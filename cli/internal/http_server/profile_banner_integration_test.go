package http_server

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/assets"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/testutil"
)

func profileBannerHTTPPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 900, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 900; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 150, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func setupProfileBannerHTTPServer(t *testing.T) (*httptest.Server, *http.Client, *core.ChattoCore, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	cookieSecret := "profile-banner-cookie-secret-32-bytes"
	store := cookie.NewStore([]byte(cookieSecret))
	store.Options(sessions.Options{MaxAge: 86400, HttpOnly: true, Secure: false, Path: "/"})
	router.Use(sessions.Sessions("chatto_session", store))

	_, nc := testutil.StartSharedNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	instance, err := core.NewChattoCore(ctx, nc, config.CoreConfig{})
	if err != nil {
		t.Fatal(err)
	}
	startCoreServices(t, instance)
	user, err := instance.CreateUser(ctx, "", "profile-banner-http", "Profile Banner HTTP", "password123")
	if err != nil {
		t.Fatal(err)
	}

	server := &HTTPServer{
		config: config.ChattoConfig{Webserver: config.WebserverConfig{URL: "http://localhost:4000", CookieSigningSecret: cookieSecret}},
		router: router,
		core:   instance,
	}
	router.Use(server.corsMiddleware(server.buildAllowedOrigins()))
	router.Use(server.csrfMiddleware())
	router.GET("/login-test", func(c *gin.Context) {
		if err := server.createCookieSession(c, user.Id, "profile_banner_test"); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		if err := server.ensureCSRFToken(c); err != nil {
			c.String(http.StatusInternalServerError, err.Error())
			return
		}
		c.String(http.StatusOK, "logged in")
	})
	server.setupProfileBannerRoutes()
	router.GET("/assets/server/*path", server.serveServerAsset)

	httpServer := httptest.NewServer(router)
	t.Cleanup(httpServer.Close)
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return httpServer, &http.Client{Jar: jar}, instance, user.Id
}

func profileBannerRequest(t *testing.T, client *http.Client, method, url string, body io.Reader, token string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "image/png")
	}
	if token != "" {
		request.Header.Set(csrfHeaderName, token)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestProfileBannerHTTPAuthorizationCSRFAndDelivery(t *testing.T) {
	server, client, _, userID := setupProfileBannerHTTPServer(t)

	response, err := http.Get(server.URL + profileBannerCapabilityPath)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated capability status = %d", response.StatusCode)
	}

	token := csrfCookieValue(t, client, server.URL)
	banner := profileBannerHTTPPNG(t)

	response = profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(banner), "")
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cookie upload without CSRF status = %d", response.StatusCode)
	}

	response = profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(banner), token)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("valid upload status = %d", response.StatusCode)
	}

	response = profileBannerRequest(t, client, http.MethodGet, server.URL+"/api/profile/banner/"+userID, nil, "")
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || len(body) == 0 {
		t.Fatalf("read status=%d bytes=%d", response.StatusCode, len(body))
	}
	if response.Header.Get("ETag") == "" || response.Header.Get("X-Content-Type-Options") != "nosniff" || response.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("unexpected protected headers: %#v", response.Header)
	}
	etag := response.Header.Get("ETag")

	head := profileBannerRequest(t, client, http.MethodHead, server.URL+"/api/profile/banner/"+userID, nil, "")
	headBody, _ := io.ReadAll(head.Body)
	head.Body.Close()
	if head.StatusCode != http.StatusOK || len(headBody) != 0 {
		t.Fatalf("HEAD status=%d bytes=%d", head.StatusCode, len(headBody))
	}

	conditional, err := http.NewRequest(http.MethodGet, server.URL+"/api/profile/banner/"+userID, nil)
	if err != nil {
		t.Fatal(err)
	}
	conditional.Header.Set("If-None-Match", etag)
	conditionalResponse, err := client.Do(conditional)
	if err != nil {
		t.Fatal(err)
	}
	conditionalResponse.Body.Close()
	if conditionalResponse.StatusCode != http.StatusNotModified {
		t.Fatalf("conditional status = %d", conditionalResponse.StatusCode)
	}

	publicResponse, err := http.Get(server.URL + "/assets/server/" + core.ProfileBannerAssetID(userID))
	if err != nil {
		t.Fatal(err)
	}
	publicResponse.Body.Close()
	if publicResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("generic public profile-banner route status = %d", publicResponse.StatusCode)
	}

	response = profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, "")
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cookie delete without CSRF status = %d", response.StatusCode)
	}
	response = profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, token)
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("valid delete status = %d", response.StatusCode)
	}
}

func TestProfileBannerHTTPRejectsForgedMalformedAndOversizedBodies(t *testing.T) {
	server, client, _, _ := setupProfileBannerHTTPServer(t)
	token := csrfCookieValue(t, client, server.URL)

	forged := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, strings.NewReader("<html>not an image</html>"), token)
	forged.Body.Close()
	if forged.StatusCode != http.StatusBadRequest {
		t.Fatalf("forged image status = %d", forged.StatusCode)
	}

	oversizedBody := bytes.NewReader(make([]byte, assets.MaxProfileBannerUploadSize+1))
	oversized := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, oversizedBody, token)
	oversized.Body.Close()
	if oversized.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized image status = %d", oversized.StatusCode)
	}
}

func TestProfileBannerCORSPreflightAllowsMutationMethods(t *testing.T) {
	server := setupCORSServer(t, config.WebserverConfig{
		URL:            "https://chat.example.com",
		AllowedOrigins: []string{"https://app.example.com"},
	})
	request := httptest.NewRequest(http.MethodOptions, profileBannerMutationPath, nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	request.Header.Set("Access-Control-Request-Headers", "authorization, content-type, x-csrf-token")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", response.Code)
	}
	methods := response.Header().Get("Access-Control-Allow-Methods")
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions} {
		if !strings.Contains(methods, method) {
			t.Fatalf("CORS methods %q missing %q", methods, method)
		}
	}
}
