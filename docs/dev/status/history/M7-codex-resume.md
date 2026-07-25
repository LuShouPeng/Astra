# M7 历史快照 — Codex 适配与 Session 恢复

> 冻结于 M7 完成时。前一快照：[`M6-project-link-ui.md`](./M6-project-link-ui.md)。

| 项     | 值                                                   |
| ------ | ---------------------------------------------------- |
| 里程碑 | **M7 完成** — Codex 原生恢复 + live Session 恢复 UI  |
| 日期   | 2026-07-25                                           |
| Commit | `7a2983b feat(sessions): resume Codex live sessions` |
| 范围   | 仅 Codex；不新增 Gemini 专用适配                     |

## 交付内容

- `AgentLaunchConfig.mode` 增加向后兼容的 `new/resume` 启动语义。
- Rust 运行时将 Codex resume 映射为 `codex exec resume --last <prompt>`，并保持原工作目录。
- `resumeLiveSession` 校验 live/Codex/非运行态，读取最多 200 条持久化日志，重建流订阅并清除旧 `completedAt`。
- 恢复失败时拆除订阅并将 Session 收敛为 failed；重复恢复、demo、运行中及非 Codex 会话均显式拒绝。
- Session 详情页对已结束的 Codex live Session 显示 Resume，并禁止向无进程 live Session 发送 follow-up。
- 单测覆盖 Codex resume argv、适配器 mode、恢复成功/失败/非法状态和 UI 调用边界。

## 设计边界

Codex 的模型上下文由 CLI `--last` 管理；Astra 日志用于恢复前持久化可读性检查和构造末尾输出提示。该选择避免把 Astra Session ID 错当成 Codex 原生 thread ID。
