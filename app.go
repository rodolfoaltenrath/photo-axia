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
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	assetsMu   sync.RWMutex
	imagePaths map[string]string
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
	ID        string `json:"id"`
	Name      string `json:"name"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	MimeType  string `json:"mimeType"`
	SourceURL string `json:"sourceUrl"`
}

func NewApp() *App {
	return &App{imagePaths: make(map[string]string)}
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
		imported, err := a.readImageFile(path)
		if err != nil {
			return nil, err
		}
		images = append(images, imported)
	}

	return images, nil
}

func (a *App) SaveExportedPNG(suggestedName string, dataURL string) (string, error) {
	if suggestedName == "" {
		suggestedName = "imagem.png"
	}
	if filepath.Ext(suggestedName) == "" {
		suggestedName += ".png"
	}

	encoded, found := strings.CutPrefix(dataURL, "data:image/png;base64,")
	if !found {
		return "", fmt.Errorf("formato de exportacao invalido")
	}

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decodificar PNG: %w", err)
	}
	if len(data) < 8 || http.DetectContentType(data) != "image/png" {
		return "", fmt.Errorf("conteudo exportado nao e um PNG valido")
	}

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Exportar PNG",
		DefaultFilename: suggestedName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Imagem PNG", Pattern: "*.png"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if strings.ToLower(filepath.Ext(path)) != ".png" {
		path += ".png"
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("salvar PNG: %w", err)
	}

	return path, nil
}

func (a *App) readImageFile(path string) (ImportedImage, error) {
	file, err := os.Open(path)
	if err != nil {
		return ImportedImage{}, err
	}
	defer file.Close()

	config, format, err := image.DecodeConfig(file)
	if err != nil {
		return ImportedImage{}, err
	}

	mimeType := "image/" + format
	if format == "jpeg" {
		mimeType = "image/jpeg"
	}
	id := fmt.Sprintf("image-%d", time.Now().UnixNano())

	a.assetsMu.Lock()
	a.imagePaths[id] = path
	a.assetsMu.Unlock()

	return ImportedImage{
		ID:        id,
		Name:      filepath.Base(path),
		Width:     config.Width,
		Height:    config.Height,
		MimeType:  mimeType,
		SourceURL: "/__axia_asset/" + id,
	}, nil
}

func (a *App) AssetHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.Error(response, "metodo nao permitido", http.StatusMethodNotAllowed)
			return
		}

		id, found := strings.CutPrefix(request.URL.Path, "/__axia_asset/")
		if !found || id == "" || strings.Contains(id, "/") {
			http.NotFound(response, request)
			return
		}

		a.assetsMu.RLock()
		path, exists := a.imagePaths[id]
		a.assetsMu.RUnlock()
		if !exists {
			http.NotFound(response, request)
			return
		}

		response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(response, request, path)
	})
}

func (a *App) AssetMiddleware(next http.Handler) http.Handler {
	assets := a.AssetHandler()
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/__axia_asset/") {
			assets.ServeHTTP(response, request)
			return
		}
		next.ServeHTTP(response, request)
	})
}
