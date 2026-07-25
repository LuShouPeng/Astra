@echo off
REM Astra Nexus Workbench - 开发模式启动脚本
REM 用法: 双击运行此脚本

echo ============================================
echo Astra Nexus Workbench 开发模式
echo ============================================
echo.

REM 检查 Rust 是否已安装
echo 检查 Rust 工具链...
cargo --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ❌ 未检测到 Rust 工具链！
    echo.
    echo 请先安装 Rust：
    echo   1. 运行项目根目录中的 rustup-init.exe
    echo   2. 选择选项 1 进行标准安装
    echo   3. 安装完成后，重启终端
    echo   4. 再次运行此脚本
    echo.
    pause
    exit /b 1
)

echo ✅ Rust 已安装
echo.

REM 启动开发服务器
echo 正在启动开发服务器...
echo.
echo 功能特性:
echo   ✅ 前端热重载
echo   ✅ Git 写操作完整功能
echo   ✅ 实时调试
echo.
echo 按 Ctrl+C 停止服务器
echo.

call npm run tauri dev
