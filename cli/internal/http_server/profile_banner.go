package http_server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/assets"
	"hmans.de/chatto/internal/authctx"
	"hmans.de/chatto/internal/core"
)

const (
	profileBannerCapabilityPath = "/api/profile/banner/capability"
	profileBannerMutationPath   = "/api/profile/banner"
	profileBannerReadPath       = "/api/profile/banner/:userID"
	profileBannerReadTimeout    = 30 * time.Second
)

type profileBannerCapabilityResponse struct {
	Supported         bool  `json:"supported"`
	MaxUploadBytes    int64 `json:"maxUploadBytes"`
	RecommendedWidth  int   `json:"recommendedWidth"`
	RecommendedHeight int   `json:"recommendedHeight"`
	MinimumWidth      int   `json:"minimumWidth"`
	MinimumHeight     int   `json:"minimumHeight"`
}

type profileBannerErrorResponse struct {
	Code string `json:"code"`
}

func (s *HTTPServer) setupProfileBannerRoutes() {
	s.router.GET(profileBannerCapabilityPath, s.handleProfileBannerCapability)
	s.router.GET(profileBannerReadPath, s.handleProfileBannerRead)
	s.router.HEAD(profileBannerReadPath, s.handleProfileBannerRead)
	s.router.PUT(
		profileBannerMutationPath,
		limitRequestBody(assets.MaxProfileBannerUploadSize, profileBannerReadTimeout),
		s.handleProfileBannerUpload,
	)
	s.router.DELETE(profileBannerMutationPath, s.handleProfileBannerDelete)
}

func (s *HTTPServer) handleProfileBannerCapability(c *gin.Context) {
	setProfileBannerPrivateHeaders(c)
	if _, _, ok := s.profileBannerActor(c); !ok {
		return
	}
	c.JSON(http.StatusOK, profileBannerCapabilityResponse{
		Supported:         true,
		MaxUploadBytes:    assets.MaxProfileBannerUploadSize,
		RecommendedWidth:  assets.ProfileBannerWidth,
		RecommendedHeight: assets.ProfileBannerHeight,
		MinimumWidth:      assets.MinProfileBannerSourceWidth,
		MinimumHeight:     assets.MinProfileBannerSourceHeight,
	})
}

func (s *HTTPServer) handleProfileBannerUpload(c *gin.Context) {
	setProfileBannerPrivateHeaders(c)
	ctx, userID, ok := s.profileBannerActor(c)
	if !ok {
		return
	}

	operationCtx, cancel := context.WithTimeout(ctx, profileBannerReadTimeout)
	defer cancel()
	if _, err := s.core.ReplaceUserProfileBannerFromUpload(
		operationCtx,
		userID,
		c.Request.Body,
	); err != nil {
		s.writeProfileBannerFailure(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *HTTPServer) handleProfileBannerDelete(c *gin.Context) {
	setProfileBannerPrivateHeaders(c)
	ctx, userID, ok := s.profileBannerActor(c)
	if !ok {
		return
	}
	if err := s.core.DeleteUserProfileBanner(ctx, userID); err != nil {
		s.writeProfileBannerFailure(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *HTTPServer) handleProfileBannerRead(c *gin.Context) {
	setProfileBannerPrivateHeaders(c)
	ctx, _, ok := s.profileBannerActor(c)
	if !ok {
		return
	}

	assetID, err := s.core.UserProfileBannerAssetID(ctx, c.Param("userID"))
	if err != nil {
		s.writeProfileBannerFailure(c, err)
		return
	}

	reader, info, err := s.core.GetServerAssetFromAnyBackend(ctx, assetID)
	if err != nil {
		writeProfileBannerError(c, http.StatusNotFound, "not_found")
		return
	}
	if closer, ok := reader.(io.Closer); ok {
		defer closer.Close()
	}

	data, err := io.ReadAll(io.LimitReader(reader, assets.MaxProfileBannerProcessedSize+1))
	if err != nil {
		s.logger.Warn("Failed to read profile banner", "error", err, "user_id", c.Param("userID"))
		writeProfileBannerError(c, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	if int64(len(data)) > assets.MaxProfileBannerProcessedSize {
		s.logger.Warn("Stored profile banner exceeds its canonical bound", "user_id", c.Param("userID"))
		writeProfileBannerError(c, http.StatusInternalServerError, "invalid_stored_banner")
		return
	}

	contentType := info.ContentType
	if contentType != "image/jpeg" && contentType != "image/webp" {
		s.logger.Warn(
			"Stored profile banner has an invalid content type",
			"user_id", c.Param("userID"),
			"content_type", contentType,
		)
		writeProfileBannerError(c, http.StatusInternalServerError, "invalid_stored_banner")
		return
	}

	digest := sha256.Sum256(data)
	etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(digest[:]))
	c.Header("Cache-Control", "private, no-cache")
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.Itoa(len(data)))
	c.Header("ETag", etag)
	c.Header("Cross-Origin-Resource-Policy", "cross-origin")
	c.Header("X-Content-Type-Options", "nosniff")

	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	if c.Request.Method == http.MethodHead {
		c.Status(http.StatusOK)
		return
	}
	c.Data(http.StatusOK, contentType, data)
}

func (s *HTTPServer) profileBannerActor(c *gin.Context) (context.Context, string, bool) {
	if s.core == nil {
		writeProfileBannerError(c, http.StatusServiceUnavailable, "temporarily_unavailable")
		return c.Request.Context(), "", false
	}
	request := s.injectUserIntoContext(c)
	ctx := request.Context()
	if err := authenticationValidationError(ctx); err != nil {
		writeProfileBannerError(c, http.StatusServiceUnavailable, "authentication_unavailable")
		return ctx, "", false
	}
	user := authctx.ForContext(ctx)
	if user == nil || user.GetId() == "" {
		writeProfileBannerError(c, http.StatusUnauthorized, "authentication_required")
		return ctx, "", false
	}
	return ctx, user.GetId(), true
}

func (s *HTTPServer) writeProfileBannerFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, core.ErrNotAuthenticated):
		writeProfileBannerError(c, http.StatusUnauthorized, "authentication_required")
	case errors.Is(err, core.ErrPermissionDenied):
		writeProfileBannerError(c, http.StatusForbidden, "forbidden")
	case errors.Is(err, core.ErrNotFound):
		writeProfileBannerError(c, http.StatusNotFound, "not_found")
	case errors.Is(err, core.ErrInvalidArgument):
		writeProfileBannerError(c, http.StatusBadRequest, "invalid_image")
	case errors.Is(err, context.DeadlineExceeded):
		writeProfileBannerError(c, http.StatusGatewayTimeout, "timed_out")
	case errors.Is(err, context.Canceled):
		writeProfileBannerError(c, http.StatusServiceUnavailable, "interrupted")
	default:
		s.logger.Error("Profile banner operation failed", "error", err)
		writeProfileBannerError(c, http.StatusInternalServerError, "internal_error")
	}
}

func setProfileBannerPrivateHeaders(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Vary", "Authorization, Cookie")
	c.Header("X-Content-Type-Options", "nosniff")
}

func writeProfileBannerError(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, profileBannerErrorResponse{Code: code})
}
