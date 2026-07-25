# Astra Nexus 工作流编排指南

## 创建与运行

- 在“工作流”中手工创建 DAG，或输入目标让本地 Claude/Codex 规划 Agent 生成草案。
- 生成结果只会进入编辑器；验证并点击“运行”前不会执行。
- Agent、MCP、人工审批、条件和汇合节点均可在右侧属性检查器配置。
- 默认并发为 2，范围为 1–4；节点可覆盖超时与重试次数。

## 审批与 Git

- 只读控制操作可自动执行。命令、写入、网络、安装、worktree、集成和最终合并需要明确批准。
- 每个 Agent 节点使用独立 worktree；并行结果依次合入运行集成分支。
- 最终页会显示 diff 统计和受管提交。只有再次确认后才会合入运行开始时的用户分支。
- 取消会终止完整进程树并保留未提交 diff；清理 worktree 是独立确认操作。

## MCP 与 Skill

- MCP 支持 stdio 和 Streamable HTTP，不支持旧版 SSE。
- Header/API Key 只保存为 Windows Credential Manager 引用，SQLite 和日志不保存明文。
- Skill 可从策展目录、HTTPS Git 来源或本地目录安装；安装过程不执行脚本或依赖。
- Skill 内容按 SHA-256 缓存并按工作流启用。历史运行引用的版本在卸载后仍保留。
- “导出到 Provider”会显示目标目录和覆盖选项；Astra 不会静默修改全局 Provider 配置。

## 恢复与诊断

- 应用重启后，遗留运行显示为“已中断”，可继续或清理。
- 在“设置 → 常规”可配置 Claude/Codex executable path 并运行版本诊断。
- Gemini 仅用于展示，不参与运行。
