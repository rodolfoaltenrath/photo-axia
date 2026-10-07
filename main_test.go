package main

import "testing"

func TestMainWindowURL(t *testing.T) {
	cases := []struct {
		poc, preview, styles, media bool
		want                        string
	}{
		{false, false, false, false, "/"},
		{true, false, false, false, "/?axiaRustPoc=1"},
		{false, true, false, false, "/?axiaPreviewSmoke=1"},
		{false, false, true, false, "/?axiaRustStyles=1"},
		{false, true, true, false, "/?axiaPreviewSmoke=1&axiaRustStyles=1"},
		{true, false, true, false, "/?axiaRustPoc=1&axiaRustStyles=1"},
		{true, false, false, true, "/?axiaRustMediaBenchmark=1&axiaRustPoc=1"},
		{false, false, false, true, "/"},
		{false, true, false, true, "/?axiaPreviewSmoke=1"},
	}
	for _, tc := range cases {
		if got := mainWindowURL(tc.poc, tc.preview, tc.styles, tc.media); got != tc.want {
			t.Errorf("mainWindowURL(%v, %v, %v, %v) = %q, want %q", tc.poc, tc.preview, tc.styles, tc.media, got, tc.want)
		}
	}
}
