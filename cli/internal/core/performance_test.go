package core

import (
	"errors"
	"slices"
	"sync"
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

func TestPerformanceManagerAppliesEveryEnvelopeInPrecedenceOrder(t *testing.T) {
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfileCustom,
		CustomLimits:  performanceLimitsToProto(PerformanceLimits{12, 32, 12, 12, 12}),
		Revision:      3,
	})
	manager := newPerformanceManager(config.PerformanceConfig{
		MaxImageTransformWorkers:    8,
		MaxImageTransformAdmissions: 24,
		MaxAssetUploadWorkers:       8,
		MaxLinkPreviewWorkers:       8,
		MaxVideoWorkers:             8,
	}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 4, MemoryBytes: 1 << 30}
	})

	status := manager.Status()
	if status.Effective.ImageTransformWorkers != 1 || status.Effective.VideoWorkers != 1 {
		t.Fatalf("memory-heavy limits = %#v, want 1", status.Effective)
	}
	if got, want := status.CapReasons["image_transform_workers"], []string{capReasonOperator, capReasonCPU, capReasonMemory}; !slices.Equal(got, want) {
		t.Fatalf("image transform cap reasons = %v, want %v", got, want)
	}
	if got, want := status.CapReasons["link_preview_workers"], []string{capReasonOperator, capReasonCPU}; !slices.Equal(got, want) {
		t.Fatalf("link preview cap reasons = %v, want %v", got, want)
	}
}

func TestPerformanceManagerAdmissionOperatorCapAlsoBoundsWorkers(t *testing.T) {
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, &configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfilePerformance,
		Revision:      4,
	})
	manager := newPerformanceManager(config.PerformanceConfig{
		MaxImageTransformAdmissions: 1,
	}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 16, MemoryBytes: 16 << 30}
	})

	status := manager.Status()
	if status.Effective.ImageTransformWorkers != 1 || status.Effective.ImageTransformAdmissions != 1 {
		t.Fatalf("image transform limits = %#v, want workers and admissions bounded to 1", status.Effective)
	}
	if !slices.Contains(status.CapReasons["image_transform_workers"], capReasonOperator) {
		t.Fatalf("worker cap reasons = %v, want inherited operator admission cap", status.CapReasons["image_transform_workers"])
	}
	if status.EffectiveProfile != config.PerformanceProfileCustom {
		t.Fatalf("effective profile = %q, want custom after partial caps", status.EffectiveProfile)
	}
}

func TestPerformanceManagerPreservesHistoricalUpgradeAndUsesBalancedForNewConfig(t *testing.T) {
	projection := NewConfigProjection()
	detect := func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 8, MemoryBytes: 8 << 30}
	}

	historical := newPerformanceManager(config.PerformanceConfig{}, projection, detect).Status()
	if historical.Source != performanceSourceHistorical || historical.RequestedProfile != config.PerformanceProfileLegacy {
		t.Fatalf("historical status = %#v", historical)
	}
	if historical.Effective != performancePreset(config.PerformanceProfileBalanced) {
		t.Fatalf("historical limits = %#v, want balanced-compatible limits", historical.Effective)
	}
	if historical.EffectiveProfile != config.PerformanceProfileBalanced {
		t.Fatalf("historical effective profile = %q, want balanced", historical.EffectiveProfile)
	}

	newConfig := newPerformanceManager(config.PerformanceConfig{DefaultProfile: config.PerformanceProfileBalanced}, projection, detect).Status()
	if newConfig.Source != performanceSourceOperatorDefault || newConfig.RequestedProfile != config.PerformanceProfileBalanced {
		t.Fatalf("new-config status = %#v", newConfig)
	}
}

func TestPerformanceManagerReplicasSharePolicyAndDeriveLocalEnvelopeAfterRestart(t *testing.T) {
	policy := &configv1.ServerPerformancePolicy{
		SchemaVersion: 1,
		Profile:       config.PerformanceProfilePerformance,
		Revision:      11,
	}
	projection := NewConfigProjection()
	applyPerformancePolicy(t, projection, policy)
	replayedProjection := NewConfigProjection()
	applyPerformancePolicy(t, replayedProjection, policy)

	large := newPerformanceManager(config.PerformanceConfig{}, projection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 8, MemoryBytes: 8 << 30}
	}).Status()
	small := newPerformanceManager(config.PerformanceConfig{}, replayedProjection, func() runtimecap.Capacity {
		return runtimecap.Capacity{CPUs: 1, MemoryBytes: 768 << 20}
	}).Status()

	if large.Revision != 11 || small.Revision != 11 || large.RequestedProfile != small.RequestedProfile {
		t.Fatalf("replica policy mismatch: large=%#v small=%#v", large, small)
	}
	if large.Effective.ImageTransformWorkers != 4 || small.Effective.ImageTransformWorkers != 1 {
		t.Fatalf("replica effective limits: large=%#v small=%#v", large.Effective, small.Effective)
	}
	if len(small.CapReasons["image_transform_workers"]) == 0 {
		t.Fatal("small replica did not explain its local cap")
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

func TestUpdatePerformanceSettingsRequiresOwnerAndRejectsStaleRevision(t *testing.T) {
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

	initial, err := chattoCore.GetPerformanceSettings(ctx, owner.Id)
	if err != nil {
		t.Fatal(err)
	}
	if initial.Revision != 0 || initial.Source != performanceSourceHistorical {
		t.Fatalf("initial status = %#v", initial)
	}
	updated, err := chattoCore.UpdatePerformanceSettings(ctx, owner.Id, 0, config.PerformanceProfileBalanced, PerformanceLimits{})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 1 || updated.Source != performanceSourceOwner {
		t.Fatalf("updated status = %#v", updated)
	}
	if _, err := chattoCore.UpdatePerformanceSettings(ctx, owner.Id, 0, config.PerformanceProfileEconomy, PerformanceLimits{}); !errors.Is(err, ErrConfigConflict) {
		t.Fatalf("stale update error = %v, want config conflict", err)
	}
	current, err := chattoCore.GetPerformanceSettings(ctx, owner.Id)
	if err != nil {
		t.Fatal(err)
	}
	if current.Revision != 1 || current.RequestedProfile != config.PerformanceProfileBalanced {
		t.Fatalf("stale update changed policy: %#v", current)
	}
}

func TestUpdatePerformanceSettingsRejectsOneOfTwoConcurrentOwnerWrites(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	ctx := testContext(t)
	owner, err := chattoCore.CreateUser(ctx, SystemActorID, "concurrent-performance-owner", "Concurrent Performance Owner", "password")
	if err != nil {
		t.Fatal(err)
	}
	if err := chattoCore.AssignServerRole(ctx, SystemActorID, owner.Id, RoleOwner); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	for _, profile := range []string{config.PerformanceProfileEconomy, config.PerformanceProfilePerformance} {
		go func() {
			ready.Done()
			<-start
			_, updateErr := chattoCore.UpdatePerformanceSettings(ctx, owner.Id, 0, profile, PerformanceLimits{})
			errs <- updateErr
		}()
	}
	ready.Wait()
	close(start)

	successes, conflicts := 0, 0
	for range 2 {
		switch updateErr := <-errs; {
		case updateErr == nil:
			successes++
		case errors.Is(updateErr, ErrConfigConflict):
			conflicts++
		default:
			t.Fatalf("concurrent update error = %v", updateErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent results = %d successes, %d conflicts; want one of each", successes, conflicts)
	}
	status, err := chattoCore.GetPerformanceSettings(ctx, owner.Id)
	if err != nil {
		t.Fatal(err)
	}
	if status.Revision != 1 || status.Source != performanceSourceOwner {
		t.Fatalf("concurrent final status = %#v", status)
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
