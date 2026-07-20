package perfmedia

import (
	"strings"
	"testing"
)

func TestParsePressureSample(t *testing.T) {
	sample, err := ParsePressureSample("some avg10=0.12 avg60=0.34 avg300=0.56 total=1234\nfull avg10=0.01 avg60=0.02 avg300=0.03 total=456\n")
	if err != nil {
		t.Fatalf("ParsePressureSample: %v", err)
	}
	if sample.Some.Avg10 != 0.12 || sample.Some.TotalMicros != 1234 || sample.Full.Avg300 != 0.03 || sample.Full.TotalMicros != 456 {
		t.Fatalf("ParsePressureSample = %+v", sample)
	}
	if _, err := ParsePressureSample("some avg10=nope\n"); err == nil {
		t.Fatal("malformed pressure input was accepted")
	}
}

func FuzzParsePressureSampleNeverPanics(f *testing.F) {
	f.Add("some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n")
	f.Add("some avg10=nope\n")
	f.Fuzz(func(t *testing.T, input string) {
		_, _ = ParsePressureSample(input)
	})
}

func TestEvaluatePreflightRejectsUnverifiableCampaign(t *testing.T) {
	profile, _ := NetworkProfileFor(NetworkNormal)
	snapshot := PreflightSnapshot{
		OS: "linux", Architecture: "amd64", WorkDirFingerprint: strings.Repeat("a", 64), WorkVolumeFingerprint: strings.Repeat("c", 64), DiskFreePercent: 15,
		GitRevision: "0123456789abcdef0123456789abcdef01234567", GitDirty: false,
		Cgroup: CgroupSnapshot{
			Version: 2, PathFingerprint: "cgroup-a", CPUMax: "200000 100000", EffectiveCPUs: 2, CPUSetEffective: "0-3", ProcessCPUSet: "0-1",
			MemoryMaxBytes: 4 << 30, ResourceFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
		ThermalEvidence: "throttle_counters",
		Pressure: ResourcePressure{
			Available: true, Scope: "cgroup",
			Memory: PressureSample{Some: PressureLine{Avg10: 0.2}},
			IO:     PressureSample{Full: PressureLine{Avg10: 0.01}},
		},
	}
	expect := PreflightExpectations{
		MinDiskFreePercent: 20, ExpectedArchitecture: "arm64", ExpectedCPUs: 4,
		ExpectedMemoryBytes: 8 << 30, MaxPressureSomeAvg10: 0.1, MaxPressureFullAvg10: 0,
		NetworkProfile: profile,
		NetworkEvidence: NetworkEvidence{
			Profile: NetworkNormal, MeasuredRateMbps: 20, MeasuredRTTMillis: 50,
		},
		RequireSeparateGenerator: true,
	}
	report := EvaluatePreflight(snapshot, expect)
	if report.Canonical || len(report.Reasons) < 8 {
		t.Fatalf("EvaluatePreflight = %+v, want multiple explicit rejection reasons", report)
	}
	joined := strings.Join(report.Reasons, " ")
	for _, want := range []string{"disk", "architecture", "CPU", "memory", "pressure", "network", "generator"} {
		if !strings.Contains(joined, want) {
			t.Errorf("preflight reasons missing %q: %s", want, joined)
		}
	}
}

func TestEvaluatePreflightAcceptsFullyProvenCampaign(t *testing.T) {
	const qdiscSHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	profile, _ := NetworkProfileFor(NetworkDegraded)
	snapshot := PreflightSnapshot{
		OS: "linux", Architecture: "amd64", WorkDirFingerprint: strings.Repeat("a", 64), WorkVolumeFingerprint: strings.Repeat("c", 64), DiskFreePercent: 25,
		GitRevision: "0123456789abcdef0123456789abcdef01234567", GitDirty: false,
		Cgroup: CgroupSnapshot{
			Version: 2, PathFingerprint: "cgroup-a", CPUMax: "200000 100000", EffectiveCPUs: 2, CPUSetEffective: "0-3", ProcessCPUSet: "0-1",
			MemoryMaxBytes: 4 << 30, ResourceFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
		ThermalEvidence: "throttle_counters",
		Pressure:        ResourcePressure{Available: true, Scope: "cgroup"},
	}
	expect := PreflightExpectations{
		MinDiskFreePercent: 20, ExpectedArchitecture: "amd64", ExpectedCPUs: 2,
		ExpectedMemoryBytes: 4 << 30, MaxPressureSomeAvg10: 0.1, MaxPressureFullAvg10: 0,
		NetworkProfile: profile,
		NetworkEvidence: NetworkEvidence{
			Profile: NetworkDegraded, MeasuredRateMbps: 4, MeasuredRTTMillis: 150,
			MeasuredLossPercent: 1, Seed: 260717, ShapedBothDirections: true, ReceiverIngress: true,
			SenderQdiscSHA256: qdiscSHA, ReceiverQdiscSHA256: qdiscSHA,
		},
		RequireSeparateGenerator: true, SeparateGeneratorProven: true,
	}
	report := EvaluatePreflight(snapshot, expect)
	if !report.Canonical || len(report.Reasons) != 0 {
		t.Fatalf("EvaluatePreflight = %+v, want canonical", report)
	}
}

func TestEvaluatePreflightRejectsMissingProcessAffinity(t *testing.T) {
	profile, _ := NetworkProfileFor(NetworkLocal)
	snapshot := PreflightSnapshot{
		OS: "linux", Architecture: "amd64", WorkDirFingerprint: strings.Repeat("a", 64), WorkVolumeFingerprint: strings.Repeat("c", 64), DiskFreePercent: 25,
		GitRevision: strings.Repeat("1", 40),
		Cgroup: CgroupSnapshot{
			Version: 2, CPUMax: "200000 100000", EffectiveCPUs: 2, CPUSetEffective: "0-3", MemoryMaxBytes: 4 << 30,
			ResourceFingerprint: strings.Repeat("b", 64),
		},
		ThermalEvidence: "throttle_counters",
		Pressure:        ResourcePressure{Available: true, Scope: "cgroup"},
	}
	expect := PreflightExpectations{
		MinDiskFreePercent: 20, ExpectedArchitecture: "amd64", ExpectedCPUs: 2,
		ExpectedMemoryBytes: 4 << 30, MaxPressureSomeAvg10: 0.1,
		NetworkProfile:  profile,
		NetworkEvidence: NetworkEvidence{Profile: NetworkLocal},
	}
	report := EvaluatePreflight(snapshot, expect)
	if report.Canonical || !strings.Contains(strings.Join(report.Reasons, " "), "process CPU affinity") {
		t.Fatalf("EvaluatePreflight = %+v, want explicit process affinity rejection", report)
	}
}

func TestEvaluatePreflightRejectsHostWidePressureFallback(t *testing.T) {
	profile, _ := NetworkProfileFor(NetworkLocal)
	snapshot := PreflightSnapshot{
		OS: "linux", Architecture: "amd64", WorkDirFingerprint: strings.Repeat("a", 64), WorkVolumeFingerprint: strings.Repeat("c", 64), DiskFreePercent: 25,
		GitRevision: strings.Repeat("1", 40),
		Cgroup: CgroupSnapshot{
			Version: 2, CPUMax: "200000 100000", EffectiveCPUs: 2, CPUSetEffective: "0-3", ProcessCPUSet: "0-1",
			MemoryMaxBytes: 4 << 30, ResourceFingerprint: strings.Repeat("b", 64),
		},
		ThermalEvidence: "throttle_counters",
		Pressure:        ResourcePressure{Available: true, Scope: "system"},
	}
	expect := PreflightExpectations{
		MinDiskFreePercent: 20, ExpectedArchitecture: "amd64", ExpectedCPUs: 2,
		ExpectedMemoryBytes: 4 << 30, MaxPressureSomeAvg10: 0.1,
		NetworkProfile:  profile,
		NetworkEvidence: NetworkEvidence{Profile: NetworkLocal},
	}
	report := EvaluatePreflight(snapshot, expect)
	if report.Canonical || !strings.Contains(strings.Join(report.Reasons, " "), "benchmark cgroup") {
		t.Fatalf("EvaluatePreflight = %+v, want cgroup-scoped PSI rejection", report)
	}
}

func TestParseCPUQuotaRequiresExplicitPositiveLimit(t *testing.T) {
	for input, wantOK := range map[string]bool{
		"200000 100000": true,
		"max 100000":    false,
		"0 100000":      false,
		"200000 0":      false,
		"broken":        false,
	} {
		got, ok := parseCPUQuota(input)
		if ok != wantOK {
			t.Errorf("parseCPUQuota(%q) ok = %v, want %v", input, ok, wantOK)
		}
		if input == "200000 100000" && got != 2 {
			t.Errorf("parseCPUQuota(%q) = %v, want 2", input, got)
		}
	}
}
