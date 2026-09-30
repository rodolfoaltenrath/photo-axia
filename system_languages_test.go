package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestNormalizePreferredLanguage(t *testing.T) {
	cases := map[string]string{
		"pt_BR.UTF-8":                   "pt-BR",
		"zh_CN":                         "zh-CN",
		"zh-Hans-CN":                    "zh-Hans-CN",
		"en_US@euro":                    "en-US",
		"C.UTF-8":                       "",
		"POSIX":                         "",
		"":                              "",
		"../../etc":                     "",
		"en-1":                          "",
		"en-" + strings.Repeat("a", 70): "",
	}
	for input, expected := range cases {
		if actual := normalizePreferredLanguage(input); actual != expected {
			t.Errorf("normalizePreferredLanguage(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestSystemLanguagesAreNormalized(t *testing.T) {
	languages := (&App{}).GetSystemLanguages()
	if len(languages) > maxPreferredLanguages {
		t.Fatalf("got %d languages, maximum is %d", len(languages), maxPreferredLanguages)
	}
	if !reflect.DeepEqual(languages, uniquePreferredLanguages(languages...)) {
		t.Fatalf("system languages are not normalized: %v", languages)
	}
}

func TestEnvironmentPreferredLanguages(t *testing.T) {
	cases := []struct {
		name     string
		values   map[string]string
		expected []string
	}{
		{"language order", map[string]string{
			"LANGUAGE": "fr_FR:pt_BR:fr-FR", "LC_MESSAGES": "en_US", "LANG": "zh_CN.UTF-8",
		}, []string{"fr-FR", "pt-BR", "en-US", "zh-CN"}},
		{"LC_ALL overrides", map[string]string{
			"LC_ALL": "de_DE.UTF-8", "LANGUAGE": "pt_BR", "LANG": "en_US",
		}, []string{"de-DE"}},
		{"C locale", map[string]string{
			"LC_ALL": "C.UTF-8", "LANGUAGE": "pt_BR",
		}, []string{}},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			actual := environmentPreferredLanguages(func(name string) string { return item.values[name] })
			if !reflect.DeepEqual(actual, item.expected) {
				t.Errorf("languages = %v, want %v", actual, item.expected)
			}
		})
	}
}

func TestUniquePreferredLanguagesIsBounded(t *testing.T) {
	values := make([]string, 0, 32)
	for index := 0; index < 32; index++ {
		values = append(values, "en-"+string(rune('A'+index/26))+string(rune('A'+index%26)))
	}
	if actual := uniquePreferredLanguages(values...); len(actual) != maxPreferredLanguages {
		t.Fatalf("got %d languages, want %d", len(actual), maxPreferredLanguages)
	}
}
