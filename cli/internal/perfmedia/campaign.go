package perfmedia

import (
	"encoding/hex"
	"fmt"
	"math"
	"slices"
	"strings"
)

type NetworkProfileName string

const (
	NetworkLocal    NetworkProfileName = "local"
	NetworkLAN      NetworkProfileName = "lan"
	NetworkNormal   NetworkProfileName = "normal"
	NetworkDegraded NetworkProfileName = "degraded"
)

type NetworkProfile struct {
	Name                   NetworkProfileName `json:"name"`
	TargetRateMbps         float64            `json:"target_rate_mbps"`
	TargetRTTMillis        float64            `json:"target_rtt_millis"`
	TargetLossPercent      float64            `json:"target_loss_percent"`
	OneWayDelayMillis      float64            `json:"one_way_delay_millis"`
	RequireBidirectional   bool               `json:"require_bidirectional"`
	RequireReceiverIngress bool               `json:"require_receiver_ingress"`
}

type NetworkEvidence struct {
	Profile              NetworkProfileName `json:"profile"`
	MeasuredRateMbps     float64            `json:"measured_rate_mbps"`
	MeasuredRTTMillis    float64            `json:"measured_rtt_millis"`
	MeasuredLossPercent  float64            `json:"measured_loss_percent"`
	Seed                 uint32             `json:"seed,omitempty"`
	ShapedBothDirections bool               `json:"shaped_both_directions"`
	ReceiverIngress      bool               `json:"receiver_ingress"`
	SenderQdiscSHA256    string             `json:"sender_qdisc_sha256,omitempty"`
	ReceiverQdiscSHA256  string             `json:"receiver_qdisc_sha256,omitempty"`
}

func NetworkProfileFor(name NetworkProfileName) (NetworkProfile, error) {
	switch name {
	case NetworkLocal:
		return NetworkProfile{Name: name}, nil
	case NetworkLAN:
		return NetworkProfile{Name: name, TargetRateMbps: 1000, TargetRTTMillis: 2}, nil
	case NetworkNormal:
		return NetworkProfile{
			Name: name, TargetRateMbps: 20, TargetRTTMillis: 50, OneWayDelayMillis: 25,
			RequireBidirectional: true, RequireReceiverIngress: true,
		}, nil
	case NetworkDegraded:
		return NetworkProfile{
			Name: name, TargetRateMbps: 4, TargetRTTMillis: 150, TargetLossPercent: 1, OneWayDelayMillis: 75,
			RequireBidirectional: true, RequireReceiverIngress: true,
		}, nil
	default:
		return NetworkProfile{}, fmt.Errorf("unknown network profile %q", name)
	}
}

func ValidateNetworkEvidence(profile NetworkProfile, evidence NetworkEvidence) []string {
	var reasons []string
	if evidence.Profile != profile.Name {
		reasons = append(reasons, fmt.Sprintf("network evidence profile %q does not match %q", evidence.Profile, profile.Name))
	}
	switch profile.Name {
	case NetworkLocal:
		if evidence.MeasuredRateMbps != 0 || evidence.MeasuredRTTMillis != 0 || evidence.MeasuredLossPercent != 0 ||
			evidence.Seed != 0 || evidence.ShapedBothDirections || evidence.ReceiverIngress ||
			evidence.SenderQdiscSHA256 != "" || evidence.ReceiverQdiscSHA256 != "" {
			reasons = append(reasons, "local microbenchmark profile must not declare network measurements or shaping evidence")
		}
		return reasons
	case NetworkLAN, NetworkNormal, NetworkDegraded:
		if !finitePositive(evidence.MeasuredRateMbps) || !finiteNonNegative(evidence.MeasuredRTTMillis) || !finiteNonNegative(evidence.MeasuredLossPercent) {
			return append(reasons, "network evidence contains a missing or invalid measurement")
		}
	default:
		return append(reasons, "network evidence profile is unknown")
	}
	switch profile.Name {
	case NetworkLAN:
		if evidence.MeasuredRateMbps < profile.TargetRateMbps {
			reasons = append(reasons, fmt.Sprintf("network LAN rate %.3f Mbps is below %.3f Mbps", evidence.MeasuredRateMbps, profile.TargetRateMbps))
		}
		if evidence.MeasuredRTTMillis > profile.TargetRTTMillis {
			reasons = append(reasons, fmt.Sprintf("network LAN RTT %.3f ms exceeds %.3f ms", evidence.MeasuredRTTMillis, profile.TargetRTTMillis))
		}
		if evidence.MeasuredLossPercent != 0 {
			reasons = append(reasons, "network LAN evidence must report zero packet loss")
		}
	case NetworkNormal, NetworkDegraded:
		if relativeDifferencePercent(evidence.MeasuredRateMbps, profile.TargetRateMbps) > 5 {
			reasons = append(reasons, fmt.Sprintf("network rate %.3f Mbps differs from target %.3f Mbps by more than 5%%", evidence.MeasuredRateMbps, profile.TargetRateMbps))
		}
		if relativeDifferencePercent(evidence.MeasuredRTTMillis, profile.TargetRTTMillis) > 10 {
			reasons = append(reasons, fmt.Sprintf("network RTT %.3f ms differs from target %.3f ms by more than 10%%", evidence.MeasuredRTTMillis, profile.TargetRTTMillis))
		}
		if math.Abs(evidence.MeasuredLossPercent-profile.TargetLossPercent) > 0.2 {
			reasons = append(reasons, fmt.Sprintf("network loss %.3f%% differs from target %.3f%% by more than 0.2 point", evidence.MeasuredLossPercent, profile.TargetLossPercent))
		}
		if profile.RequireBidirectional && !evidence.ShapedBothDirections {
			reasons = append(reasons, "network profile is not proven in both directions")
		}
		if profile.RequireReceiverIngress && !evidence.ReceiverIngress {
			reasons = append(reasons, "network profile lacks receiver-ingress evidence")
		}
		if !isSHA256(evidence.SenderQdiscSHA256) || !isSHA256(evidence.ReceiverQdiscSHA256) {
			reasons = append(reasons, "network profile lacks hashed qdisc evidence for both endpoints")
		}
		if profile.TargetLossPercent > 0 && evidence.Seed == 0 {
			reasons = append(reasons, "network loss profile lacks a deterministic non-zero seed")
		}
	}
	return reasons
}

type CampaignConditions struct {
	Revision          string             `json:"revision"`
	Backend           string             `json:"backend"`
	CacheState        string             `json:"cache_state"`
	Network           NetworkProfileName `json:"network"`
	Path              string             `json:"path"`
	CgroupFingerprint string             `json:"cgroup_fingerprint"`
	CorpusSHA256      string             `json:"corpus_sha256"`
	WorkloadSHA256    string             `json:"workload_sha256"`
}

type CampaignSample struct {
	Conditions CampaignConditions `json:"conditions"`
	Throughput float64            `json:"throughput_per_second"`
	P95Millis  float64            `json:"p95_millis"`
}

type StabilityAssessment struct {
	Canonical                     bool     `json:"canonical"`
	Status                        string   `json:"status"`
	ThroughputMedian              float64  `json:"throughput_median"`
	P95MedianMillis               float64  `json:"p95_median_millis"`
	ThroughputMaxDeviationPercent float64  `json:"throughput_max_deviation_percent"`
	P95MaxDeviationPercent        float64  `json:"p95_max_deviation_percent"`
	Reasons                       []string `json:"reasons,omitempty"`
}

func AssessCampaignStability(samples []CampaignSample, maximumDeviationPercent float64) StabilityAssessment {
	assessment := StabilityAssessment{Status: "UNVERIFIED"}
	if len(samples) < 3 {
		assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("campaign has %d independent runs; at least 3 are required", len(samples)))
		return assessment
	}
	if !finitePositive(maximumDeviationPercent) {
		assessment.Reasons = append(assessment.Reasons, "maximum campaign deviation must be finite and positive")
		return assessment
	}
	base := samples[0].Conditions
	throughput := make([]float64, 0, len(samples))
	p95 := make([]float64, 0, len(samples))
	for i, sample := range samples {
		if conditionReasons := validateCampaignConditions(sample.Conditions); len(conditionReasons) != 0 {
			for _, reason := range conditionReasons {
				assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("campaign run %d: %s", i+1, reason))
			}
		}
		if sample.Conditions != base {
			assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("campaign run %d conditions differ from run 1", i+1))
		}
		if !finitePositive(sample.Throughput) || !finitePositive(sample.P95Millis) {
			assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("campaign run %d has an invalid throughput or p95", i+1))
			continue
		}
		throughput = append(throughput, sample.Throughput)
		p95 = append(p95, sample.P95Millis)
	}
	if len(throughput) != len(samples) {
		return assessment
	}
	assessment.ThroughputMedian = median(throughput)
	assessment.P95MedianMillis = median(p95)
	assessment.ThroughputMaxDeviationPercent = maxDeviationPercent(throughput, assessment.ThroughputMedian)
	assessment.P95MaxDeviationPercent = maxDeviationPercent(p95, assessment.P95MedianMillis)
	inputReasons := len(assessment.Reasons)
	if assessment.ThroughputMaxDeviationPercent > maximumDeviationPercent {
		assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("throughput maximum deviation %.3f%% exceeds %.3f%%", assessment.ThroughputMaxDeviationPercent, maximumDeviationPercent))
	}
	if assessment.P95MaxDeviationPercent > maximumDeviationPercent {
		assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("p95 maximum deviation %.3f%% exceeds %.3f%%", assessment.P95MaxDeviationPercent, maximumDeviationPercent))
	}
	assessment.Canonical = len(assessment.Reasons) == 0
	if assessment.Canonical {
		assessment.Status = "VERIFIED"
	} else if inputReasons == 0 {
		assessment.Status = "UNSTABLE"
	}
	return assessment
}

func validateCampaignConditions(conditions CampaignConditions) []string {
	var reasons []string
	if !isHexLength(conditions.Revision, 40) && !isHexLength(conditions.Revision, 64) {
		reasons = append(reasons, "revision must be a full 40- or 64-character hexadecimal object ID")
	}
	if conditions.Backend != "nats" && conditions.Backend != "s3" {
		reasons = append(reasons, "backend must be nats or s3")
	}
	if conditions.CacheState != "cold" && conditions.CacheState != "warm" && conditions.CacheState != "full" {
		reasons = append(reasons, "cache state must be cold, warm, or full")
	}
	if conditions.Network != NetworkLAN && conditions.Network != NetworkNormal && conditions.Network != NetworkDegraded {
		reasons = append(reasons, "network profile is unknown")
	}
	if conditions.Path != "direct" && conditions.Path != "caddy_tls" {
		reasons = append(reasons, "path must be direct or caddy_tls")
	}
	if !isSHA256(conditions.CgroupFingerprint) {
		reasons = append(reasons, "cgroup fingerprint must be a SHA-256 digest")
	}
	if !isSHA256(conditions.CorpusSHA256) {
		reasons = append(reasons, "corpus fingerprint must be a SHA-256 digest")
	}
	if !isSHA256(conditions.WorkloadSHA256) {
		reasons = append(reasons, "workload fingerprint must be a SHA-256 digest")
	}
	return reasons
}

type MonitoringSample struct {
	Conditions CampaignConditions `json:"conditions"`
	CPUSeconds float64            `json:"cpu_seconds"`
	P95Millis  float64            `json:"p95_millis"`
}

type MonitoringOverheadAssessment struct {
	Accepted          bool     `json:"accepted"`
	Status            string   `json:"status"`
	CPUPercent        float64  `json:"cpu_percent"`
	P95Percent        float64  `json:"p95_percent"`
	MetricsOffSamples int      `json:"metrics_off_samples"`
	MetricsOnSamples  int      `json:"metrics_on_samples"`
	MaximumPercent    float64  `json:"maximum_percent"`
	Reasons           []string `json:"reasons,omitempty"`
}

func AssessMonitoringOverhead(off, on []MonitoringSample, maximumPercent float64) MonitoringOverheadAssessment {
	assessment := MonitoringOverheadAssessment{
		Status: "UNVERIFIED", MetricsOffSamples: len(off), MetricsOnSamples: len(on), MaximumPercent: maximumPercent,
	}
	if len(off) < 3 || len(on) < 3 || len(off) != len(on) {
		assessment.Reasons = append(assessment.Reasons, "monitoring comparison requires matching sets of at least 3 samples")
		return assessment
	}
	if !finitePositive(maximumPercent) {
		assessment.Reasons = append(assessment.Reasons, "maximum monitoring overhead must be finite and positive")
		return assessment
	}
	offCPU, offP95 := make([]float64, 0, len(off)), make([]float64, 0, len(off))
	onCPU, onP95 := make([]float64, 0, len(on)), make([]float64, 0, len(on))
	base := off[0].Conditions
	for i := range off {
		if off[i].Conditions != base || on[i].Conditions != base {
			assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("monitoring sample pair %d conditions differ from pair 1", i+1))
		}
		if conditionReasons := validateCampaignConditions(off[i].Conditions); len(conditionReasons) != 0 {
			for _, reason := range conditionReasons {
				assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("monitoring sample pair %d: %s", i+1, reason))
			}
		}
		if !finitePositive(off[i].CPUSeconds) || !finitePositive(off[i].P95Millis) || !finitePositive(on[i].CPUSeconds) || !finitePositive(on[i].P95Millis) {
			assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("monitoring sample pair %d contains an invalid measurement", i+1))
			continue
		}
		offCPU, offP95 = append(offCPU, off[i].CPUSeconds), append(offP95, off[i].P95Millis)
		onCPU, onP95 = append(onCPU, on[i].CPUSeconds), append(onP95, on[i].P95Millis)
	}
	if len(offCPU) != len(off) {
		return assessment
	}
	assessment.CPUPercent = relativeChangePercent(median(offCPU), median(onCPU))
	assessment.P95Percent = relativeChangePercent(median(offP95), median(onP95))
	inputReasons := len(assessment.Reasons)
	if assessment.CPUPercent > maximumPercent {
		assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("monitoring CPU overhead %.3f%% exceeds %.3f%%", assessment.CPUPercent, maximumPercent))
	}
	if assessment.P95Percent > maximumPercent {
		assessment.Reasons = append(assessment.Reasons, fmt.Sprintf("monitoring p95 overhead %.3f%% exceeds %.3f%%", assessment.P95Percent, maximumPercent))
	}
	assessment.Accepted = len(assessment.Reasons) == 0
	if assessment.Accepted {
		assessment.Status = "VERIFIED"
	} else if inputReasons == 0 {
		assessment.Status = "REGRESSION"
	}
	return assessment
}

func median(values []float64) float64 {
	ordered := slices.Clone(values)
	slices.Sort(ordered)
	middle := len(ordered) / 2
	if len(ordered)%2 == 1 {
		return ordered[middle]
	}
	return (ordered[middle-1] + ordered[middle]) / 2
}

func maxDeviationPercent(values []float64, center float64) float64 {
	maximum := 0.0
	for _, value := range values {
		maximum = max(maximum, relativeDifferencePercent(value, center))
	}
	return maximum
}

func relativeDifferencePercent(value, target float64) float64 {
	if !finitePositive(target) {
		return math.Inf(1)
	}
	return math.Abs(value-target) / target * 100
}

func relativeChangePercent(before, after float64) float64 {
	if !finitePositive(before) {
		return math.Inf(1)
	}
	return (after - before) / before * 100
}

func finitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func finiteNonNegative(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func isSHA256(value string) bool {
	return isHexLength(value, 64)
}

func isHexLength(value string, length int) bool {
	if len(value) != length || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
