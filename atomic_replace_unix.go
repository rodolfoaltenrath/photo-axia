//go:build !windows

package main

import "os"

func replaceFileAtomically(source string, target string) error {
	return os.Rename(source, target)
}
