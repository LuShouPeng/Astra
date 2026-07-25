# Terminal PTY Module

完整的交互式终端实现，支持命令执行策略、权限确认、工作目录隔离和命令取消。

## 功能特性

### ✅ 已实现的功能

1. **PTY 交互式终端**
   - 基于 `portable-pty` 的跨平台 PTY 实现
   - 支持 Windows (PowerShell/CMD) 和 Unix (Shell) 环境
   - 完整的输入/输出流处理
   - 终端尺寸调整支持

2. **命令执行策略和权限确认**
   - 三级执行策略：`Allow`（允许）、`Confirm`（确认）、`Deny`（拒绝）
   - 基于正则表达式的命令匹配规则
   - 默认安全规则集：
     - 阻止从根目录递归删除 (`rm -rf /`)
     - 需要确认提升权限操作 (`sudo`, `su`)
     - 需要确认系统电源操作 (`shutdown`, `reboot`)
     - 需要确认强制推送 (`git push --force`)
   - 动态添加/更新自定义规则

3. **工作目录隔离**
   - 每个会话独立的工作目录
   - 路径规范化和安全验证
   - 支持动态切换工作目录 (`cd` 命令)
   - 防止路径遍历攻击

4. **命令取消与失败恢复**
   - 发送 Ctrl+C 中断信号
   - 会话状态查询（存活检测）
   - 优雅的会话关闭和资源清理
   - 多会话并发管理

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (TypeScript)                   │
├─────────────────────────────────────────────────────────────┤
│  terminalService (TauriTerminalService)                      │
│  - createSession()                                           │
│  - executeCommand() → Policy Check                           │
│  - confirmCommand() / cancelCommand()                        │
│  - startOutputPolling()                                      │
└────────────────────┬────────────────────────────────────────┘
                     │ Tauri IPC
┌────────────────────▼────────────────────────────────────────┐
│                    Backend (Rust)                            │
├─────────────────────────────────────────────────────────────┤
│  TerminalManager                                             │
│  ├── sessions: HashMap<SessionId, TerminalSession>          │
│  │   └── TerminalSession                                    │
│  │       ├── master: MasterPty (I/O)                        │
│  │       ├── child: Child Process                           │
│  │       └── working_dir: PathBuf                           │
│  └── command_rules: Vec<CommandRule>                        │
│      └── pattern → policy (Allow/Confirm/Deny)              │
└─────────────────────────────────────────────────────────────┘
```

## 使用示例

### 基础用法

```typescript
import { terminalService, ExecutionPolicy } from '@/modules/terminal';

// 1. 创建终端会话
const sessionId = await terminalService.createSession({
  workingDir: '/home/user/project',
  cols: 80,
  rows: 24,
  shell: '/bin/bash', // 可选，默认使用系统 shell
  env: {
    NODE_ENV: 'development', // 自定义环境变量
  },
});

// 2. 执行命令（带策略检查）
const policy = await terminalService.executeCommand(
  sessionId,
  'npm install'
);

if (policy === ExecutionPolicy.Confirm) {
  // 用户需要确认
  const userConfirmed = await showConfirmDialog('Execute npm install?');
  if (userConfirmed) {
    await terminalService.confirmCommand(sessionId, 'npm install');
  }
}

// 3. 读取输出
const output = await terminalService.readOutput(sessionId);
console.log(output);

// 4. 取消命令（发送 Ctrl+C）
await terminalService.cancelCommand(sessionId);

// 5. 关闭会话
await terminalService.closeSession(sessionId);
```

### 实时输出流

```typescript
// 创建带输出流的会话
const { sessionId, cleanup } = await terminalService.createSessionWithStreaming(
  {
    workingDir: process.cwd(),
    cols: 120,
    rows: 30,
  },
  (output) => {
    // 实时处理输出
    console.log(output);
    updateTerminalUI(output);
  }
);

// 执行命令
await terminalService.executeCommand(sessionId, 'ls -la');

// 清理
cleanup();
await terminalService.closeSession(sessionId);
```

### 自定义命令规则

```typescript
// 添加自定义规则
await terminalService.addCommandRule({
  pattern: '^npm\\s+(publish|unpublish)',
  policy: ExecutionPolicy.Confirm,
  description: 'npm publish operations require confirmation',
});

// 阻止危险操作
await terminalService.addCommandRule({
  pattern: '^dd\\s+if=.*of=/dev/(sd|hd)',
  policy: ExecutionPolicy.Deny,
  description: 'Direct disk writes are forbidden',
});

// 查看所有规则
const rules = await terminalService.getCommandRules();
console.log(rules);
```

### 工作目录管理

```typescript
// 查询会话信息
const info = await terminalService.getSessionInfo(sessionId);
console.log('Current directory:', info.workingDir);
console.log('Is alive:', info.isAlive);

// 切换目录
await terminalService.changeDirectory(sessionId, '/tmp');

// 再次确认
const updatedInfo = await terminalService.getSessionInfo(sessionId);
console.log('New directory:', updatedInfo.workingDir);
```

### 监听确认事件

```typescript
// 监听需要确认的命令
const unlisten = await terminalService.onCommandConfirmationRequired(
  async (command) => {
    const confirmed = await showModal({
      title: 'Command Requires Confirmation',
      message: `Execute: ${command}?`,
      buttons: ['Allow', 'Cancel'],
    });

    if (confirmed) {
      await terminalService.confirmCommand(sessionId, command);
    }
  }
);

// 清理监听器
unlisten();
```

### 多会话管理

```typescript
// 列出所有活动会话
const activeSessions = await terminalService.listSessions();
console.log('Active sessions:', activeSessions);

// 批量关闭
for (const sessionId of activeSessions) {
  const info = await terminalService.getSessionInfo(sessionId);
  if (!info.isAlive) {
    await terminalService.closeSession(sessionId);
  }
}
```

## API 参考

### Rust Backend

所有命令都通过 Tauri IPC 调用：

| 命令 | 功能 | 参数 | 返回值 |
|------|------|------|--------|
| `terminal_create_session` | 创建会话 | `config: TerminalConfig` | `String` (session ID) |
| `terminal_write_input` | 写入输入 | `session_id, data` | `()` |
| `terminal_read_output` | 读取输出 | `session_id` | `String` |
| `terminal_execute_command` | 执行命令 | `session_id, command` | `ExecutionPolicy` |
| `terminal_confirm_command` | 确认执行 | `session_id, command` | `()` |
| `terminal_cancel_command` | 取消命令 | `session_id` | `()` |
| `terminal_resize` | 调整尺寸 | `session_id, cols, rows` | `()` |
| `terminal_get_session_info` | 会话信息 | `session_id` | `TerminalSessionInfo` |
| `terminal_close_session` | 关闭会话 | `session_id` | `()` |
| `terminal_list_sessions` | 列出会话 | - | `Vec<String>` |
| `terminal_add_command_rule` | 添加规则 | `rule: CommandRule` | `()` |
| `terminal_get_command_rules` | 获取规则 | - | `Vec<CommandRule>` |
| `terminal_change_directory` | 切换目录 | `session_id, path` | `()` |

### TypeScript Frontend

详见 `src/core/contracts/terminal.ts` 和 `src/modules/terminal/services/terminalService.ts`

## 安全考虑

1. **命令过滤**：默认阻止或需要确认危险操作
2. **路径隔离**：每个会话的工作目录独立，防止路径遍历
3. **会话隔离**：不同会话之间完全隔离，互不干扰
4. **资源清理**：会话关闭时自动清理进程和文件描述符
5. **错误处理**：完善的错误类型和错误恢复机制

## 测试建议

1. **单元测试**：测试各个 API 调用
2. **集成测试**：测试完整的命令执行流程
3. **安全测试**：验证命令策略和路径隔离
4. **压力测试**：多会话并发测试
5. **平台测试**：Windows 和 Unix 环境验证

## 扩展方向

1. **命令历史**：记录和搜索命令历史
2. **自动补全**：基于上下文的命令补全
3. **会话持久化**：保存和恢复会话状态
4. **性能监控**：命令执行时间、资源使用
5. **日志审计**：完整的命令执行日志

## 依赖

### Rust
- `portable-pty` ^0.8 - 跨平台 PTY 实现
- `tokio` ^1 - 异步运行时
- `uuid` ^1 - 会话 ID 生成
- `regex` ^1 - 命令规则匹配
- `thiserror` ^2 - 错误处理

### TypeScript
- `@tauri-apps/api` ^2 - Tauri 前端绑定

## 许可证

与项目主体保持一致
