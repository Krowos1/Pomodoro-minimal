//go:build windows

package main

import (
	_ "embed"

	"github.com/getlantern/systray"
)

//go:embed build/appicon.ico
var trayIcon []byte

func traySupported() bool { return true }

func startTray(app *App) {
	go systray.Run(func() {
		systray.SetIcon(trayIcon)
		systray.SetTitle("Pomodoro")
		systray.SetTooltip("Pomodoro — focus timer")
		show := systray.AddMenuItem("Open Pomodoro", "Show the timer")
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit", "Close Pomodoro")
		go func() {
			for {
				select {
				case <-show.ClickedCh:
					app.ShowWindow()
				case <-quit.ClickedCh:
					app.Quit()
					return
				}
			}
		}()
	}, func() {})
}

func stopTray() { systray.Quit() }
