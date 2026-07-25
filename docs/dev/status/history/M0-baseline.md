# 历史快照 · M0 基线

> ❄️ **已冻结** — 此文件记录 M0 完成时的项目状态，不再修改。
> 完成日期：2026-07-25 · Git 节点：tag `baseline-before-agent` / commit `c5171f4`

这是「真实 Agent 集成」开发**开始前**的状态：所有目标能力尚未动工，
仅完成分支、基线 tag 与开发文档（M0）。当前状态见 [`../STATUS.md`](../STATUS.md)。

## 六项目标能力（M0 时点）

| # | 能力 | 状态 |
|---|------|------|
| 1 | Claude CLI 接入 | ❌ 未开发 |
| 2 | Codex CLI 接入 | ❌ 未开发 |
| 3 | Gemini CLI / 运行时 / 适配器 | ❌ 未开发 |
| 4 | Agent 能力发现 | ❌ 未开发 |
| 5 | 真实 Session 创建/执行/停止/恢复 | 🔧 仅 mock（`sessionTransitions.ts` local simulation） |
| 6 | 本地项目 ↔ 真实 Session 关联 | 🔧 数据断开（session 全绑 demo 项目） |

## 已实现（真实可用）

打开工作区、最近工作区持久化、添加本地项目、Git 摘要、变更列表、单文件
Diff、系统打开目录/文件、桌面通知。均连真实 Rust 后端，仅对 `source:'local'` 生效。

## 未开发（代码中完全不存在）

后端 Agent 运行时、能力发现、Session 持久化拆分、进程权限、tokio 依赖；
前端 `src/modules/agents/` 整个模块、运行时服务、流桥接、liveSessionService、
从项目启动会话的入口。

## 契约现状（M0 时点，M1 起点）

- `agents.ts`：`ProviderCapability` 仅 4 字段；无 `AgentLaunchConfig`/`AgentStreamEvent`。
- `sessions.ts`：`AgentSession` 无 `origin`/`runtimeProcessId`/`workingDirectory`。
- 后端 `mod.rs`：仅 `project` + `workspace`；`invoke_handler` 仅 7 个只读命令。

## 环境

Rust 1.97.1 / Cargo 1.97.1 / MSVC 14.44.35207 / Windows SDK 10.0.26100.0。
前端 typecheck+lint 通过，138 前端用例（Timeline 2 条偶发超时）；
后端 `cargo build` 成功（18MB exe），6 用例中 4 通过、2 条路径校验 pre-existing 失败。
