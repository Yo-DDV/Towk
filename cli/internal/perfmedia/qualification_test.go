package perfmedia

import (
	"fmt"
	"strings"
	"testing"
)

func TestAssessCapacityQualificationAcceptsCompletePairwiseMatrix(t *testing.T) {
	report := validCapacityQualificationReport()
	assessment := AssessCapacityQualification(report)
	if !assessment.Accepted || assessment.Status != "VERIFIED" {
		t.Fatalf("assessment = %#v, want VERIFIED", assessment)
	}
	if assessment.NominalRuns != 96 || assessment.OverloadRuns != 4 || assessment.RecoveryRuns != 4 || assessment.SoakRuns != 1 {
		t.Fatalf("phase counts = %#v, want 96 nominal, 4 overload, 4 recovery, 1 soak", assessment)
	}
}

func TestAssessCapacityQualificationRejectsMissingPairwiseCoverage(t *testing.T) {
	report := validCapacityQualificationReport()
	filtered := report.Runs[:0]
	for _, run := range report.Runs {
		if run.Profile == QualificationProfileEconomy && run.CacheState == "full" {
			continue
		}
		filtered = append(filtered, run)
	}
	report.Runs = filtered

	assessment := AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "profile=economy") || !qualificationReasonContains(assessment.Reasons, "cache_state=full") {
		t.Fatalf("assessment = %#v, want missing economy/full pair", assessment)
	}
}

func TestAssessCapacityQualificationRequiresCustomNominalAndResilienceCoverage(t *testing.T) {
	report := validCapacityQualificationReport()
	filtered := report.Runs[:0]
	for _, run := range report.Runs {
		if run.Profile != QualificationProfileCustom {
			filtered = append(filtered, run)
		}
	}
	report.Runs = filtered
	assessment := AssessCapacityQualification(report)
	for _, want := range []string{"profile=custom", "custom overload", "custom recovery"} {
		if !qualificationReasonContains(assessment.Reasons, want) {
			t.Fatalf("assessment = %#v, want missing %q reason", assessment, want)
		}
	}
}

func TestAssessCapacityQualificationRejectsUnprovedPerformanceLimits(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CapacityQualificationReport)
		want   string
	}{
		{name: "missing requested limits", mutate: func(report *CapacityQualificationReport) {
			report.Runs[0].RequestedLimits = QualificationPerformanceLimits{}
		}, want: "requested performance limits"},
		{name: "standard preset mismatch", mutate: func(report *CapacityQualificationReport) {
			report.Runs[0].RequestedLimits.AssetUploadWorkers++
		}, want: "declared standard profile"},
		{name: "effective exceeds requested", mutate: func(report *CapacityQualificationReport) {
			report.Runs[0].EffectiveLimits.VideoWorkers = report.Runs[0].RequestedLimits.VideoWorkers + 1
		}, want: "exceed requested limits"},
		{name: "invalid custom bounds", mutate: func(report *CapacityQualificationReport) {
			run := qualificationRunForProfilePhase(t, report.Runs, QualificationProfileCustom, QualificationPhaseNominal)
			run.RequestedLimits.ImageTransformAdmissions = run.RequestedLimits.ImageTransformWorkers - 1
		}, want: "requested performance limits"},
		{name: "unknown overload subsystem", mutate: func(report *CapacityQualificationReport) {
			qualificationRunForPhase(t, report.Runs, QualificationPhaseOverload).AdmissionSubsystem = "unknown"
		}, want: "admission subsystem"},
		{name: "overload limit differs from effective policy", mutate: func(report *CapacityQualificationReport) {
			qualificationRunForPhase(t, report.Runs, QualificationPhaseOverload).AdmissionLimit++
		}, want: "admission limit"},
		{name: "recovery changes environment", mutate: func(report *CapacityQualificationReport) {
			qualificationRunForPhase(t, report.Runs, QualificationPhaseRecovery).Backend = "s3"
		}, want: "preserve its overload environment"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := validCapacityQualificationReport()
			tt.mutate(&report)
			assessment := AssessCapacityQualification(report)
			if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, tt.want) {
				t.Fatalf("assessment = %#v, want %q", assessment, tt.want)
			}
		})
	}
}

func TestAssessCapacityQualificationRejectsInvalidResourceAndDurationEvidence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*QualificationRun)
		want   string
	}{
		{name: "short duration", mutate: func(run *QualificationRun) { run.DurationSeconds = 1799 }, want: "at least 1800 seconds"},
		{name: "memory p95", mutate: func(run *QualificationRun) { run.WorkingSetP95Bytes = run.Envelope.MemoryLimitBytes * 71 / 100 }, want: "working-set p95"},
		{name: "zero memory evidence", mutate: func(run *QualificationRun) { run.WorkingSetP95Bytes = 0 }, want: "working-set p95"},
		{name: "memory peak", mutate: func(run *QualificationRun) { run.WorkingSetPeakBytes = run.Envelope.MemoryLimitBytes * 81 / 100 }, want: "working-set peak"},
		{name: "peak below p95", mutate: func(run *QualificationRun) { run.WorkingSetPeakBytes = run.WorkingSetP95Bytes - 1 }, want: "below working-set p95"},
		{name: "host memory", mutate: func(run *QualificationRun) { run.HostMemoryPeakBytes = run.Envelope.HostMemoryBytes * 86 / 100 }, want: "host memory peak"},
		{name: "throttling", mutate: func(run *QualificationRun) { run.CPUThrottledSeconds = 6 }, want: "CPU throttling"},
		{name: "server errors", mutate: func(run *QualificationRun) { run.UnexpectedServerErrors = 1; run.Requests = 1000 }, want: "unexpected server error rate"},
		{name: "unverified preflight", mutate: func(run *QualificationRun) { run.PreflightStatus = "UNVERIFIED" }, want: "preflight status"},
		{name: "missing thermal proof", mutate: func(run *QualificationRun) { run.Envelope.ThermalProven = false }, want: "thermal"},
		{name: "empty load", mutate: func(run *QualificationRun) { run.Load = QualificationLoadVector{} }, want: "load vector"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := validCapacityQualificationReport()
			tt.mutate(&report.Runs[0])
			assessment := AssessCapacityQualification(report)
			if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, tt.want) {
				t.Fatalf("assessment = %#v, want reason containing %q", assessment, tt.want)
			}
		})
	}
}

func TestAssessCapacityQualificationRequiresMeasuredScalePoints(t *testing.T) {
	report := validCapacityQualificationReport()
	report.ScalePoints = report.ScalePoints[:3]
	assessment := AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "8 CPU") {
		t.Fatalf("assessment = %#v, want missing 8 CPU scale point", assessment)
	}
}

func TestAssessCapacityQualificationRejectsNonMonotonicScalingAndDocumentsWeakScaling(t *testing.T) {
	report := validCapacityQualificationReport()
	report.ScalePoints[2].ThroughputPerSecond = report.ScalePoints[1].ThroughputPerSecond - 1
	assessment := AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "not monotonic") {
		t.Fatalf("assessment = %#v, want non-monotonic scaling rejection", assessment)
	}

	report = validCapacityQualificationReport()
	report.ScalePoints[2].ThroughputPerSecond = report.ScalePoints[1].ThroughputPerSecond * 1.2
	report.ScalePoints[2].Bottleneck = "storage latency p95 reached the qualified ceiling"
	assessment = AssessCapacityQualification(report)
	if !assessment.Accepted || !qualificationReasonContains(assessment.Limitations, "below the 1.5x target") {
		t.Fatalf("assessment = %#v, want accepted documented scaling limitation", assessment)
	}
}

func TestAssessCapacityQualificationRequiresSeparateGeneratorForLargeCustomPoints(t *testing.T) {
	report := validCapacityQualificationReport()
	report.ScalePoints = append(report.ScalePoints, QualificationScalePoint{
		CPUs: 12, MemoryLimitBytes: 24 << 30, ThroughputPerSecond: 700,
	})
	assessment := AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "separate generator") {
		t.Fatalf("assessment = %#v, want separate-generator rejection", assessment)
	}
}

func TestAssessCapacityQualificationRequiresEveryResiliencePhase(t *testing.T) {
	tests := []struct {
		name   string
		remove func(QualificationRun) bool
		want   string
	}{
		{name: "economy overload", remove: func(run QualificationRun) bool {
			return run.Profile == QualificationProfileEconomy && run.Phase == QualificationPhaseOverload
		}, want: "economy overload"},
		{name: "performance recovery", remove: func(run QualificationRun) bool {
			return run.Profile == QualificationProfilePerformance && run.Phase == QualificationPhaseRecovery
		}, want: "performance recovery"},
		{name: "balanced soak", remove: func(run QualificationRun) bool { return run.Phase == QualificationPhaseSoak }, want: "balanced soak"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := validCapacityQualificationReport()
			filtered := report.Runs[:0]
			for _, run := range report.Runs {
				if !tt.remove(run) {
					filtered = append(filtered, run)
				}
			}
			report.Runs = filtered
			assessment := AssessCapacityQualification(report)
			if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, tt.want) {
				t.Fatalf("assessment = %#v, want missing %s", assessment, tt.want)
			}
		})
	}
}

func TestAssessCapacityQualificationRejectsUnsafeOverloadEvidence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*QualificationRun)
		want   string
	}{
		{name: "short overload", mutate: func(run *QualificationRun) { run.DurationSeconds = 599 }, want: "overload duration"},
		{name: "unbounded admission", mutate: func(run *QualificationRun) { run.AdmissionBounded = false }, want: "bounded admission"},
		{name: "no rejection pressure", mutate: func(run *QualificationRun) { run.AdmissionRejections = 0 }, want: "admission rejections"},
		{name: "limit not reached", mutate: func(run *QualificationRun) { run.PeakAdmitted = run.AdmissionLimit - 1 }, want: "admission limit"},
		{name: "admission overflow", mutate: func(run *QualificationRun) { run.PeakAdmitted = run.AdmissionLimit + 1 }, want: "admission limit"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := validCapacityQualificationReport()
			run := qualificationRunForPhase(t, report.Runs, QualificationPhaseOverload)
			tt.mutate(run)
			assessment := AssessCapacityQualification(report)
			if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, tt.want) {
				t.Fatalf("assessment = %#v, want %q", assessment, tt.want)
			}
		})
	}
}

func TestAssessCapacityQualificationRejectsIncompleteRecoveryAndSoak(t *testing.T) {
	tests := []struct {
		name   string
		phase  QualificationPhase
		mutate func(*QualificationRun)
		want   string
	}{
		{name: "slow recovery", phase: QualificationPhaseRecovery, mutate: func(run *QualificationRun) { run.RecoverySeconds = 61 }, want: "within 60 seconds"},
		{name: "unlinked recovery", phase: QualificationPhaseRecovery, mutate: func(run *QualificationRun) { run.PrecedingOverloadRunID = "" }, want: "same-profile overload"},
		{name: "throughput not restored", phase: QualificationPhaseRecovery, mutate: func(run *QualificationRun) { run.RecoveredThroughputPerSecond = 89 }, want: "90% of baseline throughput"},
		{name: "latency not restored", phase: QualificationPhaseRecovery, mutate: func(run *QualificationRun) { run.RecoveredP95Millis = 111 }, want: "110% of baseline p95"},
		{name: "short soak", phase: QualificationPhaseSoak, mutate: func(run *QualificationRun) { run.DurationSeconds = 7199 }, want: "soak duration"},
		{name: "lifecycle residue", phase: QualificationPhaseSoak, mutate: func(run *QualificationRun) { run.ResidualGoroutines = 1 }, want: "lifecycle residue"},
		{name: "oom", phase: QualificationPhaseOverload, mutate: func(run *QualificationRun) { run.OOMKillCount = 1 }, want: "crash, panic, OOM"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := validCapacityQualificationReport()
			run := qualificationRunForPhase(t, report.Runs, tt.phase)
			tt.mutate(run)
			assessment := AssessCapacityQualification(report)
			if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, tt.want) {
				t.Fatalf("assessment = %#v, want %q", assessment, tt.want)
			}
		})
	}
}

func TestAssessCapacityQualificationRejectsWrongScaleMemoryAndUnboundedLimitation(t *testing.T) {
	report := validCapacityQualificationReport()
	report.ScalePoints[0].MemoryLimitBytes++
	assessment := AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "memory envelope") {
		t.Fatalf("assessment = %#v, want scale memory rejection", assessment)
	}

	report = validCapacityQualificationReport()
	report.ScalePoints[2].ThroughputPerSecond = report.ScalePoints[1].ThroughputPerSecond * 1.2
	report.ScalePoints[2].Bottleneck = strings.Repeat("x", 513)
	assessment = AssessCapacityQualification(report)
	if assessment.Accepted || !qualificationReasonContains(assessment.Reasons, "bottleneck evidence") {
		t.Fatalf("assessment = %#v, want unbounded bottleneck rejection", assessment)
	}
}

func validCapacityQualificationReport() CapacityQualificationReport {
	const revision = "0123456789abcdef0123456789abcdef01234567"
	profiles := []QualificationProfile{
		QualificationProfileEconomy,
		QualificationProfileBalanced,
		QualificationProfilePerformance,
		QualificationProfileCustom,
	}
	backends := []string{"nats", "s3"}
	caches := []string{"cold", "warm", "full"}
	networks := []NetworkProfileName{NetworkNormal, NetworkDegraded}
	paths := []string{"direct", "caddy_tls"}
	envelopes := map[QualificationProfile]QualificationEnvelope{
		QualificationProfileEconomy: {
			LogicalCPUs: 1, MemoryLimitBytes: 2 << 30, HostMemoryBytes: 4 << 30,
			Architecture: "amd64", CPUModel: "qualification-cpu", CgroupFingerprint: strings.Repeat("1", 64), ThermalProven: true,
		},
		QualificationProfileBalanced: {
			LogicalCPUs: 2, MemoryLimitBytes: 4 << 30, HostMemoryBytes: 8 << 30,
			Architecture: "amd64", CPUModel: "qualification-cpu", CgroupFingerprint: strings.Repeat("2", 64), ThermalProven: true,
		},
		QualificationProfilePerformance: {
			LogicalCPUs: 8, MemoryLimitBytes: 16 << 30, HostMemoryBytes: 24 << 30,
			Architecture: "amd64", CPUModel: "qualification-cpu", CgroupFingerprint: strings.Repeat("3", 64), ThermalProven: true,
		},
		QualificationProfileCustom: {
			LogicalCPUs: 4, MemoryLimitBytes: 8 << 30, HostMemoryBytes: 12 << 30,
			Architecture: "amd64", CPUModel: "qualification-cpu", CgroupFingerprint: strings.Repeat("4", 64), ThermalProven: true,
		},
	}
	limits := map[QualificationProfile]QualificationPerformanceLimits{
		QualificationProfileEconomy:     {ImageTransformWorkers: 1, ImageTransformAdmissions: 4, AssetUploadWorkers: 2, LinkPreviewWorkers: 1, VideoWorkers: 1},
		QualificationProfileBalanced:    {ImageTransformWorkers: 2, ImageTransformAdmissions: 8, AssetUploadWorkers: 4, LinkPreviewWorkers: 2, VideoWorkers: 2},
		QualificationProfilePerformance: {ImageTransformWorkers: 4, ImageTransformAdmissions: 16, AssetUploadWorkers: 8, LinkPreviewWorkers: 4, VideoWorkers: 4},
		QualificationProfileCustom:      {ImageTransformWorkers: 3, ImageTransformAdmissions: 12, AssetUploadWorkers: 6, LinkPreviewWorkers: 3, VideoWorkers: 2},
	}
	var runs []QualificationRun
	index := 1
	for _, profile := range profiles {
		for _, backend := range backends {
			for _, cacheState := range caches {
				for _, network := range networks {
					for _, path := range paths {
						envelope := envelopes[profile]
						performanceLimits := limits[profile]
						runs = append(runs, QualificationRun{
							RunID: fmt.Sprintf("%032x", index), Revision: revision, Profile: profile,
							Backend: backend, CacheState: cacheState, Network: network, Path: path,
							Phase: QualificationPhaseNominal, DurationSeconds: 1800, PreflightStatus: "VERIFIED",
							Envelope: envelope, RequestedLimits: performanceLimits, EffectiveLimits: performanceLimits,
							Load:     QualificationLoadVector{IdleConnections: 10, ActiveConnections: 4, MessagesPerSecond: 1, ConcurrentUploads: 1, UploadMbps: 2, ColdTransformsPerSecond: 1, WarmReadsPerSecond: 5, AudioPublishers: 1, AudioSubscribers: 1, VideoPublishers: 1, VideoSubscribers: 1, EgressMbps: 5, CorpusGiB: 1, ReadMiBPerSecond: 10, WriteMiBPerSecond: 2, StorageP95Millis: 5},
							Requests: 10_000, WorkingSetP95Bytes: envelope.MemoryLimitBytes / 2,
							WorkingSetPeakBytes: envelope.MemoryLimitBytes * 3 / 5,
							HostMemoryPeakBytes: envelope.HostMemoryBytes / 2,
							CPUUsageSeconds:     100, CPUThrottledSeconds: 1,
						})
						index++
					}
				}
			}
		}
	}
	for _, profile := range profiles {
		envelope := envelopes[profile]
		performanceLimits := limits[profile]
		base := QualificationRun{
			Revision: revision, Profile: profile, Backend: "nats", CacheState: "warm", Network: NetworkNormal, Path: "direct",
			PreflightStatus: "VERIFIED", Envelope: envelope, RequestedLimits: performanceLimits, EffectiveLimits: performanceLimits,
			Load:     QualificationLoadVector{ActiveConnections: 4, MessagesPerSecond: 1, ConcurrentUploads: 1, UploadMbps: 2, WarmReadsPerSecond: 5},
			Requests: 10_000, WorkingSetP95Bytes: envelope.MemoryLimitBytes / 2,
			WorkingSetPeakBytes: envelope.MemoryLimitBytes * 3 / 5, HostMemoryPeakBytes: envelope.HostMemoryBytes / 2,
			CPUUsageSeconds: 100, CPUThrottledSeconds: 1,
		}
		overload := base
		overload.RunID = fmt.Sprintf("%032x", index)
		overload.Phase = QualificationPhaseOverload
		overload.DurationSeconds = 600
		overload.AdmissionBounded = true
		overload.AdmissionRejections = 100
		overload.AdmissionSubsystem = "image_transform"
		overload.AdmissionLimit = performanceLimits.ImageTransformAdmissions
		overload.PeakAdmitted = performanceLimits.ImageTransformAdmissions
		runs = append(runs, overload)
		index++

		recovery := base
		recovery.RunID = fmt.Sprintf("%032x", index)
		recovery.PrecedingOverloadRunID = overload.RunID
		recovery.Phase = QualificationPhaseRecovery
		recovery.DurationSeconds = 60
		recovery.RecoverySeconds = 30
		recovery.BaselineThroughputPerSecond = 100
		recovery.RecoveredThroughputPerSecond = 95
		recovery.BaselineP95Millis = 100
		recovery.RecoveredP95Millis = 105
		runs = append(runs, recovery)
		index++
	}
	balancedEnvelope := envelopes[QualificationProfileBalanced]
	runs = append(runs, QualificationRun{
		RunID: fmt.Sprintf("%032x", index), Revision: revision, Profile: QualificationProfileBalanced,
		Backend: "nats", CacheState: "warm", Network: NetworkNormal, Path: "direct",
		Phase: QualificationPhaseSoak, DurationSeconds: 7200, PreflightStatus: "VERIFIED", Envelope: balancedEnvelope,
		RequestedLimits: limits[QualificationProfileBalanced], EffectiveLimits: limits[QualificationProfileBalanced],
		Load:     QualificationLoadVector{ActiveConnections: 4, MessagesPerSecond: 1, ConcurrentUploads: 1, UploadMbps: 2, WarmReadsPerSecond: 5},
		Requests: 10_000, WorkingSetP95Bytes: balancedEnvelope.MemoryLimitBytes / 2,
		WorkingSetPeakBytes: balancedEnvelope.MemoryLimitBytes * 3 / 5, HostMemoryPeakBytes: balancedEnvelope.HostMemoryBytes / 2,
		CPUUsageSeconds: 100, CPUThrottledSeconds: 1,
	})
	return CapacityQualificationReport{
		Revision: revision,
		Runs:     runs,
		ScalePoints: []QualificationScalePoint{
			{CPUs: 1, MemoryLimitBytes: 2 << 30, ThroughputPerSecond: 100},
			{CPUs: 2, MemoryLimitBytes: 4 << 30, ThroughputPerSecond: 160},
			{CPUs: 4, MemoryLimitBytes: 8 << 30, ThroughputPerSecond: 250},
			{CPUs: 8, MemoryLimitBytes: 16 << 30, ThroughputPerSecond: 500},
		},
	}
}

func qualificationRunForProfilePhase(t *testing.T, runs []QualificationRun, profile QualificationProfile, phase QualificationPhase) *QualificationRun {
	t.Helper()
	for index := range runs {
		if runs[index].Profile == profile && runs[index].Phase == phase {
			return &runs[index]
		}
	}
	t.Fatalf("missing %s phase %s", profile, phase)
	return nil
}

func qualificationRunForPhase(t *testing.T, runs []QualificationRun, phase QualificationPhase) *QualificationRun {
	t.Helper()
	for index := range runs {
		if runs[index].Phase == phase {
			return &runs[index]
		}
	}
	t.Fatalf("missing phase %s", phase)
	return nil
}

func qualificationReasonContains(reasons []string, want string) bool {
	for _, reason := range reasons {
		if strings.Contains(reason, want) {
			return true
		}
	}
	return false
}
