@echo off
setlocal
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Go is not installed or not in PATH.
  pause
  exit /b 1
)
where wails >nul 2>nul
if errorlevel 1 (
  echo Wails CLI not found. Installing Wails v2...
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
)
go mod tidy
wails build
pause
