# Pomodoro timer

A clean, minimal Pomodoro timer built with **Go + Wails**.

![App preview](preview.jpg)

## Features

- Focus, Short Break, and Long Break modes
- Accurate real-time countdown using `Date.now()`
- Compact responsive interface with scrolling support
- Light and dark themes
- Loud 4-second completion bell generated with Web Audio
- Sound toggle
- Auto-start next mode
- Daily focus statistics
- 7-day activity chart
- Session history
- JSON export
- Local state persistence through the Go backend

## Requirements

- Go 1.22+
- Wails v2 CLI
- A supported desktop WebView runtime

## Download

You can download the latest version of the app from the [Releases](../../releases) page.

## Run in development mode

```bash
go mod tidy
wails dev
```

On Windows you can also run:

```bat
run-dev.bat
```

## Build

```bash
wails build
```

On Windows you can also run:

```bat
build-app.bat
```
