package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:                    "Axia",
		Width:                    1440,
		Height:                   960,
		MinWidth:                 1024,
		MinHeight:                720,
		WindowStartState:         options.Maximised,
		EnableDefaultContextMenu: false,
		Linux: &linux.Options{
			WebviewGpuPolicy: linux.WebviewGpuPolicyAlways,
			ProgramName:      "axia",
		},
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Handler:    app.assetHandler(),
			Middleware: app.assetMiddleware,
		},
		BackgroundColour: &options.RGBA{R: 21, G: 25, B: 31, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
