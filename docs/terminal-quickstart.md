# Terminal PTY 快速开始指南

这是一个完整的交互式终端实现，包含命令执行策略、权限确认、工作目录隔离和命令取消功能。

## 安装依赖

### Rust 依赖

```bash
cd src-tauri
cargo build
```

主要依赖已添加到 `Cargo.toml`：
- `portable-pty = "0.8"` - PTY 实现
- `tokio = { version = "1", features = ["full"] }` - 异步运行时
- `uuid = { version = "1", features = ["v4", "serde"] }` - 会话 ID
- `regex = "1"` - 命令规则匹配
- `thiserror = "2"` - 错误处理

### TypeScript 依赖

已使用项目现有的 Tauri API，无需额外安装。

## 功能验证清单

### ✅ 已实现功能

- [x] **PTY 交互式终端**
  - 跨平台支持（Windows/Linux/macOS）
  - 完整的输入/输出流
  - 终端尺寸调整
  
- [x] **命令执行策略**
  - 三级策略：Allow / Confirm / Deny
  - 正则表达式规则匹配
  - 默认安全规则集
  - 动态规则管理

- [x] **权限确认**
  - 事件驱动的确认流程
  - 前端确认界面集成
  - 确认后执行机制

- [x] **工作目录隔离**
  - 每会话独立工作目录
  - 路径规范化和验证
  - 动态目录切换
  - 路径遍历保护

- [x] **命令取消与恢复**
  - Ctrl+C 中断信号
  - 会话状态查询
  - 优雅关闭
  - 资源清理

## 使用示例

### 1. 基础终端会话

```typescript
import { terminalService } from '@/modules/terminal';

// 创建会话
const sessionId = await terminalService.createSession({
  workingDir: process.cwd(),
  cols: 80,
  rows: 24,
});

// 执行命令
await terminalService.executeCommand(sessionId, 'npm install');

// 读取输出
const output = await terminalService.readOutput(sessionId);
console.log(output);

// 关闭会话
await terminalService.closeSession(sessionId);
```

### 2. 实时输出流

```typescript
// 带输出流的会话
const { sessionId, cleanup } = await terminalService.createSessionWithStreaming(
  {
    workingDir: '/home/user/project',
    cols: 120,
    rows: 30,
  },
  (output) => {
    // 实时显示输出
    console.log(output);
  }
);

// 执行命令
await terminalService.executeCommand(sessionId, 'npm test');

// 清理
cleanup();
await terminalService.closeSession(sessionId);
```

### 3. 命令确认流程

```typescript
// 监听确认请求
const unlisten = await terminalService.onCommandConfirmationRequired(
  async (command) => {
    const confirmed = confirm(`Execute: ${command}?`);
    if (confirmed) {
      await terminalService.confirmCommand(sessionId, command);
    }
  }
);

// 执行需要确认的命令
await terminalService.executeCommand(sessionId, 'sudo apt-get update');

// 清理
unlisten();
```

### 4. 取消运行中的命令

```typescript
// 启动长时间运行的命令
await terminalService.executeCommand(sessionId, 'npm run build');

// 用户请求取消
await terminalService.cancelCommand(sessionId); // 发送 Ctrl+C

// 检查会话状态
const info = await terminalService.getSessionInfo(sessionId);
console.log('Is alive:', info.isAlive);
```

### 5. 自定义安全规则

```typescript
import { ExecutionPolicy } from '@/modules/terminal';

// 添加自定义规则
await terminalService.addCommandRule({
  pattern: '^docker\\s+(rmi|rm).*-f',
  policy: ExecutionPolicy.Confirm,
  description: 'Force Docker removal requires confirmation',
});

// 阻止危险操作
await terminalService.addCommandRule({
  pattern: '^mkfs\\..*',
  policy: ExecutionPolicy.Deny,
  description: 'Filesystem formatting is forbidden',
});
```

## 默认安全规则

以下命令会自动应用策略：

| 命令模式 | 策略 | 说明 |
|---------|------|------|
| `rm -rf /` | Deny | 禁止从根目录递归删除 |
| `sudo ...` | Confirm | 提升权限需要确认 |
| `su ...` | Confirm | 切换用户需要确认 |
| `shutdown` | Confirm | 系统关机需要确认 |
| `reboot` | Confirm | 系统重启需要确认 |
| `git push --force` | Confirm | 强制推送需要确认 |

## 架构说明

```
Frontend (React/TypeScript)
    ↓ Tauri IPC
Backend (Rust)
    ├── TerminalManager
    │   ├── sessions: HashMap<SessionId, TerminalSession>
    │   └── command_rules: Vec<CommandRule>
    └── portable-pty
        ├── MasterPty (I/O)
        └── Child Process
```

## 测试

```bash
# 运行 TypeScript 测试
npm test src/modules/terminal

# 运行 Rust 测试
cd src-tauri
cargo test
```

## 故障排查

### 会话无法创建

**问题**：`WorkingDirectoryError`

**解决**：
- 确保工作目录存在且可访问
- 检查路径格式（Windows 使用反斜杠或双反斜杠）
- 验证目录权限

### 命令无输出

**问题**：`readOutput()` 返回空字符串

**解决**：
- 使用 `startOutputPolling()` 进行实时轮询
- 增加轮询间隔时间
- 检查命令是否实际执行

### 命令被阻止

**问题**：`CommandNotPermitted`

**解决**：
- 检查 `getCommandRules()` 查看当前规则
- 修改规则策略或添加例外
- 使用 `confirmCommand()` 手动确认

### PTY 系统错误

**问题**：`PtyError`

**解决**：
- Windows: 确保 PowerShell 或 CMD 可用
- Linux/macOS: 确保 shell 路径正确
- 检查系统 PTY 设备权限

## 下一步

1. **集成到 UI**: 创建 React 组件显示终端
2. **持久化**: 保存命令历史和会话状态
3. **主题**: 支持终端配色方案
4. **快捷键**: 添加常用快捷键支持
5. **自动补全**: 实现命令和路径补全

## 相关文件

- **Rust Backend**: `src-tauri/src/modules/terminal.rs`
- **TypeScript Service**: `src/modules/terminal/services/terminalService.ts`
- **Contracts**: `src/core/contracts/terminal.ts`
- **Tests**: `src/modules/terminal/services/terminalService.test.ts`
- **Documentation**: `docs/terminal-module.md`

## 贡献

欢迎提交 Issue 和 PR！

## 许可证

与项目主体保持一致
