package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

func platformPreferredLanguages() []string {
	// AppleLanguages is the user's ordered UI-language list. Never invoke a shell
	// or treat this output as executable content.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/bin/defaults", "read", "-g", "AppleLanguages").Output()
	if err == nil {
		var values []string
		for _, line := range strings.Split(string(output), "\n") {
			line = strings.Trim(line, " \t\r\"',()")
			if line != "" {
				values = append(values, line)
			}
		}
		if languages := uniquePreferredLanguages(values...); len(languages) > 0 {
			return languages
		}
	}
	return environmentPreferredLanguages(os.Getenv)
}
