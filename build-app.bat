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
  go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
)
go mod tidy
pushd frontend
call npm test
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
popd
wails build
pause
