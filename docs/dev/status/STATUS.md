# 项目状态记录（当前）

> 本文件是项目状态的**唯一事实源**，每完成一个里程碑覆盖更新。
> 历史快照冻结在 [`history/`](./history/)，README 见 [`./README.md`](./README.md)。
> 配套开发计划：[`../real-agent-integration.md`](../real-agent-integration.md)

| 项          | 值                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 更新日期    | 2026-07-25                                                                                                                                                                                                                                                                                                                                                               |
| 当前里程碑  | **M8 完成 + Agent 登录入口补充**（Settings 可在独立终端启动 Claude/Codex 登录；不读取用户配置）                                                                                                                                                                                                                                                                          |
| 分支        | `feature/real-agent-integration`                                                                                                                                                                                                                                                                                                                                         |
| 回滚基线    | tag `baseline-before-agent`                                                                                                                                                                                                                                                                                                                                              |
| 最新 commit | `7a2983b feat(sessions): resume Codex live sessions`；M8 提交待本轮完成                                                                                                                                                                                                                                                                                                  |
| 前端测试    | **181 用例**；Agent Settings 定向测试 6/6 通过（M8 全量基线 180/180）                                                                                                                                                                                                                                                                                                    |
| 后端测试    | **23/23 全绿**（新增登录 Provider 守卫）                                                                                                                                                                                                                                                                                                                                 |
| 编译        | ✅ typecheck；✅ ESLint 0 warnings；✅ Vite production build；✅ cargo fmt/check/test                                                                                                                                                                                                                                                                                    |
| E2E         | 首轮 22/24；两视口同一旧 accessible-name 定位器失败，已修复；修复后重跑授权被拒，待最终复跑                                                                                                                                                                                                                                                                              |
| M5 真机验证 | ✅ 2026-07-25 全部通过：happy path / 持久化拆分（38 行→1 条 agent_message）/ stop 杀进程 / C3 冲突拒绝 / C4 gemini exit 55+stderr 片段 / B1 关闭落盘。经 dev 钩子驱动真实代码路径，目标项目 Astra_Test。**真机发现并修复 2 Bug**：ChangesReview 零变更崩溃、窗口无法关闭（缺 `allow-destroy` 权限）。详见 [`history/M5-live-sessions.md`](./history/M5-live-sessions.md) |

## 图例

- ✅ **已实现**：功能完整、连到真实后端、可用
- 🔧 **需修改**：已存在但当前是 mock/占位，须改造才能达成目标
- ❌ **未开发**：目标功能，代码中完全不存在

---

## 里程碑进度总览

| 里程碑 | 内容                                | 状态                                                | Git 节点                                                                                                                           |
| ------ | ----------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| M0     | 分支 + 基线 + 开发文档              | ✅ 完成                                             | tag `baseline-before-agent`                                                                                                        |
| M1     | 契约扩展（agents/sessions）         | ✅ 完成                                             | commit `feat(contracts): agent runtime types`                                                                                      |
| M2     | 能力发现（后端+前端+Context）       | ✅ 完成                                             | commit `feat(agents): capability discovery`                                                                                        |
| M3     | 运行时后端（agent_runtime.rs+权限） | ✅ 完成                                             | commit `feat(tauri): agent process runtime`                                                                                        |
| M4     | 前端运行时服务 + 流桥接             | ✅ 完成（**IPC 真机已验证** ✅）                    | commit `feat(agents): frontend runtime service` + `fix(tauri): agent_start async`                                                  |
| M5     | Session 生命周期 + 持久化拆分       | ✅ 完成（逻辑 + 集成测覆盖，**真机验证已通过** ✅） | commit `session_persistence` + `live session service` + `serialized snapshot` + `wire SessionDetailPage` + `真机验证 + 2 Bug 修复` |
| M6     | 项目关联 + UI                       | ✅ 完成（本轮按要求未运行测试）                     | commit `feat(projects): link live sessions`                                                                                        |
| M7     | Codex 适配 + Session 恢复           | ✅ 完成                                             | commit `feat(sessions): resume Codex live sessions`                                                                                |
| M8     | 回归 + 文档 + e2e                   | ✅ 实现完成；E2E 最终复跑待授权                     | commit `test: complete agent integration regression`                                                                               |

---

## 六项目标能力状态

| #   | 能力                             | 状态                                                      | 依赖里程碑             |
| --- | -------------------------------- | --------------------------------------------------------- | ---------------------- |
| 1   | Claude CLI 接入                  | ✅ 前后端服务、流式 IPC 与项目启动 UI 已接通              | M3 ✓, M4 ✓, M6 ✓       |
| 2   | Codex CLI 接入                   | ✅ 新建与 `exec resume --last`、项目 UI、日志恢复均接通   | M3 ✓, M4 ✓, M6 ✓, M7 ✓ |
| 3   | Gemini CLI / 运行时              | 🔧 保留既有通用映射与能力发现；不再安排专用适配里程碑     | M3 ✓, M4 ✓             |
| 4   | Agent 能力发现                   | ✅ **已实现**（M2）                                       | M2 ✓                   |
| 5   | 真实 Session 创建/执行/停止/恢复 | ✅ 创建/停止/追问；Codex 原生恢复已实现                   | M5 ✓, M7 ✓             |
| 6   | 本地项目 ↔ 真实 Session 关联     | ✅ 项目页启动、`projectId` 双向派生、live/demo 展示已接通 | M6 ✓                   |

---

## ✅ 已实现（真实可用，连到 Rust 后端）

这些是 Agent 集成的「外壳」，与目标能力无关但为其提供地基。

| 功能                             | 前端入口                                                                            | 后端命令                                                                 | 备注                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打开本地文件夹为工作区           | `workspaceService.ts`                                                               | `workspace_inspect_path` / `workspace_check_exists`                      | 真实文件系统，`canonical_directory` 规范化                                                                                                                                                                                                                                                                             |
| 最近工作区持久化                 | `WorkspaceContext.tsx`                                                              | tauri-plugin-store                                                       | 真实落盘，启动时刷新可用性                                                                                                                                                                                                                                                                                             |
| 添加本地项目（写入快照）         | `App.tsx` `ProjectsRoute.addProject`                                                | `project_git_summary`                                                    | `source:'local'`，读真实 git                                                                                                                                                                                                                                                                                           |
| 本地项目 Git 摘要                | `projectService.ts`                                                                 | `project_git_summary`                                                    | git2 读盘：分支 / clean / modified                                                                                                                                                                                                                                                                                     |
| 本地项目变更列表                 | `changesService.ts`                                                                 | `project_git_changes`                                                    | 真实 git diff，含增删行数、二进制标记                                                                                                                                                                                                                                                                                  |
| 单文件 Diff                      | `changesService.ts`                                                                 | `project_file_diff`                                                      | 真实 patch，越界路径被拒                                                                                                                                                                                                                                                                                               |
| 系统打开目录 / 文件              | project/changes service                                                             | `system_open_directory` / `system_open_file`                             | opener 插件                                                                                                                                                                                                                                                                                                            |
| 桌面通知                         | `desktopNotificationService.ts`                                                     | tauri-plugin-notification                                                | 真实系统通知                                                                                                                                                                                                                                                                                                           |
| **Agent 能力发现（M2）**         | `agents/services/capabilityDiscovery.ts` → `WorkbenchContext`                       | `discover_agent_capabilities`                                            | 启动时探测 claude/codex/gemini `--version`；结果覆盖内存快照能力值，不落盘；失败静默降级                                                                                                                                                                                                                               |
| **Agent 进程运行时（M3，后端）** | 见下方 M4 前端服务                                                                  | `agent_start` / `agent_send_input` / `agent_stop` / `agent_list_running` | tokio 子进程；stdout/stderr 按行经 `agent://stream/{id}` 推送；`kill_tree` 杀进程树；registry 管生命周期。**后端单测（含真机 echo）通过；进程树 `taskkill /T` 与退出钩子 `kill_all_blocking` 已真机验证（cmd→ping 树全灭）**                                                                                           |
| **Agent 前端运行时服务（M4）**   | `agents/services/agentRuntimeService.ts` + `adapters/`                              | 上述四命令 + `listen('agent://stream/{id}')`                             | invoke 封装 + 流订阅 + 桥接 appEventBus(`agent:stream`)；三 provider 适配器。**桥接逻辑单测覆盖（6 用例）；✅ 真实 Tauri listen↔emit IPC 往返已真机验证通过**（后端 emit→前端 appEventBus 收到 stdout/exit 事件；结果见 [`M4 手动脚本`](../M4-manual-verification.md)末节），dev 模式暴露 `window.__astraAgentRuntime` |
| **Agent 登录入口**               | `SettingsPage` → Agents + `agentAuthService.ts`                                     | `agent_open_login`                                                       | 在独立可交互终端运行 Claude 或 `codex login`；不读取 `~/.claude/settings.json`，不处理 Gemini 登录                                                                                                                                                                                                                     |
| **会话日志持久化（M5，后端）**   | `sessions/adapters/sessionPersistenceAdapter.ts`                                    | `session_log_append` / `session_log_read`                                | 完整流事件按 JSONL 追加到 `~/.astra/sessions/{id}.log`，分页读回；`safe_log_path` 拒绝非法 id 防路径穿越；无新依赖。**7 条 Rust 单测覆盖**                                                                                                                                                                             |
| **Live 会话服务（M5+M7）**       | `sessions/services/liveSessionService.ts`                                           | 上述 runtime 四命令 + 持久化两命令                                       | 创建/停止/追问；Codex `resume --last`；stdout 合并、stderr 尾诊断、目录冲突守卫、日志/快照拆分                                                                                                                                                                                                                         |
| **快照持久化拆分（M5）**         | `core/state/WorkbenchContext.tsx` + `sessions/services/workbenchLiveSessionSink.ts` | 经 repository（tauri-plugin-store）                                      | 高频流事件仅更新内存快照，仅关键节点（创建/追问/exit/停止）落盘；saveSnapshot Promise 队列串行化防并发覆盖；Tauri `onCloseRequested` 阻塞关闭→落盘→放行 + 2min 定时兜底。**11 + 5 单测**                                                                                                                               |

**语义边界**（M2 真机实测确认）：`runtimeAvailable:true` = 可执行文件存在且 `--version` 成功，**不代表已授权/能实际运行**。本机 codex/gemini 未授权但探测仍返回 true（`--version` 不需登录）。真正可用性在 M3/M4 启动进程时才暴露。

**关键守卫**：以上「项目级」能力仅对 `project.source === 'local'` 生效；demo 项目被显式拒绝。

## 🔧 需修改（已存在但为 mock / 占位）

| 功能                         | 位置                                              | 现状                                                                                   | 目标改造                      |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| Session 停止/追问            | `SessionDetailPage.tsx` + `liveSessionService.ts` | ✅ M5 已按 `origin` 分支：live 走真实 `agent_stop`/`agent_send_input`，demo 保留纯函数 | —                             |
| Session 恢复(resume)         | `liveSessionService.resumeLiveSession`            | ✅ Codex 原生恢复；非 Codex 显式拒绝                                                   | —                             |
| Session 从项目启动的 UI 入口 | `ProjectDetailPage` / `ProjectSessionTree`        | ✅ M6 已接入真实启动面板与 live/demo 标识                                              | —                             |
| 运行中 stderr 实时展示       | `liveSessionService` 流处理                       | stderr 只落日志，仅 exit 失败抓末尾；M8 评估后保留现状，避免普通诊断流污染 Timeline    | 后续结构化输出再评估          |
| 项目详情 Changes 页          | `ProjectDetailPage.tsx:43`                        | 读 `snapshot.fileChanges`（mock 假 diff）                                              | 与真实 git 变更打通（能力 6） |
| 项目卡片统计                 | `projectSelectors.ts:10-22`                       | `changedFileCount = sum(session.changedFilesCount)`（mock）                            | live session 汇入后自然真实   |

## ❌ 未开发（目标功能，代码中完全不存在）

| 功能         | 计划落点                 | 说明                                                       |
| ------------ | ------------------------ | ---------------------------------------------------------- |
| 日志文件轮转 | `session_persistence.rs` | 长跑会话日志无上限，M5 暂不处理（见 M5-known-limitations） |

---

## 契约现状（M1 后）

- `agents.ts`：✅ `ProviderCapability` 已加可选 `version`/`executablePath`/`discoveredAt`；✅ 新增 `AgentLaunchConfig`、`AgentStreamEvent`。字段留空待 M2 探测填充。
- `sessions.ts`：✅ 新增 `SessionOrigin`；`AgentSession` 已加可选 `origin`/`runtimeProcessId`/`workingDirectory`。**`origin` 缺省即 `'demo'`**——旧快照与 mock 无需迁移，`isWorkbenchSnapshot` 不校验该字段，向后兼容。
- `demoFixtures.ts`：✅ 6 条会话现显式标 `origin:'demo'`（构造时 map 注入）。
- `mod.rs`：仍为 `pub mod project; pub mod workspace;`（M1 未动后端）。

**M1 契约已就位**——`origin`/`runtimeProcessId`/`workingDirectory` 字段自 M5 起被 live 会话实际消费（创建时写入、停止/追问时按 `origin` 分支、冲突检测用 `workingDirectory`）。demo 会话仍靠 `origin` 缺省 = `'demo'` 向后兼容。

## M6 项目关联（已完成）

本地且可用的项目现在可从详情页打开启动面板。Provider 列表由运行时能力发现过滤，创建成功后直接进入新 Session；项目详情和侧栏均按 `session.projectId` 派生关联并标识 live/demo。详见 [`history/M6-project-link-ui.md`](./history/M6-project-link-ui.md)。
