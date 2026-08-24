package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

const benchmarkWidth, benchmarkHeight = 1754, 1240

func benchmarkHash(x int, y int) uint32 {
	value := uint32(x)*374761393 + uint32(y)*668265263
	value ^= uint32(x+y) * 1274126177
	return value ^ (value >> 13)
}

func exportBenchmarkFixture(kind string) *image.NRGBA {
	result := image.NewNRGBA(image.Rect(0, 0, benchmarkWidth, benchmarkHeight))
	for y := 0; y < benchmarkHeight; y++ {
		for x := 0; x < benchmarkWidth; x++ {
			pixel := color.NRGBA{R: 242, G: 242, B: 238, A: 255}
			switch kind {
			case "flat":
				pixel = color.NRGBA{R: 40, G: 120, B: 180, A: 255}
			case "gradient":
				pixel = color.NRGBA{R: uint8(x * 255 / (benchmarkWidth - 1)), G: uint8(y * 255 / (benchmarkHeight - 1)), B: uint8((x + y) & 255), A: 255}
			case "photo-noise":
				hash := benchmarkHash(x, y)
				pixel = color.NRGBA{R: uint8(hash), G: uint8(hash >> 8), B: uint8(hash >> 16), A: 255}
			case "mixed":
				insidePhoto := x >= 90 && x < 790 && y >= 100 && y < 610 || x >= 960 && x < 1660 && y >= 680 && y < 1130
				if insidePhoto {
					hash := benchmarkHash(x, y)
					pixel = color.NRGBA{R: uint8(hash), G: uint8(hash >> 8), B: uint8(hash >> 16), A: 255}
				} else if y%74 < 3 && x > 80 && x < 1670 {
					pixel = color.NRGBA{R: 35, G: 38, B: 42, A: 255}
				}
			}
			result.SetNRGBA(x, y, pixel)
		}
	}
	return result
}

func BenchmarkPNGEncoders(b *testing.B) {
	levels := []struct {
		name  string
		level png.CompressionLevel
	}{
		{"best-speed", png.BestSpeed},
		{"default", png.DefaultCompression},
		{"best-compression", png.BestCompression},
	}
	for _, fixtureName := range []string{"flat", "gradient", "photo-noise", "mixed"} {
		fixture := exportBenchmarkFixture(fixtureName)
		for _, candidate := range levels {
			b.Run(fixtureName+"/"+candidate.name, func(b *testing.B) {
				encoder := png.Encoder{CompressionLevel: candidate.level}
				var output bytes.Buffer
				if err := encoder.Encode(&output, fixture); err != nil {
					b.Fatal(err)
				}
				b.ResetTimer()
				for index := 0; index < b.N; index++ {
					output.Reset()
					if err := encoder.Encode(&output, fixture); err != nil {
						b.Fatal(err)
					}
				}
				b.StopTimer()
				b.ReportMetric(float64(output.Len()), "encoded-bytes")
				b.ReportMetric(float64(benchmarkWidth*benchmarkHeight*4), "raw-RGBA-bytes")
			})
		}
	}
}

func BenchmarkPNGDecodeAndReencodeBestSpeed(b *testing.B) {
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	for _, fixtureName := range []string{"flat", "gradient", "photo-noise", "mixed"} {
		fixture := exportBenchmarkFixture(fixtureName)
		var source bytes.Buffer
		if err := png.Encode(&source, fixture); err != nil {
			b.Fatal(err)
		}
		sourceBytes := append([]byte(nil), source.Bytes()...)
		b.Run(fixtureName, func(b *testing.B) {
			var output bytes.Buffer
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				decoded, err := png.Decode(bytes.NewReader(sourceBytes))
				if err != nil {
					b.Fatal(err)
				}
				output.Reset()
				if err := encoder.Encode(&output, decoded); err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			b.ReportMetric(float64(len(sourceBytes)), "source-bytes")
			b.ReportMetric(float64(output.Len()), "output-bytes")
		})
	}
}
