# 真实 Agent 集成开发文档

> 版本: v1.0 · 日期: 2026-07-25 · 分支: `feature/real-agent-integration`
> 回滚基线: tag `baseline-before-agent`

## 1. 需求概述

将原型从「确定性 Mock」升级为「真实 Agent 运行」，覆盖六项能力：

| # | 能力 | 说明 |
|---|------|------|
| 1 | Claude CLI 接入 | 启动真实 `claude` 子进程，双向流式交互 |
| 2 | Codex CLI 接入 | 启动真实 `codex` 子进程，复用运行时框架 |
| 3 | Gemini CLI、运行时和适配器 | 统一运行时抽象 + 三个 Provider 适配器 |
| 4 | Agent 能力发现 | 运行时探测 CLI 是否安装、版本、可执行性 |
| 5 | 真实 Session 创建/执行/停止/恢复 | Session 绑定真实进程与磁盘持久化的元数据 |
| 6 | 本地项目与真实 Session 关联 | 本地项目目录作为 Agent 工作目录，双向关联 |

### 设计原则

- **Mock 与真实共存**：保留确定性 mock 作为离线与回归测试路径（参考 roadmap Phase 1）。
- **契约优先**：先改 `src/core/contracts/`，再实现服务与 UI。
- **后端持有进程**：所有子进程生命周期在 Rust 侧，前端只通过 IPC + 事件流交互。
- **路径受限**：Agent 工作目录必须经过既有 `safe_directory()` 校验，禁止越界。
- **可回滚**：每个里程碑一个 commit，关键节点打 tag。

---

## 2. 当前架构与涉及模块

### 2.1 前端分层

```
src/core/contracts/     领域契约（agents.ts / sessions.ts / projects.ts / events.ts / workbenchData.ts）
src/core/data/          持久化（prototypeRepository.ts / tauriPrototypeStore.ts）
src/core/events/        事件总线（appEventBus.ts）
src/core/state/         全局状态（WorkbenchContext.tsx）
src/modules/sessions/   会话 UI 与状态机（SessionDetailPage.tsx / sessionTransitions.ts）
src/modules/projects/   项目服务（projectService.ts）
src/modules/demo/       demo 数据与 provider 能力（demoFixtures.ts）
```

### 2.2 后端分层

```
src-tauri/src/lib.rs                     invoke_handler 注册中心
src-tauri/src/modules/mod.rs             模块声明
src-tauri/src/modules/workspace.rs       safe_directory / 路径规范化（可复用）
src-tauri/src/modules/project.rs         Git 只读操作
src-tauri/capabilities/default.json      Tauri 权限声明
src-tauri/Cargo.toml                     Rust 依赖
```

### 2.3 关键现状事实（阅读代码确认）

- `AgentProvider = 'claude' | 'codex' | 'gemini'`，`ProviderCapability` 有 `runtimeAvailable/displayOnly` 字段，但当前全部硬编码在 `demoFixtures.ts`，`runtimeAvailable: false`。
- `AgentSession` 无任何真实进程字段；`sessionTransitions.ts` 的 `stopSession` 只改快照状态，注释明确写「local simulation」。
- 数据持久化统一走 `WorkbenchSnapshot` → `TauriPrototypeStore`（单个 `workbench.v1.json`）。真实 Session 的高频输出不适合塞进这个快照。
- `appEventBus` 是纯前端内存事件总线，**不接收** Tauri 后端事件；后端流式输出需要另接 `@tauri-apps/api/event` 的 `listen`。
- 权限模型：`capabilities/default.json` 未包含任何 shell/进程执行权限。启动子进程需要新增插件与权限。

---

## 3. 实现方式（按能力拆解）

### 能力 3、4 优先：运行时抽象 + 能力发现（地基）

**契约新增** `src/core/contracts/agents.ts`：
```typescript
export interface ProviderCapability {
  provider: AgentProvider;
  label: string;
  runtimeAvailable: boolean;   // 改为运行时探测结果
  displayOnly: boolean;
  version?: string;            // 新增：探测到的版本
  executablePath?: string;     // 新增：解析到的可执行文件
  discoveredAt?: string;       // 新增：探测时间
}

export interface AgentLaunchConfig {
  provider: AgentProvider;
  workingDirectory: string;    // 必须是已注册的本地项目根
  prompt: string;
  sessionId: string;
}

export type AgentStreamEvent =
  | { kind: 'stdout'; chunk: string }
  | { kind: 'stderr'; chunk: string }
  | { kind: 'exit'; code: number | null };
```

**后端新增** `src-tauri/src/modules/agent_capability.rs`：
- `discover_agent_capabilities()`：对 `claude/codex/gemini` 逐一执行 `which`（跨平台用 `std::process::Command` + `--version`），返回 `HashMap<provider, capability>`。
- 用 `tauri::async_runtime::spawn_blocking` 避免阻塞。

**前端新增** `src/modules/agents/services/capabilityDiscovery.ts`：封装 `invoke('discover_agent_capabilities')`。

**接入点** `WorkbenchContext.tsx`：`load()` 成功后追加一次能力探测，把结果 merge 进 `snapshot.providerCapabilities`（覆盖 demo 硬编码值）。

---

### 能力 1、2、3：CLI 接入与适配器

**后端新增** `src-tauri/src/modules/agent_runtime.rs`（核心）：
```rust
// 进程注册表：sessionId -> Child handle + 状态
struct AgentRegistry { procs: Mutex<HashMap<String, AgentHandle>> }

#[tauri::command] agent_start(config, state, app) -> Result<(), AgentError>
#[tauri::command] agent_send_input(session_id, text, state) -> Result<(), AgentError>
#[tauri::command] agent_stop(session_id, state) -> Result<(), AgentError>
#[tauri::command] agent_list_running(state) -> Vec<String>
```
- 用 `std::process::Command` / `tokio::process::Command` 启动，`stdin/stdout/stderr` 全 piped。
- 独立线程读 stdout/stderr，每行通过 `app.emit("agent://stream/{sessionId}", AgentStreamEvent)` 推给前端。
- `workingDirectory` 先过 `safe_directory()`。
- provider → 命令映射集中在一个函数（claude/codex/gemini 只是 argv 不同），这就是「适配器」在后端的落点。

**前端新增** `src/modules/agents/`：
```
adapters/claudeAdapter.ts   # 组装 launch 参数（模型、flags）
adapters/codexAdapter.ts
adapters/geminiAdapter.ts
adapters/agentAdapter.ts    # 统一接口 buildLaunchConfig(project, prompt)
services/agentRuntimeService.ts  # invoke + listen 封装，暴露 start/stop/send/onStream
index.ts
```

**Gemini 解禁** `demoFixtures.ts`：`displayOnly` 由能力探测覆盖；若探测到已安装则 `runtimeAvailable:true, displayOnly:false`。

---

### 能力 5：真实 Session 生命周期

**契约扩展** `src/core/contracts/sessions.ts`：
```typescript
export type SessionOrigin = 'demo' | 'live';   // 新增
export interface AgentSession {
  // ...现有字段
  origin: SessionOrigin;        // 区分 mock/真实
  runtimeProcessId?: string;    // 后端进程 key（= sessionId）
  workingDirectory?: string;    // 真实工作目录
}
```

**新增** `src/modules/sessions/services/liveSessionService.ts`：
- `createLiveSession(project, provider, prompt)`：写入一条 `origin:'live'` 的 session 到快照 → 调 `agentRuntimeService.start`。
- `stopLiveSession(sessionId)`：调后端 `agent_stop` → 更新快照状态。
- `resumeLiveSession(sessionId)`：从持久化的历史重建上下文再 `start`（CLI 若支持 `--resume` 则透传，否则回放 prompt）。
- 流事件 → 追加 `TimelineEvent` → 触发既有 `appEventBus`。

**改造** `sessionTransitions.ts`：`stopSession`/`applyFollowUp` 增加 `origin` 分支——`live` 走真实调用，`demo` 保持现有模拟逻辑。

**改造** `SessionDetailPage.tsx`：
- `canStop` 逻辑接入真实进程运行状态。
- follow-up 提交时，`live` session 走 `agentRuntimeService.sendInput`。
- 订阅 `agent://stream` 事件实时刷新 Timeline。

**持久化拆分**（重要）：真实 Session 的高频 stdout **不写入** `workbench.v1.json`。新增后端 `session_persistence.rs` 把日志落到 `~/.astra/sessions/{id}.log`，快照里只存摘要与元数据。

---

### 能力 6：本地项目 ↔ 真实 Session 关联

**契约扩展** `src/core/contracts/projects.ts`：项目本身不必存 sessionId（可由 `sessions.filter(s => s.projectId===p.id)` 派生），但需保证 `createLiveSession` 强制校验 `project.source==='local' && status==='available'`。

**改造** `projectService.ts`：新增 `startAgentSession(project, provider, prompt)` 作为门面，内部委托 `liveSessionService`，并复用现有 `openDirectory` 的本地校验。

**改造** `ProjectDetailPage.tsx` / `ProjectSessionTree.tsx`：新增「启动 Agent 会话」入口，列表区分 live/demo session 并显示运行状态。

---

## 4. 后端权限与依赖改动（易漏）

| 文件 | 改动 |
|------|------|
| `src-tauri/Cargo.toml` | 加 `tokio`（进程/异步）；评估 `tauri-plugin-shell`（若用官方 shell 权限模型） |
| `src-tauri/capabilities/default.json` | 新增自定义进程权限；若用 shell 插件需声明 `shell:allow-execute` 并配置 allowlist |
| `src-tauri/src/lib.rs` | 注册 `agent_*` 与 `discover_*`、`session_*` 命令；`.manage(AgentRegistry::default())` |
| `src-tauri/src/modules/mod.rs` | `pub mod agent_runtime; pub mod agent_capability; pub mod session_persistence;` |
| `tauri.conf.json` CSP | 无需放开网络；进程走 IPC，保持现有 CSP |

---

## 5. 难点与最易出问题的环节

### 🔴 高风险（最容易出问题）

1. **流式 IPC 与前端事件总线不通**
   后端 `app.emit` 走的是 `@tauri-apps/api/event`，而项目现有 `appEventBus` 是纯内存的。**必须**在 `agentRuntimeService` 里用 `listen()` 桥接两者，否则 Timeline 永远收不到真实输出。这是最容易被忽略、且 mock 测试无法暴露的问题。

2. **进程生命周期与孤儿进程**
   应用崩溃/刷新后，Rust 侧 `Child` 若未妥善 kill 会残留孤儿进程。需要：窗口关闭钩子里遍历 registry kill；`agent_stop` 要 kill 整个进程树（CLI 可能 fork 子进程，Windows 上尤其麻烦，需 `taskkill /T` 或 job object）。

3. **持久化膨胀**
   若把 stdout 全塞进 `WorkbenchSnapshot`，`prototypeRepository` 每次 `save` 都会序列化整个大对象 + `isWorkbenchSnapshot` 全量校验，性能和体积都会爆炸。**必须**日志与快照分离存储。

4. **stdout 解析与背压**
   CLI 输出是流，非结构化。按行缓冲要处理不完整行、超长行、ANSI 转义、二进制。高频输出要节流（前端按帧合并），否则 React 状态风暴。

### 🟡 中风险

5. **跨平台 CLI 发现**：Windows 是 `claude.cmd`/`.exe`，PATH 解析、`where` vs `which` 差异；能力探测要兼容。

6. **权限模型**：Tauri 2 默认不允许执行进程，`capabilities` 配置错误会导致 invoke 静默失败或运行时报权限错。

7. **stopSession 语义分裂**：现有函数对 display-only 抛错、只处理 running/waiting。加入 live 分支后状态机要重新梳理，避免 mock 测试回归。

8. **恢复（resume）语义**：三个 CLI 的 resume 能力不同（是否支持 `--continue`/`--resume`、session id 格式）。无法真正 resume 时的降级策略要明确。

### 🟢 低风险

9. 契约类型扩展（加可选字段，向后兼容 `isWorkbenchSnapshot` 校验）。
10. UI 按钮与状态展示。

---

## 6. 工作分解（里程碑 = commit/tag 节点）

| 里程碑 | 内容 | 验证 | Git 节点 |
|--------|------|------|----------|
| M0 | 分支+基线（已完成） | 138 测试通过 | tag `baseline-before-agent` |
| M1 | 契约扩展（agents/sessions） + 单测 | `npm run typecheck && test` | commit `feat(contracts): agent runtime types` |
| M2 | 能力发现（后端 + 前端 + Context 接入） | 探测本机 CLI 返回正确 | commit `feat(agents): capability discovery` |
| M3 | 运行时后端（agent_runtime.rs + 权限） | `cargo test`；能启动 echo 进程 | commit `feat(tauri): agent process runtime` |
| M4 | 前端运行时服务 + 流桥接 | 手动启动 claude 看到流 | tag `milestone-claude-live` |
| M5 | Session 生命周期 + 持久化拆分 | 创建/停止/恢复闭环 | commit `feat(sessions): live lifecycle` |
| M6 | 项目关联 + UI | 从项目页启动真实会话 | commit `feat(projects): link live sessions` |
| M7 | Codex 适配器 + Session 恢复 | Claude/Codex 可启动，live Session 可恢复；不新增 Gemini 专用适配 | tag `milestone-codex-live` |
| M8 | 回归 + 文档 + e2e | 全套 verification | commit `test: agent integration coverage` |

---

## 7. Git 代码管理策略

### 分支与标签
```bash
# 已建立
git tag  baseline-before-agent          # 回滚基线
git checkout -b feature/real-agent-integration

# 每个里程碑提交后打 tag（关键节点）
git tag milestone-claude-live
git tag milestone-codex-live
```

### 提交规范
- 每个里程碑一个（或多个小）commit，遵循 Conventional Commits。
- 契约 / 后端 / 前端 / 测试尽量分开提交，回滚粒度更细。

### 回滚手册
```bash
# 回到集成开发前的完全干净状态
git checkout main                       # 或 git reset --hard baseline-before-agent

# 回滚到某个里程碑
git reset --hard milestone-claude-live

# 只撤销最后一次提交但保留改动
git reset --soft HEAD~1

# 放弃分支全部工作
git checkout main && git branch -D feature/real-agent-integration
```

> ⚠️ `reset --hard` 会丢弃工作区改动，执行前先 `git status` 确认，必要时 `git stash`。

### 提交前检查（每次里程碑）
```bash
npm run typecheck && npm run lint && npm run test
cd src-tauri && cargo fmt --check && cargo test && cd ..
```

---

## 8. 一句话总结

先搭「契约 + 能力发现 + 后端运行时」三块地基（M1–M3），把**流式 IPC 桥接**和**日志/快照分离**这两个最易翻车的点在 M4–M5 打通，M6 接通项目 UI，M7 仅完善 Codex 与 Session 恢复。Gemini 保留既有通用运行时映射，不新增专用适配工作。全程以里程碑 tag 保证可随时回滚到 `baseline-before-agent`。
