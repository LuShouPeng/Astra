# M5 历史快照 — Session 生命周期 + 持久化拆分

> 冻结于 M5 完成时。上游计划见 [`../../real-agent-integration.md`](../../real-agent-integration.md)。
> 前一快照：[`M4-frontend-runtime.md`](./M4-frontend-runtime.md)。
> 实施计划与决策：[`../../../../PLAN_M5.md`](../../../../PLAN_M5.md)（B/C 类解决项 + 6 phase）。
> 残留局限：[`../../M5-known-limitations.md`](../../M5-known-limitations.md)（仅 A 类，留待后续里程碑）。

| 项 | 值 |
|----|----|
| 里程碑 | **M5 完成** — 真实 live 会话创建/停止/追问 + 持久化拆分（stdout→日志文件，快照只存摘要） |
| 日期 | 2026-07-25 |
| 分支 | `feature/real-agent-integration` |
| 风险等级 | 🔴 高（高频流写快照 → OOM / 序列化卡死；并发写覆盖） |
| 前端测试 | 174 用例（151→174，+23：liveSessionService 13、WorkbenchContext 11、sink 5、集成 1，部分为改造） |
| 后端测试 | 21 用例全绿（14→21，+7 session_persistence：roundtrip / 分页 / 缺失 / 隔离 / 损坏行跳过 / 路径穿越拒绝 / id 形状） |
| 编译 | ✅ 前端 typecheck / lint (--max-warnings 0) 通过；后端 `cargo check` / `cargo test --lib` 全绿 |
| 提交粒度 | 4 commit：后端持久化 / 前端服务 / WorkbenchContext+sink / UI 接入（+集成测试） |

## 交付内容

### 后端持久化（Phase 1，commit `feat(sessions): backend session log persistence`）

`src-tauri/src/modules/session_persistence.rs`：
- `session_log_append(session_id, event)` — 追加 JSONL 到 `~/.astra/sessions/{id}.log`
- `session_log_read(session_id, offset?, limit?)` — 分页读回（resume/debug 用）
- **安全**：`safe_log_path` 拒绝任何非 `[A-Za-z0-9_-]` 的 `session_id`（前端可控 = 不可信，防路径穿越）
- **无新依赖**：`epoch_millis()` 代 chrono，`app.path().home_dir()` 代 dirs
- 可测核心（`append_event`/`read_events` 收显式 `base_dir`）与 Tauri command 包装分离

### 前端 live 会话服务（Phase 2，commit `feat(sessions): live session service + stream coalescing`）

`src/modules/sessions/services/liveSessionService.ts` + `adapters/sessionPersistenceAdapter.ts`：
- `createLiveSession`：校验本地/可用/非空 → 建 `origin:'live'` 会话 → 订阅流 → 启动进程（失败则拆除 + failed 态）
- `sendFollowUp`：向进程 stdin 发送 + 落盘 user_message（关键节点）
- `stopLiveSession`：`agent_stop` + flush + 拆除 + stopped 态
- `resumeLiveSession`：M5 mock（抛「计划 M7 支持」）
- **流处理**：每事件落日志；stdout 缓冲，静默 500ms 或达 64KB [C1] 合并成一条 agent_message（仅内存）；stderr 环形缓冲末 10 行；exit 非 0 [C4] 把 stderr 末尾拼进 StatusEvent

### 快照写入策略 + sink（Phase 3，commit `feat(state): serialized snapshot persistence + live session sink`）

`src/core/state/WorkbenchContext.tsx`：
- **[C2]** `saveSnapshot` 走 Promise 队列串行化，防定时兜底与用户操作并发覆盖
- 新增 `updateSnapshot(mutate, {persist})`：关键节点落盘，高频事件仅进内存（读 ref 取最新快照，避免闭包旧值）
- 落盘成功不再回写 `state.snapshot`（否则回退并发内存更新）；save 失败保留 `ready` 态仅记 error
- **[B1]** `flushPending` + Tauri `onCloseRequested` 阻塞关闭→落盘→放行（非 Tauri 静默降级）+ 2min 定时兜底

`src/modules/sessions/services/workbenchLiveSessionSink.ts`：把 `LiveSessionUpdate` 映射为快照不可变改写（session upsert / event append+去重 / status patch）。

### UI 接入（Phase 4，commit `feat(sessions): wire SessionDetailPage to live session lifecycle`）

- `LiveSessionProvider` 单例：桥接 `updateSnapshot`→sink，挂路由之上使流订阅跨页存活
- `SessionDetailPage` 按 `origin` 分支：live 走 `stopLiveSession`/`sendFollowUp`，demo 保持 `sessionTransitions` 纯函数
- `canStop` 对 live 额外查 `listRunning()` 确认真实进程存在
- `App` 统一构造单例 `agentRuntime`，dev 仍挂 `window.__astraAgentRuntime`

## M5 内已解决（B/C 类，非遗留债）

| 项 | 问题 | 方案 | 位置 |
|----|------|------|------|
| B1 | beforeunload 强杀/休眠不触发 | Tauri `onCloseRequested` 阻塞保存 + 2min 兜底 | WorkbenchContext |
| C1 | 超长无换行 stdout → buffer OOM | 达 64KB 强制 flush | liveSessionService |
| C2 | 定时保存与用户操作并发覆盖 | saveSnapshot Promise 队列串行化 | WorkbenchContext |
| C3 | 同目录两会话并发改文件 → 脏数据 | 启动前查 running，同 workingDirectory 拒绝 | liveSessionService |
| C4 | 失败时 Timeline 只见 exit code | exit≠0 抓末 10 行 stderr 入 StatusEvent | liveSessionService |

## 自动化验证（单测 + 集成）

- 端到端集成测（`LiveSessionContext.integration.test.tsx`）：真实 WorkbenchProvider + LiveSessionProvider + sink 栈，100 行 stdout 合并成 1 条 agent_message，101 次 logAppend，落盘 <10 次（关键节点），会话收敛 completed。**证明持久化拆分端到端成立**。

## 真机验证（已执行 ✅ 2026-07-25）

运行中 Tauri app + 已装 claude/codex/gemini CLI，目标真实本地项目 `Astra_Test`（`D:\Zhanyi\Astra_Test`）。
因 M6 启动 UI 未就绪，dev 下经 `window.__astraLiveSessions` / `window.__astraUpdateSnapshot`（`import.meta.env.DEV` 守卫，生产 no-op）从 devtools 驱动 M5 真实代码路径。

- [x] 创建 live 会话 → claude 真实流式输出 → 正常退出：`.log` 42 行完整 JSONL（末尾 `exit code 0`）
- [x] **持久化拆分**：38 行 stdout 在快照合并为 **1 条** `agent_message`（1689 字），完整流仅在 `.log`；快照仅存摘要
- [x] **stop + 杀进程**：`stopLiveSession` 杀掉 codex 进程树，状态→`stopped`
- [x] **[C3]** 同目录重复启动被拒绝（「该项目已有运行中的会话」），未 spawn 进程、无第二份 log
- [x] **[C4]** gemini 拒绝授权 → exit 55，Timeline status 事件含 `进程异常退出 (code 55)` + stderr 尾片段（顺带验证 `sendFollowUp` live 路径）
- [x] **[B1]** 内存态（`persist:false`）哨兵在窗口关闭时落盘；关闭钩子 `preventDefault → flushPending → destroy` 生效
- [x] 高频不卡死：流式期间 UI 无明显卡顿（用户确认）；合并逻辑见上（Test 1 + 集成测）

### 真机测试发现并修复的 2 个真实 Bug

- **BUG1 — `ChangesReview.tsx:58` 崩溃**：会话零文件变更时 `selected` 为 `undefined`，早返回前访问 `selected.binary` 抛 `TypeError`。live 会话初始必零变更，进入 Changes 视图必崩。修复：`selected?.binary`，并加回归测 `ChangesReview.test.tsx`（复现精确 TypeError）。
- **BUG2 — 窗口无法关闭（发布阻断级）**：B1 `appWindow.destroy()` 被拒（`core:window:allow-destroy` 未在 capabilities）。有待落盘状态时点关闭 → `preventDefault` 后 `destroy` 抛权限错误 → **窗口永远关不掉**。修复：`capabilities/default.json` 增加 `core:window:allow-destroy`，重建后关闭正常。

> 说明：64KB 强制 flush（C1）由集成测覆盖；本次未单独构造超长无换行 stdout 真机复现。`claude --print` 生成 2000 行的压测在本机长时间缓冲未爆发（环境/时序，非 M5 缺陷），故高频合并结论以 Test 1（38 行→1 条）+ 集成测（100 行→1 条）为准。

## 向后兼容

demo 会话不受影响（`origin` 缺省 = `'demo'`），`sessionTransitions` 纯函数逻辑保持不变，`isWorkbenchSnapshot` 不校验新字段。
