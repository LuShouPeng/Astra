# 🚀 快速安装和运行指南

## 📋 前提条件

- ✅ Windows 10/11
- ✅ Node.js 20.19+ 或 22.12+ （当前: 20.18.1，建议升级）
- ⚠️ Rust 工具链（需要安装）

---

## 🎯 三步快速开始

### 步骤 1: 安装 Rust 工具链

**方法 1: 使用项目中的安装程序（推荐）**

1. 双击运行 `rustup-init.exe`
2. 在命令行中输入 `1` 并按回车（选择标准安装）
3. 等待安装完成（约 5-10 分钟）
4. **重要**: 关闭并重新打开终端窗口

验证安装：
```bash
cargo --version
# 应该显示: cargo 1.xx.x
```

**方法 2: 从官网安装**
- 访问: https://rustup.rs/
- 下载并运行安装程序

### 步骤 2: 选择运行模式

#### 🔧 开发模式（推荐用于测试新功能）

双击运行 `dev.bat` 或在终端执行：
```bash
npm run tauri dev
```

**特点**:
- ✅ 支持前端热重载
- ✅ 实时查看代码更改
- ✅ 完整的 Git 写操作功能
- ✅ 实时调试

**首次启动**: 需要 5-15 分钟编译 Rust 代码  
**后续启动**: 30 秒 - 2 分钟

#### 📦 生产模式（构建可执行文件）

双击运行 `build.bat` 或在终端执行：
```bash
npm run tauri build
```

**生成文件位置**:
```
src-tauri/target/release/astra-nexus-workbench.exe  ← 可执行文件
src-tauri/target/release/bundle/                     ← 安装包
```

**构建时间**: 约 5-10 分钟（首次）

### 步骤 3: 测试 Git 写操作功能

1. **打开应用**后，添加一个本地 Git 项目
2. 导航到 **Changes** 页面
3. 尝试以下操作：
   - ✅ 提交更改（Commit）
   - ✅ 切换分支（Checkout）
   - ✅ 合并分支（Merge）
   - ✅ 重置状态（Reset）

---

## 🛠️ 使用便捷脚本

### 开发模式
```bash
# 方式 1: 双击
dev.bat

# 方式 2: 命令行
npm run tauri dev
```

### 生产构建
```bash
# 方式 1: 双击
build.bat

# 方式 2: 命令行
npm run tauri build
```

### 仅前端开发（无后端功能）
```bash
npm run dev
# 在浏览器打开 http://localhost:5173
# 注意: Git 写操作功能不可用
```

---

## 🔍 故障排除

### 问题 1: "cargo: command not found"

**原因**: Rust 未安装或环境变量未生效

**解决方案**:
1. 运行 `rustup-init.exe` 安装 Rust
2. **重启终端窗口**（重要！）
3. 验证: `cargo --version`

### 问题 2: Rust 编译错误

**常见错误**: git2 库编译失败

**解决方案**:
1. 安装 Visual Studio Build Tools
   - 下载: https://visualstudio.microsoft.com/downloads/
   - 选择 "Desktop development with C++"
2. 或安装完整的 Visual Studio Community

### 问题 3: Node.js 版本警告

```
You are using Node.js 20.18.1. Vite requires Node.js version 20.19+
```

**解决方案**: 升级 Node.js
- 下载最新版本: https://nodejs.org/
- 安装 LTS 版本（推荐）

### 问题 4: 端口被占用

```
Port 5173 is already in use
```

**解决方案**:
```bash
# 找到并结束占用端口的进程
netstat -ano | findstr :5173
taskkill /PID <进程ID> /F
```

### 问题 5: 构建速度慢

**优化方案**:
1. 确保网络连接良好（需要下载依赖）
2. 首次构建需要更长时间，后续会更快
3. 使用 SSD 硬盘可以显著提升速度

---

## 📊 构建时间参考

| 操作 | 首次 | 后续 |
|------|------|------|
| Rust 工具链安装 | 5-10 分钟 | - |
| 开发模式启动 | 5-15 分钟 | 30秒-2分钟 |
| 生产构建 | 5-10 分钟 | 2-5 分钟 |
| 前端热重载 | - | < 1 秒 |

---

## 🎓 功能测试清单

启动应用后，按照以下清单测试新功能：

### ✅ Git Commit（提交）
1. 在本地 Git 项目中修改一些文件
2. 打开 Changes 页面
3. 点击 "Commit" 按钮
4. 输入提交信息
5. 确认提交成功

### ✅ Git Checkout（切换分支）
1. 点击 "Checkout" 按钮
2. 输入分支名称
3. 勾选 "Create new branch" 创建新分支
4. 确认切换成功

### ✅ Git Merge（合并）
1. 确保有其他分支可以合并
2. 点击 "Merge" 按钮
3. 输入要合并的分支名
4. 确认合并结果（成功或冲突）

### ✅ Git Reset（重置）
1. 点击 "Reset" 按钮
2. 选择重置类型（soft/mixed/hard）
3. 阅读警告信息（特别是 hard reset）
4. 确认重置成功

### ✅ Worktree 管理
1. 测试创建 worktree
2. 查看 worktree 列表
3. 测试删除 worktree

---

## 📚 相关文档

完成构建后，查看以下文档了解详细功能：

1. **QUICK_START.md** - 功能使用指南和示例
2. **README_GIT_OPERATIONS.md** - 功能总览
3. **GIT_OPERATIONS_IMPLEMENTATION.md** - 完整技术文档
4. **BUILD_AND_RUN.md** - 详细构建说明

---

## 🎯 开发工作流

### 日常开发
```bash
# 1. 启动开发模式
npm run tauri dev

# 2. 修改代码（前端自动热重载）

# 3. 如果修改了 Rust 代码，保存后自动重新编译

# 4. 测试功能

# 5. 按 Ctrl+C 停止
```

### 发布前
```bash
# 1. 运行测试
npm test

# 2. 类型检查
npm run typecheck

# 3. 代码规范检查
npm run lint

# 4. 构建生产版本
npm run tauri build

# 5. 测试生成的可执行文件
# 位于: src-tauri/target/release/astra-nexus-workbench.exe
```

---

## 💡 提示和技巧

### 加速构建
```bash
# 使用 release 优化但保留调试符号
cargo build --release

# 清理构建缓存（如果遇到奇怪的问题）
cd src-tauri
cargo clean
cd ..
```

### 查看详细日志
```bash
# 启用 Rust 日志
set RUST_LOG=debug
npm run tauri dev
```

### 仅构建前端
```bash
# 如果只修改了前端代码
npm run build
```

### 检查 Rust 代码（不构建）
```bash
cd src-tauri
cargo check
cd ..
```

---

## 🆘 获取帮助

如果遇到问题：

1. **查看错误信息**: 仔细阅读终端中的错误提示
2. **查看文档**: 
   - `BUILD_AND_RUN.md` - 详细构建说明
   - `QUICK_START.md` - 功能使用指南
3. **检查日志**: 
   - 终端输出
   - 应用内的错误提示
   - 浏览器控制台（开发模式）

---

## ✅ 成功标志

如果看到以下界面，说明构建成功：

### 开发模式
```
✓ built in XXXms

VITE v8.1.5  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose

Tauri CLI v2.x.x
```

### 生产构建
```
Finished release [optimized] target(s) in XX.XXs
    Bundling astra-nexus-workbench.exe
    Finished 1 bundle(s) at:
        src-tauri/target/release/bundle/...
```

---

**祝你使用愉快！** 🎉

如有问题，请查看详细文档或查看终端错误信息。
