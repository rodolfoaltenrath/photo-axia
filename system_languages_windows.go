package main

import "golang.org/x/sys/windows"

func platformPreferredLanguages() []string {
	languages, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil {
		return nil
	}
	return languages
}
