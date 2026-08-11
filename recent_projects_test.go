package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func recentTestApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	app := NewApp()
	app.recentConfigDirectory = filepath.Join(root, "config")
	app.recentCacheDirectory = filepath.Join(root, "cache")
	return app
}

func recentProjectFile(t *testing.T, directory string, name string) string {
	t.Helper()
	path := filepath.Join(directory, name+".axia")
	if err := os.WriteFile(path, []byte("project"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRecentProjectsDeduplicateAndRemove(t *testing.T) {
	app := recentTestApp(t)
	directory := t.TempDir()
	first := recentProjectFile(t, directory, "first")
	second := recentProjectFile(t, directory, "second")
	if _, err := app.RecordRecentProject(first, "Primeiro", 1920, 1080); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RecordRecentProject(second, "Segundo", 1080, 1080); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RecordRecentProject(first, "Primeiro atualizado", 2560, 1440); err != nil {
		t.Fatal(err)
	}
	projects, err := app.ListRecentProjects()
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 2 || projects[0].Path != first || projects[0].Name != "Primeiro atualizado" {
		t.Fatalf("unexpected recent projects: %#v", projects)
	}
	if err := app.RemoveRecentProject(first); err != nil {
		t.Fatal(err)
	}
	projects, _ = app.ListRecentProjects()
	if len(projects) != 1 || projects[0].Path != second {
		t.Fatalf("unexpected projects after removal: %#v", projects)
	}
}

func TestRecentProjectsAreBoundedAndTolerateCorruptIndex(t *testing.T) {
	app := recentTestApp(t)
	directory := t.TempDir()
	for index := 0; index < maxRecentProjects+5; index++ {
		path := recentProjectFile(t, directory, fmt.Sprintf("project-%02d", index))
		if _, err := app.RecordRecentProject(path, "Projeto", 100, 100); err != nil {
			t.Fatal(err)
		}
	}
	projects, err := app.ListRecentProjects()
	if err != nil || len(projects) != maxRecentProjects {
		t.Fatalf("unexpected bounded list: %d, %v", len(projects), err)
	}
	indexPath, _, _ := app.recentIndexPaths()
	if err := os.WriteFile(indexPath, []byte("not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	projects, err = app.ListRecentProjects()
	if err != nil || len(projects) != 0 {
		t.Fatalf("corrupt index should be ignored: %#v, %v", projects, err)
	}
	backups, err := filepath.Glob(indexPath + ".corrupt-*")
	if err != nil || len(backups) != 1 {
		t.Fatalf("corrupt index should be preserved: %#v, %v", backups, err)
	}
}

func TestRecentThumbnailRoundTrip(t *testing.T) {
	app := recentTestApp(t)
	path := recentProjectFile(t, t.TempDir(), "thumbnail")
	project, err := app.RecordRecentProject(path, "Miniatura", 640, 360)
	if err != nil {
		t.Fatal(err)
	}
	token, err := app.PrepareRecentThumbnail(path)
	if err != nil {
		t.Fatal(err)
	}
	preview := image.NewRGBA(image.Rect(0, 0, 64, 36))
	for y := 0; y < 36; y++ {
		for x := 0; x < 64; x++ {
			preview.SetRGBA(x, y, color.RGBA{R: 30, G: 80, B: 160, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, preview); err != nil {
		t.Fatal(err)
	}
	upload := httptest.NewRequest(http.MethodPost, "/__axia_recent/thumbnail/"+token, bytes.NewReader(encoded.Bytes()))
	upload.Header.Set("Content-Type", "image/png")
	uploadResponse := httptest.NewRecorder()
	app.recentProjectsHandler().ServeHTTP(uploadResponse, upload)
	if uploadResponse.Code != http.StatusNoContent {
		t.Fatalf("unexpected upload response: %d %s", uploadResponse.Code, uploadResponse.Body.String())
	}
	projects, _ := app.ListRecentProjects()
	if len(projects) != 1 || projects[0].ThumbnailURL == "" {
		t.Fatalf("thumbnail missing from recent project: %#v", projects)
	}
	request := httptest.NewRequest(http.MethodGet, "/__axia_recent/thumb/"+project.ID, nil)
	response := httptest.NewRecorder()
	app.recentProjectsHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("unexpected thumbnail response: %d %s", response.Code, response.Header().Get("Content-Type"))
	}
}

func TestUnavailableRecentProjectRemainsVisible(t *testing.T) {
	app := recentTestApp(t)
	path := recentProjectFile(t, t.TempDir(), "missing")
	if _, err := app.RecordRecentProject(path, "Ausente", 100, 80); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	projects, _ := app.ListRecentProjects()
	if len(projects) != 1 || projects[0].Available {
		t.Fatalf("missing project availability is wrong: %#v", projects)
	}
}

func TestRecentThumbnailRejectsInvalidUploads(t *testing.T) {
	app := recentTestApp(t)
	path := recentProjectFile(t, t.TempDir(), "invalid-thumbnail")
	if _, err := app.RecordRecentProject(path, "Miniatura", 640, 360); err != nil {
		t.Fatal(err)
	}
	valid := image.NewRGBA(image.Rect(0, 0, 16, 9))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, valid); err != nil {
		t.Fatal(err)
	}
	wide := image.NewRGBA(image.Rect(0, 0, maxThumbnailDimension+1, 1))
	var wideEncoded bytes.Buffer
	if err := png.Encode(&wideEncoded, wide); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name        string
		contentType string
		body        []byte
		status      int
	}{
		{name: "unsupported", contentType: "image/gif", body: encoded.Bytes(), status: http.StatusUnsupportedMediaType},
		{name: "mismatched", contentType: "image/jpeg", body: encoded.Bytes(), status: http.StatusBadRequest},
		{name: "oversized", contentType: "image/png", body: make([]byte, maxRecentThumbnail+1), status: http.StatusBadRequest},
		{name: "invalid dimensions", contentType: "image/png", body: wideEncoded.Bytes(), status: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			token, err := app.PrepareRecentThumbnail(path)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/__axia_recent/thumbnail/"+token, bytes.NewReader(test.body))
			request.Header.Set("Content-Type", test.contentType)
			response := httptest.NewRecorder()
			app.recentProjectsHandler().ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("unexpected status: %d, want %d", response.Code, test.status)
			}
		})
	}
}

func TestRecentThumbnailIsInvalidatedWhenProjectChangesAndClearRemovesCache(t *testing.T) {
	app := recentTestApp(t)
	path := recentProjectFile(t, t.TempDir(), "changed-thumbnail")
	if _, err := app.RecordRecentProject(path, "Projeto", 640, 360); err != nil {
		t.Fatal(err)
	}
	token, _ := app.PrepareRecentThumbnail(path)
	preview := image.NewRGBA(image.Rect(0, 0, 16, 9))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, preview); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/__axia_recent/thumbnail/"+token, bytes.NewReader(encoded.Bytes()))
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	app.recentProjectsHandler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("thumbnail upload failed: %d", response.Code)
	}
	_, cacheDirectory, _ := app.recentIndexPaths()
	entries, _ := os.ReadDir(cacheDirectory)
	if len(entries) != 1 {
		t.Fatalf("expected one cached thumbnail, got %d", len(entries))
	}
	changedAt := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, changedAt, changedAt); err != nil {
		t.Fatal(err)
	}
	project, err := app.RecordRecentProject(path, "Projeto", 640, 360)
	if err != nil {
		t.Fatal(err)
	}
	if project.ThumbnailURL != "" {
		t.Fatalf("changed project retained a stale thumbnail: %#v", project)
	}
	entries, _ = os.ReadDir(cacheDirectory)
	if len(entries) != 0 {
		t.Fatalf("stale thumbnail was not removed: %#v", entries)
	}
	token, _ = app.PrepareRecentThumbnail(path)
	request = httptest.NewRequest(http.MethodPost, "/__axia_recent/thumbnail/"+token, bytes.NewReader(encoded.Bytes()))
	request.Header.Set("Content-Type", "image/png")
	response = httptest.NewRecorder()
	app.recentProjectsHandler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("replacement thumbnail upload failed: %d", response.Code)
	}
	if err := app.ClearRecentProjects(); err != nil {
		t.Fatal(err)
	}
	entries, _ = os.ReadDir(cacheDirectory)
	if len(entries) != 0 {
		t.Fatalf("clear left cached files behind: %#v", entries)
	}
}

func TestStaleRecentThumbnailUploadCannotOverwriteNewProjectVersion(t *testing.T) {
	app := recentTestApp(t)
	path := recentProjectFile(t, t.TempDir(), "stale-upload")
	if _, err := app.RecordRecentProject(path, "Projeto", 640, 360); err != nil {
		t.Fatal(err)
	}
	token, err := app.PrepareRecentThumbnail(path)
	if err != nil {
		t.Fatal(err)
	}
	changedAt := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, changedAt, changedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := app.RecordRecentProject(path, "Projeto atualizado", 640, 360); err != nil {
		t.Fatal(err)
	}
	preview := image.NewRGBA(image.Rect(0, 0, 16, 9))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, preview); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/__axia_recent/thumbnail/"+token, bytes.NewReader(encoded.Bytes()))
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	app.recentProjectsHandler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("stale upload should be rejected: %d %s", response.Code, response.Body.String())
	}
}

func TestRecentProjectsPreserveConcurrentUpdatesAcrossAppInstances(t *testing.T) {
	root := t.TempDir()
	firstApp := NewApp()
	secondApp := NewApp()
	for _, app := range []*App{firstApp, secondApp} {
		app.recentConfigDirectory = filepath.Join(root, "config")
		app.recentCacheDirectory = filepath.Join(root, "cache")
	}
	directory := t.TempDir()
	paths := []string{
		recentProjectFile(t, directory, "concurrent-first"),
		recentProjectFile(t, directory, "concurrent-second"),
	}
	var waitGroup sync.WaitGroup
	errors := make(chan error, len(paths))
	for index, app := range []*App{firstApp, secondApp} {
		waitGroup.Add(1)
		go func(index int, app *App) {
			defer waitGroup.Done()
			_, err := app.RecordRecentProject(paths[index], fmt.Sprintf("Projeto %d", index), 100, 100)
			errors <- err
		}(index, app)
	}
	waitGroup.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	projects, err := firstApp.ListRecentProjects()
	if err != nil || len(projects) != 2 {
		t.Fatalf("concurrent records were lost: %#v, %v", projects, err)
	}
}
