package cmd

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/spf13/cobra"
	"golang.org/x/sync/errgroup"
	"golang.org/x/term"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/embedded_nats"
	"hmans.de/chatto/internal/exporter"
	"hmans.de/chatto/internal/http_server"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/push"
	"hmans.de/chatto/internal/runtimeunit"
	"hmans.de/chatto/internal/video"
)

// devStartupHook is called after core is initialized. Set by build-tagged init().
// Receives the loaded config so dev-only setup paths can read sections like
// `[bootstrap]` without a separate env-var or sidecar file. In bootstrap-tag
// builds this applies the [bootstrap] section from chatto.toml; in release
// builds this is a no-op.
var devStartupHook func(ctx context.Context, core *core.ChattoCore, cfg config.ChattoConfig)

func init() {
	gin.SetMode(gin.ReleaseMode)
}

var banner = `
  _______        __
 /_  __/ |      / /__
  / /  | | /| / / _ \
 / /   | |/ |/ /  __/
/_/    |__/|__/\___/   TOWK
`

var configFile string

var runCmd = &cobra.Command{
	Use:     "run",
	Aliases: []string{"start"},
	Short:   "Runs the Towk server",
	Run: func(cmd *cobra.Command, args []string) {
		runServer(configFile)
	},
}

func init() {
	rootCmd.AddCommand(runCmd)
	runCmd.Flags().StringVarP(&configFile, "config", "c", "", configFlagHelp)
}

func runServer(configPath string) {
	cfg, err := config.ReadConfig(configPath)
	if err != nil {
		log.Fatal("Failed to read configuration", "error", err)
	}

	configureLogging(cfg.General)
	if shouldPrintBanner(cfg.General.LogFormat, isLogOutputTerminal()) {
		printBanner()
	}

	stopStartupCPUProfile := startStartupCPUProfile(cfg.Diagnostics.StartupCPUProfile)
	startupCPUProfileStopped := false
	defer func() {
		if !startupCPUProfileStopped {
			stopStartupCPUProfile()
		}
	}()

	exitCode := 0
	defer func() {
		if exitCode != 0 {
			os.Exit(exitCode)
		}
	}()

	// Conductor stops foreground run scripts with SIGHUP before escalating.
	// Towk has no reload-on-HUP behavior, so treat it as graceful shutdown
	// alongside the usual terminal and supervisor stop signals.
	shutdownSignals := runtimeunit.ShutdownSignals()
	signalLog := make(chan os.Signal, 1)
	stopSignalLog := make(chan struct{})
	signal.Notify(signalLog, shutdownSignals...)
	defer func() {
		signal.Stop(signalLog)
		close(stopSignalLog)
	}()
	go func() {
		select {
		case sig := <-signalLog:
			log.Info("Received shutdown signal", "signal", sig.String())
		case <-stopSignalLog:
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), shutdownSignals...)
	defer stop()

	// Use errgroup to coordinate services
	g, ctx := errgroup.WithContext(ctx)

	// Start embedded NATS if enabled (must be ready before other services)
	var embeddedNATS *server.Server
	if cfg.NATS.Embedded.Enabled {
		var err error
		embeddedNATS, err = embedded_nats.StartServer(&cfg.NATS.Embedded)
		if err != nil {
			log.Fatal("Failed to start embedded NATS server", "error", err)
		}
		defer embedded_nats.ShutdownServer(embeddedNATS)
	}

	// Connect to NATS
	nc, err := runtimeunit.ConnectToNATS(ctx, cfg, embeddedNATS)
	if err != nil {
		log.Error("Failed to connect to NATS", "error", err)
		exitCode = 1
		return
	}
	defer runtimeunit.CloseNATSConnection(nc)

	// Create Towk core
	cfg.Core.AuthTokenTTL = cfg.Auth.TokenTTLOrDefault()
	cfg.Core.AuthTokenAbsoluteTTL = cfg.Auth.TokenAbsoluteTTLOrDefault()
	cfg.Core.EmailOTP = cfg.Auth.EmailOTP
	cfg.Core.AuthRateLimit = cfg.Auth.RateLimit
	cfg.Core.Replicas = cfg.NATS.ReplicasOrDefault()
	cfg.Core.Limits = cfg.Limits
	cfg.Core.Owners = cfg.Owners
	chattoCore, err := core.NewChattoCore(ctx, nc, cfg.Core)
	if err != nil {
		log.Error("Failed to create Towk core", "error", err)
		exitCode = 1
		return
	}
	chattoCore.ConfigurePerformance(performanceConfigWithLegacyVideoCap(cfg.Performance, cfg.Video))

	// Set asset base URL for absolute asset URLs (required for cross-origin clients)
	if cfg.Webserver.URL != "" {
		if parsed, err := url.Parse(cfg.Webserver.URL); err == nil {
			chattoCore.AssetBaseURL = parsed.Scheme + "://" + parsed.Host
		}
	}

	// Set the video-specific upload limit when video processing is enabled.
	// Otherwise, original videos use the general attachment limit.
	if cfg.Video.Enabled {
		chattoCore.VideoMaxUploadSize = int64(cfg.Video.MaxUploadSizeOrDefault())
	}

	if err := chattoCore.EnableLiveKitCallReconciliation(cfg.LiveKit); err != nil {
		log.Error("Failed to configure LiveKit call-state reconciliation", "error", err)
		exitCode = 1
		return
	}

	// Set up push notification callback if push is enabled
	setupPushNotifications(chattoCore, cfg)

	// Start core's background services (PresenceHub + projectors) BEFORE
	// bootstrap. Bootstrap triggers JoinRoom, which calls WaitForSeq on
	// the room-membership projector — if it's not running yet, the wait
	// blocks until the bootstrap context cancels.
	g.Go(func() error {
		return chattoCore.Run(ctx)
	})

	// Block until core.Run has finished its boot phase (projectors
	// started + ensureChannelRoomsAreInAGroup done). SeedDefaultRooms
	// issues CreateRoom calls whose default-group lookup hits the
	// RoomGroups projection — without this wait, the projection is
	// still empty and the seeded rooms land without a group.
	if err := chattoCore.WaitForBoot(ctx); err != nil {
		if ctx.Err() != nil {
			return
		}
		log.Error("Core boot never completed", "error", err)
		exitCode = 1
		return
	}
	stopStartupCPUProfile()
	startupCPUProfileStopped = true

	// Seed `announcements` + `general` on first boot of a fresh server.
	// Idempotent — no-op once any channel room exists.
	if err := chattoCore.SeedDefaultRooms(ctx); err != nil {
		if ctx.Err() != nil {
			return
		}
		log.Error("Failed to seed default rooms", "error", err)
		exitCode = 1
		return
	}

	// Run dev startup hook (auto-bootstrap in dev builds, no-op in prod)
	devStartupHook(ctx, chattoCore, cfg)

	if cfg.Exporter.Enabled {
		env, err := runtimeunit.NewEnv(ctx, cfg, nc, log.WithPrefix("exporter"), Version)
		if err != nil {
			log.Error("Failed to create exporter environment", "error", err)
			exitCode = 1
			return
		}
		g.Go(func() error {
			return runtimeunit.Run(ctx, env, exporter.Unit{})
		})
	}

	// Start video processing service if enabled before the HTTP server begins
	// accepting uploads. The service registers a process-local callback on
	// core, so no transient NATS worker subject is involved.
	if cfg.Video.Enabled {
		videoSvc, err := video.NewService(chattoCore, cfg.Video, log.WithPrefix("video"))
		if err != nil {
			log.Error("ffmpeg not found — video processing disabled", "error", err)
			log.Error("Install ffmpeg: brew install ffmpeg (macOS) or apk add ffmpeg (Alpine)")
		} else {
			g.Go(func() error {
				return videoSvc.Run(ctx)
			})
		}
	}

	// Create and run HTTP server
	addr := fmt.Sprintf(":%d", cfg.Webserver.EffectivePort())
	httpServer, err := http_server.NewHTTPServer(http_server.HTTPServerConfig{
		Config:  cfg,
		NC:      nc,
		Core:    chattoCore,
		Addr:    addr,
		Version: Version,
	})
	if err != nil {
		log.Error("Failed to create HTTP server", "error", err)
		exitCode = 1
		return
	}
	g.Go(func() error {
		return httpServer.Run(ctx)
	})

	// Wait for all services to complete (or one to fail)
	if err := g.Wait(); err != nil && err != context.Canceled {
		log.Error("Server failed", "error", err)
		exitCode = 1
	}
}

func performanceConfigWithLegacyVideoCap(performance config.PerformanceConfig, video config.VideoConfig) config.PerformanceConfig {
	if video.MaxConcurrent > 0 && video.MaxConcurrent <= config.MaxPerformanceWorkers &&
		(performance.MaxVideoWorkers == 0 || video.MaxConcurrent < performance.MaxVideoWorkers) {
		// Preserve the historical video.max_concurrent operator ceiling while
		// performance profiles become the canonical runtime policy.
		performance.MaxVideoWorkers = video.MaxConcurrent
	}
	return performance
}

func printBanner() {
	for line := range strings.SplitSeq(banner, "\n") {
		log.Info(line)
	}
}

func configureLogging(cfg config.GeneralConfig) {
	setLogFormat(cfg.LogFormat, isLogOutputTerminal())
	setLogLevel(cfg.LogLevel)
}

func setLogFormat(format string, outputIsTerminal bool) {
	switch effectiveLogFormat(format, outputIsTerminal) {
	case "json":
		log.SetFormatter(log.JSONFormatter)
	case "logfmt":
		log.SetFormatter(log.LogfmtFormatter)
	default:
		log.SetFormatter(log.TextFormatter)
	}
}

func effectiveLogFormat(format string, outputIsTerminal bool) string {
	switch strings.ToLower(format) {
	case "", "auto":
		if outputIsTerminal {
			return "text"
		}
		return "json"
	case "json", "logfmt", "text":
		return strings.ToLower(format)
	default:
		return "text"
	}
}

func shouldPrintBanner(format string, outputIsTerminal bool) bool {
	return effectiveLogFormat(format, outputIsTerminal) == "text"
}

func isLogOutputTerminal() bool {
	return term.IsTerminal(int(os.Stderr.Fd()))
}

func setLogLevel(level string) {
	switch strings.ToLower(level) {
	case "debug":
		log.SetLevel(log.DebugLevel)
	case "info":
		log.SetLevel(log.InfoLevel)
	case "warn":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	default:
		log.Warn("Unknown log level in configuration, defaulting to 'info'", "log_level", level)
		log.SetLevel(log.InfoLevel)
	}
}

// setupPushNotifications configures the push notification callback if push is enabled.
func setupPushNotifications(chattoCore *core.ChattoCore, cfg config.ChattoConfig) {
	if !cfg.Push.IsConfigured() {
		return
	}

	logger := log.WithPrefix("push")
	sender := push.NewSender(cfg.Push, logger)
	if sender == nil {
		return
	}

	logger.Info("Push notifications enabled")

	// Set the callback that will be invoked when notifications are created
	chattoCore.OnNotificationCreated = func(ctx context.Context, notification *corev1.Notification) {
		// Get user's push subscriptions
		subscriptions, err := chattoCore.GetUserPushSubscriptions(ctx, notification.RecipientId)
		if err != nil {
			logger.Warn("Failed to get push subscriptions",
				"user_id", notification.RecipientId,
				"error", err)
			return
		}

		if len(subscriptions) == 0 {
			return
		}

		// Get the actor's display name. Keep an explicit presence bit so the
		// browser can localize the unknown-caller fallback for call pushes.
		actorName := ""
		actorKnown := false
		if notification.ActorId != "" {
			actor, err := chattoCore.GetUser(ctx, notification.ActorId)
			if err == nil && actor != nil {
				actorKnown = true
				actorName = actor.DisplayName
				if actorName == "" {
					actorName = actor.Login
				}
			}
		}

		// Build payload context with message preview and room name
		payloadCtx := fetchPayloadContext(ctx, chattoCore, notification, logger)
		if payloadCtx == nil {
			payloadCtx = &push.PayloadContext{}
		}
		payloadCtx.ActorKnown = actorKnown

		appBadge := ""
		if pushNotificationUsesCountBadge(notification) {
			if count, err := chattoCore.GetNotificationCount(ctx, notification.RecipientId); err == nil {
				appBadge = strconv.Itoa(count)
			} else {
				logger.Warn("Failed to get notification count for push app badge",
					"user_id", notification.RecipientId,
					"error", err)
			}
		}

		// Creation and dismissal events run asynchronously. A dismissal can
		// overtake this callback, so fail closed if the notification is no longer
		// pending immediately before delivery.
		pending, err := chattoCore.GetNotification(ctx, notification.RecipientId, notification.Id)
		if err != nil {
			logger.Warn("Failed to revalidate notification before push delivery",
				"user_id", notification.RecipientId,
				"notification_id", notification.Id,
				"error", err)
			return
		}
		if pending == nil {
			logger.Debug("Skipped stale push for dismissed notification",
				"user_id", notification.RecipientId,
				"notification_id", notification.Id)
			return
		}

		subscriptions = filterOwnedPushSubscriptions(ctx, chattoCore, notification.RecipientId, subscriptions, logger)
		subscriptions = push.FilterSubscriptionsByCanonicalOrigin(subscriptions, cfg.Webserver.URL)
		subscriptions = dedupePushSubscriptionsByClientID(subscriptions)
		if len(subscriptions) == 0 {
			return
		}
		batches := localizedPushBatches(
			subscriptions,
			notification,
			actorName,
			cfg.Webserver.URL,
			payloadCtx,
			appBadge,
		)
		resultBatches := make(chan []*push.SendResult, len(batches))
		for _, batch := range batches {
			go func(batch localizedPushBatch) {
				resultBatches <- sender.SendToMany(ctx, batch.subscriptions, batch.payload)
			}(batch)
		}
		results := make([]*push.SendResult, 0, len(subscriptions))
		for range batches {
			results = append(results, (<-resultBatches)...)
		}

		// Process results - clean up expired subscriptions
		for _, result := range results {
			if result.Gone {
				// Subscription is no longer valid, delete it
				if err := chattoCore.DeletePushSubscription(ctx, notification.RecipientId, result.Endpoint); err != nil {
					logger.Warn("Failed to delete expired push subscription",
						"endpoint_id", push.EndpointLogID(result.Endpoint),
						"error", err)
				} else {
					logger.Debug("Deleted expired push subscription",
						"endpoint_id", push.EndpointLogID(result.Endpoint))
				}
			} else if result.Error != nil {
				logger.Warn("Failed to send push notification",
					"endpoint_id", push.EndpointLogID(result.Endpoint),
					"error", result.Error)
			} else if result.Success {
				logger.Debug("Push notification sent",
					"user_id", notification.RecipientId,
					"notification_id", notification.Id)
			}
		}
	}

	// Do not send data-only Web Push messages for dismissals. Browser push
	// subscriptions are userVisibleOnly; a worker that closes a notification
	// without showing one can make Chromium surface a generic background-update
	// notification. Online clients receive the dismissal over realtime and close
	// the matching native notification through their service worker.
}

type localizedPushBatch struct {
	subscriptions []*corev1.PushSubscription
	payload       *push.Payload
}

func localizedPushBatches(
	subscriptions []*corev1.PushSubscription,
	notification *corev1.Notification,
	actorName, baseURL string,
	payloadCtx *push.PayloadContext,
	appBadge string,
) []localizedPushBatch {
	grouped := make(map[string][]*corev1.PushSubscription, 5)
	for _, subscription := range subscriptions {
		locale := push.NormalizeLocale(subscription.GetLocale())
		grouped[locale] = append(grouped[locale], subscription)
	}

	batches := make([]localizedPushBatch, 0, len(grouped))
	for _, locale := range []string{"en", "de", "fr", "es", "pt"} {
		localeSubscriptions := grouped[locale]
		if len(localeSubscriptions) == 0 {
			continue
		}
		payload := push.BuildLocalizedPayloadFromNotification(
			notification,
			actorName,
			baseURL,
			payloadCtx,
			locale,
		)
		payload.AppBadge = appBadge
		batches = append(batches, localizedPushBatch{
			subscriptions: localeSubscriptions,
			payload:       payload,
		})
	}
	return batches
}

func filterOwnedPushSubscriptions(
	ctx context.Context,
	chattoCore *core.ChattoCore,
	userID string,
	subscriptions []*corev1.PushSubscription,
	logger *log.Logger,
) []*corev1.PushSubscription {
	owned := make([]*corev1.PushSubscription, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		isOwned, err := chattoCore.PushSubscriptionCurrentForUser(ctx, userID, subscription)
		if err != nil {
			logger.Warn("Failed to revalidate push endpoint ownership",
				"user_id", userID,
				"endpoint_id", push.EndpointLogID(subscription.Endpoint),
				"error", err)
			continue
		}
		if isOwned {
			owned = append(owned, subscription)
		}
	}
	return owned
}

func dedupePushSubscriptionsByClientID(subscriptions []*corev1.PushSubscription) []*corev1.PushSubscription {
	if len(subscriptions) < 2 {
		return subscriptions
	}

	result := make([]*corev1.PushSubscription, 0, len(subscriptions))
	resultIndexByClientID := make(map[string]int, len(subscriptions))
	for _, subscription := range subscriptions {
		clientID := subscription.GetClientId()
		if clientID == "" {
			result = append(result, subscription)
			continue
		}

		existingIndex, exists := resultIndexByClientID[clientID]
		if !exists {
			resultIndexByClientID[clientID] = len(result)
			result = append(result, subscription)
			continue
		}
		if pushSubscriptionNewer(subscription, result[existingIndex]) {
			result[existingIndex] = subscription
		}
	}
	return result
}

func pushSubscriptionNewer(candidate, current *corev1.PushSubscription) bool {
	candidateCreatedAt := candidate.GetCreatedAt()
	currentCreatedAt := current.GetCreatedAt()
	if candidateCreatedAt == nil {
		return false
	}
	if currentCreatedAt == nil {
		return true
	}
	return candidateCreatedAt.AsTime().After(currentCreatedAt.AsTime())
}

// fetchPayloadContext builds the payload context with message preview and room name.
// This is best-effort - if fetching fails, returns nil and the notification will have a generic body.
func fetchPayloadContext(ctx context.Context, chattoCore *core.ChattoCore, notification *corev1.Notification, logger *log.Logger) *push.PayloadContext {
	var roomID, eventID string
	var kind core.RoomKind

	switch n := notification.Notification.(type) {
	case *corev1.Notification_DmMessage:
		kind = core.KindDM
		roomID = n.DmMessage.RoomId
		eventID = n.DmMessage.EventId
	case *corev1.Notification_Mention:
		roomID = n.Mention.RoomId
		eventID = n.Mention.EventId
	case *corev1.Notification_Reply:
		roomID = n.Reply.RoomId
		eventID = n.Reply.EventId
	case *corev1.Notification_RoomMessage:
		roomID = n.RoomMessage.RoomId
		eventID = n.RoomMessage.EventId
	case *corev1.Notification_CallStarted:
		roomID = n.CallStarted.RoomId
		room, err := chattoCore.FindRoomByID(ctx, roomID)
		if err != nil {
			logger.Debug("Failed to resolve room for call push notification",
				"room_id", roomID, "error", err)
			return nil
		}
		return &push.PayloadContext{
			RoomName:  room.GetName(),
			IsPrivate: core.KindOfRoom(room) == core.KindDM,
		}
	default:
		return nil
	}

	if eventID == "" {
		return nil
	}

	payloadCtx := &push.PayloadContext{}

	if kind == "" {
		// Mention and reply notifications no longer carry a kind on the
		// wire — recover from the room record (mostly channels in practice).
		var err error
		kind, err = chattoCore.FindRoomKind(ctx, roomID)
		if err != nil {
			logger.Debug("Failed to resolve room kind for push notification preview",
				"room_id", roomID, "error", err)
			return nil
		}
	}

	// Fetch the message to get its body
	event, err := chattoCore.GetRoomEventByEventID(ctx, kind, roomID, eventID)
	if err != nil {
		logger.Debug("Failed to fetch event for push notification preview",
			"event_id", eventID,
			"error", err)
		return nil
	}
	if event == nil {
		return nil
	}

	// Extract message body from the event
	if _, ok := event.Event.(*corev1.Event_MessagePosted); ok {
		body, err := chattoCore.GetMessageBody(ctx, kind, event.Id)
		if err != nil {
			logger.Debug("Failed to fetch message body for push notification preview",
				"event_id", event.Id,
				"error", err)
		} else {
			payloadCtx.MessagePreview = body
		}
	}

	// For notifications shown as channel activity, also fetch the room name.
	switch notification.Notification.(type) {
	case *corev1.Notification_Mention, *corev1.Notification_Reply, *corev1.Notification_RoomMessage:
		room, err := chattoCore.GetRoom(ctx, kind, roomID)
		if err != nil {
			logger.Debug("Failed to fetch room for push notification",
				"room_id", roomID,
				"error", err)
		} else if room != nil {
			payloadCtx.RoomName = room.Name
		}
	}

	return payloadCtx
}

func pushNotificationUsesCountBadge(notification *corev1.Notification) bool {
	if notification == nil {
		return false
	}
	switch notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage,
		*corev1.Notification_Mention,
		*corev1.Notification_Reply,
		*corev1.Notification_RoomMessage,
		*corev1.Notification_CallStarted:
		return true
	default:
		return false
	}
}
