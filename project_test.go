package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image/color"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func projectManifest(assetPath string, version int) []byte {
	manifest := map[string]any{
		"format":  "axia",
		"version": version,
		"document": map[string]any{
			"id": "document-1", "name": "Teste", "width": 40, "height": 20,
		},
		"layers": []any{},
		"assets": []map[string]any{{
			"id": "asset-0001", "path": assetPath, "mimeType": "image/png", "width": 40, "height": 20,
		}},
	}
	data, _ := json.Marshal(manifest)
	return data
}

func projectSaveRequest(t *testing.T, token string, manifest []byte, nativeAssets map[string]string, upload []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("manifest", string(manifest)); err != nil {
		t.Fatal(err)
	}
	encodedNative, _ := json.Marshal(nativeAssets)
	if err := writer.WriteField("nativeAssets", string(encodedNative)); err != nil {
		t.Fatal(err)
	}
	if upload != nil {
		part, err := writer.CreateFormFile("asset__asset-0001", "asset.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(upload); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/__axia_project/save/"+token, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func TestAxiaProjectRoundTripWithNativeAsset(t *testing.T) {
	directory := t.TempDir()
	imagePath := filepath.Join(directory, "source.png")
	writeSolidPNG(t, imagePath, 40, 20, color.RGBA{R: 30, G: 150, B: 210})
	target := filepath.Join(directory, "project.axia")
	app := NewApp()
	app.imagePaths["native"] = imagePath
	app.projectSaves["save-token"] = target

	request := projectSaveRequest(t, "save-token", projectManifest("assets/asset-0001.png", 1), map[string]string{
		"asset-0001": "/__axia_asset/native",
	}, nil)
	response := httptest.NewRecorder()
	app.projectHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected save status %d: %s", response.Code, response.Body.String())
	}

	opened, err := app.openAxiaProject(target)
	if err != nil {
		t.Fatal(err)
	}
	assetURL := opened.AssetURLs["asset-0001"]
	if assetURL == "" || opened.Path != target {
		t.Fatalf("unexpected opened project: %#v", opened)
	}
	assetResponse := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(assetResponse, httptest.NewRequest(http.MethodGet, assetURL, nil))
	if assetResponse.Code != http.StatusOK {
		t.Fatalf("restored asset unavailable: %d", assetResponse.Code)
	}
	app.shutdown(nil)
}

func TestAxiaProjectStoresUploadedEditedAsset(t *testing.T) {
	directory := t.TempDir()
	imagePath := filepath.Join(directory, "edited.png")
	writeSolidPNG(t, imagePath, 40, 20, color.RGBA{R: 180, G: 70, B: 100})
	data, err := os.ReadFile(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, "edited.axia")
	app := NewApp()
	app.projectSaves["upload-token"] = target
	response := httptest.NewRecorder()
	app.projectHandler().ServeHTTP(
		response,
		projectSaveRequest(t, "upload-token", projectManifest("assets/asset-0001.png", 1), nil, data),
	)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected save status %d: %s", response.Code, response.Body.String())
	}
	opened, err := app.openAxiaProject(target)
	if err != nil {
		t.Fatal(err)
	}
	if opened.AssetURLs["asset-0001"] == "" {
		t.Fatal("uploaded asset was not restored")
	}
	app.shutdown(nil)
}

func TestAxiaProjectReleasesInactiveExtractionSessions(t *testing.T) {
	directory := t.TempDir()
	imagePath := filepath.Join(directory, "source.png")
	writeSolidPNG(t, imagePath, 40, 20, color.RGBA{R: 80, G: 120, B: 220})
	target := filepath.Join(directory, "sessions.axia")
	app := NewApp()
	app.imagePaths["native"] = imagePath
	app.projectSaves["session-token"] = target
	response := httptest.NewRecorder()
	app.projectHandler().ServeHTTP(response, projectSaveRequest(
		t, "session-token", projectManifest("assets/asset-0001.png", 1),
		map[string]string{"asset-0001": "/__axia_asset/native"}, nil,
	))
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected save status %d: %s", response.Code, response.Body.String())
	}

	first, err := app.openAxiaProject(target)
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.openAxiaProject(target)
	if err != nil {
		t.Fatal(err)
	}
	firstDirectory := app.projectFiles[first.SessionID].directory
	if err := app.FinalizeAxiaProjectOpen(second.SessionID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(firstDirectory); !os.IsNotExist(err) {
		t.Fatalf("inactive extraction directory was not removed: %v", err)
	}
	firstResponse := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(firstResponse, httptest.NewRequest(http.MethodGet, first.AssetURLs["asset-0001"], nil))
	if firstResponse.Code != http.StatusNotFound {
		t.Fatalf("inactive asset remains registered: %d", firstResponse.Code)
	}
	secondResponse := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, second.AssetURLs["asset-0001"], nil))
	if secondResponse.Code != http.StatusOK {
		t.Fatalf("active asset was released: %d", secondResponse.Code)
	}
	app.ReleaseAxiaProjectAssets()
}

func TestAxiaProjectRejectsCorruptedAssetCRC(t *testing.T) {
	directory := t.TempDir()
	imagePath := filepath.Join(directory, "source.png")
	writeSolidPNG(t, imagePath, 40, 20, color.RGBA{R: 210, G: 90, B: 30})
	imageData, err := os.ReadFile(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, "corrupted.axia")
	app := NewApp()
	app.imagePaths["native"] = imagePath
	app.projectSaves["crc-token"] = target
	response := httptest.NewRecorder()
	app.projectHandler().ServeHTTP(response, projectSaveRequest(
		t, "crc-token", projectManifest("assets/asset-0001.png", 1),
		map[string]string{"asset-0001": "/__axia_asset/native"}, nil,
	))
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected save status %d: %s", response.Code, response.Body.String())
	}
	archiveData, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	assetOffset := bytes.Index(archiveData, imageData)
	if assetOffset < 0 {
		t.Fatal("stored image bytes not found in project archive")
	}
	archiveData[assetOffset+len(imageData)/2] ^= 0xff
	if err := os.WriteFile(target, archiveData, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.openAxiaProject(target); err == nil {
		t.Fatal("expected corrupted asset CRC to fail")
	}
	if len(app.projectFiles) != 0 {
		t.Fatal("corrupted project left an extraction session registered")
	}
}

func TestAxiaProjectRejectsTraversalWithoutReplacingTarget(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "existing.axia")
	if err := os.WriteFile(target, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.projectSaves["bad-token"] = target
	response := httptest.NewRecorder()
	app.projectHandler().ServeHTTP(
		response,
		projectSaveRequest(t, "bad-token", projectManifest("assets/../outside.png", 1), nil, nil),
	)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request, got %d", response.Code)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "existing" {
		t.Fatal("invalid save replaced the existing project")
	}
}

func TestAxiaProjectRejectsUnsupportedVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.axia")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	manifest, err := archive.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(manifest, bytes.NewReader(projectManifest("assets/asset-0001.png", 99))); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := NewApp().openAxiaProject(path); err == nil {
		t.Fatal("expected unsupported project version to fail")
	}
}
