@echo off
echo ============================================
echo Rust 一键安装程序
echo ============================================
echo.
echo 此脚本将自动安装 Rust 和所需的 C++ 工具
echo.
echo 安装过程：
echo   1. 安装 Rust 工具链
echo   2. 如需要，会自动下载 Visual Studio
echo   3. 配置开发环境
echo.
echo 注意：
echo   - 需要下载约 1-3 GB 的文件
echo   - 安装时间约 20-40 分钟
echo   - 需要稳定的网络连接
echo.
echo ============================================
echo.
choice /C YN /M "是否继续安装？(Y=是, N=否)"
if errorlevel 2 goto :cancel
if errorlevel 1 goto :install

:install
echo.
echo [1/3] 正在启动 Rust 安装程序...
echo.
echo 在弹出的窗口中：
echo   - 如果提示需要 Visual Studio，请选择选项 1
echo   - 等待下载和安装完成
echo   - 不要关闭此窗口
echo.
pause
echo.

REM 使用默认设置自动安装
rustup-init.exe -y --default-toolchain stable --profile default

if errorlevel 1 (
    echo.
    echo ============================================
    echo 安装遇到问题
    echo ============================================
    echo.
    echo 可能的原因：
    echo   1. 缺少 Visual Studio C++ 组件
    echo   2. 网络连接问题
    echo   3. 权限不足
    echo.
    echo 请尝试以下解决方案：
    echo.
    echo 方案 1: 手动安装 Visual Studio Build Tools
    echo   访问: https://visualstudio.microsoft.com/downloads/
    echo   下载并安装 "Build Tools for Visual Studio"
    echo   勾选: "Desktop development with C++"
    echo   安装完成后，重新运行此脚本
    echo.
    echo 方案 2: 以管理员身份运行
    echo   右键点击此脚本
    echo   选择"以管理员身份运行"
    echo.
    echo 方案 3: 查看详细安装指南
    echo   打开: RUST_INSTALLATION_GUIDE.md
    echo.
    pause
    goto :end
)

echo.
echo [2/3] 配置环境变量...
echo.

REM 刷新环境变量
call "%USERPROFILE%\.cargo\env.bat" 2>nul

echo.
echo [3/3] 验证安装...
echo.

REM 检查 cargo 是否可用
where cargo >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Cargo 命令未找到
    echo.
    echo 请执行以下步骤：
    echo   1. 关闭此窗口
    echo   2. 重新打开一个新的终端
    echo   3. 运行命令: cargo --version
    echo   4. 如果显示版本号，说明安装成功
    echo   5. 然后运行: dev.bat
    echo.
) else (
    echo ✅ 安装成功！
    echo.
    cargo --version
    echo.
    echo ============================================
    echo 下一步
    echo ============================================
    echo.
    echo 1. 关闭此窗口
    echo 2. 打开新终端（重要！）
    echo 3. 运行以下命令启动项目：
    echo    dev.bat
    echo.
    echo 或者运行：
    echo    npm run tauri dev
    echo.
    echo 首次启动需要 5-15 分钟编译 Rust 代码
    echo 请耐心等待...
    echo.
)

pause
goto :end

:cancel
echo.
echo 安装已取消
echo.
echo 如需手动安装，请：
echo   1. 打开 RUST_INSTALLATION_GUIDE.md 查看详细步骤
echo   2. 或访问: https://www.rust-lang.org/zh-CN/tools/install
echo.
pause

:end
