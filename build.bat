@echo off
REM Astra Nexus Workbench - 自动构建脚本
REM 用法: 双击运行此脚本

echo ============================================
echo Astra Nexus Workbench 构建脚本
echo ============================================
echo.

REM 检查 Rust 是否已安装
echo [1/5] 检查 Rust 工具链...
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
    echo 正在打开 Rust 安装程序...
    if exist rustup-init.exe (
        start rustup-init.exe
    ) else (
        echo rustup-init.exe 未找到，请手动下载: https://rustup.rs/
    )
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('cargo --version') do set CARGO_VERSION=%%i
echo ✅ Rust 已安装: %CARGO_VERSION%
echo.

REM 检查 Node.js
echo [2/5] 检查 Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未检测到 Node.js！
    echo 请从 https://nodejs.org/ 安装 Node.js
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js 已安装: %NODE_VERSION%
echo.

REM 检查 Rust 代码
echo [3/5] 检查 Rust 代码...
cd src-tauri
cargo check
if errorlevel 1 (
    echo.
    echo ❌ Rust 代码检查失败！
    echo 请查看上面的错误信息。
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✅ Rust 代码检查通过
echo.

REM 运行前端测试
echo [4/5] 运行测试...
call npm test
if errorlevel 1 (
    echo.
    echo ❌ 测试失败！
    pause
    exit /b 1
)
echo ✅ 所有测试通过
echo.

REM 构建应用
echo [5/5] 构建应用...
echo 这可能需要几分钟时间，请耐心等待...
echo.
call npm run tauri build
if errorlevel 1 (
    echo.
    echo ❌ 构建失败！
    pause
    exit /b 1
)

echo.
echo ============================================
echo ✅ 构建成功！
echo ============================================
echo.
echo 可执行文件位置:
echo   src-tauri\target\release\astra-nexus-workbench.exe
echo.
echo 安装包位置:
echo   src-tauri\target\release\bundle\
echo.
pause
