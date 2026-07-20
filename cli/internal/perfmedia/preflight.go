package perfmedia

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type PressureLine struct {
	Avg10       float64 `json:"avg10"`
	Avg60       float64 `json:"avg60"`
	Avg300      float64 `json:"avg300"`
	TotalMicros uint64  `json:"total_micros"`
}

type PressureSample struct {
	Some PressureLine `json:"some"`
	Full PressureLine `json:"full"`
}

type ResourcePressure struct {
	Available bool           `json:"available"`
	CPU       PressureSample `json:"cpu"`
	Memory    PressureSample `json:"memory"`
	IO        PressureSample `json:"io"`
	Scope     string         `json:"scope"`
}

type CgroupSnapshot struct {
	Version             int               `json:"version"`
	PathFingerprint     string            `json:"path_fingerprint,omitempty"`
	CPUMax              string            `json:"cpu_max,omitempty"`
	CPUWeight           string            `json:"cpu_weight,omitempty"`
	EffectiveCPUs       float64           `json:"effective_cpus"`
	CPUSetEffective     string            `json:"cpuset_effective,omitempty"`
	ProcessCPUSet       string            `json:"process_cpuset,omitempty"`
	MemoryMax           string            `json:"memory_max,omitempty"`
	MemoryHigh          string            `json:"memory_high,omitempty"`
	MemorySwapMax       string            `json:"memory_swap_max,omitempty"`
	MemoryMaxBytes      int64             `json:"memory_max_bytes,omitempty"`
	MemoryCurrentBytes  int64             `json:"memory_current_bytes,omitempty"`
	CPUStat             map[string]uint64 `json:"cpu_stat,omitempty"`
	IOMaxSHA256         string            `json:"io_max_sha256,omitempty"`
	IOStatTotals        map[string]uint64 `json:"io_stat_totals,omitempty"`
	PIDsMax             string            `json:"pids_max,omitempty"`
	ResourceFingerprint string            `json:"resource_fingerprint,omitempty"`
}

type PreflightSnapshot struct {
	OS                    string           `json:"os"`
	Architecture          string           `json:"architecture"`
	KernelRelease         string           `json:"kernel_release,omitempty"`
	CPUModel              string           `json:"cpu_model,omitempty"`
	LogicalCPUs           int              `json:"logical_cpus"`
	MemoryTotalBytes      int64            `json:"memory_total_bytes,omitempty"`
	WorkDirFingerprint    string           `json:"work_dir_fingerprint"`
	WorkVolumeFingerprint string           `json:"work_volume_fingerprint"`
	DiskFreePercent       float64          `json:"disk_free_percent"`
	GitRevision           string           `json:"git_revision"`
	GitDirty              bool             `json:"git_dirty"`
	Cgroup                CgroupSnapshot   `json:"cgroup"`
	Pressure              ResourcePressure `json:"pressure"`
	ScalingGovernors      []string         `json:"scaling_governors,omitempty"`
	ThermalThrottleCount  uint64           `json:"thermal_throttle_count,omitempty"`
	ThermalMaxMilliC      int64            `json:"thermal_max_millicelsius,omitempty"`
	ThermalEvidence       string           `json:"thermal_evidence"`
	ThermalHeadroomMilliC int64            `json:"thermal_headroom_millicelsius,omitempty"`
	ClockSource           string           `json:"clock_source,omitempty"`
}

type PreflightExpectations struct {
	MinDiskFreePercent       float64         `json:"min_disk_free_percent"`
	ExpectedArchitecture     string          `json:"expected_architecture,omitempty"`
	ExpectedCPUs             float64         `json:"expected_cpus,omitempty"`
	ExpectedMemoryBytes      int64           `json:"expected_memory_bytes,omitempty"`
	MaxPressureSomeAvg10     float64         `json:"max_pressure_some_avg10"`
	MaxPressureFullAvg10     float64         `json:"max_pressure_full_avg10"`
	NetworkProfile           NetworkProfile  `json:"network_profile"`
	NetworkEvidence          NetworkEvidence `json:"network_evidence"`
	RequireSeparateGenerator bool            `json:"require_separate_generator"`
	SeparateGeneratorProven  bool            `json:"separate_generator_proven"`
}

type PreflightReport struct {
	Schema          string                `json:"schema"`
	CapturedAt      time.Time             `json:"captured_at"`
	ProtocolCommand string                `json:"protocol_command"`
	Canonical       bool                  `json:"canonical"`
	Status          string                `json:"status"`
	Reasons         []string              `json:"reasons,omitempty"`
	Snapshot        PreflightSnapshot     `json:"snapshot"`
	Expectations    PreflightExpectations `json:"expectations"`
}

func ParsePressureSample(input string) (PressureSample, error) {
	var sample PressureSample
	seen := map[string]bool{}
	scanner := bufio.NewScanner(strings.NewReader(input))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 0 {
			continue
		}
		kind := fields[0]
		if kind != "some" && kind != "full" {
			return PressureSample{}, fmt.Errorf("unknown pressure line %q", kind)
		}
		line, err := parsePressureLine(fields[1:])
		if err != nil {
			return PressureSample{}, fmt.Errorf("parse pressure %s: %w", kind, err)
		}
		if kind == "some" {
			sample.Some = line
		} else {
			sample.Full = line
		}
		seen[kind] = true
	}
	if err := scanner.Err(); err != nil {
		return PressureSample{}, err
	}
	if !seen["some"] || !seen["full"] {
		return PressureSample{}, errors.New("pressure sample must contain some and full lines")
	}
	return sample, nil
}

func parsePressureLine(fields []string) (PressureLine, error) {
	values := make(map[string]string, len(fields))
	for _, field := range fields {
		key, value, ok := strings.Cut(field, "=")
		if !ok {
			return PressureLine{}, fmt.Errorf("invalid field %q", field)
		}
		values[key] = value
	}
	parseFloat := func(key string) (float64, error) {
		value, ok := values[key]
		if !ok {
			return 0, fmt.Errorf("missing %s", key)
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil || !finiteNonNegative(parsed) {
			return 0, fmt.Errorf("invalid %s %q", key, value)
		}
		return parsed, nil
	}
	avg10, err := parseFloat("avg10")
	if err != nil {
		return PressureLine{}, err
	}
	avg60, err := parseFloat("avg60")
	if err != nil {
		return PressureLine{}, err
	}
	avg300, err := parseFloat("avg300")
	if err != nil {
		return PressureLine{}, err
	}
	totalText, ok := values["total"]
	if !ok {
		return PressureLine{}, errors.New("missing total")
	}
	total, err := strconv.ParseUint(totalText, 10, 64)
	if err != nil {
		return PressureLine{}, fmt.Errorf("invalid total %q", totalText)
	}
	return PressureLine{Avg10: avg10, Avg60: avg60, Avg300: avg300, TotalMicros: total}, nil
}

func CapturePreflight(ctx context.Context, repoRoot, workDir string) (PreflightSnapshot, error) {
	return CapturePreflightForPID(ctx, repoRoot, workDir, 0)
}

// CapturePreflightForPID captures the target process resource envelope while
// keeping repository provenance and benchmark storage checks on the host.
func CapturePreflightForPID(ctx context.Context, repoRoot, workDir string, targetPID int) (PreflightSnapshot, error) {
	if targetPID < 0 {
		return PreflightSnapshot{}, errors.New("target PID must not be negative")
	}
	snapshot, err := capturePlatformPreflight(workDir, targetPID)
	if err != nil {
		return PreflightSnapshot{}, err
	}
	revision, err := gitOutput(ctx, repoRoot, "rev-parse", "HEAD")
	if err != nil {
		return PreflightSnapshot{}, fmt.Errorf("read git revision: %w", err)
	}
	status, err := gitOutput(ctx, repoRoot, "status", "--porcelain", "--untracked-files=normal")
	if err != nil {
		return PreflightSnapshot{}, fmt.Errorf("read git status: %w", err)
	}
	snapshot.GitRevision = revision
	snapshot.GitDirty = status != ""
	return snapshot, nil
}

func EvaluatePreflight(snapshot PreflightSnapshot, expectations PreflightExpectations) PreflightReport {
	report := PreflightReport{
		Schema: "towk.media-preflight.v1", CapturedAt: time.Now().UTC(), Status: "UNVERIFIED",
		Snapshot: snapshot, Expectations: expectations,
	}
	if snapshot.OS != "linux" {
		report.Reasons = append(report.Reasons, fmt.Sprintf("operating system %q is not the Linux qualification target", snapshot.OS))
	}
	if !finitePositive(snapshot.DiskFreePercent) || snapshot.DiskFreePercent < expectations.MinDiskFreePercent {
		report.Reasons = append(report.Reasons, fmt.Sprintf("disk free %.3f%% is below required %.3f%%", snapshot.DiskFreePercent, expectations.MinDiskFreePercent))
	}
	if !isHexLength(snapshot.GitRevision, 40) && !isHexLength(snapshot.GitRevision, 64) {
		report.Reasons = append(report.Reasons, "git revision must be a full object ID")
	}
	if snapshot.GitDirty {
		report.Reasons = append(report.Reasons, "git worktree is dirty")
	}
	if snapshot.Cgroup.Version != 2 {
		report.Reasons = append(report.Reasons, "cgroup v2 evidence is missing")
	}
	if _, ok := parseCPUQuota(snapshot.Cgroup.CPUMax); !ok {
		report.Reasons = append(report.Reasons, "explicit cgroup CPU quota evidence is missing or invalid")
	}
	if !isSHA256(snapshot.WorkDirFingerprint) {
		report.Reasons = append(report.Reasons, "work directory fingerprint is missing")
	}
	if !isSHA256(snapshot.WorkVolumeFingerprint) {
		report.Reasons = append(report.Reasons, "work filesystem fingerprint is missing")
	}
	if !isSHA256(snapshot.Cgroup.ResourceFingerprint) {
		report.Reasons = append(report.Reasons, "cgroup resource fingerprint is missing")
	}
	if countCPUSet(snapshot.Cgroup.CPUSetEffective) == 0 {
		report.Reasons = append(report.Reasons, "cgroup effective CPU set evidence is missing or invalid")
	}
	processCPUs := countCPUSet(snapshot.Cgroup.ProcessCPUSet)
	if processCPUs == 0 {
		report.Reasons = append(report.Reasons, "process CPU affinity evidence is missing or invalid")
	} else if snapshot.Cgroup.EffectiveCPUs > float64(processCPUs) {
		report.Reasons = append(report.Reasons, "effective CPU limit exceeds the process CPU affinity")
	}
	if !snapshot.Pressure.Available {
		report.Reasons = append(report.Reasons, "PSI pressure evidence is missing")
	} else if snapshot.Pressure.Scope != "cgroup" {
		report.Reasons = append(report.Reasons, "PSI pressure evidence is not scoped to the benchmark cgroup")
	}
	if snapshot.ThermalEvidence == "" || snapshot.ThermalEvidence == "unavailable" {
		report.Reasons = append(report.Reasons, "thermal throttling evidence is unavailable")
	} else if snapshot.ThermalEvidence == "temperature_only" && snapshot.ThermalHeadroomMilliC <= 0 {
		report.Reasons = append(report.Reasons, "thermal temperature evidence lacks positive critical headroom")
	}
	if expectations.ExpectedArchitecture != "" && snapshot.Architecture != expectations.ExpectedArchitecture {
		report.Reasons = append(report.Reasons, fmt.Sprintf("architecture %q does not match expected %q", snapshot.Architecture, expectations.ExpectedArchitecture))
	}
	if expectations.ExpectedCPUs <= 0 {
		report.Reasons = append(report.Reasons, "expected CPU envelope is missing")
	} else if relativeDifferencePercent(snapshot.Cgroup.EffectiveCPUs, expectations.ExpectedCPUs) > 1 {
		report.Reasons = append(report.Reasons, fmt.Sprintf("effective CPU limit %.3f does not match expected %.3f", snapshot.Cgroup.EffectiveCPUs, expectations.ExpectedCPUs))
	}
	if expectations.ExpectedMemoryBytes <= 0 {
		report.Reasons = append(report.Reasons, "expected memory envelope is missing")
	} else if snapshot.Cgroup.MemoryMaxBytes != expectations.ExpectedMemoryBytes {
		report.Reasons = append(report.Reasons, fmt.Sprintf("effective memory limit %d does not match expected %d", snapshot.Cgroup.MemoryMaxBytes, expectations.ExpectedMemoryBytes))
	}
	for _, resource := range []struct {
		name   string
		sample PressureSample
	}{
		{name: "memory", sample: snapshot.Pressure.Memory},
		{name: "IO", sample: snapshot.Pressure.IO},
	} {
		if resource.sample.Some.Avg10 > expectations.MaxPressureSomeAvg10 {
			report.Reasons = append(report.Reasons, fmt.Sprintf("%s pressure some avg10 %.3f exceeds %.3f", resource.name, resource.sample.Some.Avg10, expectations.MaxPressureSomeAvg10))
		}
		if resource.sample.Full.Avg10 > expectations.MaxPressureFullAvg10 {
			report.Reasons = append(report.Reasons, fmt.Sprintf("%s pressure full avg10 %.3f exceeds %.3f", resource.name, resource.sample.Full.Avg10, expectations.MaxPressureFullAvg10))
		}
	}
	report.Reasons = append(report.Reasons, ValidateNetworkEvidence(expectations.NetworkProfile, expectations.NetworkEvidence)...)
	if expectations.RequireSeparateGenerator && !expectations.SeparateGeneratorProven {
		report.Reasons = append(report.Reasons, "separate load generator evidence is required")
	}
	report.Canonical = len(report.Reasons) == 0
	if report.Canonical {
		report.Status = "VERIFIED"
	}
	return report
}

func countCPUSet(value string) int {
	count := 0
	for _, part := range strings.Split(strings.TrimSpace(value), ",") {
		if part == "" {
			continue
		}
		startText, endText, ranged := strings.Cut(part, "-")
		start, err := strconv.Atoi(startText)
		if err != nil {
			return 0
		}
		if !ranged {
			count++
			continue
		}
		end, err := strconv.Atoi(endText)
		if err != nil || end < start {
			return 0
		}
		count += end - start + 1
	}
	return count
}

func parseCPUQuota(value string) (float64, bool) {
	fields := strings.Fields(value)
	if len(fields) != 2 || fields[0] == "max" {
		return 0, false
	}
	quota, quotaErr := strconv.ParseFloat(fields[0], 64)
	period, periodErr := strconv.ParseFloat(fields[1], 64)
	if quotaErr != nil || periodErr != nil || quota <= 0 || period <= 0 {
		return 0, false
	}
	return quota / period, true
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	command.Dir = dir
	output, err := command.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
