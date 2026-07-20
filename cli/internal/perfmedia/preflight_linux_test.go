//go:build linux

package perfmedia

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlatformPreflightDoesNotExposeWorkDirectory(t *testing.T) {
	workDir := t.TempDir()
	snapshot, err := capturePlatformPreflight(workDir, 0)
	if err != nil {
		t.Fatalf("capturePlatformPreflight: %v", err)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if strings.Contains(string(encoded), workDir) {
		t.Fatalf("preflight JSON exposed work directory %q", workDir)
	}
	if !isSHA256(snapshot.WorkDirFingerprint) {
		t.Fatalf("work directory fingerprint = %q, want SHA-256", snapshot.WorkDirFingerprint)
	}
	if !isSHA256(snapshot.WorkVolumeFingerprint) {
		t.Fatalf("work volume fingerprint = %q, want SHA-256", snapshot.WorkVolumeFingerprint)
	}
	if snapshot.Cgroup.Version == 2 {
		if !isSHA256(snapshot.Cgroup.PathFingerprint) {
			t.Fatalf("cgroup path fingerprint = %q, want SHA-256", snapshot.Cgroup.PathFingerprint)
		}
		processCPUs := countCPUSet(snapshot.Cgroup.ProcessCPUSet)
		if processCPUs == 0 {
			t.Fatalf("process CPU affinity = %q, want a non-empty valid CPU set", snapshot.Cgroup.ProcessCPUSet)
		}
		if snapshot.Cgroup.EffectiveCPUs > float64(processCPUs) {
			t.Fatalf("effective CPUs = %v, process affinity CPUs = %d", snapshot.Cgroup.EffectiveCPUs, processCPUs)
		}
		if !isSHA256(snapshot.Cgroup.ResourceFingerprint) {
			t.Fatalf("resource fingerprint = %q, want SHA-256", snapshot.Cgroup.ResourceFingerprint)
		}
	}
}

func TestPlatformPreflightRejectsNonDirectoryWorkPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(path, []byte("not a benchmark work directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := capturePlatformPreflight(path, 0); err == nil || !strings.Contains(err.Error(), "must be a directory") {
		t.Fatalf("capturePlatformPreflight error = %v, want directory rejection", err)
	}
}

func TestPlatformPreflightCanObserveTargetProcess(t *testing.T) {
	workDir := t.TempDir()
	self, err := capturePlatformPreflight(workDir, 0)
	if err != nil {
		t.Fatalf("capture current process: %v", err)
	}
	target, err := capturePlatformPreflight(workDir, os.Getpid())
	if err != nil {
		t.Fatalf("capture target process: %v", err)
	}
	if target.Cgroup.ResourceFingerprint != self.Cgroup.ResourceFingerprint {
		t.Fatalf("target resource fingerprint = %q, current = %q", target.Cgroup.ResourceFingerprint, self.Cgroup.ResourceFingerprint)
	}
	if target.Cgroup.ProcessCPUSet != self.Cgroup.ProcessCPUSet {
		t.Fatalf("target CPU set = %q, current = %q", target.Cgroup.ProcessCPUSet, self.Cgroup.ProcessCPUSet)
	}
	if target.LogicalCPUs != countCPUSet(target.Cgroup.ProcessCPUSet) {
		t.Fatalf("target logical CPUs = %d, want affinity count", target.LogicalCPUs)
	}
	encoded, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "target_pid") {
		t.Fatalf("preflight JSON exposed target PID metadata: %s", encoded)
	}
}

func TestPlatformPreflightRejectsMissingTargetProcess(t *testing.T) {
	if _, err := capturePlatformPreflight(t.TempDir(), 1<<30); err == nil || !strings.Contains(err.Error(), "target process") {
		t.Fatalf("capturePlatformPreflight error = %v, want missing target rejection", err)
	}
}

func TestProcessStartTimeParsesNamesWithParentheses(t *testing.T) {
	if _, err := processStartTime(os.Getpid()); err != nil {
		t.Fatalf("processStartTime: %v", err)
	}
}

func TestCountCPUSet(t *testing.T) {
	for input, want := range map[string]int{
		"0": 1, "0-3": 4, "0-3,8,10-11": 7, "": 0, "broken": 0, "3-1": 0,
	} {
		if got := countCPUSet(input); got != want {
			t.Errorf("countCPUSet(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestEffectiveCPUsIncludesProcessAffinity(t *testing.T) {
	if got := effectiveCPUs("400000 100000", "0-23", "0-1"); got != 2 {
		t.Fatalf("effectiveCPUs with narrower process affinity = %v, want 2", got)
	}
	if got := effectiveCPUs("200000 100000", "0-3", "0-3"); got != 2 {
		t.Fatalf("effectiveCPUs with narrower quota = %v, want 2", got)
	}
}

func TestCgroupResourceFingerprintIncludesProcessAffinity(t *testing.T) {
	snapshot := CgroupSnapshot{
		CPUMax: "400000 100000", CPUWeight: "100", CPUSetEffective: "0-23",
		ProcessCPUSet: "0-3", MemoryMax: "4294967296", MemoryHigh: "max",
		MemorySwapMax: "0", IOMaxSHA256: hashText(""), PIDsMax: "max",
	}
	first := cgroupResourceFingerprint(snapshot)
	snapshot.ProcessCPUSet = "0-1"
	second := cgroupResourceFingerprint(snapshot)
	if first == second {
		t.Fatal("resource fingerprint did not change with process CPU affinity")
	}
}

func TestParseIOStatTotalsOmitsDeviceIdentifiers(t *testing.T) {
	if got := parseIOStatTotals(""); len(got) != 0 {
		t.Fatalf("parseIOStatTotals(empty) = %v, want empty", got)
	}
	got := parseIOStatTotals("259:0 rbytes=10 wbytes=20 rios=1 wios=2\n8:0 rbytes=30 wbytes=40 rios=3 wios=4\n")
	for key, want := range map[string]uint64{"rbytes": 40, "wbytes": 60, "rios": 4, "wios": 6} {
		if got[key] != want {
			t.Errorf("parseIOStatTotals[%q] = %d, want %d", key, got[key], want)
		}
	}
	if _, exists := got["259:0"]; exists {
		t.Fatal("IO totals exposed a device identifier")
	}
}

func FuzzLinuxPreflightParsersNeverPanic(f *testing.F) {
	f.Add("259:0 rbytes=10 wbytes=20\n", "0-3,8")
	f.Add("", "broken")
	f.Fuzz(func(t *testing.T, ioStat, cpuSet string) {
		_ = parseIOStatTotals(ioStat)
		_ = countCPUSet(cpuSet)
	})
}
