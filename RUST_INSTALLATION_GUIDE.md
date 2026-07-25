# 🔧 Rust 安装详细指南

## 当前情况

Rust 需要 **Visual Studio C++ 组件**才能在 Windows 上正常工作。

---

## 🎯 推荐方案：自动安装（最简单）

### 步骤 1: 运行自动安装脚本

**双击运行**：`install-rust.bat`

这个脚本会：
1. 自动安装 Rust
2. 自动下载并安装 Visual Studio Community（如果需要）
3. 配置所有必需的组件

**注意**：首次安装会下载约 2-3 GB 的文件，请确保网络连接良好。

---

## 🛠️ 方案二：手动分步安装

### 步骤 1: 安装 Visual Studio Build Tools

#### 选项 A: 完整的 Visual Studio Community（推荐）

1. 访问：https://visualstudio.microsoft.com/zh-hans/downloads/
2. 下载 **Visual Studio Community 2022**（免费）
3. 运行安装程序
4. 在工作负载选择界面，勾选：
   - ✅ **使用 C++ 的桌面开发**
5. 点击安装，等待完成（约 15-30 分钟）

#### 选项 B: 仅安装 Build Tools（更小）

1. 访问：https://visualstudio.microsoft.com/zh-hans/downloads/
2. 向下滚动到 **所有下载 → Tools for Visual Studio**
3. 下载 **Build Tools for Visual Studio 2022**
4. 运行安装程序
5. 勾选：
   - ✅ **Desktop development with C++**（使用 C++ 的桌面开发）
   - ✅ **Windows 10 SDK**
6. 点击安装，等待完成（约 10-20 分钟）

### 步骤 2: 安装 Rust

安装完 Visual Studio 组件后：

**方法 1：使用安装脚本**
```bash
双击运行：rustup-init.exe
```

**方法 2：命令行安装**
```bash
# 在终端中运行
rustup-init.exe -y --default-toolchain stable
```

在弹出的窗口中：
1. 输入 `1` 并按回车（选择标准安装）
2. 等待安装完成（约 5-10 分钟）

### 步骤 3: 验证安装

**重要**：关闭当前终端，打开新终端窗口

```bash
# 检查 Rust 版本
cargo --version

# 应该显示类似：
# cargo 1.xx.x (xxxxx 2024-xx-xx)
```

如果看到版本号，说明安装成功！✅

---

## 🚀 方案三：使用 GNU ABI（不推荐）

如果你不想安装 Visual Studio，可以使用 GNU 工具链（但可能遇到兼容性问题）：

```bash
rustup-init.exe --default-host x86_64-pc-windows-gnu -y
```

**缺点**：
- 可能无法编译某些依赖
- git2 库可能编译失败
- 需要额外安装 MinGW

---

## ⚡ 快速安装命令（推荐）

如果你已经安装了 Visual Studio 或 Build Tools：

```bash
# 在 PowerShell 中运行（以管理员身份）
.\rustup-init.exe -y --default-toolchain stable

# 重启终端后验证
cargo --version
```

---

## 🔍 常见问题

### ❓ "无法连接到服务器"
**解决方案**：
- 检查网络连接
- 尝试使用代理或 VPN
- 手动下载：https://www.rust-lang.org/zh-CN/tools/install

### ❓ "找不到 MSVC"
**解决方案**：
1. 确保已安装 Visual Studio 或 Build Tools
2. 确保勾选了 "Desktop development with C++"
3. 重启计算机
4. 重新运行 rustup-init.exe

### ❓ 安装很慢
**原因**：需要下载约 1-2 GB 的文件
**解决方案**：耐心等待，确保网络连接稳定

### ❓ "error: linker 'link.exe' not found"
**解决方案**：
1. 安装 Visual Studio Build Tools
2. 重启终端
3. 重新编译

---

## 📊 安装时间参考

| 组件 | 下载大小 | 安装时间 |
|------|----------|----------|
| Visual Studio Community | ~2-3 GB | 15-30 分钟 |
| Build Tools | ~1-2 GB | 10-20 分钟 |
| Rust 工具链 | ~200-300 MB | 5-10 分钟 |
| **总计** | ~3-4 GB | 30-60 分钟 |

---

## ✅ 安装成功标志

当你在新终端中运行 `cargo --version` 看到以下输出时，说明安装成功：

```
cargo 1.xx.x (xxxxx 2024-xx-xx)
```

然后你可以运行：

```bash
# 开发模式
npm run tauri dev

# 或双击运行
dev.bat
```

---

## 🎯 推荐的完整安装流程

### 如果你是第一次使用 Rust：

1. **安装 Visual Studio Community**
   - 最完整的开发环境
   - 包含所有必需工具
   - 未来可能用到的其他功能

2. **运行自动安装脚本**
   ```bash
   双击：install-rust.bat
   ```

3. **重启终端**

4. **验证安装**
   ```bash
   cargo --version
   ```

5. **启动项目**
   ```bash
   双击：dev.bat
   ```

---

## 💡 小提示

### 加速下载
如果在中国大陆，可以使用国内镜像：

```bash
# 在安装前设置环境变量（PowerShell）
$env:RUSTUP_DIST_SERVER="https://mirrors.ustc.edu.cn/rust-static"
$env:RUSTUP_UPDATE_ROOT="https://mirrors.ustc.edu.cn/rust-static/rustup"

# 然后运行
.\rustup-init.exe -y
```

### 离线安装
如果网络不稳定，可以：
1. 在网络好的地方下载完整的离线安装包
2. 传输到目标机器
3. 运行离线安装

---

## 🆘 获取帮助

如果安装过程中遇到问题：

1. **查看错误信息**：仔细阅读终端中的错误提示
2. **检查先决条件**：确保 Visual Studio 组件已正确安装
3. **重启系统**：有时重启可以解决环境变量问题
4. **查看官方文档**：https://www.rust-lang.org/zh-CN/tools/install

---

## 📞 下一步

安装完成后：

1. ✅ 验证安装：`cargo --version`
2. ✅ 运行项目：双击 `dev.bat`
3. ✅ 阅读文档：`START_HERE.md`
4. ✅ 测试功能：在应用中测试 Git 操作

---

**祝你安装顺利！** 🚀

如有问题，请查看上述常见问题部分或查看错误信息。
