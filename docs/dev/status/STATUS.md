# 项目状态记录（当前）

> 本文件是项目状态的**唯一事实源**，每完成一个里程碑覆盖更新。
> 历史快照冻结在 [`history/`](./history/)，README 见 [`./README.md`](./README.md)。
> 配套开发计划：[`../real-agent-integration.md`](../real-agent-integration.md)

| 项 | 值 |
|----|----|
| 更新日期 | 2026-07-25 |
| 当前里程碑 | **M4 完成**（前端运行时服务 + 流桥接；桥接逻辑已单测，**真机 IPC 已验证通过** ✅） |
| 分支 | `feature/real-agent-integration` |
| 回滚基线 | tag `baseline-before-agent` |
| 最新 commit | `fix(tauri): make agent_start async so tokio tasks have a runtime`（M4 真机验证中发现的阻塞 bug 修复，见 git log） |
| 前端测试 | 151 用例全通过（+6 agents runtime/adapter） |
| 后端测试 | 14 用例**全绿**（含 agent_runtime 5 条真机 echo；进程树 kill 已临时测试真机验证后移除）。此前 2 条 project.rs 失败为测试 bug（temp_dir 短路径 vs canonical 长路径），已于 `fix(tests)` 修复 |
| 编译 | ✅ 前端 typecheck/lint (--max-warnings 0) 通过；后端 `cargo build` / `cargo test --lib` 全绿 |
| M4 真机修复 | ⚠️→✅ `agent_start` 原为同步命令，真机启动即 tokio panic（"no reactor running"）；改 `async fn` 由 Tauri 托管 runtime 执行后修复。单测因 `#[tokio::test]` 自带 runtime 未能暴露此问题 |

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
| M5 | Session 生命周期 + 持久化拆分 | ❌ 未开始 | — |
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
| 5 | 真实 Session 创建/执行/停止/恢复 | 🔧 需修改（仅 mock） | M5 |
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

**语义边界**（M2 真机实测确认）：`runtimeAvailable:true` = 可执行文件存在且 `--version` 成功，**不代表已授权/能实际运行**。本机 codex/gemini 未授权但探测仍返回 true（`--version` 不需登录）。真正可用性在 M3/M4 启动进程时才暴露。

**关键守卫**：以上「项目级」能力仅对 `project.source === 'local'` 生效；demo 项目被显式拒绝。

## 🔧 需修改（已存在但为 mock / 占位）

| 功能 | 位置 | 现状 | 目标改造 |
|------|------|------|---------|
| Session 停止 | `sessionTransitions.ts` `stopSession` | 纯快照改写，注释「local simulation」 | 按 `origin` 分支：live 走真实 `agent_stop` |
| Session 追问 | `sessionTransitions.ts` `applyFollowUp` | 纯快照改写 | live 走 `agent_send_input` |
| Session 详情页 | `SessionDetailPage.tsx` | `canStop` 基于 mock 状态；无流订阅 | 接真实进程状态 + 订阅 `agent://stream` |
| 项目详情 Changes 页 | `ProjectDetailPage.tsx:43` | 读 `snapshot.fileChanges`（mock 假 diff） | 与真实 git 变更打通（能力 6） |
| 项目卡片统计 | `projectSelectors.ts:10-22` | `changedFileCount = sum(session.changedFilesCount)`（mock） | live session 汇入后自然真实 |

## ❌ 未开发（目标功能，代码中完全不存在）

| 功能 | 计划落点 | 说明 |
|------|---------|------|
| Session 持久化拆分 | `src-tauri/src/modules/session_persistence.rs` | 无日志落盘机制 |
| Live Session 服务 | `liveSessionService.ts` | 无法创建真实 session；6 条全为 mock |
| 从项目启动 Agent 会话 | `ProjectDetailPage` / `ProjectSessionTree` | 无任何启动入口（M4 暴露 dev-only `window.__astraAgentRuntime`，非 UI） |

---

## 契约现状（M1 后）

- `agents.ts`：✅ `ProviderCapability` 已加可选 `version`/`executablePath`/`discoveredAt`；✅ 新增 `AgentLaunchConfig`、`AgentStreamEvent`。字段留空待 M2 探测填充。
- `sessions.ts`：✅ 新增 `SessionOrigin`；`AgentSession` 已加可选 `origin`/`runtimeProcessId`/`workingDirectory`。**`origin` 缺省即 `'demo'`**——旧快照与 mock 无需迁移，`isWorkbenchSnapshot` 不校验该字段，向后兼容。
- `demoFixtures.ts`：✅ 6 条会话现显式标 `origin:'demo'`（构造时 map 注入）。
- `mod.rs`：仍为 `pub mod project; pub mod workspace;`（M1 未动后端）。

**M1 契约已就位，但无任何功能变为可用**——这些类型要到 M2（能力发现填充探测字段）、M5（live 会话消费 origin/进程字段）才被实际使用。六项能力状态因此不变。

## 结构性缺口（最重要的一条）

真实本地项目与 Session **完全断开**：可以打开真实文件夹、读真实 git，但没有任何入口在本地项目上启动会话；6 条 mock session 全绑在 3 个 `demo://` 项目下。真实项目加进来后卡片显示「真实元数据 + Agent 相关全为 0」，与 demo 项目并排共存。这正是能力 6（M6）要补的洞。

