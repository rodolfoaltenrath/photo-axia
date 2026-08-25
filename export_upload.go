package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxExportUploadBytes = int64(512 * 1024 * 1024)
	exportUploadLifetime = 2 * time.Minute
)

type ExportSaveTarget struct {
	Token string `json:"token"`
	Path  string `json:"path"`
}

type exportUpload struct {
	Path      string
	MimeType  string
	ExpiresAt time.Time
}

type exportFormatDefinition struct {
	Extension string
	Title     string
	Filter    string
	Format    string
}

type pngPhysicalChunkWriter struct {
	target   io.Writer
	chunk    []byte
	prefix   []byte
	injected bool
}

func (writer *pngPhysicalChunkWriter) Write(data []byte) (int, error) {
	if writer.injected || len(writer.chunk) == 0 {
		return writer.target.Write(data)
	}
	writer.prefix = append(writer.prefix, data...)
	if len(writer.prefix) < 33 {
		return len(data), nil
	}
	combined := make([]byte, 0, len(writer.prefix)+len(writer.chunk))
	combined = append(combined, writer.prefix[:33]...)
	combined = append(combined, writer.chunk...)
	combined = append(combined, writer.prefix[33:]...)
	if _, err := writer.target.Write(combined); err != nil {
		return 0, err
	}
	writer.prefix = nil
	writer.injected = true
	return len(data), nil
}

func pngPhysicalChunk(path string) []byte {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	header, err := io.ReadAll(io.LimitReader(file, 256*1024))
	if err != nil || len(header) < 8 || !bytes.Equal(header[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return nil
	}
	for offset := 8; offset+12 <= len(header); {
		length := int(uint32(header[offset])<<24 | uint32(header[offset+1])<<16 | uint32(header[offset+2])<<8 | uint32(header[offset+3]))
		end := offset + 12 + length
		if end < offset || end > len(header) {
			return nil
		}
		typeName := string(header[offset+4 : offset+8])
		if typeName == "pHYs" && length == 9 {
			return append([]byte(nil), header[offset:end]...)
		}
		if typeName == "IDAT" || typeName == "IEND" {
			return nil
		}
		offset = end
	}
	return nil
}

func optimizePNGExport(path string) (string, bool, error) {
	source, err := os.Open(path)
	if err != nil {
		return path, false, err
	}
	decoded, err := png.Decode(source)
	closeErr := source.Close()
	if err != nil {
		return path, false, err
	}
	if closeErr != nil {
		return path, false, closeErr
	}
	physicalChunk := pngPhysicalChunk(path)
	candidate, err := os.CreateTemp(filepath.Dir(path), ".axia-png-optimized-*")
	if err != nil {
		return path, false, err
	}
	candidatePath := candidate.Name()
	keepCandidate := false
	defer func() {
		_ = candidate.Close()
		if !keepCandidate {
			_ = os.Remove(candidatePath)
		}
	}()
	var output io.Writer = candidate
	if len(physicalChunk) > 0 {
		output = &pngPhysicalChunkWriter{target: candidate, chunk: physicalChunk}
	}
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(output, decoded); err != nil {
		return path, false, err
	}
	if err := candidate.Sync(); err != nil {
		return path, false, err
	}
	if err := candidate.Close(); err != nil {
		return path, false, err
	}
	sourceInfo, err := os.Stat(path)
	if err != nil {
		return path, false, err
	}
	candidateInfo, err := os.Stat(candidatePath)
	if err != nil {
		return path, false, err
	}
	if candidateInfo.Size() >= sourceInfo.Size() {
		return path, false, nil
	}
	keepCandidate = true
	return candidatePath, true, nil
}

func exportFormatForMime(mimeType string) (exportFormatDefinition, bool) {
	format, found := map[string]exportFormatDefinition{
		"image/png":  {Extension: ".png", Title: "Exportar PNG", Filter: "Imagem PNG", Format: "png"},
		"image/jpeg": {Extension: ".jpg", Title: "Exportar JPEG", Filter: "Imagem JPEG", Format: "jpeg"},
		"image/webp": {Extension: ".webp", Title: "Exportar WebP", Filter: "Imagem WebP", Format: "webp"},
	}[mimeType]
	return format, found
}

func normalizeExportFilename(name string, extension string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." {
		name = "imagem"
	}
	currentExtension := filepath.Ext(name)
	if !strings.EqualFold(currentExtension, extension) {
		name = strings.TrimSuffix(name, currentExtension) + extension
	}
	return name
}

func (a *App) PrepareExportedImage(suggestedName string, mimeType string) (ExportSaveTarget, error) {
	format, supported := exportFormatForMime(mimeType)
	if !supported {
		return ExportSaveTarget{}, fmt.Errorf("formato de exportacao nao suportado")
	}
	dialog, err := a.newSaveFileDialog(
		format.Title,
		normalizeExportFilename(suggestedName, format.Extension),
		format.Filter,
		"*"+format.Extension,
	)
	if err != nil {
		return ExportSaveTarget{}, err
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil || path == "" {
		return ExportSaveTarget{}, err
	}
	path = strings.TrimSuffix(path, filepath.Ext(path)) + format.Extension
	absolute, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return ExportSaveTarget{}, fmt.Errorf("preparar destino da exportacao: %w", err)
	}
	token, err := projectToken()
	if err != nil {
		return ExportSaveTarget{}, fmt.Errorf("preparar exportacao: %w", err)
	}
	a.exportMu.Lock()
	now := time.Now()
	for candidate, upload := range a.exportUploads {
		if now.After(upload.ExpiresAt) {
			delete(a.exportUploads, candidate)
		}
	}
	a.exportUploads = map[string]exportUpload{
		token: {Path: absolute, MimeType: mimeType, ExpiresAt: now.Add(exportUploadLifetime)},
	}
	a.exportMu.Unlock()
	return ExportSaveTarget{Token: token, Path: absolute}, nil
}

func (a *App) takeExportUpload(token string) (exportUpload, bool) {
	a.exportMu.Lock()
	defer a.exportMu.Unlock()
	upload, exists := a.exportUploads[token]
	delete(a.exportUploads, token)
	if !exists || time.Now().After(upload.ExpiresAt) {
		return exportUpload{}, false
	}
	return upload, true
}

func storeExportUpload(upload exportUpload, source io.Reader) (returnErr error) {
	format, supported := exportFormatForMime(upload.MimeType)
	if !supported {
		return fmt.Errorf("formato de exportacao invalido")
	}
	if err := os.MkdirAll(filepath.Dir(upload.Path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(upload.Path), ".axia-export-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	optimizedPath := ""
	defer func() {
		_ = temporary.Close()
		if returnErr != nil {
			_ = os.Remove(temporaryPath)
			if optimizedPath != "" {
				_ = os.Remove(optimizedPath)
			}
		}
	}()
	written, err := io.Copy(temporary, io.LimitReader(source, maxExportUploadBytes+1))
	if err != nil {
		return err
	}
	if written == 0 || written > maxExportUploadBytes {
		return fmt.Errorf("imagem exportada excede o limite permitido")
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return err
	}
	config, decodedFormat, err := image.DecodeConfig(temporary)
	if err != nil || decodedFormat != format.Format || config.Width <= 0 || config.Height <= 0 ||
		config.Width > 16_384 || config.Height > 16_384 || int64(config.Width)*int64(config.Height) > 64_000_000 {
		return fmt.Errorf("conteudo exportado nao corresponde ao formato solicitado")
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	replacementPath := temporaryPath
	if upload.MimeType == "image/png" {
		candidatePath, optimized, err := optimizePNGExport(temporaryPath)
		if err != nil {
			return fmt.Errorf("otimizar PNG: %w", err)
		}
		if optimized {
			optimizedPath = candidatePath
			replacementPath = candidatePath
		}
	}
	if err := replaceFileAtomically(replacementPath, upload.Path); err != nil {
		return err
	}
	if replacementPath != temporaryPath {
		_ = os.Remove(temporaryPath)
	}
	return nil
}

func (a *App) exportHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		token, found := strings.CutPrefix(request.URL.Path, "/__axia_export/save/")
		if !found || !safeAssetID(token) {
			http.NotFound(response, request)
			return
		}
		if request.Method != http.MethodPost {
			http.Error(response, "metodo nao permitido", http.StatusMethodNotAllowed)
			return
		}
		upload, exists := a.takeExportUpload(token)
		if !exists {
			http.Error(response, "exportacao expirada ou invalida", http.StatusNotFound)
			return
		}
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(request.Header.Get("Content-Type"), ";")[0]))
		if contentType != upload.MimeType {
			http.Error(response, "formato enviado diverge da exportacao", http.StatusUnsupportedMediaType)
			return
		}
		if err := storeExportUpload(upload, request.Body); err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		response.WriteHeader(http.StatusNoContent)
	})
}
