# 构建和运行指南

## 当前状态

✅ **前端构建成功！**
```
dist/index.html                  0.44 kB
dist/assets/index-DA4hQfSz.css  64.86 kB
dist/assets/index-GBfi9-vs.js  406.73 kB
```

⚠️ **需要安装 Rust 工具链才能构建完整的 Tauri 应用**

---

## 🚀 完整构建步骤

### 步骤 1: 安装 Rust 工具链

#### 方法 A: 使用项目中的安装程序（推荐）
```bash
# 在项目根目录运行
./rustup-init.exe
```

安装时选择：
1. 选择 `1) Proceed with standard installation (default - just press enter)`
2. 等待安装完成
3. 安装完成后，重启终端使环境变量生效

#### 方法 B: 从官网下载
访问 https://rustup.rs/ 下载并安装

### 步骤 2: 验证 Rust 安装

```bash
# 重启终端后运行
cargo --version
rustc --version

# 应该看到类似输出：
# cargo 1.xx.x
# rustc 1.xx.x
```

### 步骤 3: 检查 Rust 后端代码

```bash
cd src-tauri
cargo check
```

预期输出：
```
Checking astra-nexus-workbench v0.1.0
Finished `dev` profile [unoptimized + debuginfo] target(s) in X.XXs
```

如果有编译错误，请查看错误信息并修复。

### 步骤 4: 构建完整应用

#### 开发模式（推荐先用这个测试）
```bash
# 回到项目根目录
cd ..

# 启动开发服务器
npm run tauri dev
```

这会：
1. 启动 Vite 开发服务器（前端热重载）
2. 编译 Rust 后端
3. 启动 Tauri 应用窗口

#### 生产模式
```bash
# 构建生产版本
npm run tauri build
```

这会：
1. 构建优化的前端代码
2. 编译优化的 Rust 后端
3. 生成可执行文件和安装包

生成的文件位于：
- Windows: `src-tauri/target/release/astra-nexus-workbench.exe`
- 安装包: `src-tauri/target/release/bundle/`

---

## 🔧 常见问题

### 问题 1: Node.js 版本警告
```
You are using Node.js 20.18.1. Vite requires Node.js version 20.19+ or 22.12+
```

**解决方案**: 升级 Node.js 到 20.19+ 或 22.12+
- 下载: https://nodejs.org/

### 问题 2: Rust 工具链未找到
```
cargo: command not found
```

**解决方案**: 
1. 运行 `./rustup-init.exe` 安装 Rust
2. 重启终端
3. 验证: `cargo --version`

### 问题 3: 编译错误
如果 Rust 编译出错，可能是依赖问题。

**解决方案**:
```bash
cd src-tauri
cargo clean
cargo update
cargo check
```

### 问题 4: git2 编译错误
git2 库可能需要额外的系统依赖。

**Windows 解决方案**:
1. 安装 Visual Studio Build Tools
2. 或安装完整的 Visual Studio（包含 C++ 开发工具）

---

## 📦 快速测试（仅前端）

如果你只想测试前端代码（不包含 Git 写操作功能）：

```bash
# 开发模式
npm run dev

# 在浏览器中打开
# 默认: http://localhost:5173
```

**注意**: 这种模式下，Git 写操作功能无法使用，因为需要 Rust 后端支持。

---

## 🎯 推荐的构建流程

### 首次构建
```bash
# 1. 安装 Rust
./rustup-init.exe

# 2. 重启终端

# 3. 验证 Rust
cargo --version

# 4. 检查 Rust 代码
cd src-tauri
cargo check
cd ..

# 5. 运行开发模式
npm run tauri dev
```

### 日常开发
```bash
# 启动开发服务器（支持热重载）
npm run tauri dev
```

### 生产构建
```bash
# 1. 确保所有测试通过
npm test

# 2. 类型检查
npm run typecheck

# 3. 代码规范
npm run lint

# 4. 构建生产版本
npm run tauri build

# 5. 可执行文件位于
# src-tauri/target/release/astra-nexus-workbench.exe
```

---

## 📊 构建时间估算

- **首次 Rust 编译**: 5-15 分钟（取决于网络和 CPU）
- **后续 Rust 增量编译**: 30 秒 - 2 分钟
- **前端构建**: 5-10 秒
- **完整应用构建**: 1-3 分钟

---

## 🧪 验证新功能

构建成功后，测试 Git 写操作功能：

### 1. 打开一个本地 Git 项目
在应用中添加一个本地 Git 仓库项目

### 2. 查看 Changes 页面
应该能看到未提交的更改

### 3. 测试 Git 操作
- 点击 "Commit" 按钮测试提交
- 点击 "Checkout" 按钮测试分支切换
- 点击 "Merge" 按钮测试合并
- 点击 "Reset" 按钮测试重置

### 4. 检查控制台
如果有错误，查看：
- 应用内的错误提示
- 浏览器开发者工具（如果是 dev 模式）
- 终端输出

---

## 🔍 调试技巧

### 查看 Rust 日志
```bash
# 启用详细日志
RUST_LOG=debug npm run tauri dev
```

### 查看 Tauri 命令调用
在 `src-tauri/src/lib.rs` 中添加日志：
```rust
println!("Git commit called with: {:?}", request);
```

### 前端调试
在 Chrome DevTools 中查看：
- Console: 查看 JavaScript 错误
- Network: 查看 Tauri 命令调用

---

## 📝 构建脚本

我为你创建了一个自动化构建脚本：

**build.sh** (Linux/Mac):
```bash
#!/bin/bash
set -e

echo "🔍 Checking Rust installation..."
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust not found. Please install Rust first."
    echo "Run: ./rustup-init.exe"
    exit 1
fi

echo "✅ Rust found: $(cargo --version)"

echo ""
echo "🔧 Checking Rust code..."
cd src-tauri
cargo check
cd ..

echo ""
echo "🧪 Running tests..."
npm test

echo ""
echo "📦 Building application..."
npm run tauri build

echo ""
echo "✅ Build complete!"
echo "📁 Executable: src-tauri/target/release/astra-nexus-workbench.exe"
```

**build.bat** (Windows):
```batch
@echo off
echo Checking Rust installation...
cargo --version >nul 2>&1
if errorlevel 1 (
    echo Rust not found. Please install Rust first.
    echo Run: rustup-init.exe
    exit /b 1
)

echo Rust found.
echo.

echo Checking Rust code...
cd src-tauri
cargo check
if errorlevel 1 exit /b 1
cd ..

echo.
echo Running tests...
call npm test
if errorlevel 1 exit /b 1

echo.
echo Building application...
call npm run tauri build
if errorlevel 1 exit /b 1

echo.
echo Build complete!
echo Executable: src-tauri\target\release\astra-nexus-workbench.exe
```

---

## 🎉 下一步

构建成功后：

1. ✅ 测试所有 Git 操作功能
2. ✅ 创建测试用的 Git 仓库进行验证
3. ✅ 查看生成的文档了解功能详情
4. ✅ 根据需要集成到你的工作流程

---

## 📚 相关文档

- `QUICK_START.md` - 功能使用指南
- `GIT_OPERATIONS_IMPLEMENTATION.md` - 技术文档
- `README_GIT_OPERATIONS.md` - 功能总览

---

**祝构建成功！** 🚀
