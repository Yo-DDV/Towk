package runtimecap

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectFromUsesSmallestProcessEnvelope(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "/proc/self/status", "Name:\ttowk\nCpus_allowed_list:\t0-5\n")
	writeTestFile(t, root, "/proc/self/cgroup", "0::/tenant/towk\n")
	writeTestFile(t, root, "/sys/fs/cgroup/cpu.max", "1200000 100000\n")
	writeTestFile(t, root, "/sys/fs/cgroup/tenant/cpu.max", "400000 100000\n")
	writeTestFile(t, root, "/sys/fs/cgroup/tenant/towk/cpu.max", "250000 100000\n")
	writeTestFile(t, root, "/sys/fs/cgroup/memory.max", "8589934592\n")
	writeTestFile(t, root, "/sys/fs/cgroup/tenant/memory.max", "4294967296\n")
	writeTestFile(t, root, "/sys/fs/cgroup/tenant/towk/memory.max", "2147483648\n")

	got := detectFrom(root, 12, 4*1024*1024*1024)
	if got.CPUs != 3 || got.CPUSource != "cgroup_quota" {
		t.Fatalf("CPU capacity = %#v, want 3 from cgroup quota", got)
	}
	if got.MemoryBytes != 2*1024*1024*1024 || got.MemorySource != "cgroup_limit" {
		t.Fatalf("memory capacity = %#v, want 2 GiB from cgroup", got)
	}
}

func TestDetectFromFallsBackToRuntime(t *testing.T) {
	got := detectFrom(t.TempDir(), 7, math.MaxInt64)
	if got.CPUs != 7 || got.CPUSource != "go_runtime" {
		t.Fatalf("CPU capacity = %#v, want Go runtime fallback", got)
	}
	if got.MemoryBytes != 0 || got.MemorySource != "" {
		t.Fatalf("memory capacity = %#v, want unknown", got)
	}
}

func TestDetectFromUsesHostMemoryWithoutCgroup(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "/proc/meminfo", "MemTotal:        2097152 kB\nMemFree:          1024 kB\n")
	got := detectFrom(root, 2, math.MaxInt64)
	if got.MemoryBytes != 2*1024*1024*1024 || got.MemorySource != "host_memory" {
		t.Fatalf("memory capacity = %#v, want 2 GiB host memory", got)
	}
}

func TestCountCPUList(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
		ok    bool
	}{{"0-3,8,10-11", 7, true}, {"4", 1, true}, {"3-1", 0, false}, {"", 0, false}} {
		got, ok := countCPUList(tc.value)
		if got != tc.want || ok != tc.ok {
			t.Errorf("countCPUList(%q) = (%d, %v), want (%d, %v)", tc.value, got, ok, tc.want, tc.ok)
		}
	}
}

func writeTestFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := hostPath(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
