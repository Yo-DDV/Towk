package http_server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/pprof"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"hmans.de/chatto/internal/connectapi"
)

type processMetrics struct {
	realtimeWebSocketConnections atomic.Int64
	mediaRequests                *prometheus.CounterVec
	mediaRequestDuration         *prometheus.HistogramVec
	mediaResponseBytes           *prometheus.CounterVec
	mediaCache                   *prometheus.CounterVec
	mediaRange                   *prometheus.CounterVec
	mediaTransformDuration       *prometheus.HistogramVec
	mediaTransformJobs           *prometheus.GaugeVec
	assetUploadRequests          *prometheus.CounterVec
	assetUploadDuration          *prometheus.HistogramVec
	assetUploadBytes             *prometheus.CounterVec
}

func newProcessMetrics() *processMetrics {
	m := &processMetrics{
		mediaRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_media_requests_total",
			Help: "Media delivery requests handled by this Towk process.",
		}, []string{"operation", "outcome", "size_class"}),
		mediaRequestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "towk_media_request_duration_seconds",
			Help:    "Media delivery request duration in this Towk process.",
			Buckets: mediaDurationBuckets,
		}, []string{"operation", "size_class"}),
		mediaResponseBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_media_response_bytes_total",
			Help: "Media response bytes written by this Towk process.",
		}, []string{"operation"}),
		mediaCache: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_media_cache_lookups_total",
			Help: "Media derivative cache lookup results in this Towk process.",
		}, []string{"operation", "result"}),
		mediaRange: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_media_range_requests_total",
			Help: "Media requests carrying a Range header by final HTTP status class.",
		}, []string{"operation", "status"}),
		mediaTransformDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "towk_media_transform_duration_seconds",
			Help:    "Cold image transform duration in this Towk process.",
			Buckets: mediaDurationBuckets,
		}, []string{"outcome", "size_class"}),
		mediaTransformJobs: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "towk_media_transform_jobs",
			Help: "Current process-local image transform jobs by bounded state; pending remains zero while the synchronous transform path has no admission queue.",
		}, []string{"state"}),
		assetUploadRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_asset_upload_operations_total",
			Help: "Resumable asset upload operations handled by this Towk process.",
		}, []string{"operation", "outcome", "size_class"}),
		assetUploadDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "towk_asset_upload_operation_duration_seconds",
			Help:    "Resumable asset upload operation duration in this Towk process.",
			Buckets: mediaDurationBuckets,
		}, []string{"operation", "outcome"}),
		assetUploadBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "towk_asset_upload_bytes_total",
			Help: "Successfully declared or transferred asset upload bytes observed by this Towk process.",
		}, []string{"operation"}),
	}
	m.mediaTransformJobs.WithLabelValues("active").Set(0)
	m.mediaTransformJobs.WithLabelValues("pending").Set(0)
	return m
}

var mediaDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 5}

const mediaMetricsMaximumSeries = 592

type mediaOperation string

const (
	mediaOperationServerOriginal      mediaOperation = "server_original"
	mediaOperationServerTransform     mediaOperation = "server_transform"
	mediaOperationAttachmentOriginal  mediaOperation = "attachment_original"
	mediaOperationAttachmentTransform mediaOperation = "attachment_transform"
)

type mediaCacheResult string

const (
	mediaCacheNone  mediaCacheResult = "none"
	mediaCacheHit   mediaCacheResult = "hit"
	mediaCacheMiss  mediaCacheResult = "miss"
	mediaCacheError mediaCacheResult = "error"
)

type mediaTransformOutcome string

const (
	mediaTransformSuccess mediaTransformOutcome = "success"
	mediaTransformError   mediaTransformOutcome = "error"
)

func (m *processMetrics) collectors() []prometheus.Collector {
	return []prometheus.Collector{
		m.mediaRequests,
		m.mediaRequestDuration,
		m.mediaResponseBytes,
		m.mediaCache,
		m.mediaRange,
		m.mediaTransformDuration,
		m.mediaTransformJobs,
		m.assetUploadRequests,
		m.assetUploadDuration,
		m.assetUploadBytes,
	}
}

func (m *processMetrics) observeMediaRequest(operation mediaOperation, cache mediaCacheResult, status int, sizeBytes int64, duration time.Duration) {
	operationLabel := boundedMediaOperation(operation)
	sizeClass := mediaSizeClass(sizeBytes)
	m.mediaRequests.WithLabelValues(operationLabel, mediaRequestOutcome(status), sizeClass).Inc()
	m.mediaRequestDuration.WithLabelValues(operationLabel, sizeClass).Observe(duration.Seconds())
	m.mediaResponseBytes.WithLabelValues(operationLabel).Add(float64(max(sizeBytes, 0)))
	m.mediaCache.WithLabelValues(operationLabel, boundedMediaCacheResult(cache)).Inc()
}

func (m *processMetrics) observeMediaRange(operation mediaOperation, status int) {
	m.mediaRange.WithLabelValues(boundedMediaOperation(operation), mediaRangeStatus(status)).Inc()
}

func (m *processMetrics) observeMediaTransform(outcome mediaTransformOutcome, sizeBytes int64, duration time.Duration) {
	m.mediaTransformDuration.WithLabelValues(boundedMediaTransformOutcome(outcome), mediaSizeClass(sizeBytes)).Observe(duration.Seconds())
}

func (m *processMetrics) mediaTransformStarted() func() {
	m.mediaTransformJobs.WithLabelValues("active").Inc()
	var once sync.Once
	return func() {
		once.Do(func() { m.mediaTransformJobs.WithLabelValues("active").Dec() })
	}
}

func (m *processMetrics) ObserveAssetUpload(operation connectapi.AssetUploadOperation, outcome connectapi.AssetUploadOutcome, sizeBytes int64, duration time.Duration) {
	operationLabel := boundedAssetUploadOperation(operation)
	outcomeLabel := boundedAssetUploadOutcome(outcome)
	m.assetUploadRequests.WithLabelValues(operationLabel, outcomeLabel, mediaSizeClass(sizeBytes)).Inc()
	m.assetUploadDuration.WithLabelValues(operationLabel, outcomeLabel).Observe(duration.Seconds())
	if outcomeLabel == string(connectapi.AssetUploadSuccess) {
		m.assetUploadBytes.WithLabelValues(operationLabel).Add(float64(max(sizeBytes, 0)))
	}
}

const mediaCacheContextKey = "towk.media.cache_result"

func (s *HTTPServer) finishMediaRequest(c *gin.Context, operation mediaOperation, started time.Time) {
	if s.metrics == nil {
		return
	}
	cache := mediaCacheNone
	if value, ok := c.Get(mediaCacheContextKey); ok {
		if observed, valid := value.(mediaCacheResult); valid {
			cache = observed
		}
	}
	status := c.Writer.Status()
	s.metrics.observeMediaRequest(operation, cache, status, int64(c.Writer.Size()), time.Since(started))
	if c.GetHeader("Range") != "" {
		s.metrics.observeMediaRange(operation, status)
	}
}

func boundedMediaOperation(operation mediaOperation) string {
	switch operation {
	case mediaOperationServerOriginal, mediaOperationServerTransform, mediaOperationAttachmentOriginal, mediaOperationAttachmentTransform:
		return string(operation)
	default:
		return "other"
	}
}

func boundedMediaCacheResult(result mediaCacheResult) string {
	switch result {
	case mediaCacheNone, mediaCacheHit, mediaCacheMiss, mediaCacheError:
		return string(result)
	default:
		return string(mediaCacheError)
	}
}

func boundedMediaTransformOutcome(outcome mediaTransformOutcome) string {
	if outcome == mediaTransformSuccess {
		return string(mediaTransformSuccess)
	}
	return string(mediaTransformError)
}

func boundedAssetUploadOperation(operation connectapi.AssetUploadOperation) string {
	switch operation {
	case connectapi.AssetUploadCreate, connectapi.AssetUploadChunk, connectapi.AssetUploadComplete, connectapi.AssetUploadCancel:
		return string(operation)
	default:
		return "other"
	}
}

func boundedAssetUploadOutcome(outcome connectapi.AssetUploadOutcome) string {
	if outcome == connectapi.AssetUploadSuccess {
		return string(connectapi.AssetUploadSuccess)
	}
	return string(connectapi.AssetUploadError)
}

func mediaRequestOutcome(status int) string {
	switch {
	case status >= 200 && status < 300:
		return "success"
	case status >= 300 && status < 400:
		return "redirect"
	case status == http.StatusBadRequest:
		return "invalid"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "unauthorized"
	case status == http.StatusNotFound:
		return "not_found"
	default:
		return "error"
	}
}

func mediaRangeStatus(status int) string {
	switch status {
	case http.StatusOK, http.StatusPartialContent, http.StatusRequestedRangeNotSatisfiable:
		return fmt.Sprint(status)
	default:
		return "other"
	}
}

func mediaSizeClass(sizeBytes int64) string {
	switch {
	case sizeBytes < 0:
		return "unknown"
	case sizeBytes <= 1<<20:
		return "small"
	case sizeBytes <= 32<<20:
		return "medium"
	default:
		return "large"
	}
}

func (m *processMetrics) realtimeWebSocketOpened() {
	m.realtimeWebSocketConnections.Add(1)
}

func (m *processMetrics) realtimeWebSocketClosed() {
	m.realtimeWebSocketConnections.Add(-1)
}

func (m *processMetrics) realtimeWebSocketConnectionCount() int64 {
	return m.realtimeWebSocketConnections.Load()
}

func (s *HTTPServer) newMetricsServer() (*http.Server, error) {
	if s.metrics == nil {
		s.metrics = newProcessMetrics()
	}

	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		newChattoCollector(s),
	)
	registry.MustRegister(s.metrics.collectors()...)

	mux := http.NewServeMux()
	mux.Handle(s.config.Metrics.PathOrDefault(), promhttp.HandlerFor(registry, promhttp.HandlerOpts{}))
	if s.config.Metrics.Pprof {
		registerPprofHandlers(mux)
	}

	addr := net.JoinHostPort(s.config.Metrics.BindAddressOrDefault(), fmt.Sprint(s.config.Metrics.PortOrDefault()))
	return newHTTPServer(addr, mux), nil
}

func registerPprofHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
}

type chattoCollector struct {
	server *HTTPServer

	buildInfo               *prometheus.Desc
	ready                   *prometheus.Desc
	realtimeWebSockets      *prometheus.Desc
	myEventsActive          *prometheus.Desc
	myEventsDelivered       *prometheus.Desc
	myEventsSlowDisconnects *prometheus.Desc
	presenceRefreshes       *prometheus.Desc
	presenceFailures        *prometheus.Desc
	modelInfo               *prometheus.Desc
	legacyServiceInfo       *prometheus.Desc
	natsConnected           *prometheus.Desc
	natsRTT                 *prometheus.Desc
	natsMessages            *prometheus.Desc
	natsBytes               *prometheus.Desc
	natsReconnects          *prometheus.Desc
	projectionStarted       *prometheus.Desc
	projectionStartup       *prometheus.Desc
	projectionStartupMsgs   *prometheus.Desc
	projectionFailed        *prometheus.Desc
	projectionLastApplied   *prometheus.Desc
	projectionTarget        *prometheus.Desc
	projectionLag           *prometheus.Desc
	projectionEntries       *prometheus.Desc
	projectionBytes         *prometheus.Desc
	scrapeError             *prometheus.Desc
}

func newChattoCollector(server *HTTPServer) *chattoCollector {
	return &chattoCollector{
		server: server,

		buildInfo: prometheus.NewDesc(
			"chatto_build_info",
			"Build information for this Towk process.",
			[]string{"version"},
			nil,
		),
		ready: prometheus.NewDesc(
			"chatto_ready",
			"Whether this Towk process is ready to serve application traffic.",
			nil,
			nil,
		),
		realtimeWebSockets: prometheus.NewDesc(
			"chatto_realtime_websocket_connections",
			"Current realtime WebSocket connections in this process.",
			nil,
			nil,
		),
		myEventsActive: prometheus.NewDesc(
			"chatto_my_events_streams",
			"Active live event streams in this process.",
			nil,
			nil,
		),
		myEventsDelivered: prometheus.NewDesc(
			"chatto_my_events_delivered_total",
			"Total live event envelopes delivered by this process.",
			nil,
			nil,
		),
		myEventsSlowDisconnects: prometheus.NewDesc(
			"chatto_my_events_slow_consumer_disconnects_total",
			"Total myEvents streams closed because their NATS live-event subscription was a slow consumer.",
			nil,
			nil,
		),
		presenceRefreshes: prometheus.NewDesc(
			"chatto_presence_refreshes_total",
			"Total successful presence TTL refreshes from myEvents streams in this process.",
			nil,
			nil,
		),
		presenceFailures: prometheus.NewDesc(
			"chatto_presence_refresh_failures_total",
			"Total failed presence TTL refreshes from myEvents streams in this process.",
			nil,
			nil,
		),
		modelInfo: prometheus.NewDesc(
			"chatto_model_info",
			"Registered core model in this Towk process.",
			[]string{"model"},
			nil,
		),
		legacyServiceInfo: prometheus.NewDesc(
			"chatto_service_info",
			"Deprecated compatibility alias for chatto_model_info.",
			[]string{"service"},
			nil,
		),
		natsConnected: prometheus.NewDesc(
			"chatto_nats_connected",
			"Whether this process is currently connected to NATS.",
			nil,
			nil,
		),
		natsRTT: prometheus.NewDesc(
			"chatto_nats_rtt_seconds",
			"Current NATS round-trip time in seconds.",
			nil,
			nil,
		),
		natsMessages: prometheus.NewDesc(
			"chatto_nats_messages_total",
			"Total NATS messages sent or received by this process.",
			[]string{"direction"},
			nil,
		),
		natsBytes: prometheus.NewDesc(
			"chatto_nats_bytes_total",
			"Total NATS bytes sent or received by this process.",
			[]string{"direction"},
			nil,
		),
		natsReconnects: prometheus.NewDesc(
			"chatto_nats_reconnects_total",
			"Total NATS reconnects observed by this process.",
			nil,
			nil,
		),
		projectionStarted: prometheus.NewDesc(
			"chatto_projection_started",
			"Whether a process-local projection has started.",
			[]string{"projection"},
			nil,
		),
		projectionStartup: prometheus.NewDesc(
			"chatto_projection_startup_duration_seconds",
			"Seconds from process-local projection start until its initial replay completed.",
			[]string{"projection"},
			nil,
		),
		projectionStartupMsgs: prometheus.NewDesc(
			"chatto_projection_startup_messages",
			"Number of matching EVT messages applied by a process-local projection during initial replay.",
			[]string{"projection"},
			nil,
		),
		projectionFailed: prometheus.NewDesc(
			"chatto_projection_failed",
			"Whether a process-local projection has failed.",
			[]string{"projection"},
			nil,
		),
		projectionLastApplied: prometheus.NewDesc(
			"chatto_projection_last_applied_sequence",
			"Last EVT stream sequence applied by a process-local projection.",
			[]string{"projection"},
			nil,
		),
		projectionTarget: prometheus.NewDesc(
			"chatto_projection_target_sequence",
			"Current matching EVT stream target sequence for a process-local projection.",
			[]string{"projection"},
			nil,
		),
		projectionLag: prometheus.NewDesc(
			"chatto_projection_lag_events",
			"Number of matching EVT stream events not yet applied by a process-local projection.",
			[]string{"projection"},
			nil,
		),
		projectionEntries: prometheus.NewDesc(
			"chatto_projection_entries",
			"Estimated number of entries held by a process-local projection.",
			[]string{"projection"},
			nil,
		),
		projectionBytes: prometheus.NewDesc(
			"chatto_projection_estimated_bytes",
			"Estimated heap bytes held by a process-local projection.",
			[]string{"projection"},
			nil,
		),
		scrapeError: prometheus.NewDesc(
			"chatto_metrics_scrape_error",
			"Whether a Towk metrics collector failed during this scrape.",
			[]string{"collector"},
			nil,
		),
	}
}

func (c *chattoCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.buildInfo
	ch <- c.ready
	ch <- c.realtimeWebSockets
	ch <- c.myEventsActive
	ch <- c.myEventsDelivered
	ch <- c.myEventsSlowDisconnects
	ch <- c.presenceRefreshes
	ch <- c.presenceFailures
	ch <- c.modelInfo
	ch <- c.legacyServiceInfo
	ch <- c.natsConnected
	ch <- c.natsRTT
	ch <- c.natsMessages
	ch <- c.natsBytes
	ch <- c.natsReconnects
	ch <- c.projectionStarted
	ch <- c.projectionStartup
	ch <- c.projectionFailed
	ch <- c.projectionLastApplied
	ch <- c.projectionTarget
	ch <- c.projectionLag
	ch <- c.projectionEntries
	ch <- c.projectionBytes
	ch <- c.scrapeError
}

func (c *chattoCollector) Collect(ch chan<- prometheus.Metric) {
	version := c.server.version
	if version == "" {
		version = "unknown"
	}
	ch <- prometheus.MustNewConstMetric(c.buildInfo, prometheus.GaugeValue, 1, version)
	ch <- prometheus.MustNewConstMetric(c.realtimeWebSockets, prometheus.GaugeValue, float64(c.server.metrics.realtimeWebSocketConnectionCount()))

	c.collectNATSMetrics(ch)
	c.collectCoreMetrics(ch)
}

func (c *chattoCollector) collectNATSMetrics(ch chan<- prometheus.Metric) {
	if c.server.nc == nil {
		ch <- prometheus.MustNewConstMetric(c.natsConnected, prometheus.GaugeValue, 0)
		return
	}

	connected := 0.0
	if c.server.nc.IsConnected() {
		connected = 1
		if rtt, err := c.server.nc.RTT(); err == nil {
			ch <- prometheus.MustNewConstMetric(c.natsRTT, prometheus.GaugeValue, rtt.Seconds())
		}
	}
	ch <- prometheus.MustNewConstMetric(c.natsConnected, prometheus.GaugeValue, connected)

	stats := c.server.nc.Stats()
	ch <- prometheus.MustNewConstMetric(c.natsMessages, prometheus.CounterValue, float64(stats.InMsgs), "in")
	ch <- prometheus.MustNewConstMetric(c.natsMessages, prometheus.CounterValue, float64(stats.OutMsgs), "out")
	ch <- prometheus.MustNewConstMetric(c.natsBytes, prometheus.CounterValue, float64(stats.InBytes), "in")
	ch <- prometheus.MustNewConstMetric(c.natsBytes, prometheus.CounterValue, float64(stats.OutBytes), "out")
	ch <- prometheus.MustNewConstMetric(c.natsReconnects, prometheus.CounterValue, float64(stats.Reconnects))
}

func (c *chattoCollector) collectCoreMetrics(ch chan<- prometheus.Metric) {
	if c.server.core == nil {
		ch <- prometheus.MustNewConstMetric(c.ready, prometheus.GaugeValue, 0)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), httpServerReadHeaderTimeout)
	defer cancel()

	ready := 1.0
	if err := c.server.core.Ready(ctx); err != nil {
		ready = 0
	}
	ch <- prometheus.MustNewConstMetric(c.ready, prometheus.GaugeValue, ready)

	myEvents := c.server.core.MyEventsMetrics()
	ch <- prometheus.MustNewConstMetric(c.myEventsActive, prometheus.GaugeValue, float64(myEvents.ActiveStreams))
	ch <- prometheus.MustNewConstMetric(c.myEventsDelivered, prometheus.CounterValue, float64(myEvents.DeliveredEvents))
	ch <- prometheus.MustNewConstMetric(c.myEventsSlowDisconnects, prometheus.CounterValue, float64(myEvents.SlowDisconnects))
	ch <- prometheus.MustNewConstMetric(c.presenceRefreshes, prometheus.CounterValue, float64(myEvents.PresenceRefreshes))
	ch <- prometheus.MustNewConstMetric(c.presenceFailures, prometheus.CounterValue, float64(myEvents.PresenceFailures))
	for _, model := range c.server.core.ModelMetadata() {
		ch <- prometheus.MustNewConstMetric(c.modelInfo, prometheus.GaugeValue, 1, model.Key)
		ch <- prometheus.MustNewConstMetric(c.legacyServiceInfo, prometheus.GaugeValue, 1, model.LegacyServiceKey)
	}

	projections, err := c.server.core.ProjectionAdminStates(ctx)
	if err != nil {
		ch <- prometheus.MustNewConstMetric(c.scrapeError, prometheus.GaugeValue, 1, "projections")
		return
	}
	ch <- prometheus.MustNewConstMetric(c.scrapeError, prometheus.GaugeValue, 0, "projections")
	for _, projection := range projections {
		started := boolMetric(projection.Started)
		failed := boolMetric(projection.Failed)
		ch <- prometheus.MustNewConstMetric(c.projectionStarted, prometheus.GaugeValue, started, projection.Key)
		if projection.StartupComplete {
			ch <- prometheus.MustNewConstMetric(c.projectionStartup, prometheus.GaugeValue, projection.StartupDuration, projection.Key)
			ch <- prometheus.MustNewConstMetric(c.projectionStartupMsgs, prometheus.GaugeValue, float64(projection.StartupMessages), projection.Key)
		}
		ch <- prometheus.MustNewConstMetric(c.projectionFailed, prometheus.GaugeValue, failed, projection.Key)
		ch <- prometheus.MustNewConstMetric(c.projectionLastApplied, prometheus.GaugeValue, float64(projection.LastAppliedSeq), projection.Key)
		ch <- prometheus.MustNewConstMetric(c.projectionTarget, prometheus.GaugeValue, float64(projection.MatchingStreamSeq), projection.Key)
		ch <- prometheus.MustNewConstMetric(c.projectionLag, prometheus.GaugeValue, float64(projection.Lag), projection.Key)
		ch <- prometheus.MustNewConstMetric(c.projectionEntries, prometheus.GaugeValue, float64(projection.EntryCount), projection.Key)
		ch <- prometheus.MustNewConstMetric(c.projectionBytes, prometheus.GaugeValue, float64(projection.EstimatedBytes), projection.Key)
	}
}

func boolMetric(v bool) float64 {
	if v {
		return 1
	}
	return 0
}
