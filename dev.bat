@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  TodoCalendar Dev Mode
echo ========================================
echo.
echo Starting... please wait for compilation.
echo Keep this window open; closing it exits the app.
echo.
npx --yes @tauri-apps/cli@latest dev
pause
