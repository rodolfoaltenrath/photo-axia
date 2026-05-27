package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

type DocumentSpec struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Unit           string  `json:"unit"`
	PhysicalWidth  float64 `json:"physicalWidth"`
	PhysicalHeight float64 `json:"physicalHeight"`
	ResolutionDPI  int     `json:"resolutionDpi"`
	ColorSpace     string  `json:"colorSpace"`
	Background     string  `json:"background"`
	CreatedAt      string  `json:"createdAt"`
}

type EditorStatus struct {
	AppName      string `json:"appName"`
	Engine       string `json:"engine"`
	DocumentOpen bool   `json:"documentOpen"`
}

type ImportedImage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	MimeType string `json:"mimeType"`
	DataURL  string `json:"dataUrl"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) GetEditorStatus() EditorStatus {
	return EditorStatus{
		AppName:      "Axia",
		Engine:       "go-image-core/0.1.0",
		DocumentOpen: true,
	}
}

func (a *App) CreateDocument(name string, width int, height int, unit string, physicalWidth float64, physicalHeight float64, resolutionDPI int, background string) DocumentSpec {
	if name == "" {
		name = "Sem titulo"
	}

	if unit == "" {
		unit = "px"
	}

	if width <= 0 {
		width = 1920
	}

	if height <= 0 {
		height = 1080
	}

	if resolutionDPI <= 0 {
		resolutionDPI = 72
	}

	if physicalWidth <= 0 {
		physicalWidth = float64(width)
	}

	if physicalHeight <= 0 {
		physicalHeight = float64(height)
	}

	if background == "" {
		background = "transparent"
	}

	return DocumentSpec{
		ID:             fmt.Sprintf("doc-%d", time.Now().UnixNano()),
		Name:           name,
		Width:          width,
		Height:         height,
		Unit:           unit,
		PhysicalWidth:  physicalWidth,
		PhysicalHeight: physicalHeight,
		ResolutionDPI:  resolutionDPI,
		ColorSpace:     "sRGB",
		Background:     background,
		CreatedAt:      time.Now().Format(time.RFC3339),
	}
}

func (a *App) ApplyPreviewFilter(filterName string) string {
	if filterName == "" {
		filterName = "clarity"
	}

	return "Filtro enviado para o motor Go: " + filterName
}

func (a *App) SelectImageFiles() ([]ImportedImage, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Importar imagens",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Imagens",
				Pattern:     "*.png;*.jpg;*.jpeg;*.gif",
			},
		},
	})
	if err != nil {
		return nil, err
	}

	images := make([]ImportedImage, 0, len(paths))
	for _, path := range paths {
		imported, err := readImageFile(path)
		if err != nil {
			return nil, err
		}
		images = append(images, imported)
	}

	return images, nil
}

func readImageFile(path string) (ImportedImage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ImportedImage{}, err
	}

	file, err := os.Open(path)
	if err != nil {
		return ImportedImage{}, err
	}
	defer file.Close()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		return ImportedImage{}, err
	}

	mimeType := http.DetectContentType(data)
	return ImportedImage{
		ID:       fmt.Sprintf("image-%d", time.Now().UnixNano()),
		Name:     filepath.Base(path),
		Width:    config.Width,
		Height:   config.Height,
		MimeType: mimeType,
		DataURL:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data),
	}, nil
}
