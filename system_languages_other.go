//go:build !windows && !linux && !darwin

package main

func platformPreferredLanguages() []string { return nil }
