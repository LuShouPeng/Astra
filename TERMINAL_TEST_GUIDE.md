# 终端 PTY 模块测试验证指南

## 测试环境要求

### Windows 平台
- **Rust 工具链**: `stable-x86_64-pc-windows-msvc` (已安装)
- **C++ 编译器**: Visual Studio 2022/2019 或 Build Tools (已安装)
- **Node.js**: v20+ (已安装)

### 编译器环境确认
```bash
# 检查 Rust 工具链
rustup show

# 检查 Visual Studio 安装路径
powershell.exe -Command "& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe' -latest -property installationPath"

# 检查 Node.js
node --version
npm --version
```

---

## 快速验证命令

### 1. Rust 后端集成测试 (推荐)

**方法 A: 使用 PowerShell + VS DevShell (最可靠)**

```powershell
# 在 PowerShell 中执行
cd D:\Astra-main\Astra-main\src-tauri

# 加载 VS 环境并运行测试
Import-Module 'C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
Enter-VsDevShell -VsInstallPath 'C:\Program Files\Microsoft Visual Studio\18\Community' -SkipAutomaticLocation
cargo test --lib terminal -- --nocapture
```

**方法 B: 使用 Developer PowerShell for VS (更简单)**

```powershell
# 1. 从开始菜单打开 "Developer PowerShell for VS 2026"
# 2. 进入项目目录
cd D:\Astra-main\Astra-main\src-tauri

# 3. 运行测试
cargo test --lib terminal -- --nocapture
```

**方法 C: 使用 cmd.exe + vcvarsall.bat**

```cmd
cd D:\Astra-main\Astra-main\src-tauri
"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat" x64
cargo test --lib terminal -- --nocapture
```

---

### 2. TypeScript 前端服务测试

```bash
cd D:\Astra-main\Astra-main
npm test -- src/modules/terminal/services/terminalService.test.ts
```

---

## 测试内容说明

### Rust 后端测试 (7 项)

| 测试名称 | 验证内容 |
|---------|---------|
| `default_rules_deny_rm_rf_root` | 策略引擎正确拦截 `rm -rf /` 危险命令 |
| `default_rules_confirm_privilege_and_power` | `sudo`/`su`/`shutdown`/`reboot` 需要确认 |
| `default_rules_confirm_force_push` | `git push --force` 需要确认 |
| `ordinary_commands_are_allowed` | 普通命令 (`ls`/`npm install` 等) 直接允许 |
| `custom_rule_takes_effect` | 动态添加自定义规则生效 |
| `pty_spawns_shell_and_echoes_command` | **真实 PTY 交互**: 拉起 PowerShell、执行命令、读取输出 |
| `pty_resize_succeeds` | 终端尺寸调整功能正常 |

### TypeScript 前端测试 (16 项)

- 所有 Tauri 命令的 IPC 调用封装
- 会话创建、命令执行、输出读取、会话关闭
- 输出轮询机制
- 命令规则管理 (添加/查询)
- 工作目录切换

---

## 预期输出

### ✅ 成功输出示例

```
running 7 tests
test modules::terminal::tests::default_rules_deny_rm_rf_root ... ok
test modules::terminal::tests::default_rules_confirm_force_push ... ok
test modules::terminal::tests::custom_rule_takes_effect ... ok
test modules::terminal::tests::default_rules_confirm_privilege_and_power ... ok
test modules::terminal::tests::ordinary_commands_are_allowed ... ok
test modules::terminal::tests::pty_resize_succeeds ... ok
test modules::terminal::tests::pty_spawns_shell_and_echoes_command ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 1.30s
```

```
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Duration  2.94s
```

---

## 常见问题排查

### 问题 1: `link.exe` 错误 "extra operand"

**原因**: Git Bash 的 `link.exe` 遮蔽了 MSVC 链接器

**解决**: 使用 PowerShell 或 Developer Command Prompt,不要在 Git Bash 中运行 cargo

---

### 问题 2: `error: linker 'link.exe' not found`

**原因**: MSVC 环境未加载

**解决**: 
```powershell
# 方法 1: 使用 "Developer PowerShell for VS 2026" (从开始菜单打开)

# 方法 2: 手动加载环境
Import-Module 'C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
Enter-VsDevShell -VsInstallPath 'C:\Program Files\Microsoft Visual Studio\18\Community' -SkipAutomaticLocation
```

---

### 问题 3: `cargo test` 编译很慢

**说明**: 首次编译需要构建所有依赖 (Tauri、portable-pty 等),正常需要 2-5 分钟

**优化**: 后续测试会使用增量编译,速度会快很多

---

## 测试代码位置

- **Rust 测试**: `src-tauri/src/modules/terminal.rs` (文件末尾 `#[cfg(test)]` 模块)
- **TypeScript 测试**: `src/modules/terminal/services/terminalService.test.ts`

---

## 验证完成标志

当看到以下输出时,说明模块已通过完整验证:

```
✅ Rust 后端: 7 passed; 0 failed
✅ TypeScript 前端: 16 passed
```

**核心能力确认:**
- ✅ PTY 在 Windows PowerShell 中成功运行
- ✅ 命令策略引擎正确过滤危险操作
- ✅ 终端读写、resize、取消功能正常
- ✅ 前后端类型契约一致

---

## 测试日志

### 最近一次验证结果

**日期**: 2026-07-25  
**平台**: Windows 11 Pro 10.0.26200  
**Rust**: 1.97.1 (stable-x86_64-pc-windows-msvc)  
**Node**: v20.18.1  
**编译器**: Visual Studio 2026 Community v18.0

**Rust 测试**: 7/7 通过 (耗时 1.30s)  
**TypeScript 测试**: 16/16 通过 (耗时 2.94s)

**状态**: ✅ 所有测试通过,模块可正常运行
