package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"hmans.de/chatto/internal/config"
	configv1 "hmans.de/chatto/internal/pb/chatto/config/v1"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/runtimecap"
)

func TestPerformanceManagerAdaptsToEveryVisibleCore(t *testing.T) {
	for _, cpus := range []int{1, 2, 4, 6, 16} {
		t.Run(string(rune('A'+cpus)), func(t *testing.T) {
			manager := newPerformanceManager(config.PerformanceConfig{}, nil, func() runtimecap.Capacity {
				return runtimecap.Capacity{
					CPUs: cpus, MemoryBytes: 64 << 30,
					CPUSource: "test", MemorySource: "test",
				}
			})

			status := manager.Status()
			want := PerformanceLimits{
				ImageTransformWorkers:    cpus,
				ImageTransformAdmissions: cpus * 8,
				AssetUploadWorkers:       cpus * 2,
				LinkPreviewWorkers:       cpus,
				VideoWorkers:             cpus,
			}
			if status.RequestedProfile != config.PerformanceProfileAdaptive ||
				status.EffectiveProfile != config.PerformanceProfileAdaptive ||
				status.Source != performanceSourceAdaptive ||
				status.SchemaVersion != performanceSettingsSchemaVersion {
				t.Fatalf("adaptive status metadata = %#v", status)
			}
			if status.Requested != want || status.Effective != want {
				t.Fatalf("limits for %d CPUs = requested %#v effective %#v, want %#v", cpus, status.Requested, status.Effective, want)
			}
			if len(status.CapReasons) != 0 {
				t.Fatalf("unexpected cap reasons for %d CPUs: %v", cpus, status.CapReasons)
			}
		})
	}
}

func TestPerformanceManagerUsesMemoryToKeepSmallHostsSafe(t *testing.T) {
	manager := newPerformanceManager(config.PerformanceConfig{}, nil, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 6, MemoryBytes: 1 << 30}
	})

	status := manager.Status()
	want := PerformanceLimits{
		ImageTransformWorkers:    1,
		ImageTransformAdmissions: 8,
		AssetUploadWorkers:       12,
		LinkPreviewWorkers:       6,
		VideoWorkers:             1,
	}
	if status.Effective != want {
		t.Fatalf("low-memory limits = %#v, want %#v", status.Effective, want)
	}
	for _, field := range []string{"image_transform_workers", "image_transform_admissions", "video_workers"} {
		if got := status.CapReasons[field]; len(got) != 1 || got[0] != capReasonMemory {
			t.Fatalf("%s cap reasons = %v, want memory", field, got)
		}
	}
}

func TestMemorySlotsKeepsAReserveOnLargeHosts(t *testing.T) {
	if got, want := memorySlots(16<<30, 512<<20, 512<<20), 28; got != want {
		t.Fatalf("large-host memory slots = %d, want %d after proportional reserve", got, want)
	}
	if got := memorySlots(1<<30, 512<<20, 512<<20); got != 1 {
		t.Fatalf("small-host memory slots = %d, want fail-safe one slot", got)
	}
}

func TestPerformanceManagerAppliesOptionalOperatorCapsAfterAdaptiveSizing(t *testing.T) {
	manager := newPerformanceManager(config.PerformanceConfig{
		MaxImageTransformWorkers:    3,
		MaxImageTransformAdmissions: 7,
		MaxAssetUploadWorkers:       5,
		MaxLinkPreviewWorkers:       2,
		MaxVideoWorkers:             1,
	}, nil, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 8, MemoryBytes: 32 << 30}
	})

	status := manager.Status()
	want := PerformanceLimits{3, 7, 5, 2, 1}
	if status.Effective != want {
		t.Fatalf("operator-capped limits = %#v, want %#v", status.Effective, want)
	}
	for _, field := range []string{"image_transform_workers", "image_transform_admissions", "asset_upload_workers", "link_preview_workers", "video_workers"} {
		if got := status.CapReasons[field]; len(got) != 1 || got[0] != capReasonOperator {
			t.Fatalf("%s cap reasons = %v, want operator", field, got)
		}
	}
}

func TestPerformanceManagerAdmissionCapAlsoBoundsWorkers(t *testing.T) {
	manager := newPerformanceManager(config.PerformanceConfig{
		MaxImageTransformAdmissions: 1,
	}, nil, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 8, MemoryBytes: 32 << 30}
	})

	status := manager.Status()
	if status.Effective.ImageTransformWorkers != 1 || status.Effective.ImageTransformAdmissions != 1 {
		t.Fatalf("image transform limits = %#v, want workers and admissions bounded to 1", status.Effective)
	}
	if got := status.CapReasons["image_transform_workers"]; len(got) != 1 || got[0] != capReasonOperator {
		t.Fatalf("worker cap reasons = %v, want inherited operator admission cap", got)
	}
}

func TestPerformanceManagerIgnoresHistoricalOwnerProfiles(t *testing.T) {
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfileEconomy,
		Revision:      7,
	})
	manager := newPerformanceManager(config.PerformanceConfig{
		DefaultProfile: config.PerformanceProfilePerformance,
	}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 6, MemoryBytes: 16 << 30}
	})

	status := manager.Status()
	if status.RequestedProfile != config.PerformanceProfileAdaptive || status.Source != performanceSourceAdaptive {
		t.Fatalf("historical policy affected adaptive metadata: %#v", status)
	}
	if status.Revision != 0 || status.Requested.ImageTransformWorkers != 6 || status.Requested.VideoWorkers != 6 {
		t.Fatalf("historical policy affected adaptive capacity: %#v", status)
	}
}

func TestPerformanceManagerFallsBackToOneCPUWhenDetectorIsInvalid(t *testing.T) {
	manager := newPerformanceManager(config.PerformanceConfig{}, nil, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 0, MemoryBytes: 0}
	})

	status := manager.Status()
	want := PerformanceLimits{1, 8, 2, 1, 1}
	if status.Requested != want || status.Effective != want {
		t.Fatalf("fallback limits = requested %#v effective %#v, want %#v", status.Requested, status.Effective, want)
	}
}

func TestAdaptivePerformanceLimitsStayWithinWorkPoolMaximums(t *testing.T) {
	got := adaptivePerformanceLimits(runtimecap.Capacity{CPUs: maxPerformanceValue})
	want := PerformanceLimits{
		ImageTransformWorkers:    config.MaxPerformanceWorkers,
		ImageTransformAdmissions: config.MaxPerformanceAdmissions,
		AssetUploadWorkers:       config.MaxPerformanceWorkers,
		LinkPreviewWorkers:       config.MaxPerformanceWorkers,
		VideoWorkers:             config.MaxPerformanceWorkers,
	}
	if got != want {
		t.Fatalf("saturated adaptive limits = %#v, want %#v", got, want)
	}
}

func TestPerformanceManagerRefreshesTheVisibleEnvelope(t *testing.T) {
	cpus := 2
	manager := newPerformanceManager(config.PerformanceConfig{}, nil, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: cpus, MemoryBytes: 16 << 30}
	})
	if got := manager.Status().Effective.ImageTransformWorkers; got != 2 {
		t.Fatalf("initial workers = %d, want 2", got)
	}

	cpus = 6
	manager.detectedAt = time.Now().Add(-performanceEnvelopeCacheTTL)
	status := manager.Status()
	if status.Envelope.CPUs != 6 || status.Effective.ImageTransformWorkers != 6 || status.Effective.VideoWorkers != 6 {
		t.Fatalf("refreshed status = %#v, want 6 CPUs", status)
	}
}

func TestPerformanceSettingsRequireOwnerAndRejectRetiredWrites(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	ctx := testContext(t)
	member, err := chattoCore.CreateUser(ctx, SystemActorID, "performance-member", "Performance Member", "password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chattoCore.GetPerformanceSettings(ctx, member.Id); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("member get error = %v, want permission denied", err)
	}
	owner, err := chattoCore.CreateUser(ctx, SystemActorID, "performance-owner", "Performance Owner", "password")
	if err != nil {
		t.Fatal(err)
	}
	if err := chattoCore.AssignServerRole(ctx, SystemActorID, owner.Id, RoleOwner); err != nil {
		t.Fatal(err)
	}

	status, err := chattoCore.GetPerformanceSettings(ctx, owner.Id)
	if err != nil {
		t.Fatal(err)
	}
	if status.Source != performanceSourceAdaptive || status.RequestedProfile != config.PerformanceProfileAdaptive {
		t.Fatalf("owner status = %#v", status)
	}
	if _, err := chattoCore.UpdatePerformanceSettings(ctx, owner.Id, 0, config.PerformanceProfilePerformance, PerformanceLimits{}); err == nil || !strings.Contains(err.Error(), "adaptive") {
		t.Fatalf("retired update error = %v, want adaptive scheduling error", err)
	}
	if chattoCore.ServerConfig.PerformancePolicy() != nil {
		t.Fatal("retired update persisted a performance policy")
	}
}

func TestMediaTranscodeAdmissionFollowsTheAdaptiveEnvelope(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	cpus := 2
	chattoCore.performance = newPerformanceManager(config.PerformanceConfig{}, chattoCore.ServerConfig, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: cpus, MemoryBytes: 16 << 30}
	})

	for range 2 {
		if !chattoCore.mediaTranscodeLimiter.TryAcquire() {
			t.Fatal("two-CPU envelope rejected an available transcode slot")
		}
	}
	if chattoCore.mediaTranscodeLimiter.TryAcquire() {
		chattoCore.mediaTranscodeLimiter.Release()
		t.Fatal("two-CPU envelope admitted a third transcode")
	}

	cpus = 4
	chattoCore.performance.detectedAt = time.Time{}
	for range 2 {
		if !chattoCore.mediaTranscodeLimiter.TryAcquire() {
			t.Fatal("four-CPU envelope did not expose its additional transcode slots")
		}
	}
	if chattoCore.mediaTranscodeLimiter.TryAcquire() {
		chattoCore.mediaTranscodeLimiter.Release()
		t.Fatal("four-CPU envelope admitted a fifth transcode")
	}
	for range 4 {
		chattoCore.mediaTranscodeLimiter.Release()
	}
}

func TestAcquireMediaTranscodeHonorsContextWhenAdaptiveCapacityIsFull(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	chattoCore.performance = newPerformanceManager(config.PerformanceConfig{}, chattoCore.ServerConfig, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 1, MemoryBytes: 4 << 30}
	})
	if err := chattoCore.AcquireMediaTranscode(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chattoCore.ReleaseMediaTranscode()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := chattoCore.AcquireMediaTranscode(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("blocked acquire error = %v, want context canceled", err)
	}
}

func applyPerformancePolicy(t *testing.T, projection *ConfigProjection, policy *configv1.ServerPerformancePolicy) {
	t.Helper()
	if err := projection.Apply(&corev1.Event{Event: &corev1.Event_ServerPerformancePolicyChanged{
		ServerPerformancePolicyChanged: &corev1.ServerPerformancePolicyChangedEvent{Policy: policy},
	}}, 1); err != nil {
		t.Fatal(err)
	}
}
