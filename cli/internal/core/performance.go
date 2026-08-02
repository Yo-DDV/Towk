package core

import (
	"context"
	"fmt"
	"sync"
	"time"

	"hmans.de/chatto/internal/config"
	configv1 "hmans.de/chatto/internal/pb/chatto/config/v1"
	"hmans.de/chatto/internal/runtimecap"
)

const performancePolicySchemaVersion uint32 = 1
const performanceSettingsSchemaVersion uint32 = 2

const (
	performanceSourceAdaptive = "adaptive"
)

const (
	capReasonOperator = "operator_cap"
	capReasonCPU      = "process_cpu"
	capReasonMemory   = "process_memory"
)

type PerformanceLimits struct {
	ImageTransformWorkers    int
	ImageTransformAdmissions int
	AssetUploadWorkers       int
	LinkPreviewWorkers       int
	VideoWorkers             int
}

type PerformanceStatus struct {
	RequestedProfile string
	EffectiveProfile string
	Source           string
	SchemaVersion    uint32
	Revision         uint64
	Requested        PerformanceLimits
	Effective        PerformanceLimits
	OperatorCaps     PerformanceLimits
	Envelope         runtimecap.Capacity
	CapReasons       map[string][]string
	PolicyError      string
	RestartRequired  bool
}

// PerformanceManager derives work-pool capacity from operator ceilings and the
// process-visible CPU/memory envelope. Each admission observes the refreshed
// cgroup envelope without persisting a product-level profile.
type PerformanceManager struct {
	config     config.PerformanceConfig
	detect     func() runtimecap.Capacity
	mu         sync.Mutex
	envelope   runtimecap.Capacity
	detectedAt time.Time
}

// A short cache avoids reading proc/cgroup files for every admission while
// keeping adaptive back-pressure responsive to a host or sibling container
// consuming memory. Limiters poll this value at most every 250ms when queued.
const performanceEnvelopeCacheTTL = 2 * time.Second

// ConfigurePerformance applies the operator-owned envelope before runtime
// services begin accepting work.
func (c *ChattoCore) ConfigurePerformance(cfg config.PerformanceConfig) {
	if c == nil || c.performance == nil {
		return
	}
	c.performance.config = cfg
}

func (c *ChattoCore) PerformanceStatus() PerformanceStatus {
	if c == nil || c.performance == nil {
		return NewPerformanceManager(config.PerformanceConfig{}, nil).Status()
	}
	return c.performance.Status()
}

func (c *ChattoCore) ImageTransformLimits() (int, int) {
	status := c.PerformanceStatus()
	return status.Effective.ImageTransformWorkers, status.Effective.ImageTransformAdmissions
}

func (c *ChattoCore) AssetUploadWorkerLimit() int {
	return c.PerformanceStatus().Effective.AssetUploadWorkers
}

func (c *ChattoCore) LinkPreviewWorkerLimit() int {
	return c.PerformanceStatus().Effective.LinkPreviewWorkers
}

func (c *ChattoCore) VideoWorkerLimit() int {
	return c.PerformanceStatus().Effective.VideoWorkers
}

// AcquireMediaTranscode reserves one process-local slot shared by video,
// animated-GIF, and voice-message ffmpeg work.
func (c *ChattoCore) AcquireMediaTranscode(ctx context.Context) error {
	if c == nil || c.mediaTranscodeLimiter == nil {
		return fmt.Errorf("media transcode capacity is not initialized")
	}
	return c.mediaTranscodeLimiter.Acquire(ctx)
}

func (c *ChattoCore) ReleaseMediaTranscode() {
	if c != nil && c.mediaTranscodeLimiter != nil {
		c.mediaTranscodeLimiter.Release()
	}
}

func (c *ChattoCore) GetPerformanceSettings(ctx context.Context, actorID string) (PerformanceStatus, error) {
	if err := c.requirePerformanceOwner(ctx, actorID); err != nil {
		return PerformanceStatus{}, err
	}
	return c.PerformanceStatus(), nil
}

func (c *ChattoCore) UpdatePerformanceSettings(ctx context.Context, actorID string, _ uint64, _ string, _ PerformanceLimits) (PerformanceStatus, error) {
	if err := c.requirePerformanceOwner(ctx, actorID); err != nil {
		return PerformanceStatus{}, err
	}
	return PerformanceStatus{}, invalidArgument("performance profiles are retired; Towk scheduling is adaptive")
}

func (c *ChattoCore) requirePerformanceOwner(ctx context.Context, actorID string) error {
	if err := requireAuthenticatedActor(actorID); err != nil {
		return err
	}
	isOwner, err := c.IsServerOwner(ctx, actorID)
	if err != nil {
		return fmt.Errorf("check owner role: %w", err)
	}
	if !isOwner {
		return ErrPermissionDenied
	}
	return nil
}

func NewPerformanceManager(cfg config.PerformanceConfig, projection *ConfigProjection) *PerformanceManager {
	return newPerformanceManager(cfg, projection, runtimecap.Detect)
}

func newPerformanceManager(cfg config.PerformanceConfig, _ *ConfigProjection, detect func() runtimecap.Capacity) *PerformanceManager {
	if detect == nil {
		detect = runtimecap.Detect
	}
	return &PerformanceManager{config: cfg, detect: detect}
}

func (m *PerformanceManager) Status() PerformanceStatus {
	envelope := m.processEnvelope()
	requested := adaptivePerformanceLimits(envelope)
	status := PerformanceStatus{
		RequestedProfile: config.PerformanceProfileAdaptive,
		EffectiveProfile: config.PerformanceProfileAdaptive,
		Source:           performanceSourceAdaptive,
		SchemaVersion:    performanceSettingsSchemaVersion,
		Requested:        requested,
		OperatorCaps: PerformanceLimits{
			ImageTransformWorkers:    m.config.MaxImageTransformWorkers,
			ImageTransformAdmissions: m.config.MaxImageTransformAdmissions,
			AssetUploadWorkers:       m.config.MaxAssetUploadWorkers,
			LinkPreviewWorkers:       m.config.MaxLinkPreviewWorkers,
			VideoWorkers:             m.config.MaxVideoWorkers,
		},
		Envelope:   envelope,
		CapReasons: make(map[string][]string),
	}
	status.Effective = m.effective(status.Requested, status.Envelope, status.OperatorCaps, status.CapReasons)
	return status
}

func (m *PerformanceManager) processEnvelope() runtimecap.Capacity {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.detectedAt.IsZero() || time.Since(m.detectedAt) >= performanceEnvelopeCacheTTL {
		m.envelope = m.detect()
		m.detectedAt = time.Now()
	}
	return m.envelope
}

func (m *PerformanceManager) effective(requested PerformanceLimits, envelope runtimecap.Capacity, operator PerformanceLimits, reasons map[string][]string) PerformanceLimits {
	cpus := max(1, envelope.CPUs)
	memoryHeavy := maxPerformanceValue
	memoryAdmissions := maxPerformanceValue
	memoryLink := maxPerformanceValue
	memoryUpload := maxPerformanceValue
	if envelope.MemoryBytes > 0 {
		memoryHeavy = memorySlots(envelope.MemoryBytes, 512<<20, 512<<20)
		memoryAdmissions = memorySlots(envelope.MemoryBytes, 512<<20, 64<<20)
		memoryLink = memorySlots(envelope.MemoryBytes, 256<<20, 128<<20)
		memoryUpload = memorySlots(envelope.MemoryBytes, 256<<20, 64<<20)
	}

	workers := boundedPerformanceValue("image_transform_workers", requested.ImageTransformWorkers, operator.ImageTransformWorkers, cpus, memoryHeavy, reasons)
	admissionCPU := max(workers, saturatedMultiply(cpus, 8))
	admissions := boundedPerformanceValue("image_transform_admissions", requested.ImageTransformAdmissions, operator.ImageTransformAdmissions, admissionCPU, memoryAdmissions, reasons)
	if admissions < workers {
		workers = admissions
		for _, reason := range reasons["image_transform_admissions"] {
			reasons["image_transform_workers"] = appendPerformanceReason(reasons["image_transform_workers"], reason)
		}
	}

	return PerformanceLimits{
		ImageTransformWorkers:    workers,
		ImageTransformAdmissions: admissions,
		AssetUploadWorkers:       boundedPerformanceValue("asset_upload_workers", requested.AssetUploadWorkers, operator.AssetUploadWorkers, saturatedMultiply(cpus, 2), memoryUpload, reasons),
		LinkPreviewWorkers:       boundedPerformanceValue("link_preview_workers", requested.LinkPreviewWorkers, operator.LinkPreviewWorkers, cpus, memoryLink, reasons),
		VideoWorkers:             boundedPerformanceValue("video_workers", requested.VideoWorkers, operator.VideoWorkers, cpus, memoryHeavy, reasons),
	}
}

const maxPerformanceValue = int(^uint32(0) >> 1)

func adaptivePerformanceLimits(envelope runtimecap.Capacity) PerformanceLimits {
	cpus := max(1, envelope.CPUs)
	return PerformanceLimits{
		ImageTransformWorkers:    min(config.MaxPerformanceWorkers, cpus),
		ImageTransformAdmissions: min(config.MaxPerformanceAdmissions, saturatedMultiply(cpus, 8)),
		AssetUploadWorkers:       min(config.MaxPerformanceWorkers, saturatedMultiply(cpus, 2)),
		LinkPreviewWorkers:       min(config.MaxPerformanceWorkers, cpus),
		VideoWorkers:             min(config.MaxPerformanceWorkers, cpus),
	}
}

func saturatedMultiply(value, factor int) int {
	if value < 1 || factor < 1 {
		return 1
	}
	if value > maxPerformanceValue/factor {
		return maxPerformanceValue
	}
	return value * factor
}

func appendPerformanceReason(reasons []string, reason string) []string {
	for _, existing := range reasons {
		if existing == reason {
			return reasons
		}
	}
	return append(reasons, reason)
}

func boundedPerformanceValue(name string, requested, operator, cpu, memory int, reasons map[string][]string) int {
	effective := max(1, requested)
	if operator > 0 && operator < effective {
		effective = operator
		reasons[name] = append(reasons[name], capReasonOperator)
	}
	if cpu > 0 && cpu < effective {
		effective = cpu
		reasons[name] = append(reasons[name], capReasonCPU)
	}
	if memory > 0 && memory < effective {
		effective = memory
		reasons[name] = append(reasons[name], capReasonMemory)
	}
	return max(1, effective)
}

func memorySlots(total, reserve, perWorker int64) int {
	if total <= reserve || perWorker <= 0 {
		return 1
	}
	// Keep a proportional reserve on large hosts so a burst does not consume
	// every byte merely because MemAvailable was high at the last sample.
	if proportional := total / 8; proportional > reserve {
		reserve = proportional
	}
	if total <= reserve {
		return 1
	}
	slots := (total - reserve) / perWorker
	if slots > int64(maxPerformanceValue) {
		return maxPerformanceValue
	}
	return max(1, int(slots))
}

func performanceLimitsFromProto(limits *configv1.PerformanceLimits) (PerformanceLimits, error) {
	if limits == nil {
		return PerformanceLimits{}, invalidArgument("custom performance limits are required")
	}
	result := PerformanceLimits{
		ImageTransformWorkers:    int(limits.GetImageTransformWorkers()),
		ImageTransformAdmissions: int(limits.GetImageTransformAdmissions()),
		AssetUploadWorkers:       int(limits.GetAssetUploadWorkers()),
		LinkPreviewWorkers:       int(limits.GetLinkPreviewWorkers()),
		VideoWorkers:             int(limits.GetVideoWorkers()),
	}
	values := []struct {
		name  string
		value int
		max   int
	}{{"image transform workers", result.ImageTransformWorkers, config.MaxPerformanceWorkers}, {"image transform admissions", result.ImageTransformAdmissions, config.MaxPerformanceAdmissions}, {"asset upload workers", result.AssetUploadWorkers, config.MaxPerformanceWorkers}, {"link preview workers", result.LinkPreviewWorkers, config.MaxPerformanceWorkers}, {"media transcode workers", result.VideoWorkers, config.MaxPerformanceWorkers}}
	for _, value := range values {
		if value.value < 1 || value.value > value.max {
			return PerformanceLimits{}, invalidArgument(fmt.Sprintf("%s must be between 1 and %d", value.name, value.max))
		}
	}
	if result.ImageTransformAdmissions < result.ImageTransformWorkers {
		return PerformanceLimits{}, invalidArgument("image transform admissions must be greater than or equal to workers")
	}
	return result, nil
}
