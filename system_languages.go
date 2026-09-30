package main

import (
	"os"
	"regexp"
	"strings"
)

const maxPreferredLanguages = 16

var languageTagPattern = regexp.MustCompile(`^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{2,8})*$`)

func normalizePreferredLanguage(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 64 {
		return ""
	}
	value, _, _ = strings.Cut(value, "@")
	value, _, _ = strings.Cut(value, ".")
	if strings.EqualFold(value, "C") || strings.EqualFold(value, "POSIX") || !languageTagPattern.MatchString(value) {
		return ""
	}
	parts := strings.Split(strings.ReplaceAll(value, "_", "-"), "-")
	parts[0] = strings.ToLower(parts[0])
	for index := 1; index < len(parts); index++ {
		if len(parts[index]) == 2 {
			parts[index] = strings.ToUpper(parts[index])
		}
	}
	return strings.Join(parts, "-")
}

func uniquePreferredLanguages(values ...string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		tag := normalizePreferredLanguage(value)
		if tag == "" {
			continue
		}
		key := strings.ToLower(tag)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, tag)
		if len(result) == maxPreferredLanguages {
			break
		}
	}
	return result
}

func environmentPreferredLanguages(getenv func(string) string) []string {
	// LC_ALL overrides the other POSIX locale variables, including LANGUAGE.
	if value := getenv("LC_ALL"); value != "" {
		return uniquePreferredLanguages(value)
	}
	values := strings.Split(getenv("LANGUAGE"), ":")
	values = append(values, getenv("LC_MESSAGES"), getenv("LANG"))
	return uniquePreferredLanguages(values...)
}

// GetSystemLanguages returns the desktop user's preferred UI languages in order.
// An empty list is valid and lets the frontend use navigator.languages as a
// fallback. It does not change the current application's language yet.
func (a *App) GetSystemLanguages() []string {
	if languages := uniquePreferredLanguages(platformPreferredLanguages()...); len(languages) > 0 {
		return languages
	}
	return environmentPreferredLanguages(os.Getenv)
}
