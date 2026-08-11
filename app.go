package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/image/draw"
)

type App struct {
	ctx           context.Context
	assetsMu      sync.RWMutex
	imagePaths    map[string]string
	projectMu     sync.Mutex
	projectSaves  map[string]string
	projectFiles  map[string]projectSession
	documentDirty atomic.Bool
	previewSlots  chan struct{}
	previewCache  *previewCache
}

// previewCacheCapacityBytes and previewCacheMaxEntries are vars (not consts) so
// tests can temporarily shrink them to exercise eviction.
var previewCacheCapacityBytes int64 = 64 * 1024 * 1024
var previewCacheMaxEntries = 200

type previewCacheKey struct {
	id     string
	width  int
	height int
}

type previewCacheEntry struct {
	key         previewCacheKey
	modTime     time.Time
	size        int64
	contentType string
	data        []byte
}

// previewCache is a small in-memory LRU for generated image previews, keyed by
// (asset id, width, height). Entries are validated against the source file's
// mtime/size on every read so a changed file on disk is never served stale.
//
// Deliberately a slice scanned linearly instead of a container/list+map: the
// expected working set is tiny (bounded by previewCacheCapacityBytes), so the
// O(n) scan is irrelevant in practice and this avoids the classic bug of a
// list and a map drifting out of sync on eviction.
type previewCache struct {
	mu      sync.Mutex
	entries []*previewCacheEntry // ordered oldest (least recently used) -> newest
	bytes   int64
}

func newPreviewCache() *previewCache {
	return &previewCache{}
}

func (c *previewCache) get(key previewCacheKey, modTime time.Time, size int64) (previewCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for index, entry := range c.entries {
		if entry.key != key {
			continue
		}
		if !entry.modTime.Equal(modTime) || entry.size != size {
			return previewCacheEntry{}, false
		}
		c.entries = append(c.entries[:index], c.entries[index+1:]...)
		c.entries = append(c.entries, entry)
		return *entry, true
	}
	return previewCacheEntry{}, false
}

func (c *previewCache) put(entry previewCacheEntry) {
	if int64(len(entry.data)) > previewCacheCapacityBytes {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	for index, existing := range c.entries {
		if existing.key == entry.key {
			c.bytes -= int64(len(existing.data))
			c.entries = append(c.entries[:index], c.entries[index+1:]...)
			break
		}
	}

	stored := entry
	c.entries = append(c.entries, &stored)
	c.bytes += int64(len(entry.data))

	for len(c.entries) > 0 && (c.bytes > previewCacheCapacityBytes || len(c.entries) > previewCacheMaxEntries) {
		oldest := c.entries[0]
		c.entries = c.entries[1:]
		c.bytes -= int64(len(oldest.data))
	}
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
	return &App{
		imagePaths:   make(map[string]string),
		projectSaves: make(map[string]string),
		projectFiles: make(map[string]projectSession),
		previewSlots: make(chan struct{}, 1),
		previewCache: newPreviewCache(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(context.Context) {
	a.releaseProjectSessions("")
	a.projectMu.Lock()
	a.projectSaves = make(map[string]string)
	a.projectMu.Unlock()
}

func (a *App) SetDocumentDirty(dirty bool) {
	a.documentDirty.Store(dirty)
}

func (a *App) beforeClose(ctx context.Context) bool {
	if !a.documentDirty.Load() {
		return false
	}
	result, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "Alterações não salvas",
		Message:       "O projeto possui alterações não salvas. Deseja sair mesmo assim?",
		Buttons:       []string{"Sair sem salvar", "Cancelar"},
		DefaultButton: "Cancelar",
		CancelButton:  "Cancelar",
	})
	return err != nil || result != "Sair sem salvar"
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

func (a *App) assetHandler() http.Handler {
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
		previewWidth, widthError := strconv.Atoi(request.URL.Query().Get("previewWidth"))
		previewHeight, heightError := strconv.Atoi(request.URL.Query().Get("previewHeight"))
		if widthError == nil && heightError == nil && previewWidth > 0 && previewHeight > 0 {
			if previewWidth > 8192 || previewHeight > 8192 || int64(previewWidth)*int64(previewHeight) > 32_000_000 {
				http.Error(response, "dimensoes de previa invalidas", http.StatusBadRequest)
				return
			}

			key := previewCacheKey{id: id, width: previewWidth, height: previewHeight}
			if info, statErr := os.Stat(path); statErr == nil {
				if entry, ok := a.previewCache.get(key, info.ModTime(), info.Size()); ok {
					writePreviewEntry(response, entry)
					return
				}
			}

			select {
			case a.previewSlots <- struct{}{}:
				defer func() { <-a.previewSlots }()
			case <-request.Context().Done():
				return
			}

			if info, statErr := os.Stat(path); statErr == nil {
				if entry, ok := a.previewCache.get(key, info.ModTime(), info.Size()); ok {
					writePreviewEntry(response, entry)
					return
				}
			}

			entry, err := generateImagePreview(path, previewWidth, previewHeight)
			if err != nil {
				http.Error(response, "falha ao gerar previa", http.StatusInternalServerError)
				return
			}
			entry.key = key
			a.previewCache.put(entry)
			writePreviewEntry(response, entry)
			return
		}

		response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(response, request, path)
	})
}

func generateImagePreview(path string, width int, height int) (previewCacheEntry, error) {
	file, err := os.Open(path)
	if err != nil {
		return previewCacheEntry{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return previewCacheEntry{}, err
	}

	source, format, err := image.Decode(file)
	if err != nil {
		return previewCacheEntry{}, err
	}

	preview := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.ApproxBiLinear.Scale(preview, preview.Bounds(), source, source.Bounds(), draw.Src, nil)

	var encoded bytes.Buffer
	contentType := "image/png"
	opaque, canCheckOpacity := source.(interface{ Opaque() bool })
	if format == "jpeg" || (canCheckOpacity && opaque.Opaque()) {
		contentType = "image/jpeg"
		err = jpeg.Encode(&encoded, preview, &jpeg.Options{Quality: 88})
	} else {
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		err = encoder.Encode(&encoded, preview)
	}
	if err != nil {
		return previewCacheEntry{}, err
	}

	return previewCacheEntry{
		modTime:     info.ModTime(),
		size:        info.Size(),
		contentType: contentType,
		data:        encoded.Bytes(),
	}, nil
}

func writePreviewEntry(response http.ResponseWriter, entry previewCacheEntry) {
	response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	response.Header().Set("Content-Type", entry.contentType)
	response.Header().Set("Content-Length", strconv.Itoa(len(entry.data)))
	response.Write(entry.data)
}

func (a *App) assetMiddleware(next http.Handler) http.Handler {
	assets := a.assetHandler()
	projects := a.projectHandler()
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/__axia_asset/") {
			assets.ServeHTTP(response, request)
			return
		}
		if strings.HasPrefix(request.URL.Path, "/__axia_project/") {
			projects.ServeHTTP(response, request)
			return
		}
		next.ServeHTTP(response, request)
	})
}
