package main

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func pngWithPhysicalResolution(t *testing.T, compression png.CompressionLevel) []byte {
	t.Helper()
	imageData := image.NewNRGBA(image.Rect(0, 0, 320, 180))
	for y := 0; y < 180; y++ {
		for x := 0; x < 320; x++ {
			imageData.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}
	var encoded bytes.Buffer
	encoder := png.Encoder{CompressionLevel: compression}
	if err := encoder.Encode(&encoded, imageData); err != nil {
		t.Fatal(err)
	}
	source := encoded.Bytes()
	chunk := make([]byte, 21)
	binary.BigEndian.PutUint32(chunk[0:4], 9)
	copy(chunk[4:8], "pHYs")
	binary.BigEndian.PutUint32(chunk[8:12], 5906)
	binary.BigEndian.PutUint32(chunk[12:16], 5906)
	chunk[16] = 1
	binary.BigEndian.PutUint32(chunk[17:21], crc32.ChecksumIEEE(chunk[4:17]))
	result := make([]byte, 0, len(source)+len(chunk))
	result = append(result, source[:33]...)
	result = append(result, chunk...)
	result = append(result, source[33:]...)
	return result
}

func testPNG(t *testing.T) []byte {
	t.Helper()
	var encoded bytes.Buffer
	imageData := image.NewRGBA(image.Rect(0, 0, 2, 1))
	imageData.SetRGBA(0, 0, color.RGBA{R: 255, A: 255})
	imageData.SetRGBA(1, 0, color.RGBA{B: 255, A: 255})
	if err := png.Encode(&encoded, imageData); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func TestExportHandlerStoresBinaryUploadAndConsumesToken(t *testing.T) {
	target := filepath.Join(t.TempDir(), "export.png")
	app := NewApp()
	app.exportUploads["valid-token"] = exportUpload{
		Path: target, MimeType: "image/png", ExpiresAt: time.Now().Add(time.Minute),
	}
	data := testPNG(t)
	request := httptest.NewRequest(http.MethodPost, "/__axia_export/save/valid-token", bytes.NewReader(data))
	request.Header.Set("Content-Type", "image/png")
	response := httptest.NewRecorder()
	app.exportHandler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
	stored, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, data) {
		t.Fatal("stored export differs from uploaded bytes")
	}

	reused := httptest.NewRequest(http.MethodPost, "/__axia_export/save/valid-token", bytes.NewReader(data))
	reused.Header.Set("Content-Type", "image/png")
	reusedResponse := httptest.NewRecorder()
	app.exportHandler().ServeHTTP(reusedResponse, reused)
	if reusedResponse.Code != http.StatusNotFound {
		t.Fatalf("expected consumed token to fail, got %d", reusedResponse.Code)
	}
}

func TestExportHandlerRejectsWrongMimeWithoutReplacingDestination(t *testing.T) {
	target := filepath.Join(t.TempDir(), "export.png")
	if err := os.WriteFile(target, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.exportUploads["mime-token"] = exportUpload{
		Path: target, MimeType: "image/png", ExpiresAt: time.Now().Add(time.Minute),
	}
	request := httptest.NewRequest(http.MethodPost, "/__axia_export/save/mime-token", bytes.NewReader(testPNG(t)))
	request.Header.Set("Content-Type", "image/jpeg")
	response := httptest.NewRecorder()
	app.exportHandler().ServeHTTP(response, request)
	if response.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("unexpected response: %d", response.Code)
	}
	stored, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != "original" {
		t.Fatal("invalid upload replaced the existing destination")
	}
}

func TestStoreExportUploadKeepsOnlySmallerLosslessPNGAndPreservesResolution(t *testing.T) {
	target := filepath.Join(t.TempDir(), "optimized.png")
	source := pngWithPhysicalResolution(t, png.NoCompression)
	if err := storeExportUpload(exportUpload{Path: target, MimeType: "image/png"}, bytes.NewReader(source)); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) >= len(source) {
		t.Fatalf("expected optimized PNG to be smaller: source=%d stored=%d", len(source), len(stored))
	}
	physicalChunk := pngPhysicalChunk(target)
	if len(physicalChunk) != 21 || binary.BigEndian.Uint32(physicalChunk[8:12]) != 5906 || binary.BigEndian.Uint32(physicalChunk[12:16]) != 5906 {
		t.Fatal("optimized PNG did not preserve pHYs resolution")
	}
	decoded, err := png.Decode(bytes.NewReader(stored))
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Bounds() != image.Rect(0, 0, 320, 180) {
		t.Fatalf("unexpected optimized bounds: %v", decoded.Bounds())
	}
	for _, point := range []image.Point{{0, 0}, {25, 70}, {319, 179}} {
		expected := color.NRGBA{R: uint8(point.X), G: uint8(point.Y), B: 120, A: 255}
		actual := color.NRGBAModel.Convert(decoded.At(point.X, point.Y)).(color.NRGBA)
		if actual != expected {
			t.Fatalf("pixel %v changed: got %v want %v", point, actual, expected)
		}
	}
}
