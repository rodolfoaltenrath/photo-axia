package main

import "os"

func platformPreferredLanguages() []string {
	return environmentPreferredLanguages(os.Getenv)
}
