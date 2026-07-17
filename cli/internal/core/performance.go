package core

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"hmans.de/chatto/internal/config"
	configv1 "hmans.de/chatto/internal/pb/chatto/config/v1"
	"hmans.de/chatto/internal/runtimecap"
)

const performancePolicySchemaVersion uint32 = 1

const (
	performanceSourceHistorical      = "historical"
	performanceSourceOperatorDefault = "operator_default"
	performanceSourceOwner           = "owner"
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

// PerformanceManager resolves an owner policy against the operator envelope
// and process-visible CPU/memory limits. It is intentionally stateless so each
// admission sees the latest projected policy and cgroup envelope.
type PerformanceManager struct {
	config     config.PerformanceConfig
	projection *ConfigProjection
	detect     func() runtimecap.Capacity
	mu         sync.Mutex
	envelope   runtimecap.Capacity
	detectedAt time.Time
}

const performanceEnvelopeCacheTTL = 5 * time.Second

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

func (c *ChattoCore) GetPerformanceSettings(ctx context.Context, actorID string) (PerformanceStatus, error) {
	if err := c.requirePerformanceOwner(ctx, actorID); err != nil {
		return PerformanceStatus{}, err
	}
	return c.PerformanceStatus(), nil
}

func (c *ChattoCore) UpdatePerformanceSettings(ctx context.Context, actorID string, expectedRevision uint64, profile string, custom PerformanceLimits) (PerformanceStatus, error) {
	if err := c.requirePerformanceOwner(ctx, actorID); err != nil {
		return PerformanceStatus{}, err
	}
	if expectedRevision == math.MaxUint64 {
		return PerformanceStatus{}, invalidArgument("performance policy revision is out of range")
	}
	profile = strings.ToLower(strings.TrimSpace(profile))
	policy := &configv1.ServerPerformancePolicy{
		SchemaVersion: performancePolicySchemaVersion,
		Profile:       profile,
		Revision:      expectedRevision + 1,
	}
	if profile == config.PerformanceProfileCustom {
		policy.CustomLimits = performanceLimitsToProto(custom)
	}
	if err := validatePerformancePolicy(policy); err != nil {
		return PerformanceStatus{}, err
	}

	_, err := c.configManager.UpdateServerConfigFunc(ctx, actorID, func(current *configv1.ServerConfig) (*configv1.ServerConfig, error) {
		currentRevision := uint64(0)
		if current.GetPerformancePolicy() != nil {
			currentRevision = current.GetPerformancePolicy().GetRevision()
		}
		if currentRevision != expectedRevision {
			return nil, ErrConfigConflict
		}
		current.PerformancePolicy = clonePerformancePolicy(policy)
		return current, nil
	})
	if err != nil {
		return PerformanceStatus{}, err
	}
	return c.PerformanceStatus(), nil
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

func newPerformanceManager(cfg config.PerformanceConfig, projection *ConfigProjection, detect func() runtimecap.Capacity) *PerformanceManager {
	if detect == nil {
		detect = runtimecap.Detect
	}
	return &PerformanceManager{config: cfg, projection: projection, detect: detect}
}

func (m *PerformanceManager) Status() PerformanceStatus {
	status := PerformanceStatus{
		OperatorCaps: PerformanceLimits{
			ImageTransformWorkers:    m.config.MaxImageTransformWorkers,
			ImageTransformAdmissions: m.config.MaxImageTransformAdmissions,
			AssetUploadWorkers:       m.config.MaxAssetUploadWorkers,
			LinkPreviewWorkers:       m.config.MaxLinkPreviewWorkers,
			VideoWorkers:             m.config.MaxVideoWorkers,
		},
		Envelope:   m.processEnvelope(),
		CapReasons: make(map[string][]string),
	}

	policy := (*configv1.ServerPerformancePolicy)(nil)
	if m.projection != nil {
		policy = m.projection.PerformancePolicy()
	}
	status.RequestedProfile, status.Source, status.SchemaVersion, status.Revision, status.Requested, status.PolicyError = m.requested(policy)
	status.EffectiveProfile = status.RequestedProfile
	if status.PolicyError != "" {
		status.EffectiveProfile = config.PerformanceProfileEconomy
		status.Requested = performancePreset(config.PerformanceProfileEconomy)
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

func (m *PerformanceManager) requested(policy *configv1.ServerPerformancePolicy) (string, string, uint32, uint64, PerformanceLimits, string) {
	if policy == nil {
		profile := m.config.DefaultProfileOrLegacy()
		source := performanceSourceOperatorDefault
		if profile == config.PerformanceProfileLegacy {
			source = performanceSourceHistorical
		}
		limits, ok := knownPerformancePreset(profile)
		if !ok {
			return profile, source, 0, 0, PerformanceLimits{}, fmt.Sprintf("unknown default performance profile %q", profile)
		}
		return profile, source, 0, 0, limits, ""
	}

	profile := strings.ToLower(strings.TrimSpace(policy.GetProfile()))
	if policy.GetSchemaVersion() != performancePolicySchemaVersion {
		return profile, performanceSourceOwner, policy.GetSchemaVersion(), policy.GetRevision(), PerformanceLimits{}, fmt.Sprintf("unsupported performance policy schema version %d", policy.GetSchemaVersion())
	}
	if profile == config.PerformanceProfileCustom {
		limits, err := performanceLimitsFromProto(policy.GetCustomLimits())
		if err != nil {
			return profile, performanceSourceOwner, policy.GetSchemaVersion(), policy.GetRevision(), PerformanceLimits{}, err.Error()
		}
		return profile, performanceSourceOwner, policy.GetSchemaVersion(), policy.GetRevision(), limits, ""
	}
	limits, ok := knownPerformancePreset(profile)
	if !ok || profile == config.PerformanceProfileLegacy {
		return profile, performanceSourceOwner, policy.GetSchemaVersion(), policy.GetRevision(), PerformanceLimits{}, fmt.Sprintf("unknown owner performance profile %q", profile)
	}
	return profile, performanceSourceOwner, policy.GetSchemaVersion(), policy.GetRevision(), limits, ""
}

func (m *PerformanceManager) effective(requested PerformanceLimits, envelope runtimecap.Capacity, operator PerformanceLimits, reasons map[string][]string) PerformanceLimits {
	cpus := max(1, envelope.CPUs)
	memoryHeavy, memoryLink, memoryUpload := config.MaxPerformanceWorkers, config.MaxPerformanceWorkers, config.MaxPerformanceWorkers
	if envelope.MemoryBytes > 0 {
		memoryHeavy = memorySlots(envelope.MemoryBytes, 512<<20, 512<<20)
		memoryLink = memorySlots(envelope.MemoryBytes, 256<<20, 128<<20)
		memoryUpload = memorySlots(envelope.MemoryBytes, 256<<20, 64<<20)
	}

	workers := boundedPerformanceValue("image_transform_workers", requested.ImageTransformWorkers, operator.ImageTransformWorkers, cpus, memoryHeavy, reasons)
	admissionCPU := min(config.MaxPerformanceAdmissions, max(workers, cpus*8))
	admissions := boundedPerformanceValue("image_transform_admissions", requested.ImageTransformAdmissions, operator.ImageTransformAdmissions, admissionCPU, config.MaxPerformanceAdmissions, reasons)
	admissions = max(workers, admissions)

	return PerformanceLimits{
		ImageTransformWorkers:    workers,
		ImageTransformAdmissions: admissions,
		AssetUploadWorkers:       boundedPerformanceValue("asset_upload_workers", requested.AssetUploadWorkers, operator.AssetUploadWorkers, cpus*2, memoryUpload, reasons),
		LinkPreviewWorkers:       boundedPerformanceValue("link_preview_workers", requested.LinkPreviewWorkers, operator.LinkPreviewWorkers, cpus, memoryLink, reasons),
		VideoWorkers:             boundedPerformanceValue("video_workers", requested.VideoWorkers, operator.VideoWorkers, cpus, memoryHeavy, reasons),
	}
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
	return max(1, min(config.MaxPerformanceWorkers, int((total-reserve)/perWorker)))
}

func performancePreset(profile string) PerformanceLimits {
	limits, _ := knownPerformancePreset(profile)
	return limits
}

func knownPerformancePreset(profile string) (PerformanceLimits, bool) {
	switch profile {
	case config.PerformanceProfileEconomy:
		return PerformanceLimits{1, 4, 2, 1, 1}, true
	case config.PerformanceProfileLegacy, config.PerformanceProfileBalanced:
		return PerformanceLimits{2, 8, 4, 2, 2}, true
	case config.PerformanceProfilePerformance:
		return PerformanceLimits{4, 16, 8, 4, 4}, true
	default:
		return PerformanceLimits{}, false
	}
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
	}{{"image transform workers", result.ImageTransformWorkers, config.MaxPerformanceWorkers}, {"image transform admissions", result.ImageTransformAdmissions, config.MaxPerformanceAdmissions}, {"asset upload workers", result.AssetUploadWorkers, config.MaxPerformanceWorkers}, {"link preview workers", result.LinkPreviewWorkers, config.MaxPerformanceWorkers}, {"video workers", result.VideoWorkers, config.MaxPerformanceWorkers}}
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

func performanceLimitsToProto(limits PerformanceLimits) *configv1.PerformanceLimits {
	return &configv1.PerformanceLimits{
		ImageTransformWorkers:    int32(limits.ImageTransformWorkers),
		ImageTransformAdmissions: int32(limits.ImageTransformAdmissions),
		AssetUploadWorkers:       int32(limits.AssetUploadWorkers),
		LinkPreviewWorkers:       int32(limits.LinkPreviewWorkers),
		VideoWorkers:             int32(limits.VideoWorkers),
	}
}
