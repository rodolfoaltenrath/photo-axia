package main

import "testing"

func TestMainWindowURL(t *testing.T) {
	cases := []struct {
		poc, preview, styles bool
		want                 string
	}{
		{false, false, false, "/"},
		{true, false, false, "/?axiaRustPoc=1"},
		{false, true, false, "/?axiaPreviewSmoke=1"},
		{false, false, true, "/?axiaRustStyles=1"},
		{false, true, true, "/?axiaPreviewSmoke=1&axiaRustStyles=1"},
		{true, false, true, "/?axiaRustPoc=1&axiaRustStyles=1"},
	}
	for _, tc := range cases {
		if got := mainWindowURL(tc.poc, tc.preview, tc.styles); got != tc.want {
			t.Errorf("mainWindowURL(%v, %v, %v) = %q, want %q", tc.poc, tc.preview, tc.styles, got, tc.want)
		}
	}
}
