package main

import (
	"embed"
	"log"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

const nativeFilesDroppedEvent = "axia:files-dropped"
const layerStyleWindowClosedEvent = "axia:layer-styles:window-closed"

func init() {
	// Registering the payload type allows the Wails v3 binding generator and
	// its Vite plugin to expose a strongly typed frontend event.
	application.RegisterEvent[[]string](nativeFilesDroppedEvent)
}

func main() {
	service := NewApp()

	desktop := application.New(application.Options{
		Name:        "Axia",
		Description: "Editor de imagens desktop",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: service.assetMiddleware,
		},
		Linux: application.LinuxOptions{
			ProgramName: "axia",
		},
	})

	window := desktop.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:       "main",
		Title:      "Axia",
		URL:        "/",
		Width:      1440,
		Height:     960,
		MinWidth:   1024,
		MinHeight:  720,
		StartState: application.WindowStateMaximised,
		// Do not reveal WebView2's previous frame while the Vue application is
		// still loading. The window is shown after the main frontend mounts.
		Hidden:                     true,
		BackgroundColour:           application.NewRGB(21, 25, 31),
		DefaultContextMenuDisabled: true,
		EnableFileDrop:             true,
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})

	service.configureDesktop(desktop, window)

	var revealMainWindowOnce sync.Once
	revealMainWindow := func() {
		revealMainWindowOnce.Do(func() {
			window.Show()
			window.Focus()
		})
	}

	// This is emitted by Wails after the WebView runtime has loaded. At that
	// point index.html's static startup shell is already painted, so it is safe
	// to reveal the window without exposing a stale WebView frame.
	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
		revealMainWindow()
	})
	// A broken runtime must never leave the application inaccessible. This only
	// runs on failure; normal startup is released by WindowRuntimeReady first.
	time.AfterFunc(2*time.Second, revealMainWindow)

	window.RegisterHook(events.Common.WindowClosing, service.handleWindowClosing)
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		if len(files) > 0 {
			desktop.Event.Emit(nativeFilesDroppedEvent, files)
		}
	})

	if err := desktop.Run(); err != nil {
		log.Fatal(err)
	}
}
