@echo off
setlocal
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Go is not installed or not in PATH.
  echo Install Go first: https://go.dev/dl/
  pause
  exit /b 1
)
where wails >nul 2>nul
if errorlevel 1 (
  echo Wails CLI not found. Installing Wails v2...
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  if errorlevel 1 (
    echo Failed to install Wails. Check your internet connection and Go PATH.
    pause
    exit /b 1
  )
)
echo Preparing Go modules...
go mod tidy
if errorlevel 1 (
  echo go mod tidy failed. Check the error above.
  pause
  exit /b 1
)
echo Starting Apple Pomodoro...
wails dev
pause
