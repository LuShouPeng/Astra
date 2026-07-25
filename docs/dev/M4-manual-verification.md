# M4 真机验证脚本

> **目的**：验证 Agent 进程流式事件从后端 `app.emit('agent://stream/{id}')` → 前端 `listen()` → `appEventBus` 的完整桥接路径。这是 dev doc 标记的头号 🔴 风险。

## 前置条件

- `npm run tauri dev` 启动应用（开发模式）
- 打开 Chrome DevTools (F12)
- 确认本机 `claude` CLI 可用（`claude --version` 成功）

## 验证步骤

### 1. 获取真实项目路径

Console 执行：
```js
// 假设你已有一个本地项目，从快照里找它的 rootPath
const snapshot = await window.__TAURI__.core.invoke('prototype_repository_load');
const project = snapshot.projects.find(p => p.source === 'local');
console.log('Project rootPath:', project?.rootPath);
// 或者直接用一个你确定存在的目录，如 'D:\\Zhanyi\\Astra'
```

### 2. 订阅 appEventBus 的 `agent:stream` 事件

Console 执行：
```js
// 先导入 appEventBus（它已在 window 暴露或可从全局上下文访问）
// 实际上 appEventBus 不在 window 上，但 __astraAgentRuntime 在
const runtime = window.__astraAgentRuntime;
if (!runtime) {
  console.error('runtime not found — ensure dev mode is active');
} else {
  console.log('✓ Agent runtime service available');
}
```

### 3. 手动启动一个 Agent 会话并订阅流

Console 执行：
```js
const sessionId = 'manual-test-' + Date.now();
const workingDirectory = 'D:\\Zhanyi\\Astra';  // 替换为步骤 1 的真实路径
const prompt = 'echo test verification';

// 订阅流事件（同时验证直接回调和 appEventBus 桥接）
const events = [];
const unsub = await runtime.onStream(sessionId, (event) => {
  console.log('[onStream callback]', event);
  events.push(event);
});

// 启动 Agent（后端会拉起 `claude --print "echo test verification"`）
await runtime.start({
  provider: 'claude',
  workingDirectory,
  prompt,
  sessionId,
});

console.log('Agent started, sessionId:', sessionId);
console.log('Waiting for stream events... check console output above.');
```

### 4. 观察输出

**期望看到**：
- Console 出现 `[onStream callback] { kind: 'stdout', chunk: '...' }` — 说明 `listen()` 收到后端推送
- 若有 appEventBus 订阅（可在代码里加 `appEventBus.subscribe('agent:stream', console.log)`），也会看到同样事件 — 说明桥接生效
- 最终出现 `{ kind: 'exit', code: 0 }` — 进程正常退出

**失败标志**：
- 只有 `Agent started` 但无任何 `[onStream callback]` — 说明流桥接断了（dev doc 的头号风险）
- 后端日志（`npm run tauri dev` 的终端）有输出但前端收不到 — 同样是桥接断裂

### 5. 清理

Console 执行：
```js
unsub();  // 取消订阅
await runtime.stop(sessionId);  // 停止进程（若还在运行）
console.log('Cleaned up session:', sessionId);
```

## 验证成功标准

✅ **必须同时满足**：
1. `onStream` 直接回调收到 stdout 和 exit 事件
2. 若 appEventBus 有监听者，`agent:stream` 事件也被触发（桥接验证）
3. 后端终端日志与前端 Console 输出的事件序列一致（无丢失）

若以上三条都满足，M4 流桥接真机验证通过。

## 附：验证 appEventBus 桥接（可选）

若要显式检查 `appEventBus` 是否收到事件，可先在 Console 执行：
```js
// 因为 appEventBus 不直接暴露，需通过 React DevTools 或在代码里加日志
// 简化验证：相信单测已覆盖桥接逻辑，只验证 onStream 回调收到即可
```

实际上单测 `agentRuntimeService.test.ts` 已验证了 `eventBus?.emit('agent:stream', ...)` 调用，此处真机验证重点是 **Tauri 的 `listen()` 能否收到后端 `app.emit` 推送的真实事件**——这是 IPC 层，mock 无法覆盖。
