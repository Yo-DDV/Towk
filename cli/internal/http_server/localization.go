package http_server

import (
	"embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const towkLocaleHeader = "X-Towk-Locale"

var supportedLocales = [...]string{"en", "de", "fr", "es", "pt"}

//go:embed locales/*.json
var localeCatalogFS embed.FS

var localeCatalogs = mustLoadLocaleCatalogs()

func mustLoadLocaleCatalogs() map[string]map[string]string {
	catalogs := make(map[string]map[string]string, len(supportedLocales))
	var baseKeys map[string]struct{}
	for _, locale := range supportedLocales {
		contents, err := localeCatalogFS.ReadFile("locales/" + locale + ".json")
		if err != nil {
			panic(fmt.Sprintf("read %s public localization catalog: %v", locale, err))
		}
		catalog := make(map[string]string)
		if err := json.Unmarshal(contents, &catalog); err != nil {
			panic(fmt.Sprintf("parse %s public localization catalog: %v", locale, err))
		}
		if locale == "en" {
			baseKeys = make(map[string]struct{}, len(catalog))
			for key, value := range catalog {
				if strings.TrimSpace(value) == "" {
					panic(fmt.Sprintf("empty English public localization value for %s", key))
				}
				baseKeys[key] = struct{}{}
			}
		} else {
			if len(catalog) != len(baseKeys) {
				panic(fmt.Sprintf("%s public localization key count differs from English", locale))
			}
			for key := range baseKeys {
				if strings.TrimSpace(catalog[key]) == "" {
					panic(fmt.Sprintf("missing %s public localization value for %s", locale, key))
				}
			}
		}
		catalogs[locale] = catalog
	}
	return catalogs
}

func normalizeSupportedLocale(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return "", false
	}
	if separator := strings.IndexAny(value, ",;"); separator >= 0 {
		value = value[:separator]
	}
	value = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "_", "-"))
	if separator := strings.IndexByte(value, '-'); separator >= 0 {
		value = value[:separator]
	}
	for _, supported := range supportedLocales {
		if value == supported {
			return supported, true
		}
	}
	return "", false
}

func preferredAcceptLanguage(value string) (string, bool) {
	bestLocale := ""
	bestQuality := -1.0
	for _, entry := range strings.Split(value, ",") {
		parts := strings.Split(entry, ";")
		locale, ok := normalizeSupportedLocale(parts[0])
		if !ok {
			continue
		}
		quality := 1.0
		for _, parameter := range parts[1:] {
			name, rawValue, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(name), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(rawValue), 64)
			if err != nil || parsed < 0 || parsed > 1 {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if quality > bestQuality {
			bestLocale = locale
			bestQuality = quality
		}
	}
	return bestLocale, bestLocale != "" && bestQuality > 0
}

func requestLocale(c *gin.Context) string {
	if locale, ok := normalizeSupportedLocale(c.GetHeader(towkLocaleHeader)); ok {
		return locale
	}
	// OAuth authorization requests are full-page navigations and cannot attach
	// the application-specific header. A bounded query parameter carries the
	// explicitly selected Towk locale through that redirect.
	if locale, ok := normalizeSupportedLocale(c.Query("locale")); ok {
		return locale
	}
	if locale, ok := preferredAcceptLanguage(c.GetHeader("Accept-Language")); ok {
		return locale
	}
	return "en"
}

func appendVary(c *gin.Context, values ...string) {
	existing := c.Writer.Header().Values("Vary")
	seen := make(map[string]struct{})
	ordered := make([]string, 0, len(existing)+len(values))
	for _, header := range existing {
		for _, value := range strings.Split(header, ",") {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			lower := strings.ToLower(value)
			if _, ok := seen[lower]; ok {
				continue
			}
			seen[lower] = struct{}{}
			ordered = append(ordered, value)
		}
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		lower := strings.ToLower(value)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		ordered = append(ordered, value)
	}
	if len(ordered) > 0 {
		c.Header("Vary", strings.Join(ordered, ", "))
	}
}

func setLocalizedResponseHeaders(c *gin.Context, locale string) {
	c.Header("Content-Language", locale)
	appendVary(c, towkLocaleHeader, "Accept-Language")
}

func localizedTextForLocale(locale, key string, args ...any) string {
	if normalized, ok := normalizeSupportedLocale(locale); ok {
		locale = normalized
	} else {
		locale = "en"
	}
	value, ok := localeCatalogs[locale][key]
	if !ok || value == "" {
		value = localeCatalogs["en"][key]
	}
	if value == "" {
		return key
	}
	if len(args) == 0 {
		return value
	}
	return fmt.Sprintf(value, args...)
}

func localizedText(c *gin.Context, key string, args ...any) string {
	locale := requestLocale(c)
	setLocalizedResponseHeaders(c, locale)
	return localizedTextForLocale(locale, key, args...)
}

func writeLocalizedError(c *gin.Context, status int, key string, args ...any) {
	c.JSON(status, gin.H{"error": localizedText(c, key, args...)})
}

func writeLocalizedMessage(c *gin.Context, status int, key string, args ...any) {
	c.JSON(status, gin.H{"message": localizedText(c, key, args...)})
}

func writeLocalizedOAuthError(c *gin.Context, status int, code, descriptionKey string, args ...any) {
	c.JSON(status, gin.H{
		"error":             code,
		"error_description": localizedText(c, descriptionKey, args...),
	})
}

func localizedDuration(locale string, value int, singularKey, pluralKey string) string {
	if value == 1 {
		return localizedTextForLocale(locale, singularKey)
	}
	return localizedTextForLocale(locale, pluralKey, value)
}
