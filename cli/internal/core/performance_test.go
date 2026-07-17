package core

import (
	"testing"

	"hmans.de/chatto/internal/config"
	configv1 "hmans.de/chatto/internal/pb/chatto/config/v1"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/runtimecap"
)

func TestPerformanceManagerResolvesProfilesAgainstProcessEnvelope(t *testing.T) {
	projection := NewConfigProjection()
	manager := newPerformanceManager(config.PerformanceConfig{DefaultProfile: config.PerformanceProfilePerformance}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 2, MemoryBytes: 2 << 30, CPUSource: "test", MemorySource: "test"}
	})

	status := manager.Status()
	if status.Source != performanceSourceOperatorDefault || status.RequestedProfile != config.PerformanceProfilePerformance {
		t.Fatalf("profile status = %#v", status)
	}
	if status.Effective.ImageTransformWorkers != 2 || status.Effective.VideoWorkers != 2 {
		t.Fatalf("CPU-heavy limits = %#v, want 2", status.Effective)
	}
	if status.Effective.AssetUploadWorkers != 4 {
		t.Fatalf("upload workers = %d, want CPU-derived 4", status.Effective.AssetUploadWorkers)
	}
	if len(status.CapReasons["image_transform_workers"]) == 0 {
		t.Fatal("missing cap reason for image transforms")
	}
}

func TestPerformanceManagerOwnerPolicyAndOperatorCap(t *testing.T) {
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{SchemaVersion: 1, Profile: config.PerformanceProfilePerformance, Revision: 7})
	manager := newPerformanceManager(config.PerformanceConfig{MaxVideoWorkers: 1}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 16, MemoryBytes: 16 << 30}
	})

	status := manager.Status()
	if status.Source != performanceSourceOwner || status.Revision != 7 {
		t.Fatalf("owner policy status = %#v", status)
	}
	if status.Requested.VideoWorkers != 4 || status.Effective.VideoWorkers != 1 {
		t.Fatalf("video limits = requested %d effective %d", status.Requested.VideoWorkers, status.Effective.VideoWorkers)
	}
	if got := status.CapReasons["video_workers"]; len(got) != 1 || got[0] != capReasonOperator {
		t.Fatalf("video cap reasons = %v", got)
	}
}

func TestPerformanceManagerCustomPolicy(t *testing.T) {
	projection := NewConfigProjection()
	want := PerformanceLimits{3, 12, 5, 2, 2}
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfileCustom,
		CustomLimits:  performanceLimitsToProto(want),
		Revision:      2,
	})
	manager := newPerformanceManager(config.PerformanceConfig{}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 16, MemoryBytes: 16 << 30}
	})
	status := manager.Status()
	if status.PolicyError != "" || status.Requested != want || status.Effective != want {
		t.Fatalf("custom policy status = %#v", status)
	}
}

func TestPerformanceManagerUnknownSchemaFallsBackSafely(t *testing.T) {
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{SchemaVersion: 99, Profile: config.PerformanceProfilePerformance, Revision: 8})
	manager := newPerformanceManager(config.PerformanceConfig{}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 32, MemoryBytes: 32 << 30}
	})
	status := manager.Status()
	if status.PolicyError == "" || status.EffectiveProfile != config.PerformanceProfileEconomy {
		t.Fatalf("unknown-schema status = %#v", status)
	}
	if status.Effective != performancePreset(config.PerformanceProfileEconomy) {
		t.Fatalf("fallback limits = %#v", status.Effective)
	}
}

func TestValidatePerformancePolicyRejectsUnsafeCustomLimits(t *testing.T) {
	err := validatePerformancePolicy(&configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfileCustom,
		CustomLimits: &configv1.PerformanceLimits{
			ImageTransformWorkers:    4,
			ImageTransformAdmissions: 2,
			AssetUploadWorkers:       1,
			LinkPreviewWorkers:       1,
			VideoWorkers:             1,
		},
	})
	if err == nil {
		t.Fatal("unsafe custom limits were accepted")
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
