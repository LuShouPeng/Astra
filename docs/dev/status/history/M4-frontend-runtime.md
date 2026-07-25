# M4 历史快照 — 前端运行时服务 + 流桥接

> 冻结于 M4 完成时。上游计划见 [`../../real-agent-integration.md`](../../real-agent-integration.md)。
> 前一快照：[`M3-agent-runtime.md`](./M3-agent-runtime.md)。

| 项 | 值 |
|----|----|
| 里程碑 | **M4 完成** — 前端运行时服务 + 适配器 + 流桥接 |
| 日期 | 2026-07-25 |
| 分支 | `feature/real-agent-integration` |
| 风险等级 | 🔴 高（流式 IPC 桥接——dev doc 头号风险） |
| 前端测试 | 151 用例全通过（+6 agents runtime/adapter） |
| 编译 | ✅ typecheck / lint (--max-warnings 0) 通过 |

## 交付内容

### 新增前端 Agent 模块 `src/modules/agents/`

```
adapters/claudeAdapter.ts    # buildClaudeLaunchConfig
adapters/codexAdapter.ts     # buildCodexLaunchConfig
adapters/geminiAdapter.ts    # buildGeminiLaunchConfig
adapters/agentAdapter.ts     # buildLaunchConfig(provider, input) 统一入口（穷尽 switch）
services/agentRuntimeService.ts  # invoke + listen 封装
services/agentRuntimeService.test.ts  # 6 用例
```

- **`agentRuntimeService`**：依赖注入模式（与 `changesService` 一致）。
  - `AgentRuntimeNativeAdapter` 抽象 invoke/listen；`TauriAgentRuntimeAdapter` 为生产实现；测试注入 fake。
  - 四方法 `start` / `sendInput` / `stop` / `listRunning` → invoke 对应后端命令。
  - **`onStream(sessionId, listener)`**：`listen('agent://stream/{sessionId}')` 订阅，返回取消函数。
  - **流桥接**：`createAgentRuntimeService(adapter, eventBus?)`——传入 eventBus 时，每个流事件在触发直接回调后额外 `emit('agent:stream', {sessionId, event})` 到 appEventBus，供 Timeline 等内存总线消费方接收（M5 在此追加 TimelineEvent）。

### 契约扩展 `src/core/contracts/events.ts`

- `AppEventMap` 新增 `'agent:stream': { sessionId: string; event: AgentStreamEvent }`。

### 接入 `src/app/App.tsx`

- dev 模式（`import.meta.env.DEV`）下把 `createDefaultAgentRuntimeService(appEventBus)` 挂到 `window.__astraAgentRuntime`，供 devtools 手动验证；生产构建 no-op。UI 启动入口留待 M6。

## ✅ 已验证（单测，mock 层）

| 验证点 | 手段 | 结果 |
|--------|------|------|
| 三 provider argv 映射 | `buildLaunchConfig` 单测 | ✅ claude/codex/gemini config 正确 |
| start/sendInput/stop/listRunning 委托 | fake adapter 记录调用 | ✅ 参数透传正确 |
| onStream 直接回调 | fake adapter 手动触发事件 | ✅ stdout/exit 有序收到 |
| **流桥接到 appEventBus** | fake adapter + 真实 appEventBus | ✅ `agent:stream` 被 emit，payload 正确 |
| 无 bus 时不 emit / 不抛错 | 仅直接回调 | ✅ |
| 取消订阅 | unsub 后 fake 标记 | ✅ |

## ⚠️ 尚未真机验证（关键诚实标注）

**桥接的业务逻辑已单测覆盖，但真实 Tauri IPC 往返未经真机验证**：

- **`listen('agent://stream/{id}')` 能否收到后端 `app.emit` 的真实推送**——这是 dev doc 头号 🔴 风险，也正是 mock **无法覆盖**的 IPC 层。单测用的是 fake adapter，`TauriAgentRuntimeAdapter.onStream` 里真正的 `listen()` 调用**没有跑过真实 Tauri runtime**。
- **真实 `claude --print` 启动 → stdout 流式回传前端**：后端 M3 用 echo 验证过进程与事件发射，但「后端 emit → 前端 listen 收到」这条完整链路**未端到端测过**。

**为何未做**：真实验证需 `npm run tauri dev` 启动应用 + 交互式 devtools 操作，无法在非交互命令行完成。已写详细手动脚本 [`../../M4-manual-verification.md`](../../M4-manual-verification.md)。

**建议**：由用户按脚本在 devtools 手动跑一次（几分钟），或推迟到 M6（UI 启动按钮就位后，验证更自然）。在此之前，M4 的 IPC 桥接标记为「逻辑已单测，真机 IPC 待验证」，不声称「流已打通」。
