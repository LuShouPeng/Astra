# 历史快照 · M1 契约扩展

> ❄️ **已冻结** — 记录 M1 完成时的项目状态，不再修改。
> 完成日期：2026-07-25 · Git 节点：commit `feat(contracts): agent runtime types`
> 上一快照：[`M0-baseline.md`](./M0-baseline.md) · 当前状态见 [`../STATUS.md`](../STATUS.md)

## 本里程碑做了什么

纯契约扩展，为后续运行时打地基。**无任何功能变为可用**，六项能力状态与 M0 相同。

### 代码改动

- `src/core/contracts/agents.ts`
  - `ProviderCapability` 新增可选 `version` / `executablePath` / `discoveredAt`（M2 探测填充）
  - 新增 `AgentLaunchConfig`（provider/workingDirectory/prompt/sessionId）
  - 新增 `AgentStreamEvent` 联合类型（stdout / stderr / exit）
- `src/core/contracts/sessions.ts`
  - 新增 `SessionOrigin = 'demo' | 'live'`
  - `AgentSession` 新增可选 `origin` / `runtimeProcessId` / `workingDirectory`
- `src/modules/demo/data/demoFixtures.ts`
  - 6 条会话在构造时 map 注入 `origin: 'demo'`
- `src/core/contracts/agentContracts.test.ts`（新增，5 用例）

### 关键设计决策

`origin` 设为**可选、缺省即 `'demo'`**。原因：`isWorkbenchSnapshot` 只校验 session 的
`id`，不校验 origin；若设必填并加进校验，磁盘上已有的 `workbench.v1.json`（旧会话无此
字段）会被判无效 → 回退 demo → **用户已添加的本地项目丢失**。可选缺省 demo 既向后兼容，
语义又吻合（旧数据本就是演示会话），且无需任何迁移代码。live 会话必须显式标 `'live'`。

### 验证

- `npm run typecheck` ✅
- `npm run lint` ✅（--max-warnings 0）
- `npx vitest run` ✅ 41 文件 143 用例全通过（基线 138 + 契约 5）
- 后端未改动，无需 `cargo` 验证

## 六项能力（M1 时点，与 M0 一致）

| # | 能力 | 状态 |
|---|------|------|
| 1 | Claude CLI 接入 | ❌ 未开发 |
| 2 | Codex CLI 接入 | ❌ 未开发 |
| 3 | Gemini CLI / 运行时 / 适配器 | ❌ 未开发 |
| 4 | Agent 能力发现 | ❌ 未开发（契约字段已备，探测逻辑未写） |
| 5 | 真实 Session 创建/执行/停止/恢复 | 🔧 仅 mock（契约字段已备，未消费） |
| 6 | 本地项目 ↔ 真实 Session 关联 | 🔧 数据断开 |

## 契约现状（M1 后，M2 起点）

- `agents.ts`：探测字段 + LaunchConfig + StreamEvent 就位，值待 M2 填充。
- `sessions.ts`：origin + 进程字段就位，待 M5 消费。
- 后端 `mod.rs`：仍仅 `project` + `workspace`；`invoke_handler` 仍 7 个只读命令。
