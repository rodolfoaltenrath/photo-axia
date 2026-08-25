package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/image/draw"
)

type App struct {
	ctx                   context.Context
	desktop               *application.App
	mainWindow            application.Window
	assetsMu              sync.RWMutex
	imagePaths            map[string]string
	pdfPaths              map[string]string
	projectMu             sync.Mutex
	projectSaves          map[string]string
	projectFiles          map[string]projectSession
	recentMu              sync.Mutex
	recentUploads         map[string]recentUpload
	exportMu              sync.Mutex
	exportUploads         map[string]exportUpload
	recentConfigDirectory string
	recentCacheDirectory  string
	documentDirty         atomic.Bool
	previewSlots          chan struct{}
	previewCache          *previewCache
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
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Width            int     `json:"width"`
	Height           int     `json:"height"`
	MimeType         string  `json:"mimeType"`
	SourceURL        string  `json:"sourceUrl"`
	ByteSize         int64   `json:"byteSize,omitempty"`
	ResolutionDPIX   float64 `json:"resolutionDpiX,omitempty"`
	ResolutionDPIY   float64 `json:"resolutionDpiY,omitempty"`
	ResolutionSource string  `json:"resolutionSource,omitempty"`
}

func NewApp() *App {
	return &App{
		imagePaths:    make(map[string]string),
		pdfPaths:      make(map[string]string),
		projectSaves:  make(map[string]string),
		projectFiles:  make(map[string]projectSession),
		recentUploads: make(map[string]recentUpload),
		exportUploads: make(map[string]exportUpload),
		previewSlots:  make(chan struct{}, 1),
		previewCache:  newPreviewCache(),
	}
}

func (a *App) configureDesktop(desktop *application.App, window application.Window) {
	a.desktop = desktop
	a.mainWindow = window
}

func (a *App) newSaveFileDialog(title, filename, filterName, pattern string) (*application.SaveFileDialogStruct, error) {
	if a.desktop == nil {
		return nil, fmt.Errorf("aplicativo desktop indisponivel")
	}
	return a.desktop.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    title,
		Filename: filename,
		Filters: []application.FileFilter{
			{DisplayName: filterName, Pattern: pattern},
		},
		Window: a.mainWindow,
	}), nil
}

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	return nil
}

func (a *App) ServiceShutdown() error {
	a.shutdown(nil)
	return nil
}

func (a *App) shutdown(context.Context) {
	a.releaseProjectSessions("")
	a.assetsMu.Lock()
	a.imagePaths = make(map[string]string)
	a.pdfPaths = make(map[string]string)
	a.assetsMu.Unlock()
	a.projectMu.Lock()
	a.projectSaves = make(map[string]string)
	a.projectMu.Unlock()
	a.recentMu.Lock()
	a.recentUploads = make(map[string]recentUpload)
	a.recentMu.Unlock()
	a.exportMu.Lock()
	a.exportUploads = make(map[string]exportUpload)
	a.exportMu.Unlock()
}

func (a *App) SetDocumentDirty(dirty bool) {
	a.documentDirty.Store(dirty)
}

func (a *App) handleWindowClosing(event *application.WindowEvent) {
	if !a.documentDirty.Load() {
		return
	}

	// WindowClosing is cancelable in v3. Cancel first so a missing native
	// dialog can never discard an edited document.
	event.Cancel()
	if a.desktop == nil || a.mainWindow == nil {
		return
	}

	confirmed := false
	confirmLabel, cancelLabel := closeDialogButtonLabels()
	dialog := a.desktop.Dialog.Question().
		SetTitle("Alterações não salvas").
		SetMessage("O projeto possui alterações não salvas. Deseja sair mesmo assim?").
		AttachToWindow(a.mainWindow)
	dialog.AddButton(confirmLabel).OnClick(func() {
		confirmed = true
	})
	cancelButton := dialog.AddButton(cancelLabel)
	dialog.SetDefaultButton(cancelButton)
	dialog.SetCancelButton(cancelButton)
	dialog.Show()

	if confirmed {
		// Prevent a second confirmation when Close emits WindowClosing again.
		a.documentDirty.Store(false)
		a.mainWindow.Close()
	}
}

func (a *App) GetEditorStatus() EditorStatus {
	return EditorStatus{
		AppName:      "Axia",
		Engine:       "go-image-core/0.1.0",
		DocumentOpen: true,
	}
}

func (a *App) CreateDocument(name string, width int, height int, unit string, physicalWidth float64, physicalHeight float64, resolutionDPI int, background string) (DocumentSpec, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Sem titulo"
	}
	if len(name) > 512 {
		return DocumentSpec{}, fmt.Errorf("nome do documento excede o limite permitido")
	}
	if width <= 0 || height <= 0 || width > 16_384 || height > 16_384 || int64(width)*int64(height) > 64_000_000 {
		return DocumentSpec{}, fmt.Errorf("dimensoes do documento invalidas")
	}
	switch unit {
	case "px", "cm", "mm", "in":
	default:
		return DocumentSpec{}, fmt.Errorf("unidade do documento invalida")
	}
	if resolutionDPI < 1 || resolutionDPI > 2400 {
		return DocumentSpec{}, fmt.Errorf("resolucao do documento invalida")
	}
	if physicalWidth <= 0 || physicalHeight <= 0 || math.IsNaN(physicalWidth) || math.IsNaN(physicalHeight) ||
		math.IsInf(physicalWidth, 0) || math.IsInf(physicalHeight, 0) {
		return DocumentSpec{}, fmt.Errorf("dimensoes fisicas do documento invalidas")
	}
	switch background {
	case "transparent", "white", "black":
	default:
		return DocumentSpec{}, fmt.Errorf("fundo do documento invalido")
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
	}, nil
}

func (a *App) ApplyPreviewFilter(filterName string) string {
	if filterName == "" {
		filterName = "clarity"
	}

	return "Filtro enviado para o motor Go: " + filterName
}

func (a *App) SelectImageFiles() ([]ImportedImage, error) {
	if a.desktop == nil {
		return nil, fmt.Errorf("aplicativo desktop indisponivel")
	}
	dialog := a.desktop.Dialog.OpenFile().
		SetTitle("Importar imagens").
		AddFilter("Imagens", "*.png;*.jpg;*.jpeg;*.gif")
	if a.mainWindow != nil {
		dialog.AttachToWindow(a.mainWindow)
	}
	paths, err := dialog.PromptForMultipleSelection()
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

const maxPDFImportBytes int64 = 512 * 1024 * 1024

type PDFImportSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SourceURL string `json:"sourceUrl"`
	ByteSize  int64  `json:"byteSize"`
}

func (a *App) SelectPDFFile() (PDFImportSource, error) {
	if a.desktop == nil {
		return PDFImportSource{}, fmt.Errorf("aplicativo desktop indisponivel")
	}
	dialog := a.desktop.Dialog.OpenFile().
		SetTitle("Importar PDF").
		AddFilter("Documento PDF", "*.pdf")
	if a.mainWindow != nil {
		dialog.AttachToWindow(a.mainWindow)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil || path == "" {
		return PDFImportSource{}, err
	}
	return a.registerPDFImport(path)
}

func (a *App) registerPDFImport(path string) (PDFImportSource, error) {
	file, err := os.Open(path)
	if err != nil {
		return PDFImportSource{}, fmt.Errorf("abrir PDF: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return PDFImportSource{}, fmt.Errorf("examinar PDF: %w", err)
	}
	if !info.Mode().IsRegular() {
		return PDFImportSource{}, fmt.Errorf("o item selecionado nao e um arquivo")
	}
	if info.Size() <= 0 || info.Size() > maxPDFImportBytes {
		return PDFImportSource{}, fmt.Errorf("o PDF deve ter no maximo 512 MB")
	}
	header := make([]byte, 5)
	if _, err := io.ReadFull(file, header); err != nil || !bytes.Equal(header, []byte("%PDF-")) {
		return PDFImportSource{}, fmt.Errorf("o arquivo selecionado nao e um PDF valido")
	}
	token, err := projectToken()
	if err != nil {
		return PDFImportSource{}, fmt.Errorf("preparar importacao do PDF: %w", err)
	}
	id := "pdf-" + token
	a.assetsMu.Lock()
	a.pdfPaths[id] = path
	a.assetsMu.Unlock()
	return PDFImportSource{
		ID:        id,
		Name:      filepath.Base(path),
		SourceURL: "/__axia_pdf/" + id,
		ByteSize:  info.Size(),
	}, nil
}

func (a *App) ReleasePDFImport(id string) {
	a.assetsMu.Lock()
	delete(a.pdfPaths, id)
	a.assetsMu.Unlock()
}

// DroppedFilesResult is the outcome of importing a native OS drag-and-drop.
type DroppedFilesResult struct {
	Images []ImportedImage  `json:"images"`
	PDF    *PDFImportSource `json:"pdf,omitempty"`
	Errors []string         `json:"errors"`
}

// ImportDroppedFiles reads the files a user dragged onto the window (native
// OS drag-and-drop, delivered as absolute paths by the Wails runtime). Unlike
// SelectImageFiles, a dropped file may be a folder or an unsupported format,
// so invalid entries are skipped and reported instead of aborting the whole
// drop.
func (a *App) ImportDroppedFiles(paths []string) DroppedFilesResult {
	images := make([]ImportedImage, 0, len(paths))
	errs := make([]string, 0)
	var pdf *PDFImportSource
	for _, path := range paths {
		if strings.EqualFold(filepath.Ext(path), ".pdf") {
			if pdf != nil {
				errs = append(errs, fmt.Sprintf("%s: solte somente um PDF por vez", filepath.Base(path)))
				continue
			}
			source, err := a.registerPDFImport(path)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: %s", filepath.Base(path), err))
				continue
			}
			pdf = &source
			continue
		}
		imported, err := a.readImageFile(path)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", filepath.Base(path), err))
			continue
		}
		images = append(images, imported)
	}
	return DroppedFilesResult{Images: images, PDF: pdf, Errors: errs}
}

func (a *App) SaveExportedPNG(suggestedName string, dataURL string) (string, error) {
	return a.SaveExportedImage(suggestedName, dataURL, "image/png")
}

func (a *App) SaveExportedImage(suggestedName string, dataURL string, mimeType string) (string, error) {
	type exportFormat struct {
		extension string
		title     string
		filter    string
	}
	formats := map[string]exportFormat{
		"image/png":  {extension: ".png", title: "Exportar PNG", filter: "Imagem PNG"},
		"image/jpeg": {extension: ".jpg", title: "Exportar JPEG", filter: "Imagem JPEG"},
		"image/webp": {extension: ".webp", title: "Exportar WebP", filter: "Imagem WebP"},
	}
	format, supported := formats[mimeType]
	if !supported {
		return "", fmt.Errorf("formato de exportacao nao suportado")
	}
	if suggestedName == "" {
		suggestedName = "imagem" + format.extension
	}
	if !strings.EqualFold(filepath.Ext(suggestedName), format.extension) {
		suggestedName = strings.TrimSuffix(suggestedName, filepath.Ext(suggestedName)) + format.extension
	}

	encoded, found := strings.CutPrefix(dataURL, "data:"+mimeType+";base64,")
	if !found {
		return "", fmt.Errorf("formato de exportacao invalido")
	}

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decodificar PNG: %w", err)
	}
	if len(data) < 8 || http.DetectContentType(data) != mimeType {
		return "", fmt.Errorf("conteudo exportado nao corresponde ao formato solicitado")
	}

	dialog, err := a.newSaveFileDialog(format.title, suggestedName, format.filter, "*"+format.extension)
	if err != nil {
		return "", err
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if !strings.EqualFold(filepath.Ext(path), format.extension) {
		path = strings.TrimSuffix(path, filepath.Ext(path)) + format.extension
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("salvar imagem: %w", err)
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
	width, height := config.Width, config.Height
	if format == "jpeg" {
		mimeType = "image/jpeg"
		// EXIF orientations 5-8 apply a 90°/270° rotation, which the frontend
		// <img> element honors when painting — the raw decoded dimensions must
		// be swapped to match, or the fitted layer box gets the wrong aspect ratio.
		// Reuse the already-open handle (seek back to 0) instead of reopening the file.
		if _, err := file.Seek(0, io.SeekStart); err == nil {
			if orientation := jpegExifOrientation(file); orientation >= 5 && orientation <= 8 {
				width, height = height, width
			}
		}
	}
	resolutionDPIX, resolutionDPIY, resolutionSource := 0.0, 0.0, ""
	if _, err := file.Seek(0, io.SeekStart); err == nil {
		header, readErr := io.ReadAll(io.LimitReader(file, 256*1024))
		if readErr == nil {
			resolutionDPIX, resolutionDPIY, resolutionSource = imageResolutionFromHeader(header, format)
		}
	}
	byteSize := int64(0)
	if info, statErr := file.Stat(); statErr == nil {
		byteSize = info.Size()
	}
	token, err := projectToken()
	if err != nil {
		return ImportedImage{}, fmt.Errorf("gerar identificador da imagem: %w", err)
	}
	id := "image-" + token

	a.assetsMu.Lock()
	a.imagePaths[id] = path
	a.assetsMu.Unlock()

	return ImportedImage{
		ID:               id,
		Name:             filepath.Base(path),
		Width:            width,
		Height:           height,
		MimeType:         mimeType,
		SourceURL:        "/__axia_asset/" + id,
		ByteSize:         byteSize,
		ResolutionDPIX:   resolutionDPIX,
		ResolutionDPIY:   resolutionDPIY,
		ResolutionSource: resolutionSource,
	}, nil
}

func imageResolutionFromHeader(data []byte, format string) (float64, float64, string) {
	normalize := func(value float64) float64 {
		if value < 1 || value > 100000 || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0
		}
		return math.Round(value*100) / 100
	}
	if format == "png" && len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		for offset := 8; offset+12 <= len(data); {
			length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
			end := offset + 12 + length
			if length < 0 || end < offset || end > len(data) {
				break
			}
			if string(data[offset+4:offset+8]) == "pHYs" && length == 9 && data[offset+16] == 1 {
				x := normalize(float64(binary.BigEndian.Uint32(data[offset+8:offset+12])) * 0.0254)
				y := normalize(float64(binary.BigEndian.Uint32(data[offset+12:offset+16])) * 0.0254)
				if x > 0 && y > 0 {
					return x, y, "png-phys"
				}
				break
			}
			offset = end
		}
	}
	if format == "jpeg" && len(data) >= 4 && data[0] == 0xff && data[1] == 0xd8 {
		jfifX, jfifY := 0.0, 0.0
		for offset := 2; offset+4 <= len(data); {
			for offset < len(data) && data[offset] == 0xff {
				offset++
			}
			if offset >= len(data) {
				break
			}
			marker := data[offset]
			offset++
			if marker == 0xd9 || marker == 0xda {
				break
			}
			if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
				continue
			}
			if offset+2 > len(data) {
				break
			}
			length := int(binary.BigEndian.Uint16(data[offset : offset+2]))
			if length < 2 || offset+length > len(data) {
				break
			}
			payload := data[offset+2 : offset+length]
			if marker == 0xe0 && len(payload) >= 12 && string(payload[:5]) == "JFIF\x00" {
				factor := 0.0
				if payload[7] == 1 {
					factor = 1
				} else if payload[7] == 2 {
					factor = 2.54
				}
				x := normalize(float64(binary.BigEndian.Uint16(payload[8:10])) * factor)
				y := normalize(float64(binary.BigEndian.Uint16(payload[10:12])) * factor)
				if x > 0 && y > 0 {
					jfifX, jfifY = x, y
				}
			} else if marker == 0xe1 {
				if exifX, exifY, ok := parseExifResolution(payload); ok {
					x, y := normalize(exifX), normalize(exifY)
					if x > 0 && y > 0 {
						return x, y, "jpeg-exif"
					}
				}
			}
			offset += length
		}
		if jfifX > 0 && jfifY > 0 {
			return jfifX, jfifY, "jpeg-jfif"
		}
	}
	return 0, 0, ""
}

func parseExifResolution(payload []byte) (float64, float64, bool) {
	if len(payload) < 14 || string(payload[0:4]) != "Exif" || payload[4] != 0 || payload[5] != 0 {
		return 0, 0, false
	}
	tiff := payload[6:]
	var order binary.ByteOrder
	switch {
	case tiff[0] == 'I' && tiff[1] == 'I':
		order = binary.LittleEndian
	case tiff[0] == 'M' && tiff[1] == 'M':
		order = binary.BigEndian
	default:
		return 0, 0, false
	}
	if order.Uint16(tiff[2:4]) != 0x002a {
		return 0, 0, false
	}
	ifdOffset := int(order.Uint32(tiff[4:8]))
	if ifdOffset < 0 || ifdOffset+2 > len(tiff) {
		return 0, 0, false
	}
	entryCount := int(order.Uint16(tiff[ifdOffset : ifdOffset+2]))
	x, y, unit := 0.0, 0.0, uint16(2)
	for index := 0; index < entryCount; index++ {
		entryOffset := ifdOffset + 2 + index*12
		if entryOffset+12 > len(tiff) {
			return 0, 0, false
		}
		tag := order.Uint16(tiff[entryOffset : entryOffset+2])
		typeID := order.Uint16(tiff[entryOffset+2 : entryOffset+4])
		count := order.Uint32(tiff[entryOffset+4 : entryOffset+8])
		if tag == 0x0128 && typeID == 3 && count == 1 {
			unit = order.Uint16(tiff[entryOffset+8 : entryOffset+10])
			continue
		}
		if (tag != 0x011a && tag != 0x011b) || typeID != 5 || count != 1 {
			continue
		}
		rationalOffset := int(order.Uint32(tiff[entryOffset+8 : entryOffset+12]))
		if rationalOffset < 0 || rationalOffset+8 > len(tiff) {
			return 0, 0, false
		}
		denominator := order.Uint32(tiff[rationalOffset+4 : rationalOffset+8])
		if denominator == 0 {
			continue
		}
		value := float64(order.Uint32(tiff[rationalOffset:rationalOffset+4])) / float64(denominator)
		if tag == 0x011a {
			x = value
		} else {
			y = value
		}
	}
	factor := 0.0
	if unit == 2 {
		factor = 1
	} else if unit == 3 {
		factor = 2.54
	}
	if x <= 0 || y <= 0 || factor == 0 {
		return 0, 0, false
	}
	return x * factor, y * factor, true
}

// jpegExifOrientation reads the EXIF Orientation tag (0x0112) from a JPEG
// stream's APP1 segment, returning 1 (identity) when absent or unparsable.
// The reader must be positioned at the start of the JPEG (SOI marker).
func jpegExifOrientation(r io.Reader) int {
	var soi [2]byte
	if _, err := io.ReadFull(r, soi[:]); err != nil || soi[0] != 0xff || soi[1] != 0xd8 {
		return 1
	}

	for {
		var marker [2]byte
		if _, err := io.ReadFull(r, marker[:]); err != nil || marker[0] != 0xff {
			return 1
		}
		if marker[1] == 0xd8 || marker[1] == 0xd9 || (marker[1] >= 0xd0 && marker[1] <= 0xd7) {
			continue
		}
		if marker[1] == 0xda {
			return 1
		}
		var lengthBytes [2]byte
		if _, err := io.ReadFull(r, lengthBytes[:]); err != nil {
			return 1
		}
		segmentLength := int(binary.BigEndian.Uint16(lengthBytes[:]))
		if segmentLength < 2 {
			return 1
		}
		payload := make([]byte, segmentLength-2)
		if _, err := io.ReadFull(r, payload); err != nil {
			return 1
		}
		if marker[1] == 0xe1 {
			if orientation, ok := parseExifOrientation(payload); ok {
				return orientation
			}
		}
	}
}

func parseExifOrientation(payload []byte) (int, bool) {
	if len(payload) < 14 || string(payload[0:4]) != "Exif" || payload[4] != 0 || payload[5] != 0 {
		return 0, false
	}
	tiff := payload[6:]
	var order binary.ByteOrder
	switch {
	case tiff[0] == 'I' && tiff[1] == 'I':
		order = binary.LittleEndian
	case tiff[0] == 'M' && tiff[1] == 'M':
		order = binary.BigEndian
	default:
		return 0, false
	}
	if order.Uint16(tiff[2:4]) != 0x002a {
		return 0, false
	}
	ifdOffset := int(order.Uint32(tiff[4:8]))
	if ifdOffset+2 > len(tiff) {
		return 0, false
	}
	entryCount := int(order.Uint16(tiff[ifdOffset : ifdOffset+2]))
	for i := 0; i < entryCount; i++ {
		entryOffset := ifdOffset + 2 + i*12
		if entryOffset+12 > len(tiff) {
			break
		}
		if order.Uint16(tiff[entryOffset:entryOffset+2]) == 0x0112 {
			return int(order.Uint16(tiff[entryOffset+8 : entryOffset+10])), true
		}
	}
	return 0, false
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

func (a *App) pdfHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			http.Error(response, "metodo nao permitido", http.StatusMethodNotAllowed)
			return
		}
		id, found := strings.CutPrefix(request.URL.Path, "/__axia_pdf/")
		if !found || id == "" || strings.Contains(id, "/") {
			http.NotFound(response, request)
			return
		}
		a.assetsMu.RLock()
		path, exists := a.pdfPaths[id]
		a.assetsMu.RUnlock()
		if !exists {
			http.NotFound(response, request)
			return
		}
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Type", "application/pdf")
		response.Header().Set("X-Content-Type-Options", "nosniff")
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
	pdfs := a.pdfHandler()
	projects := a.projectHandler()
	recents := a.recentProjectsHandler()
	exports := a.exportHandler()
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/__axia_asset/") {
			assets.ServeHTTP(response, request)
			return
		}
		if strings.HasPrefix(request.URL.Path, "/__axia_pdf/") {
			pdfs.ServeHTTP(response, request)
			return
		}
		if strings.HasPrefix(request.URL.Path, "/__axia_project/") {
			projects.ServeHTTP(response, request)
			return
		}
		if strings.HasPrefix(request.URL.Path, "/__axia_recent/") {
			recents.ServeHTTP(response, request)
			return
		}
		if strings.HasPrefix(request.URL.Path, "/__axia_export/") {
			exports.ServeHTTP(response, request)
			return
		}
		next.ServeHTTP(response, request)
	})
}
