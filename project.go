package main

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	axiaFormatVersion       = 1
	maxProjectManifestBytes = 8 * 1024 * 1024
	maxProjectAssetBytes    = int64(1024 * 1024 * 1024)
	maxProjectBytes         = int64(4 * 1024 * 1024 * 1024)
	maxProjectAssets        = 10_000
)

type ProjectSaveTarget struct {
	Token string `json:"token"`
	Path  string `json:"path"`
}

type OpenedAxiaProject struct {
	Path      string            `json:"path"`
	Manifest  string            `json:"manifest"`
	AssetURLs map[string]string `json:"assetUrls"`
	SessionID string            `json:"sessionId"`
}

type projectSession struct {
	directory string
	assetIDs  []string
}

type axiaArchiveAsset struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

type axiaArchiveManifest struct {
	Format  string             `json:"format"`
	Version int                `json:"version"`
	Assets  []axiaArchiveAsset `json:"assets"`
}

func projectToken() (string, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func axiaFilename(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "" || name == "." {
		name = "Sem titulo"
	}
	if strings.ToLower(filepath.Ext(name)) != ".axia" {
		name += ".axia"
	}
	return name
}

func (a *App) PrepareAxiaProjectSave(suggestedName string, currentPath string, saveAs bool) (ProjectSaveTarget, error) {
	path := strings.TrimSpace(currentPath)
	if saveAs || path == "" {
		selected, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Salvar projeto Axia",
			DefaultFilename: axiaFilename(suggestedName),
			Filters: []runtime.FileFilter{
				{DisplayName: "Projeto Axia", Pattern: "*.axia"},
			},
		})
		if err != nil {
			return ProjectSaveTarget{}, err
		}
		if selected == "" {
			return ProjectSaveTarget{}, nil
		}
		path = selected
	}
	if strings.ToLower(filepath.Ext(path)) != ".axia" {
		path += ".axia"
	}

	token, err := projectToken()
	if err != nil {
		return ProjectSaveTarget{}, fmt.Errorf("preparar salvamento: %w", err)
	}
	a.projectMu.Lock()
	a.projectSaves = map[string]string{token: path}
	a.projectMu.Unlock()
	return ProjectSaveTarget{Token: token, Path: path}, nil
}

func (a *App) OpenAxiaProject() (OpenedAxiaProject, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Abrir projeto Axia",
		Filters: []runtime.FileFilter{
			{DisplayName: "Projeto Axia", Pattern: "*.axia"},
		},
	})
	if err != nil || path == "" {
		return OpenedAxiaProject{}, err
	}
	return a.openAxiaProject(path)
}

func (a *App) FinalizeAxiaProjectOpen(sessionID string, accepted bool) error {
	a.projectMu.Lock()
	_, exists := a.projectFiles[sessionID]
	a.projectMu.Unlock()
	if !exists {
		return fmt.Errorf("sessao de projeto invalida")
	}
	if accepted {
		a.releaseProjectSessions(sessionID)
	} else {
		a.releaseSingleProjectSession(sessionID)
	}
	return nil
}

func (a *App) ReleaseAxiaProjectAssets() {
	a.releaseProjectSessions("")
}

func (a *App) releaseSingleProjectSession(sessionID string) {
	a.projectMu.Lock()
	session, exists := a.projectFiles[sessionID]
	if exists {
		delete(a.projectFiles, sessionID)
	}
	a.projectMu.Unlock()
	if !exists {
		return
	}
	a.assetsMu.Lock()
	for _, assetID := range session.assetIDs {
		delete(a.imagePaths, assetID)
	}
	a.assetsMu.Unlock()
	go os.RemoveAll(session.directory)
}

func (a *App) releaseProjectSessions(keepSessionID string) {
	a.projectMu.Lock()
	released := make([]projectSession, 0, len(a.projectFiles))
	for sessionID, session := range a.projectFiles {
		if sessionID == keepSessionID {
			continue
		}
		released = append(released, session)
		delete(a.projectFiles, sessionID)
	}
	a.projectMu.Unlock()
	if len(released) == 0 {
		return
	}
	a.assetsMu.Lock()
	for _, session := range released {
		for _, assetID := range session.assetIDs {
			delete(a.imagePaths, assetID)
		}
	}
	a.assetsMu.Unlock()
	for _, session := range released {
		_ = os.RemoveAll(session.directory)
	}
}

func validateManifest(data []byte) (axiaArchiveManifest, error) {
	var manifest axiaArchiveManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, fmt.Errorf("manifesto invalido: %w", err)
	}
	if manifest.Format != "axia" {
		return manifest, fmt.Errorf("o arquivo nao e um projeto Axia")
	}
	if manifest.Version != axiaFormatVersion {
		return manifest, fmt.Errorf("versao de projeto nao suportada: %d", manifest.Version)
	}
	if len(manifest.Assets) > maxProjectAssets {
		return manifest, fmt.Errorf("o projeto excede o limite de assets")
	}
	seenIDs := make(map[string]struct{}, len(manifest.Assets))
	seenPaths := make(map[string]struct{}, len(manifest.Assets))
	for _, asset := range manifest.Assets {
		if !safeAssetID(asset.ID) || !safeArchiveAssetPath(asset.Path) {
			return manifest, fmt.Errorf("asset invalido no manifesto")
		}
		if asset.Width <= 0 || asset.Height <= 0 || !supportedProjectMime(asset.MimeType) {
			return manifest, fmt.Errorf("metadados invalidos para o asset %s", asset.ID)
		}
		if _, exists := seenIDs[asset.ID]; exists {
			return manifest, fmt.Errorf("asset duplicado: %s", asset.ID)
		}
		if _, exists := seenPaths[asset.Path]; exists {
			return manifest, fmt.Errorf("caminho de asset duplicado: %s", asset.Path)
		}
		seenIDs[asset.ID] = struct{}{}
		seenPaths[asset.Path] = struct{}{}
	}
	return manifest, nil
}

func safeAssetID(id string) bool {
	if id == "" || len(id) > 96 {
		return false
	}
	for _, character := range id {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}
	return true
}

func safeArchiveAssetPath(path string) bool {
	return strings.HasPrefix(path, "assets/") && filepath.ToSlash(filepath.Clean(path)) == path &&
		!strings.Contains(path, "..") && !strings.Contains(path, "\\")
}

func supportedProjectMime(mimeType string) bool {
	return mimeType == "image/png" || mimeType == "image/jpeg" || mimeType == "image/gif"
}

func imageFormatMime(format string) string {
	if format == "jpeg" {
		return "image/jpeg"
	}
	return "image/" + format
}

func validateProjectImage(source io.ReadSeeker, asset axiaArchiveAsset) error {
	config, format, err := image.DecodeConfig(source)
	if err != nil {
		return fmt.Errorf("asset %s nao contem uma imagem valida", asset.ID)
	}
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if config.Width != asset.Width || config.Height != asset.Height || imageFormatMime(format) != asset.MimeType {
		return fmt.Errorf("asset %s diverge do manifesto", asset.ID)
	}
	return nil
}

func (a *App) takeProjectSaveTarget(token string) (string, bool) {
	a.projectMu.Lock()
	defer a.projectMu.Unlock()
	path, exists := a.projectSaves[token]
	delete(a.projectSaves, token)
	return path, exists
}

func (a *App) projectHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		token, found := strings.CutPrefix(request.URL.Path, "/__axia_project/save/")
		if !found || !safeAssetID(token) {
			http.NotFound(response, request)
			return
		}
		if request.Method != http.MethodPost {
			http.Error(response, "metodo nao permitido", http.StatusMethodNotAllowed)
			return
		}
		target, exists := a.takeProjectSaveTarget(token)
		if !exists {
			http.Error(response, "salvamento expirado ou invalido", http.StatusNotFound)
			return
		}

		request.Body = http.MaxBytesReader(response, request.Body, maxProjectBytes+maxProjectManifestBytes)
		if err := request.ParseMultipartForm(16 * 1024 * 1024); err != nil {
			http.Error(response, "projeto excede os limites permitidos", http.StatusBadRequest)
			return
		}
		if request.MultipartForm != nil {
			defer request.MultipartForm.RemoveAll()
		}
		manifestData := []byte(request.FormValue("manifest"))
		if len(manifestData) == 0 || len(manifestData) > maxProjectManifestBytes {
			http.Error(response, "manifesto ausente ou muito grande", http.StatusBadRequest)
			return
		}
		manifest, err := validateManifest(manifestData)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		var nativeAssets map[string]string
		if encoded := request.FormValue("nativeAssets"); encoded != "" {
			if err := json.Unmarshal([]byte(encoded), &nativeAssets); err != nil {
				http.Error(response, "mapa de assets nativos invalido", http.StatusBadRequest)
				return
			}
		}
		if err := a.writeAxiaProject(target, manifestData, manifest, nativeAssets, request.MultipartForm); err != nil {
			http.Error(response, err.Error(), http.StatusInternalServerError)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]string{"path": target})
	})
}

func (a *App) nativeAssetPath(sourceURL string) (string, bool) {
	id, found := strings.CutPrefix(sourceURL, "/__axia_asset/")
	if !found || id == "" || strings.ContainsAny(id, "/?") {
		return "", false
	}
	a.assetsMu.RLock()
	path, exists := a.imagePaths[id]
	a.assetsMu.RUnlock()
	return path, exists
}

func (a *App) projectAssetSource(asset axiaArchiveAsset, nativeAssets map[string]string, form *multipart.Form) (multipart.File, int64, error) {
	if sourceURL := nativeAssets[asset.ID]; sourceURL != "" {
		path, exists := a.nativeAssetPath(sourceURL)
		if !exists {
			return nil, 0, fmt.Errorf("asset nativo indisponivel: %s", asset.ID)
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, 0, err
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return nil, 0, err
		}
		return file, info.Size(), nil
	}
	files := form.File["asset__"+asset.ID]
	if len(files) != 1 {
		return nil, 0, fmt.Errorf("conteudo ausente para o asset %s", asset.ID)
	}
	file, err := files[0].Open()
	return file, files[0].Size, err
}

func (a *App) writeAxiaProject(target string, manifestData []byte, manifest axiaArchiveManifest, nativeAssets map[string]string, form *multipart.Form) (returnErr error) {
	directory := filepath.Dir(target)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("preparar pasta do projeto: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".axia-save-*")
	if err != nil {
		return fmt.Errorf("criar arquivo temporario: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		temporary.Close()
		if returnErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()

	archive := zip.NewWriter(temporary)
	manifestHeader := &zip.FileHeader{Name: "manifest.json", Method: zip.Deflate}
	manifestHeader.SetModTime(time.Now())
	manifestWriter, err := archive.CreateHeader(manifestHeader)
	if err != nil {
		return err
	}
	if _, err := manifestWriter.Write(manifestData); err != nil {
		return err
	}

	var totalBytes int64
	for _, asset := range manifest.Assets {
		source, size, err := a.projectAssetSource(asset, nativeAssets, form)
		if err != nil {
			return err
		}
		if size <= 0 || size > maxProjectAssetBytes || totalBytes+size > maxProjectBytes {
			source.Close()
			return fmt.Errorf("asset %s excede o limite permitido", asset.ID)
		}
		if err := validateProjectImage(source, asset); err != nil {
			source.Close()
			return err
		}
		header := &zip.FileHeader{Name: asset.Path, Method: zip.Store}
		header.SetModTime(time.Now())
		writer, err := archive.CreateHeader(header)
		if err == nil {
			_, err = io.CopyN(writer, source, size)
		}
		source.Close()
		if err != nil {
			return fmt.Errorf("gravar asset %s: %w", asset.ID, err)
		}
		totalBytes += size
	}
	if err := archive.Close(); err != nil {
		return fmt.Errorf("finalizar projeto: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sincronizar projeto: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("fechar projeto: %w", err)
	}
	if err := replaceFileAtomically(temporaryPath, target); err != nil {
		return fmt.Errorf("substituir projeto: %w", err)
	}
	return nil
}

func readZipEntry(entry *zip.File, maximum int64) ([]byte, error) {
	if int64(entry.UncompressedSize64) > maximum {
		return nil, fmt.Errorf("entrada %s excede o limite", entry.Name)
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maximum {
		return nil, fmt.Errorf("entrada %s excede o limite", entry.Name)
	}
	return data, nil
}

func copyVerifiedZipEntry(destination io.Writer, source io.Reader, expectedSize int64) error {
	written, err := io.Copy(destination, io.LimitReader(source, expectedSize+1))
	if err != nil {
		return err
	}
	if written != expectedSize {
		return fmt.Errorf("tamanho extraido diverge do diretorio ZIP")
	}
	return nil
}

func (a *App) openAxiaProject(path string) (result OpenedAxiaProject, returnErr error) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return result, fmt.Errorf("abrir projeto: %w", err)
	}
	defer archive.Close()
	entries := make(map[string]*zip.File, len(archive.File))
	for _, entry := range archive.File {
		if _, exists := entries[entry.Name]; exists {
			return result, fmt.Errorf("entrada duplicada no projeto: %s", entry.Name)
		}
		entries[entry.Name] = entry
	}
	manifestEntry := entries["manifest.json"]
	if manifestEntry == nil {
		return result, fmt.Errorf("manifesto nao encontrado")
	}
	manifestData, err := readZipEntry(manifestEntry, maxProjectManifestBytes)
	if err != nil {
		return result, err
	}
	manifest, err := validateManifest(manifestData)
	if err != nil {
		return result, err
	}

	directory, err := os.MkdirTemp("", "axia-project-*")
	if err != nil {
		return result, fmt.Errorf("preparar assets do projeto: %w", err)
	}
	defer func() {
		if returnErr != nil {
			_ = os.RemoveAll(directory)
		}
	}()
	assetURLs := make(map[string]string, len(manifest.Assets))
	registeredPaths := make(map[string]string, len(manifest.Assets))
	registeredIDs := make([]string, 0, len(manifest.Assets))
	var totalBytes int64
	for _, asset := range manifest.Assets {
		entry := entries[asset.Path]
		if entry == nil {
			return result, fmt.Errorf("asset ausente no projeto: %s", asset.ID)
		}
		size := int64(entry.UncompressedSize64)
		if size <= 0 || size > maxProjectAssetBytes || totalBytes+size > maxProjectBytes {
			return result, fmt.Errorf("asset %s excede o limite permitido", asset.ID)
		}
		reader, err := entry.Open()
		if err != nil {
			return result, err
		}
		extension := filepath.Ext(asset.Path)
		extractedPath := filepath.Join(directory, asset.ID+extension)
		output, err := os.OpenFile(extractedPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			err = copyVerifiedZipEntry(output, reader, size)
		}
		reader.Close()
		if output != nil {
			closeErr := output.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			return result, fmt.Errorf("extrair asset %s: %w", asset.ID, err)
		}
		file, err := os.Open(extractedPath)
		if err != nil {
			return result, err
		}
		if err := validateProjectImage(file, asset); err != nil {
			file.Close()
			return result, err
		}
		file.Close()
		registeredID, err := projectToken()
		if err != nil {
			return result, err
		}
		registeredID = "project-" + registeredID
		registeredPaths[registeredID] = extractedPath
		registeredIDs = append(registeredIDs, registeredID)
		assetURLs[asset.ID] = "/__axia_asset/" + registeredID
		totalBytes += size
	}

	sessionID, err := projectToken()
	if err != nil {
		return result, err
	}
	a.assetsMu.Lock()
	for assetID, assetPath := range registeredPaths {
		a.imagePaths[assetID] = assetPath
	}
	a.assetsMu.Unlock()
	a.projectMu.Lock()
	a.projectFiles[sessionID] = projectSession{directory: directory, assetIDs: registeredIDs}
	a.projectMu.Unlock()
	return OpenedAxiaProject{
		Path: path, Manifest: string(manifestData), AssetURLs: assetURLs, SessionID: sessionID,
	}, nil
}
