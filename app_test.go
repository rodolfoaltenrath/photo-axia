package main

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestCreateDocumentValidatesNativeBoundary(t *testing.T) {
	app := NewApp()
	document, err := app.CreateDocument(" Documento ", 1920, 1080, "px", 1920, 1080, 72, "transparent")
	if err != nil || document.Name != "Documento" {
		t.Fatalf("valid document was rejected: %#v, %v", document, err)
	}
	invalid := []struct {
		name       string
		width      int
		height     int
		unit       string
		physical   float64
		resolution int
		background string
	}{
		{name: "dimensions", width: 20_000, height: 100, unit: "px", physical: 100, resolution: 72, background: "transparent"},
		{name: "pixels", width: 10_000, height: 10_000, unit: "px", physical: 100, resolution: 72, background: "transparent"},
		{name: "unit", width: 100, height: 100, unit: "meters", physical: 100, resolution: 72, background: "transparent"},
		{name: "resolution", width: 100, height: 100, unit: "px", physical: 100, resolution: 0, background: "transparent"},
		{name: "background", width: 100, height: 100, unit: "px", physical: 100, resolution: 72, background: "purple"},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			_, err := app.CreateDocument("Documento", test.width, test.height, test.unit, test.physical, test.physical, test.resolution, test.background)
			if err == nil {
				t.Fatal("invalid native document was accepted")
			}
		})
	}
}

// writeSolidPNG writes a width x height PNG filled with the given color to path.
// The alpha channel is kept below 255 so image.RGBA.Opaque() reports false,
// which keeps generateImagePreview on the lossless PNG encoding path instead
// of JPEG — required for exact pixel-color comparisons in these tests.
func writeSolidPNG(t *testing.T, path string, width, height int, fill color.RGBA) {
	t.Helper()
	fill.A = 254

	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}

	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			source.Set(x, y, fill)
		}
	}
	if err := png.Encode(file, source); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func requestPreview(t *testing.T, app *App, sourceURL string, width, height int) *httptest.ResponseRecorder {
	t.Helper()
	url := fmt.Sprintf("%s?previewWidth=%d&previewHeight=%d", sourceURL, width, height)
	request := httptest.NewRequest(http.MethodGet, url, nil)
	response := httptest.NewRecorder()
	app.assetHandler().ServeHTTP(response, request)
	return response
}

// corruptFilePreservingStat overwrites path with undecodable bytes of the exact
// same length, then restores the original mtime. The cache's staleness check
// (mtime+size) will see no change, so a real cache hit keeps serving the old
// (valid) cached bytes without ever reopening the file; only a cache miss
// would try to decode the garbage and fail. This proves cache behavior
// deterministically without depending on file permissions or deletion, which
// can behave differently across environments (e.g. root bypassing chmod).
func corruptFilePreservingStat(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	garbage := make([]byte, info.Size())
	for index := range garbage {
		garbage[index] = 0xff
	}
	if err := os.WriteFile(path, garbage, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
}

func TestPreviewCacheServesRepeatedRequestWithoutReReading(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.png")
	writeSolidPNG(t, path, 40, 20, color.RGBA{R: 200, G: 40, B: 40})

	app := NewApp()
	imported, err := app.readImageFile(path)
	if err != nil {
		t.Fatal(err)
	}

	first := requestPreview(t, app, imported.SourceURL, 10, 5)
	if first.Code != http.StatusOK {
		t.Fatalf("unexpected first response status: %d", first.Code)
	}

	corruptFilePreservingStat(t, path)

	second := requestPreview(t, app, imported.SourceURL, 10, 5)
	if second.Code != http.StatusOK {
		t.Fatalf("expected cached response despite corrupted source, got status: %d", second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Fatal("cached response body differs from the original preview")
	}
}

func TestPreviewCacheInvalidatesOnFileChange(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.png")
	writeSolidPNG(t, path, 40, 20, color.RGBA{R: 200, G: 40, B: 40})

	app := NewApp()
	imported, err := app.readImageFile(path)
	if err != nil {
		t.Fatal(err)
	}

	first := requestPreview(t, app, imported.SourceURL, 10, 5)
	if first.Code != http.StatusOK {
		t.Fatalf("unexpected first response status: %d", first.Code)
	}
	firstPreview, _, err := image.Decode(first.Body)
	if err != nil {
		t.Fatal(err)
	}
	if r, _, _, _ := firstPreview.At(0, 0).RGBA(); r>>8 < 150 {
		t.Fatalf("expected reddish first preview, got: %v", firstPreview.At(0, 0))
	}

	writeSolidPNG(t, path, 40, 20, color.RGBA{R: 40, G: 40, B: 200})
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}

	second := requestPreview(t, app, imported.SourceURL, 10, 5)
	if second.Code != http.StatusOK {
		t.Fatalf("unexpected second response status: %d", second.Code)
	}
	secondPreview, _, err := image.Decode(second.Body)
	if err != nil {
		t.Fatal(err)
	}
	_, _, b, _ := secondPreview.At(0, 0).RGBA()
	if b>>8 < 150 {
		t.Fatalf("expected updated (blue) preview after file change, got: %v", secondPreview.At(0, 0))
	}
}

func TestPreviewCacheEvictsLeastRecentlyUsed(t *testing.T) {
	originalMaxEntries := previewCacheMaxEntries
	previewCacheMaxEntries = 1
	t.Cleanup(func() { previewCacheMaxEntries = originalMaxEntries })

	pathA := filepath.Join(t.TempDir(), "a.png")
	pathB := filepath.Join(t.TempDir(), "b.png")
	writeSolidPNG(t, pathA, 40, 20, color.RGBA{R: 200, G: 40, B: 40})
	writeSolidPNG(t, pathB, 40, 20, color.RGBA{R: 40, G: 40, B: 200})

	app := NewApp()
	importedA, err := app.readImageFile(pathA)
	if err != nil {
		t.Fatal(err)
	}
	importedB, err := app.readImageFile(pathB)
	if err != nil {
		t.Fatal(err)
	}

	if response := requestPreview(t, app, importedA.SourceURL, 10, 5); response.Code != http.StatusOK {
		t.Fatalf("unexpected status caching A: %d", response.Code)
	}
	if response := requestPreview(t, app, importedB.SourceURL, 10, 5); response.Code != http.StatusOK {
		t.Fatalf("unexpected status caching B: %d", response.Code)
	}

	corruptFilePreservingStat(t, pathA)
	if response := requestPreview(t, app, importedA.SourceURL, 10, 5); response.Code != http.StatusInternalServerError {
		t.Fatalf("expected A to have been evicted (regeneration from corrupted file fails), got status: %d", response.Code)
	}

	corruptFilePreservingStat(t, pathB)
	if response := requestPreview(t, app, importedB.SourceURL, 10, 5); response.Code != http.StatusOK {
		t.Fatalf("expected B to still be cached (most recently used), got status: %d", response.Code)
	}
}

func TestPreviewCacheHandlesConcurrentRequestsForSamePreview(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.png")
	writeSolidPNG(t, path, 40, 20, color.RGBA{R: 200, G: 40, B: 40})

	app := NewApp()
	imported, err := app.readImageFile(path)
	if err != nil {
		t.Fatal(err)
	}

	const concurrency = 8
	bodies := make([]string, concurrency)
	codes := make([]int, concurrency)
	var wg sync.WaitGroup
	wg.Add(concurrency)
	for index := 0; index < concurrency; index++ {
		go func(index int) {
			defer wg.Done()
			response := requestPreview(t, app, imported.SourceURL, 10, 5)
			codes[index] = response.Code
			bodies[index] = response.Body.String()
		}(index)
	}
	wg.Wait()

	for index, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("request %d unexpected status: %d", index, code)
		}
		if bodies[index] != bodies[0] {
			t.Fatalf("request %d body differs from request 0", index)
		}
	}
}

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

func BenchmarkGenerateImagePreview4K(b *testing.B) {
	path := filepath.Join(b.TempDir(), "benchmark-4k.jpg")
	file, err := os.Create(path)
	if err != nil {
		b.Fatal(err)
	}
	source := image.NewRGBA(image.Rect(0, 0, 3840, 2160))
	for y := 0; y < 2160; y++ {
		for x := 0; x < 3840; x++ {
			source.SetRGBA(x, y, color.RGBA{
				R: uint8((x/8 + y/31) % 256),
				G: uint8((y/6 + x/47) % 256),
				B: uint8((x/19 + y/11) % 256),
				A: 255,
			})
		}
	}
	if err := jpeg.Encode(file, source, &jpeg.Options{Quality: 82}); err != nil {
		file.Close()
		b.Fatal(err)
	}
	if err := file.Close(); err != nil {
		b.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		if _, err := generateImagePreview(path, 1344, 768); err != nil {
			b.Fatal(err)
		}
	}
	b.ReportMetric(float64(info.Size())/1024, "source-KiB")
}

func TestImageResolutionFromPNGPhys(t *testing.T) {
	header := []byte{
		0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
		0, 0, 0, 9, 'p', 'H', 'Y', 's',
		0, 0, 0x17, 0x12, 0, 0, 0x17, 0x12, 1,
		0, 0, 0, 0,
	}
	x, y, source := imageResolutionFromHeader(header, "png")
	if x != 150.01 || y != 150.01 || source != "png-phys" {
		t.Fatalf("unexpected PNG resolution: %.2f x %.2f (%s)", x, y, source)
	}
}

func TestImageResolutionFromJPEGJFIF(t *testing.T) {
	header := []byte{
		0xff, 0xd8, 0xff, 0xe0, 0, 16,
		'J', 'F', 'I', 'F', 0, 1, 2, 1,
		1, 44, 0, 150, 0, 0,
	}
	x, y, source := imageResolutionFromHeader(header, "jpeg")
	if x != 300 || y != 150 || source != "jpeg-jfif" {
		t.Fatalf("unexpected JPEG resolution: %.2f x %.2f (%s)", x, y, source)
	}
}

func TestImageResolutionFromJPEGExif(t *testing.T) {
	header := make([]byte, 82)
	binary.BigEndian.PutUint16(header[0:2], 0xffd8)
	binary.BigEndian.PutUint16(header[2:4], 0xffe1)
	binary.BigEndian.PutUint16(header[4:6], 76)
	copy(header[6:12], []byte{'E', 'x', 'i', 'f', 0, 0})
	tiff := header[12:]
	copy(tiff[0:2], []byte{'I', 'I'})
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 3)
	entries := []struct {
		tag, typeID uint16
		value       uint32
	}{
		{0x011a, 5, 50},
		{0x011b, 5, 58},
		{0x0128, 3, 2},
	}
	for index, entry := range entries {
		offset := 10 + index*12
		binary.LittleEndian.PutUint16(tiff[offset:offset+2], entry.tag)
		binary.LittleEndian.PutUint16(tiff[offset+2:offset+4], entry.typeID)
		binary.LittleEndian.PutUint32(tiff[offset+4:offset+8], 1)
		if entry.typeID == 3 {
			binary.LittleEndian.PutUint16(tiff[offset+8:offset+10], uint16(entry.value))
		} else {
			binary.LittleEndian.PutUint32(tiff[offset+8:offset+12], entry.value)
		}
	}
	binary.LittleEndian.PutUint32(tiff[50:54], 300)
	binary.LittleEndian.PutUint32(tiff[54:58], 1)
	binary.LittleEndian.PutUint32(tiff[58:62], 150)
	binary.LittleEndian.PutUint32(tiff[62:66], 1)

	x, y, source := imageResolutionFromHeader(header, "jpeg")
	if x != 300 || y != 150 || source != "jpeg-exif" {
		t.Fatalf("unexpected JPEG EXIF resolution: %.2f x %.2f (%s)", x, y, source)
	}
}
