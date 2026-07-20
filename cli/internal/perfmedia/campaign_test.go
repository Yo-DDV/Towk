package perfmedia

import (
	"math"
	"strings"
	"testing"
)

func TestNetworkProfilesAndEvidenceAreBounded(t *testing.T) {
	const qdiscSHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	tests := []struct {
		name    NetworkProfileName
		rate    float64
		rtt     float64
		loss    float64
		seed    uint32
		ingress bool
	}{
		{name: NetworkLocal},
		{name: NetworkLAN, rate: 1000, rtt: 2},
		{name: NetworkNormal, rate: 20, rtt: 50, ingress: true},
		{name: NetworkDegraded, rate: 4, rtt: 150, loss: 1, seed: 260717, ingress: true},
	}
	local, _ := NetworkProfileFor(NetworkLocal)
	if reasons := ValidateNetworkEvidence(local, NetworkEvidence{Profile: NetworkLocal, MeasuredRateMbps: 1000}); len(reasons) == 0 {
		t.Fatal("local microbenchmark profile accepted invented network evidence")
	}
	for _, tt := range tests {
		profile, err := NetworkProfileFor(tt.name)
		if err != nil {
			t.Fatalf("NetworkProfileFor(%q): %v", tt.name, err)
		}
		evidence := NetworkEvidence{
			Profile: tt.name, MeasuredRateMbps: tt.rate, MeasuredRTTMillis: tt.rtt,
			MeasuredLossPercent: tt.loss, Seed: tt.seed, ShapedBothDirections: tt.ingress,
			ReceiverIngress: tt.ingress,
		}
		if tt.name == NetworkNormal || tt.name == NetworkDegraded {
			evidence.SenderQdiscSHA256 = qdiscSHA
			evidence.ReceiverQdiscSHA256 = qdiscSHA
		}
		if reasons := ValidateNetworkEvidence(profile, evidence); len(reasons) != 0 {
			t.Errorf("ValidateNetworkEvidence(%q) = %v, want valid", tt.name, reasons)
		}
	}

	profile, _ := NetworkProfileFor(NetworkDegraded)
	bad := NetworkEvidence{
		Profile: NetworkDegraded, MeasuredRateMbps: 4, MeasuredRTTMillis: 150,
		MeasuredLossPercent: 1, Seed: 0, ShapedBothDirections: false, ReceiverIngress: false,
	}
	if reasons := ValidateNetworkEvidence(profile, bad); len(reasons) < 3 {
		t.Fatalf("incomplete degraded evidence reasons = %v, want seed and bidirectional placement failures", reasons)
	}
	if _, err := NetworkProfileFor(NetworkProfileName("untrusted")); err == nil {
		t.Fatal("unknown network profile was accepted")
	}
}

func TestDeliveryCampaignRejectsLocalOnlyNetworkProfile(t *testing.T) {
	conditions := CampaignConditions{
		Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
		Network: NetworkLocal, Path: "direct", CgroupFingerprint: strings.Repeat("b", 64),
		CorpusSHA256: strings.Repeat("a", 64), WorkloadSHA256: strings.Repeat("c", 64),
	}
	if reasons := validateCampaignConditions(conditions); len(reasons) == 0 || !strings.Contains(strings.Join(reasons, " "), "network profile") {
		t.Fatalf("local delivery conditions reasons = %v, want rejection", reasons)
	}
}

func TestAssessCampaignStability(t *testing.T) {
	conditions := CampaignConditions{
		Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
		Network: NetworkNormal, Path: "direct", CgroupFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		CorpusSHA256:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		WorkloadSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
	}
	stable := []CampaignSample{
		{Conditions: conditions, Throughput: 100, P95Millis: 200},
		{Conditions: conditions, Throughput: 105, P95Millis: 190},
		{Conditions: conditions, Throughput: 95, P95Millis: 210},
	}
	assessment := AssessCampaignStability(stable, 10)
	if !assessment.Canonical || assessment.Status != "VERIFIED" || len(assessment.Reasons) != 0 {
		t.Fatalf("stable campaign = %+v, want canonical", assessment)
	}
	if math.Abs(assessment.ThroughputMaxDeviationPercent-5) > 0.001 {
		t.Fatalf("throughput deviation = %v, want 5", assessment.ThroughputMaxDeviationPercent)
	}

	unstable := append([]CampaignSample(nil), stable...)
	unstable[2].P95Millis = 260
	assessment = AssessCampaignStability(unstable, 10)
	if assessment.Canonical || assessment.Status != "UNSTABLE" || len(assessment.Reasons) == 0 {
		t.Fatalf("unstable campaign = %+v, want rejected", assessment)
	}

	mismatched := append([]CampaignSample(nil), stable...)
	mismatched[2].Conditions.CacheState = "cold"
	assessment = AssessCampaignStability(mismatched, 10)
	if assessment.Canonical || len(assessment.Reasons) == 0 {
		t.Fatalf("mismatched campaign = %+v, want rejected", assessment)
	}

	invalid := append([]CampaignSample(nil), stable...)
	invalid[0].Conditions.Backend = "private-backend-name"
	assessment = AssessCampaignStability(invalid, 10)
	if assessment.Canonical || len(assessment.Reasons) == 0 {
		t.Fatalf("unbounded conditions = %+v, want rejected", assessment)
	}
}

func TestAssessMonitoringOverhead(t *testing.T) {
	conditions := CampaignConditions{
		Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
		Network: NetworkNormal, Path: "direct",
		CgroupFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		CorpusSHA256:      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		WorkloadSHA256:    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
	}
	off := []MonitoringSample{{Conditions: conditions, CPUSeconds: 100, P95Millis: 100}, {Conditions: conditions, CPUSeconds: 101, P95Millis: 101}, {Conditions: conditions, CPUSeconds: 99, P95Millis: 99}}
	on := []MonitoringSample{{Conditions: conditions, CPUSeconds: 101, P95Millis: 101}, {Conditions: conditions, CPUSeconds: 102, P95Millis: 102}, {Conditions: conditions, CPUSeconds: 100, P95Millis: 100}}
	assessment := AssessMonitoringOverhead(off, on, 2)
	if !assessment.Accepted || assessment.Status != "VERIFIED" {
		t.Fatalf("monitoring overhead = %+v, want accepted", assessment)
	}

	on[1].P95Millis = 120
	on[2].P95Millis = 120
	assessment = AssessMonitoringOverhead(off, on, 2)
	if assessment.Accepted || assessment.Status != "REGRESSION" || len(assessment.Reasons) == 0 {
		t.Fatalf("high monitoring overhead = %+v, want rejected", assessment)
	}

	on[2].Conditions.Backend = "s3"
	on[1].P95Millis = 102
	on[2].P95Millis = 100
	assessment = AssessMonitoringOverhead(off, on, 2)
	if assessment.Accepted || assessment.Status != "UNVERIFIED" || !strings.Contains(strings.Join(assessment.Reasons, " "), "conditions differ") {
		t.Fatalf("mismatched monitoring conditions = %+v, want rejected", assessment)
	}
}
