package perfmedia

import (
	"fmt"
	"sort"
	"strings"

	"hmans.de/chatto/internal/config"
)

const (
	qualificationNominalSeconds  = 30 * 60
	qualificationOverloadSeconds = 10 * 60
	qualificationRecoverySeconds = 60
	qualificationSoakSeconds     = 2 * 60 * 60
	qualificationGiB             = int64(1 << 30)
)

type QualificationProfile string

const (
	QualificationProfileEconomy     QualificationProfile = "economy"
	QualificationProfileBalanced    QualificationProfile = "balanced"
	QualificationProfilePerformance QualificationProfile = "performance"
	QualificationProfileCustom      QualificationProfile = "custom"
)

type QualificationPhase string

const (
	QualificationPhaseNominal  QualificationPhase = "nominal"
	QualificationPhaseOverload QualificationPhase = "overload"
	QualificationPhaseRecovery QualificationPhase = "recovery"
	QualificationPhaseSoak     QualificationPhase = "soak"
)

type QualificationEnvelope struct {
	LogicalCPUs       int    `json:"logical_cpus"`
	MemoryLimitBytes  int64  `json:"memory_limit_bytes"`
	HostMemoryBytes   int64  `json:"host_memory_bytes"`
	Architecture      string `json:"architecture"`
	CPUModel          string `json:"cpu_model"`
	CgroupFingerprint string `json:"cgroup_fingerprint"`
	ThermalProven     bool   `json:"thermal_proven"`
}

// QualificationLoadVector is the explicit workload vector from the public
// qualification protocol. Zero is valid for an individual lane, but a result
// with no activity at all is not evidence.
type QualificationLoadVector struct {
	IdleConnections         int     `json:"idle_connections"`
	ActiveConnections       int     `json:"active_connections"`
	MessagesPerSecond       float64 `json:"messages_per_second"`
	ConcurrentUploads       int     `json:"concurrent_uploads"`
	UploadMbps              float64 `json:"upload_mbps"`
	ColdTransformsPerSecond float64 `json:"cold_transforms_per_second"`
	WarmReadsPerSecond      float64 `json:"warm_reads_per_second"`
	AudioPublishers         int     `json:"audio_publishers"`
	AudioSubscribers        int     `json:"audio_subscribers"`
	VideoPublishers         int     `json:"video_publishers"`
	VideoSubscribers        int     `json:"video_subscribers"`
	EgressMbps              float64 `json:"egress_mbps"`
	CorpusGiB               float64 `json:"corpus_gib"`
	ReadMiBPerSecond        float64 `json:"read_mib_per_second"`
	WriteMiBPerSecond       float64 `json:"write_mib_per_second"`
	StorageP95Millis        float64 `json:"storage_p95_millis"`
}

// QualificationPerformanceLimits records the policy that was requested and
// the bounded limits that the process actually applied for a run.
type QualificationPerformanceLimits struct {
	ImageTransformWorkers    int `json:"image_transform_workers"`
	ImageTransformAdmissions int `json:"image_transform_admissions"`
	AssetUploadWorkers       int `json:"asset_upload_workers"`
	LinkPreviewWorkers       int `json:"link_preview_workers"`
	VideoWorkers             int `json:"video_workers"`
}

type QualificationRun struct {
	RunID                        string                         `json:"run_id"`
	Revision                     string                         `json:"revision"`
	Profile                      QualificationProfile           `json:"profile"`
	Backend                      string                         `json:"backend"`
	CacheState                   string                         `json:"cache_state"`
	Network                      NetworkProfileName             `json:"network"`
	Path                         string                         `json:"path"`
	Phase                        QualificationPhase             `json:"phase"`
	DurationSeconds              int64                          `json:"duration_seconds"`
	PreflightStatus              string                         `json:"preflight_status"`
	Envelope                     QualificationEnvelope          `json:"envelope"`
	RequestedLimits              QualificationPerformanceLimits `json:"requested_limits"`
	EffectiveLimits              QualificationPerformanceLimits `json:"effective_limits"`
	Load                         QualificationLoadVector        `json:"load"`
	Requests                     int64                          `json:"requests"`
	UnexpectedServerErrors       int64                          `json:"unexpected_server_errors"`
	WorkingSetP95Bytes           int64                          `json:"working_set_p95_bytes"`
	WorkingSetPeakBytes          int64                          `json:"working_set_peak_bytes"`
	HostMemoryPeakBytes          int64                          `json:"host_memory_peak_bytes"`
	CPUUsageSeconds              float64                        `json:"cpu_usage_seconds"`
	CPUThrottledSeconds          float64                        `json:"cpu_throttled_seconds"`
	AdmissionBounded             bool                           `json:"admission_bounded"`
	AdmissionSubsystem           string                         `json:"admission_subsystem"`
	AdmissionRejections          int64                          `json:"admission_rejections"`
	AdmissionLimit               int                            `json:"admission_limit"`
	PeakAdmitted                 int                            `json:"peak_admitted"`
	RecoverySeconds              float64                        `json:"recovery_seconds"`
	PrecedingOverloadRunID       string                         `json:"preceding_overload_run_id"`
	BaselineThroughputPerSecond  float64                        `json:"baseline_throughput_per_second"`
	RecoveredThroughputPerSecond float64                        `json:"recovered_throughput_per_second"`
	BaselineP95Millis            float64                        `json:"baseline_p95_millis"`
	RecoveredP95Millis           float64                        `json:"recovered_p95_millis"`
	CrashCount                   int                            `json:"crash_count"`
	PanicCount                   int                            `json:"panic_count"`
	OOMKillCount                 int                            `json:"oom_kill_count"`
	ResidualGoroutines           int                            `json:"residual_goroutines"`
	ResidualTempFiles            int                            `json:"residual_temp_files"`
}

type QualificationScalePoint struct {
	CPUs                int     `json:"cpus"`
	MemoryLimitBytes    int64   `json:"memory_limit_bytes"`
	ThroughputPerSecond float64 `json:"throughput_per_second"`
	SeparateGenerator   bool    `json:"separate_generator"`
	Bottleneck          string  `json:"bottleneck,omitempty"`
}

type CapacityQualificationReport struct {
	Revision    string                    `json:"revision"`
	Runs        []QualificationRun        `json:"runs"`
	ScalePoints []QualificationScalePoint `json:"scale_points"`
}

type CapacityQualificationAssessment struct {
	Accepted     bool     `json:"accepted"`
	Status       string   `json:"status"`
	NominalRuns  int      `json:"nominal_runs"`
	OverloadRuns int      `json:"overload_runs"`
	RecoveryRuns int      `json:"recovery_runs"`
	SoakRuns     int      `json:"soak_runs"`
	Reasons      []string `json:"reasons,omitempty"`
	Limitations  []string `json:"limitations,omitempty"`
}

func AssessCapacityQualification(report CapacityQualificationReport) CapacityQualificationAssessment {
	assessment := CapacityQualificationAssessment{Status: "UNVERIFIED"}
	if !isHexLength(report.Revision, 40) && !isHexLength(report.Revision, 64) {
		assessment.Reasons = append(assessment.Reasons, "report revision must be a full hexadecimal Git object ID")
	}
	if len(report.Runs) == 0 {
		assessment.Reasons = append(assessment.Reasons, "qualification report has no runs")
	}
	seenRuns := make(map[string]struct{}, len(report.Runs))
	nominal := make([]QualificationRun, 0, len(report.Runs))
	overload := make([]QualificationRun, 0, 3)
	recovery := make([]QualificationRun, 0, 3)
	soak := make([]QualificationRun, 0, 1)
	for index, run := range report.Runs {
		prefix := fmt.Sprintf("run %d", index+1)
		if !ValidDeliveryRunID(run.RunID) {
			assessment.Reasons = append(assessment.Reasons, prefix+" has an invalid run id")
		} else if _, duplicate := seenRuns[run.RunID]; duplicate {
			assessment.Reasons = append(assessment.Reasons, prefix+" repeats a run id")
		} else {
			seenRuns[run.RunID] = struct{}{}
		}
		if run.Revision != report.Revision {
			assessment.Reasons = append(assessment.Reasons, prefix+" revision differs from the report revision")
		}
		assessment.Reasons = append(assessment.Reasons, validateQualificationRun(prefix, run)...)
		if run.Phase == QualificationPhaseNominal {
			nominal = append(nominal, run)
		} else if run.Phase == QualificationPhaseOverload {
			overload = append(overload, run)
		} else if run.Phase == QualificationPhaseRecovery {
			recovery = append(recovery, run)
		} else if run.Phase == QualificationPhaseSoak {
			soak = append(soak, run)
		}
	}
	assessment.NominalRuns = len(nominal)
	assessment.OverloadRuns = len(overload)
	assessment.RecoveryRuns = len(recovery)
	assessment.SoakRuns = len(soak)
	assessment.Reasons = append(assessment.Reasons, validateQualificationPairwiseCoverage(nominal)...)
	assessment.Reasons = append(assessment.Reasons, validateQualificationResilienceCoverage(overload, recovery, soak)...)
	scaleReasons, scaleLimitations := validateQualificationScalePoints(report.ScalePoints)
	assessment.Reasons = append(assessment.Reasons, scaleReasons...)
	assessment.Limitations = append(assessment.Limitations, scaleLimitations...)
	assessment.Accepted = len(assessment.Reasons) == 0
	if assessment.Accepted {
		assessment.Status = "VERIFIED"
	}
	return assessment
}

func validateQualificationRun(prefix string, run QualificationRun) []string {
	var reasons []string
	switch run.Phase {
	case QualificationPhaseNominal:
		if run.DurationSeconds < qualificationNominalSeconds {
			reasons = append(reasons, fmt.Sprintf("%s nominal duration must be at least %d seconds", prefix, qualificationNominalSeconds))
		}
	case QualificationPhaseOverload:
		if run.DurationSeconds < qualificationOverloadSeconds {
			reasons = append(reasons, fmt.Sprintf("%s overload duration must be at least %d seconds", prefix, qualificationOverloadSeconds))
		}
		if !run.AdmissionBounded {
			reasons = append(reasons, prefix+" overload must prove bounded admission")
		}
		if run.AdmissionRejections <= 0 || run.AdmissionRejections > run.Requests {
			reasons = append(reasons, prefix+" overload admission rejections are missing or invalid")
		}
		expectedLimit, validSubsystem := qualificationAdmissionLimit(run.AdmissionSubsystem, run.EffectiveLimits)
		if !validSubsystem {
			reasons = append(reasons, prefix+" overload admission subsystem is unsupported")
		}
		if run.AdmissionLimit <= 0 || run.PeakAdmitted != run.AdmissionLimit || (validSubsystem && run.AdmissionLimit != expectedLimit) {
			reasons = append(reasons, prefix+" overload peak does not match its admission limit")
		}
	case QualificationPhaseRecovery:
		if run.DurationSeconds < qualificationRecoverySeconds {
			reasons = append(reasons, fmt.Sprintf("%s recovery observation must be at least %d seconds", prefix, qualificationRecoverySeconds))
		}
		if !finitePositive(run.RecoverySeconds) || run.RecoverySeconds > qualificationRecoverySeconds {
			reasons = append(reasons, prefix+" recovery must complete within 60 seconds")
		}
		if !finitePositive(run.BaselineThroughputPerSecond) || !finitePositive(run.RecoveredThroughputPerSecond) || run.RecoveredThroughputPerSecond < 0.9*run.BaselineThroughputPerSecond {
			reasons = append(reasons, prefix+" recovery must restore at least 90% of baseline throughput")
		}
		if !finitePositive(run.BaselineP95Millis) || !finitePositive(run.RecoveredP95Millis) || run.RecoveredP95Millis > 1.1*run.BaselineP95Millis {
			reasons = append(reasons, prefix+" recovery p95 must stay within 110% of baseline p95")
		}
	case QualificationPhaseSoak:
		if run.DurationSeconds < qualificationSoakSeconds {
			reasons = append(reasons, fmt.Sprintf("%s soak duration must be at least %d seconds", prefix, qualificationSoakSeconds))
		}
		if run.Profile != QualificationProfileBalanced {
			reasons = append(reasons, prefix+" soak must use the balanced profile")
		}
	default:
		reasons = append(reasons, prefix+" phase is unsupported by the capacity matrix")
	}
	if run.CrashCount != 0 || run.PanicCount != 0 || run.OOMKillCount != 0 {
		reasons = append(reasons, prefix+" records a crash, panic, OOM kill, or invalid negative lifecycle count")
	}
	if run.ResidualGoroutines != 0 || run.ResidualTempFiles != 0 {
		reasons = append(reasons, prefix+" records lifecycle residue after the run")
	}
	if run.PreflightStatus != "VERIFIED" {
		reasons = append(reasons, prefix+" preflight status must be VERIFIED")
	}
	if !validQualificationProfile(run.Profile) {
		reasons = append(reasons, prefix+" profile is unknown")
	}
	if run.Backend != "nats" && run.Backend != "s3" {
		reasons = append(reasons, prefix+" backend must be nats or s3")
	}
	if run.CacheState != "cold" && run.CacheState != "warm" && run.CacheState != "full" {
		reasons = append(reasons, prefix+" cache state must be cold, warm, or full")
	}
	if run.Network != NetworkNormal && run.Network != NetworkDegraded {
		reasons = append(reasons, prefix+" network must be normal or degraded")
	}
	if run.Path != "direct" && run.Path != "caddy_tls" {
		reasons = append(reasons, prefix+" path must be direct or caddy_tls")
	}
	reasons = append(reasons, validateQualificationEnvelope(prefix, run.Profile, run.Envelope)...)
	reasons = append(reasons, validateQualificationPerformanceLimits(prefix, run.Profile, run.RequestedLimits, run.EffectiveLimits)...)
	if !validQualificationLoad(run.Load) {
		reasons = append(reasons, prefix+" load vector is missing, negative, non-finite, or idle")
	}
	if run.Requests <= 0 || run.UnexpectedServerErrors < 0 || run.UnexpectedServerErrors > run.Requests {
		reasons = append(reasons, prefix+" request/error counters are invalid")
	} else if 100*float64(run.UnexpectedServerErrors)/float64(run.Requests) >= 0.1 {
		reasons = append(reasons, prefix+" unexpected server error rate must stay below 0.1%")
	}
	if !withinResourcePercent(run.WorkingSetP95Bytes, run.Envelope.MemoryLimitBytes, 70) {
		reasons = append(reasons, prefix+" working-set p95 exceeds 70% of the memory limit")
	}
	if !withinResourcePercent(run.WorkingSetPeakBytes, run.Envelope.MemoryLimitBytes, 80) {
		reasons = append(reasons, prefix+" working-set peak exceeds 80% of the memory limit")
	}
	if run.WorkingSetPeakBytes < run.WorkingSetP95Bytes {
		reasons = append(reasons, prefix+" working-set peak is below working-set p95")
	}
	if !withinResourcePercent(run.HostMemoryPeakBytes, run.Envelope.HostMemoryBytes, 85) {
		reasons = append(reasons, prefix+" host memory peak exceeds 85% of host memory")
	}
	if !finitePositive(run.CPUUsageSeconds) || !finiteNonNegative(run.CPUThrottledSeconds) || run.CPUThrottledSeconds > run.CPUUsageSeconds || 100*run.CPUThrottledSeconds/run.CPUUsageSeconds > 5 {
		reasons = append(reasons, prefix+" CPU throttling exceeds 5% or lacks valid evidence")
	}
	return reasons
}

func validateQualificationPerformanceLimits(
	prefix string,
	profile QualificationProfile,
	requested, effective QualificationPerformanceLimits,
) []string {
	var reasons []string
	if !validQualificationPerformanceLimits(requested) {
		reasons = append(reasons, prefix+" requested performance limits are missing or invalid")
	}
	if !validQualificationPerformanceLimits(effective) {
		reasons = append(reasons, prefix+" effective performance limits are missing or invalid")
	}
	if requestedValidPreset, preset := qualificationPerformancePreset(profile); preset && requested != requestedValidPreset {
		reasons = append(reasons, prefix+" requested limits do not match the declared standard profile")
	}
	if effective.ImageTransformWorkers > requested.ImageTransformWorkers ||
		effective.ImageTransformAdmissions > requested.ImageTransformAdmissions ||
		effective.AssetUploadWorkers > requested.AssetUploadWorkers ||
		effective.LinkPreviewWorkers > requested.LinkPreviewWorkers ||
		effective.VideoWorkers > requested.VideoWorkers {
		reasons = append(reasons, prefix+" effective performance limits exceed requested limits")
	}
	return reasons
}

func validQualificationPerformanceLimits(limits QualificationPerformanceLimits) bool {
	return limits.ImageTransformWorkers >= 1 && limits.ImageTransformWorkers <= config.MaxPerformanceWorkers &&
		limits.ImageTransformAdmissions >= limits.ImageTransformWorkers && limits.ImageTransformAdmissions <= config.MaxPerformanceAdmissions &&
		limits.AssetUploadWorkers >= 1 && limits.AssetUploadWorkers <= config.MaxPerformanceWorkers &&
		limits.LinkPreviewWorkers >= 1 && limits.LinkPreviewWorkers <= config.MaxPerformanceWorkers &&
		limits.VideoWorkers >= 1 && limits.VideoWorkers <= config.MaxPerformanceWorkers
}

func qualificationPerformancePreset(profile QualificationProfile) (QualificationPerformanceLimits, bool) {
	switch profile {
	case QualificationProfileEconomy:
		return QualificationPerformanceLimits{1, 4, 2, 1, 1}, true
	case QualificationProfileBalanced:
		return QualificationPerformanceLimits{2, 8, 4, 2, 2}, true
	case QualificationProfilePerformance:
		return QualificationPerformanceLimits{4, 16, 8, 4, 4}, true
	default:
		return QualificationPerformanceLimits{}, false
	}
}

func qualificationAdmissionLimit(subsystem string, limits QualificationPerformanceLimits) (int, bool) {
	switch subsystem {
	case "image_transform":
		return limits.ImageTransformAdmissions, true
	case "asset_upload":
		return limits.AssetUploadWorkers, true
	case "link_preview":
		return limits.LinkPreviewWorkers, true
	case "video":
		return limits.VideoWorkers, true
	default:
		return 0, false
	}
}

func validateQualificationEnvelope(prefix string, profile QualificationProfile, envelope QualificationEnvelope) []string {
	var reasons []string
	wantCPUs, wantMemory := qualificationProfileEnvelope(profile)
	if profile != QualificationProfileCustom && (envelope.LogicalCPUs != wantCPUs || envelope.MemoryLimitBytes != wantMemory) {
		reasons = append(reasons, fmt.Sprintf("%s envelope does not match profile %s (%d CPU, %d bytes)", prefix, profile, wantCPUs, wantMemory))
	}
	if envelope.LogicalCPUs <= 0 || envelope.MemoryLimitBytes <= 0 || envelope.HostMemoryBytes < envelope.MemoryLimitBytes {
		reasons = append(reasons, prefix+" resource envelope is invalid")
	}
	if envelope.Architecture != "amd64" && envelope.Architecture != "arm64" {
		reasons = append(reasons, prefix+" architecture must be amd64 or arm64")
	}
	if envelope.CPUModel == "" || len(envelope.CPUModel) > 256 {
		reasons = append(reasons, prefix+" CPU model is missing or unbounded")
	}
	if !isSHA256(envelope.CgroupFingerprint) {
		reasons = append(reasons, prefix+" cgroup fingerprint must be a SHA-256 digest")
	}
	if !envelope.ThermalProven {
		reasons = append(reasons, prefix+" thermal or throttling evidence is not proven")
	}
	return reasons
}

func qualificationProfileEnvelope(profile QualificationProfile) (int, int64) {
	switch profile {
	case QualificationProfileEconomy:
		return 1, 2 * qualificationGiB
	case QualificationProfileBalanced:
		return 2, 4 * qualificationGiB
	case QualificationProfilePerformance:
		return 8, 16 * qualificationGiB
	default:
		return 0, 0
	}
}

func validQualificationProfile(profile QualificationProfile) bool {
	return profile == QualificationProfileEconomy || profile == QualificationProfileBalanced || profile == QualificationProfilePerformance || profile == QualificationProfileCustom
}

func validQualificationLoad(load QualificationLoadVector) bool {
	counts := []int{load.IdleConnections, load.ActiveConnections, load.ConcurrentUploads, load.AudioPublishers, load.AudioSubscribers, load.VideoPublishers, load.VideoSubscribers}
	activity := 0.0
	for _, value := range counts {
		if value < 0 {
			return false
		}
		activity += float64(value)
	}
	values := []float64{load.MessagesPerSecond, load.UploadMbps, load.ColdTransformsPerSecond, load.WarmReadsPerSecond, load.EgressMbps, load.CorpusGiB, load.ReadMiBPerSecond, load.WriteMiBPerSecond, load.StorageP95Millis}
	for _, value := range values {
		if !finiteNonNegative(value) {
			return false
		}
		activity += value
	}
	return activity > 0
}

func withinResourcePercent(used, limit int64, maximum float64) bool {
	return used > 0 && limit > 0 && 100*float64(used)/float64(limit) <= maximum
}

type qualificationFactor struct {
	name   string
	values []string
	value  func(QualificationRun) string
}

func validateQualificationResilienceCoverage(overload, recovery, soak []QualificationRun) []string {
	var reasons []string
	overloadRuns := make(map[QualificationProfile]map[string]QualificationRun)
	for _, run := range overload {
		if overloadRuns[run.Profile] == nil {
			overloadRuns[run.Profile] = make(map[string]QualificationRun)
		}
		overloadRuns[run.Profile][run.RunID] = run
	}
	for _, profile := range []QualificationProfile{
		QualificationProfileEconomy,
		QualificationProfileBalanced,
		QualificationProfilePerformance,
		QualificationProfileCustom,
	} {
		if !qualificationPhaseCoversProfile(overload, profile) {
			reasons = append(reasons, fmt.Sprintf("qualification lacks %s overload evidence", profile))
		}
		if !qualificationPhaseCoversProfile(recovery, profile) {
			reasons = append(reasons, fmt.Sprintf("qualification lacks %s recovery evidence", profile))
		}
	}
	if !qualificationPhaseCoversProfile(soak, QualificationProfileBalanced) {
		reasons = append(reasons, "qualification lacks balanced soak evidence")
	}
	for _, run := range recovery {
		if !ValidDeliveryRunID(run.PrecedingOverloadRunID) {
			reasons = append(reasons, fmt.Sprintf("recovery run %s is not linked to a same-profile overload", run.RunID))
			continue
		}
		overload, exists := overloadRuns[run.Profile][run.PrecedingOverloadRunID]
		if !exists {
			reasons = append(reasons, fmt.Sprintf("recovery run %s is not linked to a same-profile overload", run.RunID))
			continue
		}
		if run.Envelope != overload.Envelope || run.RequestedLimits != overload.RequestedLimits || run.EffectiveLimits != overload.EffectiveLimits || run.Backend != overload.Backend || run.CacheState != overload.CacheState || run.Network != overload.Network || run.Path != overload.Path {
			reasons = append(reasons, fmt.Sprintf("recovery run %s does not preserve its overload environment and limits", run.RunID))
		}
	}
	return reasons
}

func qualificationPhaseCoversProfile(runs []QualificationRun, profile QualificationProfile) bool {
	for _, run := range runs {
		if run.Profile == profile {
			return true
		}
	}
	return false
}

func validateQualificationPairwiseCoverage(runs []QualificationRun) []string {
	factors := []qualificationFactor{
		{name: "profile", values: []string{"economy", "balanced", "performance", "custom"}, value: func(run QualificationRun) string { return string(run.Profile) }},
		{name: "backend", values: []string{"nats", "s3"}, value: func(run QualificationRun) string { return run.Backend }},
		{name: "cache_state", values: []string{"cold", "warm", "full"}, value: func(run QualificationRun) string { return run.CacheState }},
		{name: "network", values: []string{"normal", "degraded"}, value: func(run QualificationRun) string { return string(run.Network) }},
		{name: "path", values: []string{"direct", "caddy_tls"}, value: func(run QualificationRun) string { return run.Path }},
	}
	var reasons []string
	for first := 0; first < len(factors); first++ {
		for second := first + 1; second < len(factors); second++ {
			for _, firstValue := range factors[first].values {
				for _, secondValue := range factors[second].values {
					covered := false
					for _, run := range runs {
						if factors[first].value(run) == firstValue && factors[second].value(run) == secondValue {
							covered = true
							break
						}
					}
					if !covered {
						reasons = append(reasons, fmt.Sprintf("nominal matrix lacks pair %s=%s, %s=%s", factors[first].name, firstValue, factors[second].name, secondValue))
					}
				}
			}
		}
	}
	return reasons
}

func validateQualificationScalePoints(points []QualificationScalePoint) ([]string, []string) {
	var reasons, limitations []string
	byCPU := make(map[int]QualificationScalePoint, len(points))
	for index, point := range points {
		if point.CPUs <= 0 || point.MemoryLimitBytes <= 0 || !finitePositive(point.ThroughputPerSecond) {
			reasons = append(reasons, fmt.Sprintf("scale point %d is invalid", index+1))
			continue
		}
		if point.CPUs == 1 || point.CPUs == 2 || point.CPUs == 4 || point.CPUs == 8 {
			if point.MemoryLimitBytes != int64(point.CPUs)*2*qualificationGiB {
				reasons = append(reasons, fmt.Sprintf("scale point %d CPU has the wrong memory envelope", point.CPUs))
			}
		}
		if _, duplicate := byCPU[point.CPUs]; duplicate {
			reasons = append(reasons, fmt.Sprintf("scale point repeats %d CPU", point.CPUs))
		}
		if point.CPUs >= 12 && !point.SeparateGenerator {
			reasons = append(reasons, fmt.Sprintf("scale point %d CPU requires a separate generator", point.CPUs))
		}
		byCPU[point.CPUs] = point
	}
	for _, cpus := range []int{1, 2, 4, 8} {
		if _, exists := byCPU[cpus]; !exists {
			reasons = append(reasons, fmt.Sprintf("capacity curve is missing the %d CPU scale point", cpus))
		}
	}
	ordered := make([]QualificationScalePoint, 0, len(byCPU))
	for _, point := range byCPU {
		if point.CPUs <= 8 {
			ordered = append(ordered, point)
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].CPUs < ordered[j].CPUs })
	if len(ordered) == 0 {
		return reasons, limitations
	}
	base := ordered[0]
	for index := 1; index < len(ordered); index++ {
		previous, current := ordered[index-1], ordered[index]
		if current.ThroughputPerSecond <= previous.ThroughputPerSecond {
			reasons = append(reasons, fmt.Sprintf("throughput is not monotonic from %d to %d CPU", previous.CPUs, current.CPUs))
			continue
		}
		ratio := current.ThroughputPerSecond / previous.ThroughputPerSecond
		efficiency := (current.ThroughputPerSecond / float64(current.CPUs)) / (base.ThroughputPerSecond / float64(base.CPUs)) * 100
		if ratio < 1.5 || efficiency < 60 {
			if !validBottleneckEvidence(current.Bottleneck) {
				if current.Bottleneck != "" {
					reasons = append(reasons, fmt.Sprintf("scale point %d CPU bottleneck evidence must be a non-empty single value of at most 512 bytes", current.CPUs))
				}
				reasons = append(reasons, fmt.Sprintf("scale point %d CPU is below the 1.5x target or 60%% efficiency without a measured bottleneck", current.CPUs))
			} else {
				limitations = append(limitations, fmt.Sprintf("scale point %d CPU is below the 1.5x target or 60%% efficiency: %s", current.CPUs, current.Bottleneck))
			}
		}
	}
	return reasons, limitations
}

func validBottleneckEvidence(value string) bool {
	return len(value) <= 512 && strings.TrimSpace(value) != ""
}
