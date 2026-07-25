# M3 历史快照 — Agent 进程运行时（后端）

> 冻结于 M3 完成时。上游计划见 [`../../real-agent-integration.md`](../../real-agent-integration.md)。
> 前一快照：[`M2-capability-discovery.md`](./M2-capability-discovery.md)。

| 项 | 值 |
|----|----|
| 里程碑 | **M3 完成** — Agent 子进程运行时后端 |
| 日期 | 2026-07-25 |
| 分支 | `feature/real-agent-integration` |
| 风险等级 | 🔴 高（进程生命周期 / 孤儿进程 / 流式 IPC） |
| 后端测试 | `agent_runtime` 5 用例全通过（含真机 echo 进程） |
| 编译 | ✅ `cargo build` / `cargo test --lib` 通过 |

## 交付内容

### 新增 `src-tauri/src/modules/agent_runtime.rs`

- **`AgentRegistry`**（`.manage()` 注入的 Tauri state）：`Arc<Mutex<HashMap<sessionId, AgentHandle>>>`。`AgentHandle` 只存两个控制通道（`stdin_tx`、`kill_tx`），**不持有 `Child`**——子进程归 wait 任务所有，规避锁竞争。
- **`spawn_process(command, session_id, registry, sink)`**：可测试核心。接收已构建的 `Command` + `EventSink`，驱动进程：
  - stdout / stderr 各起一个 `tokio::spawn` 按行读，经 sink 发 `Stdout`/`Stderr` 事件；
  - stdin 泵任务消费 `stdin_rx` 写入子进程；
  - wait 监督任务 `tokio::select!` 于 `child.wait()` 与 `kill_rx`——正常退出取 code，收到 kill 信号则 `kill_tree(pid)`；结束时发 `Exit` 事件并从 registry 摘除。
- **`EventSink` trait**：生产实现 `AppEventSink` 转发到 `agent://stream/{sessionId}`；测试实现 `CollectorSink` 收集到 Vec。这是让 spawn 逻辑脱离 Tauri runtime 可测的关键抽象。
- **四个命令**：`agent_start`（校验目录 `safe_directory` + provider 映射 + 去重）、`agent_send_input`（自动补 `\n`）、`agent_stop`（发 kill 信号）、`agent_list_running`。
- **`provider_argv`**：provider → argv 单点映射（claude `--print`、codex `exec`、gemini `--prompt`）——后端「适配器」落点。
- **跨平台**：`build_command` 在 Windows 用 `cmd /C` 包裹（`.cmd` shim 解析）+ `CREATE_NO_WINDOW`；`kill_tree` 在 Windows 用 `taskkill /T /F` 杀进程树，Unix 用 `kill -TERM`。

### 依赖 / 注册

- `Cargo.toml`：加 `tokio`（features: process、io-util、sync、macros、rt-multi-thread、time）。
- `mod.rs`：`pub mod agent_runtime;`。
- `lib.rs`：`.manage(AgentRegistry::default())` + 注册 4 个命令（invoke_handler 现 12 个）。

## 权限决策（与 dev doc 假设不同）

dev doc 预设「新增自定义进程权限 / shell allowlist」。**实际未改 `capabilities/default.json`**：自定义 `#[tauri::command]` 经 `generate_handler!` 注册，不受 Tauri 2 权限模型约束（权限只管插件/core 命令）。直接用 `tokio::process` 不走 shell 插件，规避了 allowlist 复杂度。

## 真机验证（2026-07-25，已实测）

| 验证点 | 手段 | 结果 |
|--------|------|------|
| 进程真能启动并回传 stdout | `spawns_echo_and_captures_output` 单测启动真实 `echo` | ✅ 捕获 `Stdout` + `Exit{code:0}` |
| provider argv 映射正确 | 4 个 `provider_argv_*` 单测 | ✅ claude/codex/gemini 映射符合预期，unknown 被拒 |

## 孤儿进程防护（2026-07-25，已真机验证）

- **窗口关闭钩子已实现**：`lib.rs` 改用 `.build().run(|app, event| ...)`，在 `RunEvent::ExitRequested` 时调 `AgentRegistry::kill_all_blocking()` 遍历 registry 杀掉所有进程树。
- **`kill_all_blocking`**：用同步 `std::process::Command`（退出时 tokio runtime 可能已拆），对每个存活 pid 调 `kill_tree_blocking`（Windows `taskkill /T /F`），最后清空 registry。`AgentHandle` 为此新增 `pid` 字段。
- **真机实测**（临时测试，已删）：`cmd → ping` 两层进程树，实测输出：
  ```
  parent pid=34416 children=[26796]     # cmd + ping 子进程各一
  tree kill verified: parent + 1 child(ren) gone, registry cleared
  ```
  确认 `taskkill /T` 连 fork 出的 `ping` 子进程一并杀掉，registry 清空。子进程存活检查用 `tasklist`，子 pid 枚举用 PowerShell `Get-CimInstance`（Win11 已废弃 `wmic`）。

### 附带发现（环境相关）

- Win11 **废弃 `wmic`**：`wmic.exe` 已不在 System32/wbem，查进程关系需用 PowerShell CIM。
- 直接 `Command::new("tasklist")` 在部分 shell（如 Git Bash）会因 PATH 不含 System32 报 `program not found`；生产代码的 `taskkill` 走同一解析路径，但 **Tauri app 进程继承系统环境**，System32 在 PATH 上，实际运行无碍。测试中通过 `cmd /C` 包裹规避了测试 shell 的 PATH 差异。

## ⚠️ 尚未真机验证（留待 M4）

- **流式 IPC 桥接**：`AppEventSink.emit` → 前端 `listen()` 尚无前端消费方，Timeline 能否收到真实输出**未经端到端验证**。这是 dev doc 标记的头号 🔴 风险，M4 前不能声称打通。
- **真实 CLI 启动**：`agent_start` 对 `claude --print` 的真机拉起未测（单测用 echo 替身）。claude 已授权可用，codex/gemini 未授权——真实启动的成功/失败分支待 M4 手动验证。

## 已知非阻塞项

- `project.rs` 2 条路径校验测试（`reads_bounded_text_changes...`、`returns_a_binary_marker...`）为 pre-existing 失败，与 M3 无关。
