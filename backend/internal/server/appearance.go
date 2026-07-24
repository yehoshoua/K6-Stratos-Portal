package server

import (
	"encoding/json"
	"net/http"
	"strings"
)

const (
	settingDefaultColorPalette = "default_color_palette"
	settingDefaultLanguage     = "default_language"
	settingDefaultTheme        = "default_theme"
	fallbackColorPalette       = "royal-vibrant"
	fallbackLanguage           = "en"
	fallbackTheme              = "light"
)

var allowedColorPalettes = map[string]bool{
	"royal-vibrant":  true,
	"golden-harvest": true,
	"cyber-neon":     true,
	"gradient-blues": true,
}

var allowedLanguages = map[string]bool{
	"en": true,
	"fr": true,
	"he": true,
	"zh": true,
	"es": true,
	"de": true,
}

var allowedThemes = map[string]bool{
	"light":  true,
	"dark":   true,
	"system": true,
}

func normalizeColorPalette(id string) string {
	id = strings.TrimSpace(id)
	if allowedColorPalettes[id] {
		return id
	}
	return fallbackColorPalette
}

func normalizeLanguage(id string) string {
	id = strings.TrimSpace(id)
	if allowedLanguages[id] {
		return id
	}
	return fallbackLanguage
}

func normalizeTheme(id string) string {
	id = strings.TrimSpace(id)
	if allowedThemes[id] {
		return id
	}
	return fallbackTheme
}

type appearanceSettingsResponse struct {
	DefaultColorPalette string `json:"default_color_palette"`
	DefaultLanguage     string `json:"default_language"`
	DefaultTheme        string `json:"default_theme"`
}

func (s *Server) loadAppearanceSettings() appearanceSettingsResponse {
	palette, _ := s.db.GetSetting(settingDefaultColorPalette)
	if palette == "" {
		palette = fallbackColorPalette
	}
	language, _ := s.db.GetSetting(settingDefaultLanguage)
	if language == "" {
		language = fallbackLanguage
	}
	theme, _ := s.db.GetSetting(settingDefaultTheme)
	if theme == "" {
		theme = fallbackTheme
	}
	return appearanceSettingsResponse{
		DefaultColorPalette: normalizeColorPalette(palette),
		DefaultLanguage:     normalizeLanguage(language),
		DefaultTheme:        normalizeTheme(theme),
	}
}

func (s *Server) handleGetAppearanceSettings(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	settings := s.loadAppearanceSettings()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (s *Server) handleSaveAppearanceSettings(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, `{"error":"database not initialized"}`, http.StatusInternalServerError)
		return
	}

	var body appearanceSettingsResponse
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	palette := normalizeColorPalette(body.DefaultColorPalette)
	language := normalizeLanguage(body.DefaultLanguage)
	theme := normalizeTheme(body.DefaultTheme)

	if err := s.db.UpsertSetting(settingDefaultColorPalette, palette); err != nil {
		http.Error(w, `{"error":"failed to save settings"}`, http.StatusInternalServerError)
		return
	}
	if err := s.db.UpsertSetting(settingDefaultLanguage, language); err != nil {
		http.Error(w, `{"error":"failed to save settings"}`, http.StatusInternalServerError)
		return
	}
	if err := s.db.UpsertSetting(settingDefaultTheme, theme); err != nil {
		http.Error(w, `{"error":"failed to save settings"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(appearanceSettingsResponse{
		DefaultColorPalette: palette,
		DefaultLanguage:     language,
		DefaultTheme:        theme,
	})
}
