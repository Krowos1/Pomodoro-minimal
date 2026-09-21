# Pomodoro Minimal

A focused desktop Pomodoro timer built with Go, Wails and dependency-free ES modules.

![](https://github.com/Krowos1/Pomodoro-minimal/blob/main/view.PNG)

## Features

- Focus, short-break and optional long-break modes
- Persistent stopwatch mode for tracking time spent on a task
- Accurate countdown that survives application restarts without inventing missed sessions
- Separate auto-start settings for focus and break sessions
- In-app completion alerts with sound, system tray and always-on-top mode on Windows
- Compact timer-only window mode
- Frameless maximised or resizable windowed mode with integrated window controls
- Completion ringtone (`rington1.mp3`) or generated soft bell with volume control
- Local-time daily, weekly and monthly statistics
- Completed/interrupted session tracking, filtering, editing and deletion
- Atomic local persistence with a backup file
- Validated, versioned JSON import with confirmation and native import/export dialogs
- Keyboard controls: `Space` start/pause, `R` reset, `S` skip
- Light/dark themes and accessible keyboard focus
- Unified SVG icon system and mode-aware interface accents
- Scroll-free settings and statistics, paginated history, and app-styled selection menus

Data is stored locally in the operating-system user configuration directory under `ApplePomodoro` for compatibility with earlier releases.

## Development

Requirements: Go 1.26.6+, Node.js 18+ and Wails CLI 2.16.0.

```bash
cd frontend
npm test
npm run build
cd ..
go test ./...
wails dev
```

On Windows, `run-dev.bat` performs the frontend build and launches development mode. `build-app.bat` runs tests and creates a production build.

## Project layout

- `frontend/src/` — maintainable frontend source
- `frontend/tests/` — timer, state, date and real-browser interaction tests
- `frontend/dist/` — generated assets embedded by Go
- `build/appicon.png` — application icon used by Wails
- `build/appicon.ico` — Windows executable and tray icon
- `scripts/windows_resources/` — post-build Windows icon and version metadata

The Windows executable is generated as `build/bin/Pomodoro-Minimal.exe`. It includes product name, company, version and icon resources. A trusted Authenticode certificate is still required to replace “Unknown publisher” in SmartScreen.
