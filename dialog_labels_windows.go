//go:build windows

package main

// Wails v3 maps the native Windows MessageBox result back to callbacks using
// these exact identifiers. Windows localizes the visible labels itself.
func closeDialogButtonLabels() (confirm string, cancel string) {
	return "Yes", "No"
}
