package http_server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/authctx"
	"hmans.de/chatto/internal/core"
)

const (
	roomPurgeCapabilityPath             = "/api/admin/room-purge-capability"
	roomPurgePath                       = "/api/admin/rooms/:roomID/purge"
	roomPurgeBodyLimit                  = 4 * 1024
	roomPurgeBodyTimeout                = 10 * time.Second
	roomPurgeTimeout                    = 2 * time.Minute
	roomPurgeCleanupStartupTimeout      = 30 * time.Second
	roomPurgeCleanupRequestReadyTimeout = 10 * time.Second
	roomPurgeCleanupShutdownPoll        = 250 * time.Millisecond
)

type roomPurgeRequest struct {
	Confirmation string `json:"confirmation"`
}

type roomPurgeCapabilityResponse struct {
	CanPurgeArchivedRooms bool `json:"canPurgeArchivedRooms"`
}

type roomPurgeResponse struct {
	AlreadyPurged            bool `json:"alreadyPurged"`
	RoomEventsDeleted        int  `json:"roomEventsDeleted"`
	RBACEventsDeleted        int  `json:"rbacEventsDeleted"`
	AssetEventsDeleted       int  `json:"assetEventsDeleted"`
	AttachmentsDeleted       int  `json:"attachmentsDeleted"`
	LinkPreviewAssetsDeleted int  `json:"linkPreviewAssetsDeleted"`
}

type roomPurgeErrorResponse struct {
	Code string `json:"code"`
}

// roomPurgeRouteRuntime keeps the durable cleanup projector tied to this HTTP
// server instance without widening HTTPServer's public shape. The projector is
// started once during route setup, must catch up before the capability is
// advertised, and closes the shared NATS connection on a fatal runtime failure
// so a replica cannot continue serving with stale purged-room projections.
type roomPurgeRouteRuntime struct {
	cancel context.CancelFunc

	mu      sync.RWMutex
	service *core.RoomPurgeCleanupService
	ready   bool
	err     error
	done    chan struct{}
	doneOne sync.Once
}

func newRoomPurgeRouteRuntime() *roomPurgeRouteRuntime {
	return &roomPurgeRouteRuntime{done: make(chan struct{})}
}

func (r *roomPurgeRouteRuntime) signalStateChange() {
	if r == nil {
		return
	}
	r.doneOne.Do(func() { close(r.done) })
}

func (r *roomPurgeRouteRuntime) setReady(service *core.RoomPurgeCleanupService) {
	if r == nil || service == nil {
		return
	}
	r.mu.Lock()
	if r.err == nil {
		r.service = service
		r.ready = true
	}
	r.mu.Unlock()
	r.signalStateChange()
}

func (r *roomPurgeRouteRuntime) setError(err error) {
	if r == nil || err == nil {
		return
	}
	r.mu.Lock()
	if r.err == nil {
		r.err = err
	}
	r.mu.Unlock()
	r.signalStateChange()
}

func (r *roomPurgeRouteRuntime) healthy(ctx context.Context) error {
	if r == nil {
		return errors.New("room purge cleanup service unavailable")
	}
	for {
		r.mu.RLock()
		service := r.service
		ready := r.ready
		err := r.err
		done := r.done
		r.mu.RUnlock()

		if err != nil {
			return err
		}
		if ready && service != nil {
			return service.Healthy()
		}
		select {
		case <-done:
			continue
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (s *HTTPServer) setupRoomPurgeRoutes() {
	runtime := s.startRoomPurgeCleanupRuntime()
	s.router.GET(roomPurgeCapabilityPath, func(c *gin.Context) {
		s.handleRoomPurgeCapability(c, runtime)
	})
	s.router.POST(
		roomPurgePath,
		limitRequestBody(roomPurgeBodyLimit, roomPurgeBodyTimeout),
		func(c *gin.Context) { s.handleRoomPurge(c, runtime) },
	)
}

func (s *HTTPServer) startRoomPurgeCleanupRuntime() *roomPurgeRouteRuntime {
	runtime := newRoomPurgeRouteRuntime()
	if s.core == nil {
		runtime.setError(errors.New("room purge core unavailable"))
		return runtime
	}

	runCtx, cancel := context.WithCancel(context.Background())
	runtime.cancel = cancel

	// NewHTTPServer is commonly constructed before ChattoCore.Run starts. Do
	// not block route registration on projection boot: every replica starts this
	// durable cleanup consumer as soon as the core reports boot completion.
	go s.runRoomPurgeCleanupRuntime(runCtx, runtime)

	// HTTPServer.Run and ChattoCore.Run share the same NATS connection. Polling
	// its terminal state gives this auxiliary projector a deterministic shutdown
	// without adding a second process lifecycle or a global registry.
	if s.nc != nil {
		go func() {
			ticker := time.NewTicker(roomPurgeCleanupShutdownPoll)
			defer ticker.Stop()
			for {
				select {
				case <-runCtx.Done():
					return
				case <-ticker.C:
					if s.nc.IsClosed() {
						cancel()
						return
					}
				}
			}
		}()
	}
	return runtime
}

func (s *HTTPServer) runRoomPurgeCleanupRuntime(
	runCtx context.Context,
	runtime *roomPurgeRouteRuntime,
) {
	if err := s.core.WaitForBoot(runCtx); err != nil {
		if !errors.Is(err, context.Canceled) {
			runtime.setError(fmt.Errorf("wait for core boot: %w", err))
		}
		return
	}

	service, err := s.core.NewRoomPurgeCleanupService()
	if err != nil {
		runtime.setError(err)
		if runtime.cancel != nil {
			runtime.cancel()
		}
		return
	}
	runResult := make(chan error, 1)
	go func() { runResult <- service.Run(runCtx) }()

	startupCtx, startupCancel := context.WithTimeout(runCtx, roomPurgeCleanupStartupTimeout)
	err = service.WaitForCurrent(startupCtx)
	startupCancel()
	if err != nil {
		runtime.setError(err)
		if runtime.cancel != nil {
			runtime.cancel()
		}
		return
	}
	runtime.setReady(service)

	runErr := <-runResult
	if runErr == nil || errors.Is(runErr, context.Canceled) {
		return
	}
	runtime.setError(runErr)
	s.logger.Error("Room purge cleanup projector failed", "error", runErr)
	if s.nc != nil && !s.nc.IsClosed() {
		s.nc.Close()
	}
}

func (s *HTTPServer) roomPurgeRuntimeHealthy(
	ctx context.Context,
	runtime *roomPurgeRouteRuntime,
) error {
	readyCtx, cancel := context.WithTimeout(ctx, roomPurgeCleanupRequestReadyTimeout)
	defer cancel()
	return runtime.healthy(readyCtx)
}

func (s *HTTPServer) handleRoomPurgeCapability(c *gin.Context, runtime *roomPurgeRouteRuntime) {
	setRoomPurgeResponseHeaders(c)
	ctx, userID, ok := s.roomPurgeActor(c)
	if !ok {
		return
	}
	if err := s.roomPurgeRuntimeHealthy(ctx, runtime); err != nil {
		s.logger.Warn("Room purge cleanup service unavailable", "error", err)
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	canPurge, err := s.core.IsServerOwner(ctx, userID)
	if err != nil {
		s.logger.Warn("Failed to resolve room purge capability", "error", err)
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "authentication_unavailable")
		return
	}
	c.JSON(http.StatusOK, roomPurgeCapabilityResponse{CanPurgeArchivedRooms: canPurge})
}

func (s *HTTPServer) handleRoomPurge(c *gin.Context, runtime *roomPurgeRouteRuntime) {
	setRoomPurgeResponseHeaders(c)
	ctx, userID, ok := s.roomPurgeActor(c)
	if !ok {
		return
	}
	if err := s.roomPurgeRuntimeHealthy(ctx, runtime); err != nil {
		s.logger.Warn("Room purge cleanup service unavailable", "error", err)
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}

	var request roomPurgeRequest
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeRoomPurgeError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeRoomPurgeError(c, http.StatusBadRequest, "invalid_request")
		return
	}

	operationCtx, cancel := context.WithTimeout(ctx, roomPurgeTimeout)
	defer cancel()
	result, err := s.core.PurgeArchivedRoom(
		operationCtx,
		userID,
		c.Param("roomID"),
		request.Confirmation,
	)
	if err != nil {
		s.writeRoomPurgeFailure(c, c.Param("roomID"), err)
		return
	}
	c.JSON(http.StatusOK, roomPurgeResponse{
		AlreadyPurged:            result.AlreadyPurged,
		RoomEventsDeleted:        result.RoomEventsDeleted,
		RBACEventsDeleted:        result.RBACEventsDeleted,
		AssetEventsDeleted:       result.AssetEventsDeleted,
		AttachmentsDeleted:       result.AttachmentsDeleted,
		LinkPreviewAssetsDeleted: result.LinkPreviewAssetsDeleted,
	})
}

func (s *HTTPServer) roomPurgeActor(c *gin.Context) (context.Context, string, bool) {
	if s.core == nil {
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "temporarily_unavailable")
		return c.Request.Context(), "", false
	}
	request := s.injectUserIntoContext(c)
	ctx := request.Context()
	if err := authenticationValidationError(ctx); err != nil {
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "authentication_unavailable")
		return ctx, "", false
	}
	user := authctx.ForContext(ctx)
	if user == nil || user.GetId() == "" {
		writeRoomPurgeError(c, http.StatusUnauthorized, "authentication_required")
		return ctx, "", false
	}
	return ctx, user.GetId(), true
}

func (s *HTTPServer) writeRoomPurgeFailure(c *gin.Context, roomID string, err error) {
	switch {
	case errors.Is(err, core.ErrNotAuthenticated):
		writeRoomPurgeError(c, http.StatusUnauthorized, "authentication_required")
	case errors.Is(err, core.ErrPermissionDenied):
		writeRoomPurgeError(c, http.StatusForbidden, "forbidden")
	case errors.Is(err, core.ErrRoomPurgeInvalidRoomID):
		writeRoomPurgeError(c, http.StatusBadRequest, "invalid_room_id")
	case errors.Is(err, core.ErrRoomPurgeConfirmationMismatch):
		writeRoomPurgeError(c, http.StatusBadRequest, "confirmation_mismatch")
	case errors.Is(err, core.ErrRoomPurgeNotArchived):
		writeRoomPurgeError(c, http.StatusConflict, "room_not_archived")
	case errors.Is(err, core.ErrRoomPurgeInProgress):
		c.Header("Retry-After", "2")
		writeRoomPurgeError(c, http.StatusConflict, "purge_in_progress")
	case errors.Is(err, core.ErrRoomPurgeNotQuiescent):
		c.Header("Retry-After", "2")
		writeRoomPurgeError(c, http.StatusConflict, "purge_not_quiescent")
	case errors.Is(err, core.ErrInvalidArgument):
		writeRoomPurgeError(c, http.StatusBadRequest, "invalid_request")
	case errors.Is(err, jetstream.ErrKeyNotFound):
		writeRoomPurgeError(c, http.StatusNotFound, "room_not_found")
	case errors.Is(err, context.DeadlineExceeded):
		writeRoomPurgeError(c, http.StatusGatewayTimeout, "timed_out")
	case errors.Is(err, context.Canceled):
		writeRoomPurgeError(c, http.StatusServiceUnavailable, "interrupted")
	default:
		s.logger.Error("Permanent room purge failed", "room_id", roomID, "error", err)
		writeRoomPurgeError(c, http.StatusInternalServerError, "internal_error")
	}
}

func setRoomPurgeResponseHeaders(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Vary", "Authorization, Cookie")
	c.Header("X-Content-Type-Options", "nosniff")
}

func writeRoomPurgeError(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, roomPurgeErrorResponse{Code: code})
}
