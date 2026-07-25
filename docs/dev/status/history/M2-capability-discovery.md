# 历史快照 · M2 能力发现

> ❄️ **已冻结** — 记录 M2 完成时的项目状态，不再修改。
> 完成日期：2026-07-25 · Git 节点：commit `fdd1562` feat(agents): capability discovery
> 上一快照：[`M1-contracts.md`](./M1-contracts.md) · 当前状态见 [`../STATUS.md`](../STATUS.md)

## 本里程碑做了什么

实现**能力 4：Agent 能力发现**。这是集成开发以来**首个用户可见变化**——
本机已安装的 CLI 会在启动时被探测并标为 `runtimeAvailable:true`。

### 代码改动

**后端**
- `src-tauri/src/modules/agent_capability.rs`（新增）
  - `discover_agent_capabilities` 命令：对 claude/codex/gemini 执行 `--version`
  - Windows 经 `cmd /C` 解析 `.cmd`/`.bat` 包装器；非 Windows 直接执行
  - 同步命令（Tauri 线程池调度，M2 不需 tokio）
  - gemini 仅在真探测到时解除 display-only；其余 provider 恒 `displayOnly:false`
  - 3 个单测：版本解析、缺失 CLI 降级、gated/非 gated display-only
- `mod.rs`：加 `pub mod agent_capability;`
- `lib.rs`：`invoke_handler` 注册 `discover_agent_capabilities`（现 8 个命令）

**前端**
- `src/modules/agents/services/capabilityDiscovery.ts`（新增）：封装 invoke，
  为每个结果附加 `discoveredAt` 时间戳；后端失败时抛出交调用方降级
- `src/modules/agents/index.ts`（新增）：模块入口
- `src/core/state/WorkbenchContext.tsx`：新增可选注入 `discoverCapabilities`；
  `load()` 成功后追加一次探测，结果经 `capabilities` action **merge 进内存快照**的
  `providerCapabilities`；**不落盘**，失败静默降级保留 demo 值
- `src/app/App.tsx`：把真实 `discoverCapabilities` 接进 WorkbenchProvider
- `WorkbenchContext.test.tsx`：+2 用例（探测覆盖 demo 默认、探测失败保留 demo）

### 关键设计决策

1. **探测结果不落盘**：能力数据易过期（用户随时装/卸 CLI），每次启动重新探测，
   只更新内存快照，绝不写入 `workbench.v1.json`。
2. **可选依赖注入**：`discoverCapabilities` 作为 WorkbenchProvider 可选 prop，
   而非在 core 层直接 import agents 模块——保持 core 不反向依赖 feature 模块，
   且现有测试无需改动（缺省即不探测）。
3. **失败静默降级**：非 Tauri 环境或 CLI 全未装时探测会失败，此时保留 demo 能力值，
   不打断加载、不弹错误。

## 六项能力（M2 时点）

| # | 能力 | 状态 | 变化 |
|---|------|------|------|
| 1 | Claude CLI 接入 | ❌ 未开发 | — |
| 2 | Codex CLI 接入 | ❌ 未开发 | — |
| 3 | Gemini CLI / 运行时 / 适配器 | ❌ 未开发 | — |
| 4 | Agent 能力发现 | ✅ **已实现** | **本里程碑完成** |
| 5 | 真实 Session 创建/执行/停止/恢复 | 🔧 仅 mock | — |
| 6 | 本地项目 ↔ 真实 Session 关联 | 🔧 数据断开 | — |

## 真机验证（2026-07-25，已实测）

方式：模块内临时测试直接调 `discover_agent_capabilities()` + `cargo test -- --nocapture`
（不依赖 Tauri），验证后删除。本机三个 CLI 均已安装：

| Provider | runtimeAvailable | version | displayOnly |
|----------|:---:|---------|:---:|
| claude | `true` | `2.1.195 (Claude Code)` | false |
| codex | `true` | `codex-cli 0.145.0` | false |
| gemini | `true` | `0.52.0` | false（探测到，解禁生效） |

确认：
- **claude 从 demo 默认 `false` → 探测 `true`**，version 正确解析——探测链路真机成立。
- **Windows `.cmd` 包装器经 `cmd /C` 解析有效**（三者在 Windows 均为 `.cmd`）。

## ⚠️ 语义边界：探测的是"装没装"，不是"能不能用"

`runtimeAvailable:true` 的当前语义是**"可执行文件存在且 `--version` 成功"**，
**不代表已授权、能实际运行 Agent**。实证：本机 codex/gemini 虽**未完成账户授权、
无法实际使用**，但因 `--version` 不需登录仍返回 `true`。

真正的"可用性"（授权、能否启动会话）要到 M3/M4 真正启动进程时才暴露——
届时未授权的 CLI 会在运行时报授权错误。M3/M4 的错误处理设计需覆盖这一落差：
**探测通过 ≠ 会话能成功启动**。

- 注意：**目前尚无 UI 直接展示这些值**——变化体现在快照数据层，
  可经 devtools 或后续 UI（M6/M7）观察。能力探测本身已真实工作。

## 后端命令清单（M2 后，共 8 个）

workspace_inspect_path / workspace_check_exists / project_git_summary /
project_git_changes / project_file_diff / system_open_directory /
system_open_file / **discover_agent_capabilities**

仍**无任何进程启动命令**（M3 补 agent_runtime.rs）；`capabilities/default.json`
仍无进程权限；`Cargo.toml` 仍无 tokio。
