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
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
			// DisableWebViewDrop fica desligado de propósito: o WebKitGTK já
			// registra um destino de drag-and-drop válido (aceita
			// text/uri-list do Nautilus). Ligar essa opção chama
			// gtk_drag_dest_unset() sem registrar nada no lugar, e como o
			// Wails não chama gtk_drag_dest_set() por conta própria, o
			// GTK passa a rejeitar o arrasto no nível do SO (cursor de
			// "não permitido" na janela inteira) antes mesmo do nosso
			// bridge (EnableFileDrop) entrar em ação.
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
