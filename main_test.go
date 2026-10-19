package main

import "testing"

func TestMainWindowURL(t *testing.T) {
	cases := []struct {
		poc, preview, styles, media, document bool
		want                                  string
	}{
		{false, false, false, false, false, "/"},
		{true, false, false, false, false, "/?axiaRustPoc=1"},
		{false, true, false, false, false, "/?axiaPreviewSmoke=1"},
		{false, false, true, false, false, "/?axiaRustStyles=1"},
		{false, true, true, false, false, "/?axiaPreviewSmoke=1&axiaRustStyles=1"},
		{true, false, true, false, false, "/?axiaRustPoc=1&axiaRustStyles=1"},
		{true, false, false, true, false, "/?axiaRustMediaBenchmark=1&axiaRustPoc=1"},
		{false, false, false, true, false, "/"},
		{false, true, false, true, false, "/?axiaPreviewSmoke=1"},
		{false, false, false, false, true, "/?axiaRustDocument=1"},
		{false, false, true, false, true, "/?axiaRustDocument=1"},
		{false, true, true, false, true, "/?axiaPreviewSmoke=1&axiaRustDocument=1"},
	}
	for _, tc := range cases {
		if got := mainWindowURL(tc.poc, tc.preview, tc.styles, tc.media, tc.document); got != tc.want {
			t.Errorf("mainWindowURL(%v, %v, %v, %v, %v) = %q, want %q", tc.poc, tc.preview, tc.styles, tc.media, tc.document, got, tc.want)
		}
	}
}
