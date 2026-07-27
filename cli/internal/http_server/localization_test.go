package http_server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLocaleCatalogParityAndFormatting(t *testing.T) {
	base := localeCatalogs["en"]
	verbs := regexp.MustCompile(`%(?:\[[0-9]+\])?[0-9.]*[sd]`)
	for _, locale := range supportedLocales {
		catalog := localeCatalogs[locale]
		if len(catalog) != len(base) {
			t.Fatalf("%s catalog has %d keys, want %d", locale, len(catalog), len(base))
		}
		for key, english := range base {
			localized, ok := catalog[key]
			if !ok || strings.TrimSpace(localized) == "" {
				t.Errorf("%s catalog missing %q", locale, key)
				continue
			}
			englishVerbs := verbs.FindAllString(english, -1)
			localizedVerbs := verbs.FindAllString(localized, -1)
			sort.Strings(englishVerbs)
			sort.Strings(localizedVerbs)
			if strings.Join(englishVerbs, ",") != strings.Join(localizedVerbs, ",") {
				t.Errorf("%s %s format verbs = %v, want %v", locale, key, localizedVerbs, englishVerbs)
			}
		}
	}
}

func TestRequestLocalePrecedenceAndFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name           string
		header         string
		query          string
		acceptLanguage string
		want           string
	}{
		{name: "application header", header: "fr-FR", query: "de", acceptLanguage: "es", want: "fr"},
		{name: "navigation query", query: "pt-BR", acceptLanguage: "de", want: "pt"},
		{name: "quality weighted browser header", acceptLanguage: "es-MX;q=0.7, de-DE;q=0.9, en;q=0.8", want: "de"},
		{name: "unsupported falls back", header: "ja", query: "ru", acceptLanguage: "zh-CN", want: "en"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			request := httptest.NewRequest(http.MethodGet, "/?locale="+tc.query, nil)
			request.Header.Set(towkLocaleHeader, tc.header)
			request.Header.Set("Accept-Language", tc.acceptLanguage)
			context.Request = request
			if got := requestLocale(context); got != tc.want {
				t.Fatalf("requestLocale() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLocalizedResponseHeadersPreserveExistingVary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	context.Request.Header.Set(towkLocaleHeader, "fr")
	context.Header("Vary", "Origin")

	writeLocalizedError(context, http.StatusUnauthorized, "auth.authentication_required")

	if got := recorder.Header().Get("Content-Language"); got != "fr" {
		t.Fatalf("Content-Language = %q, want fr", got)
	}
	if got := recorder.Header().Get("Vary"); got != "Origin, X-Towk-Locale, Accept-Language" {
		t.Fatalf("Vary = %q", got)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "Authentification requise") {
		t.Fatalf("body = %s", body)
	}
}
