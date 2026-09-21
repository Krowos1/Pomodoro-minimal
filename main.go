package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:            "Pomodoro",
		StartHidden:      true,
		Width:            1320,
		Height:           900,
		MinWidth:         1180,
		MinHeight:        720,
		Frameless:        true,
		WindowStartState: options.Normal,
		OnBeforeClose:    app.beforeClose,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 246, G: 247, B: 251, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		log.Fatal(err)
	}
}
