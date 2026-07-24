package http_server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/pkg/signedurl"
)

const stableAttachmentPathPrefix = "/assets/files/"

// dmAssetAccessGuard revalidates participant-specific DM history cutoffs before
// stable attachment handlers can serve bytes or return an S3 redirect. This
// makes already-issued access tickets unusable as soon as their owning message
// falls behind the viewer's private deletion boundary.
func (s *HTTPServer) dmAssetAccessGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Next()
			return
		}
		assetID, transform, ok := stableAttachmentRequest(c.Request.URL.Path)
		if !ok {
			c.Next()
			return
		}
		roomID, ok := s.core.Assets.AssetRoomID(assetID)
		if !ok {
			c.Next()
			return
		}
		kind, err := s.core.FindRoomKind(c.Request.Context(), roomID)
		if err != nil {
			s.logger.Error("Failed to resolve room kind for DM attachment guard", "error", err, "room_id", roomID)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify access"})
			return
		}
		if kind != core.KindDM {
			c.Next()
			return
		}

		viewerID, ok := s.resolveStableAssetViewerID(c, assetID, transform)
		if !ok {
			c.Abort()
			return
		}
		accessible, err := s.core.CanAccessDMAsset(c.Request.Context(), viewerID, roomID, assetID)
		if err != nil {
			s.logger.Error("Failed to enforce DM attachment history cutoff", "error", err, "room_id", roomID)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify access"})
			return
		}
		if !accessible {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access denied"})
			return
		}
		c.Next()
	}
}

func stableAttachmentRequest(path string) (string, *signedurl.TransformParams, bool) {
	if !strings.HasPrefix(path, stableAttachmentPathPrefix) {
		return "", nil, false
	}
	parts := strings.Split(strings.TrimPrefix(path, stableAttachmentPathPrefix), "/")
	if len(parts) == 1 && parts[0] != "" {
		return parts[0], nil, true
	}
	if len(parts) != 4 || parts[0] == "" || parts[1] != "image" {
		return "", nil, false
	}
	params, err := parseStableTransformParams(parts[2], parts[3])
	if err != nil {
		return "", nil, false
	}
	return parts[0], params, true
}
