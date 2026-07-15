package http_server

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/core"
)

const pushNotificationClosePath = "/api/push/notification-close"

type pushNotificationCloseRequest struct {
	Endpoint       string `json:"endpoint"`
	Auth           string `json:"auth"`
	NotificationID string `json:"notificationId"`
}

func (s *HTTPServer) setupPushNotificationRoutes() {
	s.router.POST(pushNotificationClosePath, limitLegacyRequestBody(), s.handlePushNotificationClose)
}

func (s *HTTPServer) handlePushNotificationClose(c *gin.Context) {
	c.Header("Cache-Control", cacheControlNoCache)

	if s.core == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"dismissed": false})
		return
	}

	var req pushNotificationCloseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"dismissed": false})
		return
	}

	dismissed, err := s.core.DismissNotificationFromPushSubscription(
		c.Request.Context(),
		req.Endpoint,
		req.Auth,
		req.NotificationID,
	)
	if err != nil {
		if errors.Is(err, core.ErrInvalidArgument) {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"dismissed": false})
			return
		}
		s.logger.Warn("Failed to dismiss notification from push subscription proof", "error", err)
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"dismissed": false})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{"dismissed": dismissed})
}
