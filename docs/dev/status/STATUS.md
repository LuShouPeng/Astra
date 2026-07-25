# 项目状态记录（当前）

> 本文件是项目状态的**唯一事实源**，每完成一个里程碑覆盖更新。
> 历史快照冻结在 [`history/`](./history/)，README 见 [`./README.md`](./README.md)。
> 配套开发计划：[`../real-agent-integration.md`](../real-agent-integration.md)

| 项 | 值 |
|----|----|
| 更新日期 | 2026-07-25 |
| 当前里程碑 | **M5 完成**（真实 live 会话创建/停止/追问 + 持久化拆分；单测 + 端到端集成测 + **真机验证全部通过** ✅，真机发现并修复 2 个 Bug） |
| 分支 | `feature/real-agent-integration` |
| 回滚基线 | tag `baseline-before-agent` |
| 最新 commit | `test(sessions): end-to-end live session persistence-split integration`（M5 收尾，见 git log） |
| 前端测试 | 175 用例（+1 ChangesReview 回归测；此前 174）。满载时 Timeline 一条大数据用例偶发 5s 超时，隔离运行通过（机器负载导致，非回归） |
| 后端测试 | 21 用例**全绿**（14→21，+7 session_persistence：roundtrip / 分页 / 缺失→空 / 隔离 / 损坏行跳过 / 路径穿越拒绝 / id 形状校验） |
| 编译 | ✅ 前端 typecheck/lint (--max-warnings 0) 通过；后端 `cargo check` / `cargo test --lib` 全绿 |
| M5 真机验证 | ✅ 2026-07-25 全部通过：happy path / 持久化拆分（38 行→1 条 agent_message）/ stop 杀进程 / C3 冲突拒绝 / C4 gemini exit 55+stderr 片段 / B1 关闭落盘。经 dev 钩子驱动真实代码路径，目标项目 Astra_Test。**真机发现并修复 2 Bug**：ChangesReview 零变更崩溃、窗口无法关闭（缺 `allow-destroy` 权限）。详见 [`history/M5-live-sessions.md`](./history/M5-live-sessions.md) |

## 图例

- ✅ **已实现**：功能完整、连到真实后端、可用
- 🔧 **需修改**：已存在但当前是 mock/占位，须改造才能达成目标
- ❌ **未开发**：目标功能，代码中完全不存在

---

## 里程碑进度总览

| 里程碑 | 内容 | 状态 | Git 节点 |
|--------|------|------|----------|
| M0 | 分支 + 基线 + 开发文档 | ✅ 完成 | tag `baseline-before-agent` |
| M1 | 契约扩展（agents/sessions） | ✅ 完成 | commit `feat(contracts): agent runtime types` |
| M2 | 能力发现（后端+前端+Context） | ✅ 完成 | commit `feat(agents): capability discovery` |
| M3 | 运行时后端（agent_runtime.rs+权限） | ✅ 完成 | commit `feat(tauri): agent process runtime` |
| M4 | 前端运行时服务 + 流桥接 | ✅ 完成（**IPC 真机已验证** ✅） | commit `feat(agents): frontend runtime service` + `fix(tauri): agent_start async` |
| M5 | Session 生命周期 + 持久化拆分 | ✅ 完成（逻辑 + 集成测覆盖，**真机验证已通过** ✅） | commit `session_persistence` + `live session service` + `serialized snapshot` + `wire SessionDetailPage` + `真机验证 + 2 Bug 修复` |
| M6 | 项目关联 + UI | ❌ 未开始 | — |
| M7 | Codex + Gemini 适配器 | ❌ 未开始 | — |
| M8 | 回归 + 文档 + e2e | ❌ 未开始 | — |

---

## 六项目标能力状态

| # | 能力 | 状态 | 依赖里程碑 |
|---|------|------|-----------|
| 1 | Claude CLI 接入 | 🔧 前后端服务就位（M3+M4），**流式 IPC 真机已验证**，UI 待接（M6） | M3 ✓, M4 ✓ |
| 2 | Codex CLI 接入 | 🔧 前后端 argv/适配器已映射，待授权 + UI | M3 ✓, M4 ✓, M7 |
| 3 | Gemini CLI / 运行时 / 适配器 | 🔧 前后端 argv/适配器已映射，待授权 + UI | M3 ✓, M4 ✓, M7 |
| 4 | Agent 能力发现 | ✅ **已实现**（M2） | M2 ✓ |
| 5 | 真实 Session 创建/执行/停止/恢复 | ✅ 创建/停止/追问已实现（M5，含持久化拆分）；**恢复(resume) 仍 mock，留 M7** | M5 ✓（resume M7） |
| 6 | 本地项目 ↔ 真实 Session 关联 | 🔧 需修改（数据断开） | M6 |

---

## ✅ 已实现（真实可用，连到 Rust 后端）

这些是 Agent 集成的「外壳」，与目标能力无关但为其提供地基。

| 功能 | 前端入口 | 后端命令 | 备注 |
|------|---------|---------|------|
| 打开本地文件夹为工作区 | `workspaceService.ts` | `workspace_inspect_path` / `workspace_check_exists` | 真实文件系统，`canonical_directory` 规范化 |
| 最近工作区持久化 | `WorkspaceContext.tsx` | tauri-plugin-store | 真实落盘，启动时刷新可用性 |
| 添加本地项目（写入快照） | `App.tsx` `ProjectsRoute.addProject` | `project_git_summary` | `source:'local'`，读真实 git |
| 本地项目 Git 摘要 | `projectService.ts` | `project_git_summary` | git2 读盘：分支 / clean / modified |
| 本地项目变更列表 | `changesService.ts` | `project_git_changes` | 真实 git diff，含增删行数、二进制标记 |
| 单文件 Diff | `changesService.ts` | `project_file_diff` | 真实 patch，越界路径被拒 |
| 系统打开目录 / 文件 | project/changes service | `system_open_directory` / `system_open_file` | opener 插件 |
| 桌面通知 | `desktopNotificationService.ts` | tauri-plugin-notification | 真实系统通知 |
| **Agent 能力发现（M2）** | `agents/services/capabilityDiscovery.ts` → `WorkbenchContext` | `discover_agent_capabilities` | 启动时探测 claude/codex/gemini `--version`；结果覆盖内存快照能力值，不落盘；失败静默降级 |
| **Agent 进程运行时（M3，后端）** | 见下方 M4 前端服务 | `agent_start` / `agent_send_input` / `agent_stop` / `agent_list_running` | tokio 子进程；stdout/stderr 按行经 `agent://stream/{id}` 推送；`kill_tree` 杀进程树；registry 管生命周期。**后端单测（含真机 echo）通过；进程树 `taskkill /T` 与退出钩子 `kill_all_blocking` 已真机验证（cmd→ping 树全灭）** |
| **Agent 前端运行时服务（M4）** | `agents/services/agentRuntimeService.ts` + `adapters/` | 上述四命令 + `listen('agent://stream/{id}')` | invoke 封装 + 流订阅 + 桥接 appEventBus(`agent:stream`)；三 provider 适配器。**桥接逻辑单测覆盖（6 用例）；✅ 真实 Tauri listen↔emit IPC 往返已真机验证通过**（后端 emit→前端 appEventBus 收到 stdout/exit 事件；结果见 [`M4 手动脚本`](../M4-manual-verification.md)末节），dev 模式暴露 `window.__astraAgentRuntime` |
| **会话日志持久化（M5，后端）** | `sessions/adapters/sessionPersistenceAdapter.ts` | `session_log_append` / `session_log_read` | 完整流事件按 JSONL 追加到 `~/.astra/sessions/{id}.log`，分页读回；`safe_log_path` 拒绝非法 id 防路径穿越；无新依赖。**7 条 Rust 单测覆盖** |
| **Live 会话服务（M5）** | `sessions/services/liveSessionService.ts` | 上述 runtime 四命令 + 持久化两命令 | 创建/停止/追问真实会话（`origin:'live'`）；stdout 静默 500ms/64KB 合并成 agent_message（仅内存）；exit 非 0 抓 stderr 末尾入 StatusEvent；同目录运行中会话冲突拒绝。resume 仍 mock（M7）。**13 单测 + 端到端集成测** |
| **快照持久化拆分（M5）** | `core/state/WorkbenchContext.tsx` + `sessions/services/workbenchLiveSessionSink.ts` | 经 repository（tauri-plugin-store） | 高频流事件仅更新内存快照，仅关键节点（创建/追问/exit/停止）落盘；saveSnapshot Promise 队列串行化防并发覆盖；Tauri `onCloseRequested` 阻塞关闭→落盘→放行 + 2min 定时兜底。**11 + 5 单测** |

**语义边界**（M2 真机实测确认）：`runtimeAvailable:true` = 可执行文件存在且 `--version` 成功，**不代表已授权/能实际运行**。本机 codex/gemini 未授权但探测仍返回 true（`--version` 不需登录）。真正可用性在 M3/M4 启动进程时才暴露。

**关键守卫**：以上「项目级」能力仅对 `project.source === 'local'` 生效；demo 项目被显式拒绝。

## 🔧 需修改（已存在但为 mock / 占位）

| 功能 | 位置 | 现状 | 目标改造 |
|------|------|------|---------|
| Session 停止/追问 | `SessionDetailPage.tsx` + `liveSessionService.ts` | ✅ M5 已按 `origin` 分支：live 走真实 `agent_stop`/`agent_send_input`，demo 保留纯函数 | — |
| Session 恢复(resume) | `liveSessionService.resumeLiveSession` | mock（抛「计划 M7 支持」）；需读日志重建上下文 + provider `--resume` 支持 | M7 |
| Session 从项目启动的 UI 入口 | `ProjectDetailPage` / `ProjectSessionTree` | 服务(`createLiveSession`)就位但无 UI 按钮；仅 dev-only `window.__astraAgentRuntime` | M6 |
| 运行中 stderr 实时展示 | `liveSessionService` 流处理 | stderr 只落日志，仅 exit 失败抓末尾；运行中不进 Timeline | M6（见 M5-known-limitations 3.1） |
| 项目详情 Changes 页 | `ProjectDetailPage.tsx:43` | 读 `snapshot.fileChanges`（mock 假 diff） | 与真实 git 变更打通（能力 6） |
| 项目卡片统计 | `projectSelectors.ts:10-22` | `changedFileCount = sum(session.changedFilesCount)`（mock） | live session 汇入后自然真实 |

## ❌ 未开发（目标功能，代码中完全不存在）

| 功能 | 计划落点 | 说明 |
|------|---------|------|
| 从项目启动 Agent 会话（UI） | `ProjectDetailPage` / `ProjectSessionTree` | M5 已备好 `createLiveSession` 服务，但仍无 UI 启动入口（仅 dev-only `window.__astraAgentRuntime`）；M6 补 |
| Session 恢复(resume) | `liveSessionService.resumeLiveSession` | M5 mock；需 provider `--resume` + 从日志重建，M7 补 |
| 日志文件轮转 | `session_persistence.rs` | 长跑会话日志无上限，M5 暂不处理（见 M5-known-limitations） |

---

## 契约现状（M1 后）

- `agents.ts`：✅ `ProviderCapability` 已加可选 `version`/`executablePath`/`discoveredAt`；✅ 新增 `AgentLaunchConfig`、`AgentStreamEvent`。字段留空待 M2 探测填充。
- `sessions.ts`：✅ 新增 `SessionOrigin`；`AgentSession` 已加可选 `origin`/`runtimeProcessId`/`workingDirectory`。**`origin` 缺省即 `'demo'`**——旧快照与 mock 无需迁移，`isWorkbenchSnapshot` 不校验该字段，向后兼容。
- `demoFixtures.ts`：✅ 6 条会话现显式标 `origin:'demo'`（构造时 map 注入）。
- `mod.rs`：仍为 `pub mod project; pub mod workspace;`（M1 未动后端）。

**M1 契约已就位**——`origin`/`runtimeProcessId`/`workingDirectory` 字段自 M5 起被 live 会话实际消费（创建时写入、停止/追问时按 `origin` 分支、冲突检测用 `workingDirectory`）。demo 会话仍靠 `origin` 缺省 = `'demo'` 向后兼容。

## 结构性缺口（M6 待补）

live 会话服务（`createLiveSession`）已就位并经集成测验证，但**仍无 UI 启动入口**：用户无法在本地项目卡片上点击启动真实会话，只能经 dev-only `window.__astraAgentRuntime` 手动触发。真实项目与 Session 的 UI 关联、卡片统计打通（能力 6）是 M6 的核心任务。

