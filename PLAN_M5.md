# M5 实现计划：Session 生命周期 + 持久化拆分

## 目标
- 创建/停止/恢复 live session（`origin:'live'`）
- 流事件转 TimelineEvent，桥接到 appEventBus
- **持久化拆分**：高频 stdout → 独立日志文件，快照只存摘要

## M5 内解决项（B/C 类——方案缺陷修正 + 低成本防御）

以下原属草稿"已知局限"，经评审判定为"方案该做对"或"低成本防御"，**纳入 M5 实施范围**，不作为遗留技术债。真正留给后续的局限见 [`docs/dev/M5-known-limitations.md`](docs/dev/M5-known-limitations.md)。

### B 类：方案设计缺陷修正

#### B1. 关闭兜底改用 Tauri `onCloseRequested`（不用 beforeunload）
**问题**：WebView 的 `beforeunload` 在强杀/休眠/OOM 下不触发，且其中的异步 `saveSnapshot` 可能被浏览器中断。
**M5 方案**：用 Tauri 的 `getCurrentWindow().onCloseRequested(async (event) => {...})` hook：
- 可 `event.preventDefault()` 阻塞关闭，`await saveSnapshot()` 完成后再放行
- 前端注册（`App.tsx` 或专门的 lifecycle hook）
- 定时兜底（如 2 分钟）仍保留，作为运行中崩溃的第二道防线
**验证**：手动测——运行中点关闭按钮，确认快照已落盘再退出。

### C 类：低成本防御（几十行代码，M5 顺手做）

#### C1. stdout buffer 上限（防 OOM）
**问题**：超长无 `\n` 输出（如 base64 大图）会在 buffer 无限累积到超时。
**M5 方案**：buffer 达到上限（**64KB**）即强制 flush，flush 出的 event 标 `[truncated]` 或正常切分。
**位置**：`liveSessionService` 的累积逻辑。

#### C2. saveSnapshot 串行化（防并发写冲突）
**问题**：定时保存与用户操作保存并发，可能相互覆盖或序列化冲突。
**M5 方案**：`saveSnapshot` 用 Promise 队列串行化：
```typescript
let saveQueue: Promise<unknown> = Promise.resolve();
function enqueueSave(snap: WorkbenchSnapshot): Promise<void> {
  saveQueue = saveQueue.catch(() => {}).then(() => repository.save(snap));
  return saveQueue as Promise<void>;
}
```
**位置**：`WorkbenchContext` 的 `saveSnapshot`（改造现有）。
**注意**：需保证队列里 save 的是最新 snapshot（用最新引用，不是闭包捕获的旧值）。

#### C3. 工作目录冲突检测（防脏数据）🔴
**问题**：两个 session 用同一 `workingDirectory`，并发改文件导致竞态/脏数据。
**M5 方案**：`createLiveSession` 启动前检查——若已有 `origin:'live' && status==='running'` 的 session 绑定同一 `workingDirectory`，**拒绝创建**并抛明确错误（"该项目已有运行中的会话"）。
**位置**：`liveSessionService.createLiveSession` 入口校验。

#### C4. exit 非 0 时抓 stderr 末尾塞入 StatusEvent 🔴
**问题**：Agent 失败时 Timeline 只显示 `exit code: 1`，用户不知原因（stderr 只在日志文件）。
**M5 方案**：`liveSessionService` 维护每个 session 的"最近 N 行 stderr"环形缓冲（如末 10 行）；收到 `exit` 且 `code !== 0` 时，把这些行拼进 `StatusEvent.content`（如 `"进程异常退出 (code 1)：\n<末尾 stderr>"`）。
**位置**：`liveSessionService` 的 exit 事件处理。
**注意**：这不改变"stderr 不进 Timeline"的整体策略——仅在失败时抓末尾片段作为诊断，运行中 stderr 仍只落日志（残留局限 3.1）。

---

## 核心设计决策

### 1. 持久化拆分策略
**问题**：后端 `emit('agent://stream')` 每行 stdout 都推送，若全写入 `snapshot.timelineEvents`，快照体积爆炸 + 序列化慢 + `isWorkbenchSnapshot` 校验卡死。

**方案**：
- **后端**：新增 `src-tauri/src/modules/session_persistence.rs`
  - `session_log_append(sessionId, event: AgentStreamEvent)` — 追加到 `~/.astra/sessions/{id}.log`（JSONL 格式）
  - `session_log_read(sessionId, offset?, limit?)` — 分页读日志（resume / debug 用）
  - 日志格式：`{"timestamp":"ISO","event":{"kind":"stdout","chunk":"..."}}\n`
  
- **前端**：`liveSessionService` 处理流事件时：
  - **全部流事件** → 调后端 `session_log_append` 落盘
  - **仅摘要** TimelineEvent（`agent_message`、`status`、`command`）→ 写入快照
  - stdout/stderr 的逐块原始数据**不进**快照

### 2. liveSessionService 职责

**位置**：`src/modules/sessions/services/liveSessionService.ts`

**依赖注入**：
```typescript
interface LiveSessionDeps {
  agentRuntime: AgentRuntimeService;
  persistence: SessionPersistence;  // 封装后端 session_log_* 调用
  eventBus?: AppEventBus;
}
```

**核心方法**：

#### `createLiveSession(project, provider, prompt)`
1. 生成 session 对象（`origin:'live'`, `runtimeProcessId=sessionId`, `workingDirectory=project.rootPath`, status='running'）
2. 写入快照（`snapshot.sessions.push(newSession)`）
3. 调 `agentRuntime.start({ sessionId, provider, workingDirectory, prompt })`
4. 订阅 `agent:stream` 事件：
   - 调 `persistence.logAppend(sessionId, event)` 落盘
   - 转成 TimelineEvent（见"流事件 → TimelineEvent 映射"）
   - 选择性加入快照（摘要事件）
   - `eventBus.emit('session:stream', ...)` 供 UI 实时刷新

#### `stopLiveSession(sessionId)`
1. 调 `agentRuntime.stop(sessionId)`
2. 更新快照：`session.status = 'stopped'`, `completedAt = now()`
3. `eventBus.emit('session:stopped', { sessionId })`

#### `resumeLiveSession(sessionId)` （可选，M5 暂时 mock）
1. 从 `persistence.logRead(sessionId)` 读历史
2. 重建上下文（provider 是否支持 `--resume` 参数？）
3. 重新 `start`

### 3. 流事件 → TimelineEvent 映射

| AgentStreamEvent | TimelineEvent | 写入快照？ |
|------------------|---------------|-----------|
| `{kind:'stdout', chunk}` | 累积到 buffer，遇换行或超时后合并成一条 `AgentMessageEvent` | ✅ 是（合并后） |
| `{kind:'stderr', chunk}` | 暂时忽略，或记为独立 Timeline 类型（后续扩展） | ❌ 否 |
| `{kind:'exit', code}` | `StatusEvent { from:'running', to:code===0?'completed':'failed' }` | ✅ 是 |

**累积策略**：`liveSessionService` 内部维护 `Map<SessionId, {buffer:string, timer:NodeJS.Timeout}>`:
- 收到 stdout chunk → 加入 buffer
- 若 buffer 含 `\n` 或达到超时（比如 500ms）→ flush 成一条 `AgentMessageEvent`
- 这样避免快照里堆积万行逐字符事件

### 4. sessionTransitions 改造

**`stopSession(snapshot, sessionId, timestamp)`**:
```typescript
const session = snapshot.sessions.find(s => s.id === sessionId);
if (session.origin === 'live') {
  // 委托给 liveSessionService（需改成 async，或只更新快照，实际停止由外部调）
  // 由于 transitions 是纯函数，实际进程停止应在调用方（SessionDetailPage）处理
  throw new Error('Use liveSessionService.stopLiveSession for live sessions');
}
// 否则保持现有 mock 逻辑
```

**实际上**更好的设计是：
- `sessionTransitions.ts` 保持纯函数（只操作快照）
- SessionDetailPage 的 `stop()` 函数里检查 `session.origin`：
  - `'live'` → 调 `liveSessionService.stopLiveSession` （内部会更新快照 + 调后端）
  - `'demo'` → 调 `stopSession` 纯函数

类似地处理 `applyFollowUp`。

### 5. SessionDetailPage 改造

#### 停止按钮逻辑
```typescript
const canStop =
  !capability.displayOnly &&
  (session.status === 'running' || session.status === 'waiting') &&
  (session.origin !== 'live' || isProcessRunning(session.runtimeProcessId));  // live 要查真实进程

function isProcessRunning(pid?: string): boolean {
  if (!pid) return false;
  const running = agentRuntime.listRunning();  // 同步调用，返回 string[]
  return running.includes(pid);
}
```

#### Follow-up 提交
```typescript
async function submitFollowUp(event) {
  event.preventDefault();
  setError(null);
  if (session.origin === 'live') {
    // 真实 session：发送到进程 stdin
    try {
      await agentRuntime.sendInput(session.id, message);
      // 更新快照：追加 UserMessageEvent
      const next = addUserMessage(snapshot, session.id, message, now());
      await saveSnapshot(next);
      setMessage('');
    } catch (err) {
      setError(err.message);
    }
  } else {
    // demo session：走现有 applyFollowUp
    const next = applyFollowUp(snapshot, session.id, message, nextSessionTimestamp(snapshot));
    await saveSnapshot(next);
    setMessage('');
  }
}
```

#### 订阅流事件（实时刷新）
```typescript
useEffect(() => {
  if (session.origin !== 'live' || !agentRuntime) return;
  
  // 订阅该 session 的流（直接回调，不经 appEventBus）
  const unsub = agentRuntime.onStream(session.id, (event) => {
    // UI 实时显示新事件（但不直接改快照——由 liveSessionService 统一处理）
    // 可以设个本地 state 存最新流输出，或者依赖快照的自动刷新
  });
  
  return unsub;
}, [session.id, session.origin]);
```

**或者**更简单的方案：不在 Detail 页订阅，完全依赖 `liveSessionService` 更新快照 + WorkbenchContext 的响应式刷新（snapshot 变化 → UI 重新渲染）。这样 Detail 页无需额外逻辑。

### 6. 后端 session_persistence.rs

**位置**：`src-tauri/src/modules/session_persistence.rs`

**Tauri commands**：
```rust
#[tauri::command]
pub fn session_log_append(session_id: String, event: serde_json::Value) -> Result<(), String> {
  let dir = session_log_dir()?;  // ~/.astra/sessions/
  let path = dir.join(format!("{}.log", session_id));
  let mut file = OpenOptions::new().create(true).append(true).open(&path)
    .map_err(|e| e.to_string())?;
  let line = serde_json::json!({
    "timestamp": chrono::Utc::now().to_rfc3339(),
    "event": event,
  });
  writeln!(file, "{}", serde_json::to_string(&line).unwrap())
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn session_log_read(
  session_id: String,
  offset: Option<usize>,
  limit: Option<usize>,
) -> Result<Vec<serde_json::Value>, String> {
  // 读 JSONL，按行解析，支持分页
  // 返回 [{ timestamp, event }, ...]
}

fn session_log_dir() -> Result<PathBuf, String> {
  let base = dirs::config_dir()  // 或 data_dir
    .ok_or("Cannot locate user config directory")?;
  let dir = base.join("astra").join("sessions");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}
```

**注册**：在 `lib.rs` 加 `session_log_append`、`session_log_read` 命令，`mod.rs` 加 `pub mod session_persistence;`。

### 7. 前端 SessionPersistence 适配器

**位置**：`src/modules/sessions/adapters/sessionPersistenceAdapter.ts`

```typescript
export interface SessionPersistence {
  logAppend(sessionId: SessionId, event: AgentStreamEvent): Promise<void>;
  logRead(sessionId: SessionId, offset?: number, limit?: number): Promise<SessionLogEntry[]>;
}

export interface SessionLogEntry {
  timestamp: string;
  event: AgentStreamEvent;
}

export class TauriSessionPersistence implements SessionPersistence {
  async logAppend(sessionId: SessionId, event: AgentStreamEvent): Promise<void> {
    await invoke('session_log_append', { sessionId, event });
  }
  
  async logRead(sessionId: SessionId, offset?: number, limit?: number): Promise<SessionLogEntry[]> {
    return await invoke('session_log_read', { sessionId, offset, limit });
  }
}
```

## 实施步骤

### Phase 1: 后端持久化（独立可测试）
1. 新增 `src-tauri/src/modules/session_persistence.rs`
2. 实现 `session_log_append` / `session_log_read`
3. 在 `lib.rs` 注册命令
4. 写 Rust 单测（创建临时目录，追加 / 读取日志）

### Phase 2: 前端 liveSessionService（核心逻辑）
1. 新建 `src/modules/sessions/adapters/sessionPersistenceAdapter.ts`
2. 新建 `src/modules/sessions/services/liveSessionService.ts`
3. 实现 `createLiveSession` / `stopLiveSession`（resume 暂时 mock）
   - **[C3]** `createLiveSession` 入口：工作目录冲突检测（同目录已有 running live session 则拒绝）
4. 流事件处理：累积 buffer → flush 成 Timeline event → 写快照
   - **[C1]** buffer 达 64KB 上限强制 flush（防 OOM）
   - **[C4]** 维护每 session 末 10 行 stderr 环形缓冲；exit 且 code≠0 时拼入 StatusEvent.content
5. 单测：fake adapters + 验证流事件 → Timeline 转换逻辑
   - 覆盖 C1（超长无换行输入触发 flush）、C3（冲突拒绝）、C4（失败时 stderr 注入）

### Phase 3: 快照写入策略 + sessionTransitions 改造
1. **[C2]** 改造 `WorkbenchContext.saveSnapshot`：Promise 队列串行化，防并发写覆盖
2. 快照写入时机：关键节点写（create/stop/follow-up/exit），流事件只更新内存
3. **[B1]** 注册 Tauri `onCloseRequested` hook：阻塞关闭 → await saveSnapshot → 放行；保留 2min 定时兜底
4. 在调用方（SessionDetailPage）检查 `session.origin`，分支到 liveSessionService
5. 保持 `sessionTransitions.ts` 现有 demo 逻辑不变（向后兼容）

### Phase 4: SessionDetailPage 改造
1. `stop()` 函数：检查 origin，live 调 liveSessionService
2. `submitFollowUp()` 函数：live 走 `agentRuntime.sendInput` + 手动追加 UserMessageEvent
3. `canStop` 逻辑：live 查询 `listRunning()`

### Phase 5: 集成测试 + 真机验证
1. 前端单测（151 → 增加 liveSession + C1/C2/C3/C4 用例）
2. 后端单测（14 → 增加 session_persistence）
3. 手动启动 app：创建 live session → 看到流 → 停止 → 检查日志文件
4. 验证快照体积（只含摘要，无逐块 stdout）
5. **[B1]** 手动测：运行中点关闭，确认快照落盘后才退出
6. **[C3]** 手动测：同项目重复启动被拒绝
7. **[C4]** 手动测：启动一个必失败进程（如不存在的命令），确认 Timeline 显示 stderr 片段
8. 高频流压测：`yes | head -1000` 类场景，确认不卡死、buffer 上限生效

### Phase 6: 文档更新
1. 冻结 M4 快照（已完成）
2. 更新 STATUS.md：M5 完成（含 B/C 类已解决说明）
3. 新增 `docs/dev/status/history/M5-live-sessions.md`
4. 确认 `docs/dev/M5-known-limitations.md` 与最终实现一致（若 B/C 有变更同步）

## 已决策（原"待明确"，已按推荐确认）

1. **stdout 累积超时**：**500ms**（平衡实时性与合并效率），buffer 64KB 上限兜底 [C1]。后续可配置化。
2. **stderr 处理**：**只落日志，不进 Timeline**；但 exit 非 0 时抓末尾 stderr 塞 StatusEvent [C4]。运行中 stderr 实时展示留待 M6（残留局限 3.1）。
3. **resume**：**M5 mock**（抛错/提示"暂不支持"），M7 补齐（残留局限 2.x）。
4. **快照写入策略**：**关键节点写 + 内存 buffer**；`saveSnapshot` 串行化 [C2]；关闭用 `onCloseRequested` 兜底 [B1] + 2min 定时兜底。

## 风险与缓解（M5 内已处理）

| 风险 | 缓解措施 | 状态 |
|------|---------|------|
| 高频流卡 UI | 关键节点写 + 内存 buffer，流事件不触发 saveSnapshot | ✅ Phase 3 |
| buffer OOM | 64KB 上限强制 flush [C1] | ✅ Phase 2 |
| 并发写覆盖 | saveSnapshot Promise 队列串行化 [C2] | ✅ Phase 3 |
| 工作目录脏数据 | 冲突检测拒绝重复启动 [C3] | ✅ Phase 2 |
| 崩溃丢数据 | onCloseRequested 阻塞保存 [B1] + 2min 定时兜底 | ✅ Phase 3 |
| 失败原因不可见 | exit≠0 抓 stderr 末尾入 StatusEvent [C4] | ✅ Phase 2 |

真正留给后续里程碑的局限见 [`docs/dev/M5-known-limitations.md`](docs/dev/M5-known-limitations.md)。

🟡 **日志文件体积**：长时间运行的 session 日志会很大。
- 缓解：后续可加日志轮转（比如每 10MB 切分），M5 暂不处理。

🟢 **向后兼容**：现有 demo session 不受影响（origin 缺省 = 'demo'），`sessionTransitions` 保持现有逻辑。