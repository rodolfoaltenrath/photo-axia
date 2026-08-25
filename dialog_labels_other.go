//go:build !windows

package main

func closeDialogButtonLabels() (confirm string, cancel string) {
	return "Sair sem salvar", "Cancelar"
}
