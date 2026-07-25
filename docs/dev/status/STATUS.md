# 项目状态记录（当前）

> 本文件是项目状态的**唯一事实源**，每完成一个里程碑覆盖更新。
> 历史快照冻结在 [`history/`](./history/)，README 见 [`./README.md`](./README.md)。
> 配套开发计划：[`../real-agent-integration.md`](../real-agent-integration.md)

| 项 | 值 |
|----|----|
| 更新日期 | 2026-07-25 |
| 当前里程碑 | **M0 完成**（基线已建立，集成开发尚未开始） |
| 分支 | `feature/real-agent-integration` |
| 回滚基线 | tag `baseline-before-agent` |
| 最新 commit | `c5171f4` docs(dev): 开发文档与 git 管理策略 |
| 前端测试 | 138 用例（Timeline 2 条性能用例偶发超时，非阻塞） |
| 后端测试 | 6 用例（4 通过；2 条路径校验用例失败，pre-existing） |
| 编译 | ✅ 前端 typecheck/lint 通过；后端 `cargo build` 成功（18MB exe） |

## 图例

- ✅ **已实现**：功能完整、连到真实后端、可用
- 🔧 **需修改**：已存在但当前是 mock/占位，须改造才能达成目标
- ❌ **未开发**：目标功能，代码中完全不存在

---

## 里程碑进度总览

| 里程碑 | 内容 | 状态 | Git 节点 |
|--------|------|------|----------|
| M0 | 分支 + 基线 + 开发文档 | ✅ 完成 | tag `baseline-before-agent` |
| M1 | 契约扩展（agents/sessions） | ❌ 未开始 | — |
| M2 | 能力发现（后端+前端+Context） | ❌ 未开始 | — |
| M3 | 运行时后端（agent_runtime.rs+权限） | ❌ 未开始 | — |
| M4 | 前端运行时服务 + 流桥接 | ❌ 未开始 | — |
| M5 | Session 生命周期 + 持久化拆分 | ❌ 未开始 | — |
| M6 | 项目关联 + UI | ❌ 未开始 | — |
| M7 | Codex + Gemini 适配器 | ❌ 未开始 | — |
| M8 | 回归 + 文档 + e2e | ❌ 未开始 | — |

---

## 六项目标能力状态

| # | 能力 | 状态 | 依赖里程碑 |
|---|------|------|-----------|
| 1 | Claude CLI 接入 | ❌ 未开发 | M3, M4 |
| 2 | Codex CLI 接入 | ❌ 未开发 | M7 |
| 3 | Gemini CLI / 运行时 / 适配器 | ❌ 未开发 | M3, M7 |
| 4 | Agent 能力发现 | ❌ 未开发 | M2 |
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

**关键守卫**：以上「项目级」能力仅对 `project.source === 'local'` 生效；demo 项目被显式拒绝。

## 🔧 需修改（已存在但为 mock / 占位）

| 功能 | 位置 | 现状 | 目标改造 |
|------|------|------|---------|
| Provider 能力 | `demoFixtures.ts:9-23` | 硬编码 `runtimeAvailable:false`，gemini `displayOnly:true` | 由 M2 能力探测覆盖 |
| Session 停止 | `sessionTransitions.ts` `stopSession` | 纯快照改写，注释「local simulation」 | 按 `origin` 分支：live 走真实 `agent_stop` |
| Session 追问 | `sessionTransitions.ts` `applyFollowUp` | 纯快照改写 | live 走 `agent_send_input` |
| Session 详情页 | `SessionDetailPage.tsx` | `canStop` 基于 mock 状态；无流订阅 | 接真实进程状态 + 订阅 `agent://stream` |
| 项目详情 Changes 页 | `ProjectDetailPage.tsx:43` | 读 `snapshot.fileChanges`（mock 假 diff） | 与真实 git 变更打通（能力 6） |
| 项目卡片统计 | `projectSelectors.ts:10-22` | `changedFileCount = sum(session.changedFilesCount)`（mock） | live session 汇入后自然真实 |

## ❌ 未开发（目标功能，代码中完全不存在）

| 功能 | 计划落点 | 说明 |
|------|---------|------|
| Agent 子进程运行时 | `src-tauri/src/modules/agent_runtime.rs` | 后端零进程命令；`invoke_handler` 仅 7 个只读命令 |
| 能力发现 | `src-tauri/src/modules/agent_capability.rs` | 无 CLI 探测；PROVIDERS 是静态常量 |
| Session 持久化拆分 | `src-tauri/src/modules/session_persistence.rs` | 无日志落盘机制 |
| 前端 Agent 适配器 | `src/modules/agents/` | 整个模块不存在 |
| 前端运行时服务 + 流桥接 | `agentRuntimeService.ts` | `appEventBus` 是纯内存，未接 `@tauri-apps/api/event` |
| Live Session 服务 | `liveSessionService.ts` | 无法创建真实 session；6 条全为 mock |
| 从项目启动 Agent 会话 | `ProjectDetailPage` / `ProjectSessionTree` | 无任何启动入口 |
| 进程执行权限 | `capabilities/default.json` | 无 shell/进程权限 |
| tokio 依赖 | `Cargo.toml` | 未引入异步/进程运行时 |

---

## 契约现状（决定 M1 起点）

- `agents.ts`：`ProviderCapability` **仅 4 字段**（provider/label/runtimeAvailable/displayOnly），缺 `version`/`executablePath`/`discoveredAt`；无 `AgentLaunchConfig`、`AgentStreamEvent`。
- `sessions.ts`：`AgentSession` **无** `origin`/`runtimeProcessId`/`workingDirectory` 字段。
- `mod.rs`：仅 `pub mod project; pub mod workspace;`。

## 结构性缺口（最重要的一条）

真实本地项目与 Session **完全断开**：可以打开真实文件夹、读真实 git，但没有任何入口在本地项目上启动会话；6 条 mock session 全绑在 3 个 `demo://` 项目下。真实项目加进来后卡片显示「真实元数据 + Agent 相关全为 0」，与 demo 项目并排共存。这正是能力 6（M6）要补的洞。

