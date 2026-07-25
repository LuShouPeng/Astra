# M6 历史快照 — 项目关联 + 启动 UI

> 冻结于 M6 完成时。前一快照：[`M5-live-sessions.md`](./M5-live-sessions.md)。

| 项 | 值 |
|----|----|
| 里程碑 | **M6 完成** — 从本地项目页启动真实 Agent 会话并保持双向关联 |
| 日期 | 2026-07-25 |
| 分支 | `feature/real-agent-integration` |
| 验证 | 按用户要求本轮未运行测试；新增项目启动门面单测 |

## 交付内容

- `projectService.startAgentSession` 作为项目域门面，强制校验本地、可用项目后委托 `LiveSessionService`。
- 项目详情页新增 Agent 启动面板：只列出已探测可用且非 display-only 的 Provider，接收任务提示词，创建成功后跳转到新 Session。
- demo、缺失目录、无可用 CLI 或 live runtime 未挂载时禁用启动入口；运行时错误显示为可恢复页面错误。
- 项目 Overview / Sessions 列表和左侧 ProjectSessionTree 明确区分 `live` 与 `demo` 会话；关联仍由 `session.projectId` 单一事实派生。
- M7 范围调整为仅完善 Codex 适配与 resume；不新增 Gemini 专用适配工作。

## 残留项

- 本轮遵照用户指示未执行 typecheck、lint 或测试，后续 M8 回归需覆盖。
- 项目 Changes 页仍读取 Session 产生的 `snapshot.fileChanges`；真实 Git 全项目变更刷新不属于本里程碑启动关联闭环。
