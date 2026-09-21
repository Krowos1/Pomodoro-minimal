//go:build !windows

package main

func traySupported() bool { return false }
func startTray(_ *App)    {}
func stopTray()           {}
