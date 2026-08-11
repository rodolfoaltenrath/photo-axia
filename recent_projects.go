package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "golang.org/x/image/webp"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	recentProjectsVersion = 1
	maxRecentProjects     = 24
	maxRecentThumbnail    = int64(512 * 1024)
	maxThumbnailDimension = 768
	recentIndexLockWait   = 2 * time.Second
	recentIndexLockStale  = 30 * time.Second
	recentStatWorkers     = 6
	recentUploadLifetime  = 2 * time.Minute
)

type RecentProject struct {
	ID               string `json:"id"`
	Path             string `json:"path"`
	Name             string `json:"name"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	ModifiedAt       string `json:"modifiedAt"`
	LastOpenedAt     string `json:"lastOpenedAt"`
	ThumbnailURL     string `json:"thumbnailUrl"`
	ThumbnailVersion int64  `json:"thumbnailVersion"`
	Available        bool   `json:"available"`
}

type recentProjectRecord struct {
	ID               string `json:"id"`
	Path             string `json:"path"`
	Name             string `json:"name"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	LastOpenedAt     string `json:"lastOpenedAt"`
	LastOpenedUnix   int64  `json:"lastOpenedUnix,omitempty"`
	ProjectModified  int64  `json:"projectModified,omitempty"`
	ThumbnailFile    string `json:"thumbnailFile,omitempty"`
	ThumbnailVersion int64  `json:"thumbnailVersion,omitempty"`
}

type recentProjectsIndex struct {
	Version  int                   `json:"version"`
	Projects []recentProjectRecord `json:"projects"`
}

type recentUpload struct {
	Path            string
	ProjectModified int64
	ExpiresAt       time.Time
}

var errRecentIndexCorrupt = errors.New("indice de recentes corrompido")
var errRecentThumbnailStale = errors.New("miniatura obsoleta para a versao atual do projeto")

func canonicalProjectPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("caminho do projeto vazio")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	absolute = filepath.Clean(absolute)
	if strings.ToLower(filepath.Ext(absolute)) != ".axia" {
		return "", fmt.Errorf("o arquivo precisa usar a extensao .axia")
	}
	return absolute, nil
}

func recentPathKey(path string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

func recentProjectID(path string) string {
	digest := sha256.Sum256([]byte(recentPathKey(path)))
	return hex.EncodeToString(digest[:12])
}

func (a *App) recentDirectories() (string, string, error) {
	if a.recentConfigDirectory != "" && a.recentCacheDirectory != "" {
		return a.recentConfigDirectory, a.recentCacheDirectory, nil
	}
	configRoot, err := os.UserConfigDir()
	if err != nil {
		return "", "", err
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", "", err
	}
	return filepath.Join(configRoot, "Axia"), filepath.Join(cacheRoot, "Axia", "project-thumbnails"), nil
}

func readRecentProjects(path string) (recentProjectsIndex, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return recentProjectsIndex{Version: recentProjectsVersion}, nil
		}
		return recentProjectsIndex{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
	if err != nil {
		return recentProjectsIndex{}, err
	}
	if len(data) > 2*1024*1024 {
		return recentProjectsIndex{}, fmt.Errorf("%w: excede o limite", errRecentIndexCorrupt)
	}
	var index recentProjectsIndex
	if json.Unmarshal(data, &index) != nil || index.Version != recentProjectsVersion {
		return recentProjectsIndex{}, fmt.Errorf("%w ou incompativel", errRecentIndexCorrupt)
	}
	if len(index.Projects) > 100 {
		index.Projects = index.Projects[:100]
	}
	return index, nil
}

func loadRecentProjects(path string) (recentProjectsIndex, error) {
	index, err := readRecentProjects(path)
	if err == nil {
		return index, nil
	}
	if !errors.Is(err, errRecentIndexCorrupt) {
		return recentProjectsIndex{}, err
	}
	backup := fmt.Sprintf("%s.corrupt-%d", path, time.Now().UnixNano())
	if renameErr := os.Rename(path, backup); renameErr != nil && !os.IsNotExist(renameErr) {
		return recentProjectsIndex{}, renameErr
	}
	return recentProjectsIndex{Version: recentProjectsVersion}, nil
}

func acquireRecentIndexLock(indexPath string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(indexPath), 0o755); err != nil {
		return nil, err
	}
	lockDirectory := indexPath + ".lock"
	deadline := time.Now().Add(recentIndexLockWait)
	for {
		if err := os.Mkdir(lockDirectory, 0o700); err == nil {
			return func() { _ = os.Remove(lockDirectory) }, nil
		} else if !os.IsExist(err) {
			return nil, err
		}
		if info, err := os.Stat(lockDirectory); err == nil && time.Since(info.ModTime()) > recentIndexLockStale {
			_ = os.Remove(lockDirectory)
			continue
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("tempo esgotado aguardando o indice de projetos recentes")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (a *App) lockRecentIndex(indexPath string) (func(), error) {
	a.recentMu.Lock()
	releaseFileLock, err := acquireRecentIndexLock(indexPath)
	if err != nil {
		a.recentMu.Unlock()
		return nil, err
	}
	return func() {
		releaseFileLock()
		a.recentMu.Unlock()
	}, nil
}

func writeJSONAtomically(path string, value any) (returnErr error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".axia-index-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		temporary.Close()
		if returnErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return replaceFileAtomically(temporaryPath, path)
}

func (a *App) recentIndexPaths() (string, string, error) {
	configDirectory, cacheDirectory, err := a.recentDirectories()
	if err != nil {
		return "", "", err
	}
	return filepath.Join(configDirectory, "recent-projects.json"), cacheDirectory, nil
}

func recentRecordView(record recentProjectRecord, cacheDirectory string) RecentProject {
	info, err := os.Stat(record.Path)
	available := err == nil && !info.IsDir()
	modifiedAt := ""
	if available {
		modifiedAt = info.ModTime().UTC().Format(time.RFC3339Nano)
	}
	thumbnailURL := ""
	if record.ThumbnailFile != "" {
		if info, err := os.Stat(filepath.Join(cacheDirectory, filepath.Base(record.ThumbnailFile))); err == nil && !info.IsDir() {
			thumbnailURL = "/__axia_recent/thumb/" + record.ID + "?v=" + strconv.FormatInt(record.ThumbnailVersion, 10)
		}
	}
	return RecentProject{
		ID: record.ID, Path: record.Path, Name: record.Name, Width: record.Width, Height: record.Height,
		ModifiedAt: modifiedAt, LastOpenedAt: record.LastOpenedAt, ThumbnailURL: thumbnailURL,
		ThumbnailVersion: record.ThumbnailVersion, Available: available,
	}
}

func recentRecordViews(records []recentProjectRecord, cacheDirectory string) []RecentProject {
	projects := make([]RecentProject, len(records))
	workers := recentStatWorkers
	if len(records) < workers {
		workers = len(records)
	}
	jobs := make(chan int)
	var waitGroup sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for index := range jobs {
				projects[index] = recentRecordView(records[index], cacheDirectory)
			}
		}()
	}
	for index := range records {
		jobs <- index
	}
	close(jobs)
	waitGroup.Wait()
	return projects
}

func (a *App) ListRecentProjects() ([]RecentProject, error) {
	indexPath, cacheDirectory, err := a.recentIndexPaths()
	if err != nil {
		return nil, err
	}
	release, err := a.lockRecentIndex(indexPath)
	if err != nil {
		return nil, err
	}
	index, err := loadRecentProjects(indexPath)
	if err != nil {
		release()
		return nil, err
	}
	sort.SliceStable(index.Projects, func(first, second int) bool {
		if index.Projects[first].LastOpenedUnix != index.Projects[second].LastOpenedUnix {
			return index.Projects[first].LastOpenedUnix > index.Projects[second].LastOpenedUnix
		}
		return index.Projects[first].LastOpenedAt > index.Projects[second].LastOpenedAt
	})
	records := append([]recentProjectRecord(nil), index.Projects...)
	release()
	return recentRecordViews(records, cacheDirectory), nil
}

func (a *App) RecordRecentProject(path string, name string, width int, height int) (RecentProject, error) {
	canonical, err := canonicalProjectPath(path)
	if err != nil {
		return RecentProject{}, err
	}
	if width <= 0 || height <= 0 || width > 16_384 || height > 16_384 {
		return RecentProject{}, fmt.Errorf("dimensoes do projeto invalidas")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(canonical), filepath.Ext(canonical))
	}
	if len(name) > 512 {
		return RecentProject{}, fmt.Errorf("nome do projeto excede o limite permitido")
	}
	projectInfo, err := os.Stat(canonical)
	if err != nil || projectInfo.IsDir() {
		return RecentProject{}, fmt.Errorf("projeto recente nao esta disponivel")
	}
	projectModified := projectInfo.ModTime().UnixNano()
	indexPath, cacheDirectory, err := a.recentIndexPaths()
	if err != nil {
		return RecentProject{}, err
	}
	release, err := a.lockRecentIndex(indexPath)
	if err != nil {
		return RecentProject{}, err
	}
	defer release()
	index, err := loadRecentProjects(indexPath)
	if err != nil {
		return RecentProject{}, err
	}
	key := recentPathKey(canonical)
	record := recentProjectRecord{ID: recentProjectID(canonical), Path: canonical}
	remaining := make([]recentProjectRecord, 0, len(index.Projects)+1)
	for _, candidate := range index.Projects {
		if recentPathKey(candidate.Path) == key {
			if candidate.ProjectModified == projectModified {
				record.ThumbnailFile = candidate.ThumbnailFile
				record.ThumbnailVersion = candidate.ThumbnailVersion
			} else if candidate.ThumbnailFile != "" {
				_ = os.Remove(filepath.Join(cacheDirectory, filepath.Base(candidate.ThumbnailFile)))
			}
			continue
		}
		remaining = append(remaining, candidate)
	}
	record.Name = name
	record.Width = width
	record.Height = height
	openedAt := time.Now().UTC()
	record.LastOpenedAt = openedAt.Format(time.RFC3339Nano)
	record.LastOpenedUnix = openedAt.UnixNano()
	record.ProjectModified = projectModified
	index.Version = recentProjectsVersion
	index.Projects = append([]recentProjectRecord{record}, remaining...)
	if len(index.Projects) > maxRecentProjects {
		for _, removed := range index.Projects[maxRecentProjects:] {
			if removed.ThumbnailFile != "" {
				_ = os.Remove(filepath.Join(cacheDirectory, filepath.Base(removed.ThumbnailFile)))
			}
		}
		index.Projects = index.Projects[:maxRecentProjects]
	}
	if err := writeJSONAtomically(indexPath, index); err != nil {
		return RecentProject{}, err
	}
	return recentRecordView(record, cacheDirectory), nil
}

func (a *App) RemoveRecentProject(path string) error {
	canonical, err := canonicalProjectPath(path)
	if err != nil {
		return err
	}
	indexPath, cacheDirectory, err := a.recentIndexPaths()
	if err != nil {
		return err
	}
	release, err := a.lockRecentIndex(indexPath)
	if err != nil {
		return err
	}
	defer release()
	index, err := loadRecentProjects(indexPath)
	if err != nil {
		return err
	}
	key := recentPathKey(canonical)
	projects := index.Projects[:0]
	for _, record := range index.Projects {
		if recentPathKey(record.Path) == key {
			if record.ThumbnailFile != "" {
				_ = os.Remove(filepath.Join(cacheDirectory, filepath.Base(record.ThumbnailFile)))
			}
			continue
		}
		projects = append(projects, record)
	}
	index.Projects = projects
	return writeJSONAtomically(indexPath, index)
}

func (a *App) ClearRecentProjects() error {
	indexPath, cacheDirectory, err := a.recentIndexPaths()
	if err != nil {
		return err
	}
	release, err := a.lockRecentIndex(indexPath)
	if err != nil {
		return err
	}
	defer release()
	if err := writeJSONAtomically(indexPath, recentProjectsIndex{Version: recentProjectsVersion}); err != nil {
		return err
	}
	entries, _ := os.ReadDir(cacheDirectory)
	for _, entry := range entries {
		if !entry.IsDir() {
			_ = os.Remove(filepath.Join(cacheDirectory, entry.Name()))
		}
	}
	return nil
}

func (a *App) OpenRecentProject(path string) (OpenedAxiaProject, error) {
	canonical, err := canonicalProjectPath(path)
	if err != nil {
		return OpenedAxiaProject{}, err
	}
	return a.openAxiaProject(canonical)
}

func (a *App) PrepareRecentThumbnail(path string) (string, error) {
	canonical, err := canonicalProjectPath(path)
	if err != nil {
		return "", err
	}
	projectInfo, err := os.Stat(canonical)
	if err != nil || projectInfo.IsDir() {
		return "", fmt.Errorf("projeto recente nao esta disponivel")
	}
	token, err := projectToken()
	if err != nil {
		return "", err
	}
	a.recentMu.Lock()
	now := time.Now()
	for candidate, upload := range a.recentUploads {
		if now.After(upload.ExpiresAt) {
			delete(a.recentUploads, candidate)
		}
	}
	if len(a.recentUploads) >= 32 {
		oldestToken := ""
		var oldestExpiry time.Time
		for candidate, upload := range a.recentUploads {
			if oldestToken == "" || upload.ExpiresAt.Before(oldestExpiry) {
				oldestToken, oldestExpiry = candidate, upload.ExpiresAt
			}
		}
		delete(a.recentUploads, oldestToken)
	}
	a.recentUploads[token] = recentUpload{
		Path: canonical, ProjectModified: projectInfo.ModTime().UnixNano(), ExpiresAt: now.Add(recentUploadLifetime),
	}
	a.recentMu.Unlock()
	return token, nil
}

func (a *App) takeRecentUpload(token string) (recentUpload, bool) {
	a.recentMu.Lock()
	defer a.recentMu.Unlock()
	upload, exists := a.recentUploads[token]
	delete(a.recentUploads, token)
	if !exists || time.Now().After(upload.ExpiresAt) {
		return recentUpload{}, false
	}
	return upload, true
}

func thumbnailExtension(contentType string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0])) {
	case "image/webp":
		return ".webp", true
	case "image/png":
		return ".png", true
	case "image/jpeg":
		return ".jpg", true
	default:
		return "", false
	}
}

func (a *App) storeRecentThumbnail(upload recentUpload, extension string, data []byte) error {
	projectInfo, err := os.Stat(upload.Path)
	if err != nil || projectInfo.IsDir() || projectInfo.ModTime().UnixNano() != upload.ProjectModified {
		return errRecentThumbnailStale
	}
	indexPath, cacheDirectory, err := a.recentIndexPaths()
	if err != nil {
		return err
	}
	release, err := a.lockRecentIndex(indexPath)
	if err != nil {
		return err
	}
	defer release()
	index, err := loadRecentProjects(indexPath)
	if err != nil {
		return err
	}
	key := recentPathKey(upload.Path)
	for indexPosition := range index.Projects {
		record := &index.Projects[indexPosition]
		if recentPathKey(record.Path) != key {
			continue
		}
		if record.ProjectModified != upload.ProjectModified {
			return errRecentThumbnailStale
		}
		if err := os.MkdirAll(cacheDirectory, 0o755); err != nil {
			return err
		}
		filename := record.ID + extension
		target := filepath.Join(cacheDirectory, filename)
		temporary, err := os.CreateTemp(cacheDirectory, ".axia-thumb-*")
		if err != nil {
			return err
		}
		temporaryPath := temporary.Name()
		if _, err = temporary.Write(data); err == nil {
			err = temporary.Sync()
		}
		if closeErr := temporary.Close(); err == nil {
			err = closeErr
		}
		if err == nil {
			err = replaceFileAtomically(temporaryPath, target)
		}
		if err != nil {
			_ = os.Remove(temporaryPath)
			return err
		}
		if record.ThumbnailFile != "" && record.ThumbnailFile != filename {
			_ = os.Remove(filepath.Join(cacheDirectory, filepath.Base(record.ThumbnailFile)))
		}
		record.ThumbnailFile = filename
		record.ThumbnailVersion = time.Now().UnixNano()
		return writeJSONAtomically(indexPath, index)
	}
	return fmt.Errorf("projeto recente nao encontrado")
}

func (a *App) recentProjectsHandler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if token, found := strings.CutPrefix(request.URL.Path, "/__axia_recent/thumbnail/"); found {
			if request.Method != http.MethodPost || !safeAssetID(token) {
				http.Error(response, "requisicao invalida", http.StatusBadRequest)
				return
			}
			upload, exists := a.takeRecentUpload(token)
			if !exists {
				http.Error(response, "upload expirado ou invalido", http.StatusNotFound)
				return
			}
			extension, supported := thumbnailExtension(request.Header.Get("Content-Type"))
			if !supported {
				http.Error(response, "formato de miniatura invalido", http.StatusUnsupportedMediaType)
				return
			}
			data, err := io.ReadAll(io.LimitReader(request.Body, maxRecentThumbnail+1))
			if err != nil || int64(len(data)) == 0 || int64(len(data)) > maxRecentThumbnail {
				http.Error(response, "miniatura excede o limite permitido", http.StatusBadRequest)
				return
			}
			config, format, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > maxThumbnailDimension || config.Height > maxThumbnailDimension {
				http.Error(response, "miniatura invalida", http.StatusBadRequest)
				return
			}
			if (extension == ".webp" && format != "webp") ||
				(extension == ".png" && format != "png") ||
				(extension == ".jpg" && format != "jpeg") {
				http.Error(response, "conteudo da miniatura diverge do formato", http.StatusBadRequest)
				return
			}
			if err := a.storeRecentThumbnail(upload, extension, data); err != nil {
				status := http.StatusInternalServerError
				if errors.Is(err, errRecentThumbnailStale) {
					status = http.StatusConflict
				}
				http.Error(response, err.Error(), status)
				return
			}
			response.WriteHeader(http.StatusNoContent)
			return
		}

		id, found := strings.CutPrefix(request.URL.Path, "/__axia_recent/thumb/")
		if !found || request.Method != http.MethodGet || !safeAssetID(id) {
			http.NotFound(response, request)
			return
		}
		_, cacheDirectory, err := a.recentIndexPaths()
		if err != nil {
			http.NotFound(response, request)
			return
		}
		filename := ""
		for _, extension := range []string{".webp", ".png", ".jpg"} {
			candidate := id + extension
			if info, statErr := os.Stat(filepath.Join(cacheDirectory, candidate)); statErr == nil && !info.IsDir() {
				filename = candidate
				break
			}
		}
		if filename == "" {
			http.NotFound(response, request)
			return
		}
		response.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(response, request, filepath.Join(cacheDirectory, filepath.Base(filename)))
	})
}
