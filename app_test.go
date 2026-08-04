package main

import (
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestReadImageFileRegistersAsset(t *testing.T) {
	temporaryPath := filepath.Join(t.TempDir(), "sample.png")
	file, err := os.Create(temporaryPath)
	if err != nil {
		t.Fatal(err)
	}

	source := image.NewRGBA(image.Rect(0, 0, 3, 2))
	source.Set(1, 1, color.RGBA{R: 88, G: 196, B: 179, A: 255})
	if err := png.Encode(file, source); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	imported, err := app.readImageFile(temporaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Width != 3 || imported.Height != 2 {
		t.Fatalf("unexpected dimensions: %dx%d", imported.Width, imported.Height)
	}
	if imported.MimeType != "image/png" {
		t.Fatalf("unexpected MIME type: %s", imported.MimeType)
	}

	request := httptest.NewRequest(http.MethodGet, imported.SourceURL, nil)
	response := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected response status: %d", response.Code)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "image/png" {
		t.Fatalf("unexpected response MIME type: %s", contentType)
	}
}

func TestAssetHandlerDoesNotExposeUnknownPaths(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/__axia_asset/missing", nil)
	response := httptest.NewRecorder()
	NewApp().assetHandler().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("unexpected response status: %d", response.Code)
	}
}

func TestAssetHandlerGeneratesSizedPreview(t *testing.T) {
	temporaryPath := filepath.Join(t.TempDir(), "large.png")
	file, err := os.Create(temporaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, image.NewRGBA(image.Rect(0, 0, 40, 20))); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	imported, err := app.readImageFile(temporaryPath)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, imported.SourceURL+"?previewWidth=10&previewHeight=5", nil)
	response := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected response status: %d", response.Code)
	}

	preview, _, err := image.Decode(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Bounds().Dx() != 10 || preview.Bounds().Dy() != 5 {
		t.Fatalf("unexpected preview dimensions: %dx%d", preview.Bounds().Dx(), preview.Bounds().Dy())
	}
}
