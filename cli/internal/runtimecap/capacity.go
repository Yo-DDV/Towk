package runtimecap

import (
	"bufio"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
)

// Capacity describes the process-visible resource envelope. A zero memory
// value means that no finite process or cgroup limit could be detected.
type Capacity struct {
	CPUs         int
	MemoryBytes  int64
	CPUSource    string
	MemorySource string
}

// Detect returns conservative process-visible CPU and memory capacity. It
// combines the Go runtime limit with Linux affinity and cgroup limits when
// those files are available; unsupported platforms safely retain Go's view.
func Detect() Capacity {
	return detectFrom("/", runtime.GOMAXPROCS(0), debug.SetMemoryLimit(-1))
}

func detectFrom(root string, goMax int, goMemoryLimit int64) Capacity {
	if goMax < 1 {
		goMax = 1
	}
	capacity := Capacity{CPUs: goMax, CPUSource: "go_runtime"}

	if affinity, ok := readAffinity(root); ok && affinity < capacity.CPUs {
		capacity.CPUs = affinity
		capacity.CPUSource = "process_affinity"
	}
	if quota, ok := readCPUQuota(root); ok && quota < capacity.CPUs {
		capacity.CPUs = quota
		capacity.CPUSource = "cgroup_quota"
	}
	if capacity.CPUs < 1 {
		capacity.CPUs = 1
	}

	if finiteMemoryLimit(goMemoryLimit) {
		capacity.MemoryBytes = goMemoryLimit
		capacity.MemorySource = "go_runtime"
	}
	if memory, ok := readHostMemory(root); ok && (capacity.MemoryBytes == 0 || memory < capacity.MemoryBytes) {
		capacity.MemoryBytes = memory
		capacity.MemorySource = "host_memory"
	}
	if memory, ok := readMemoryLimit(root); ok && (capacity.MemoryBytes == 0 || memory < capacity.MemoryBytes) {
		capacity.MemoryBytes = memory
		capacity.MemorySource = "cgroup_limit"
	}
	return capacity
}

func readHostMemory(root string) (int64, bool) {
	file, err := os.Open(hostPath(root, "/proc/meminfo"))
	if err != nil {
		return 0, false
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 || fields[0] != "MemTotal:" {
			continue
		}
		kilobytes, err := strconv.ParseInt(fields[1], 10, 64)
		if err == nil && kilobytes > 0 {
			return kilobytes * 1024, true
		}
	}
	return 0, false
}

func readAffinity(root string) (int, bool) {
	file, err := os.Open(hostPath(root, "/proc/self/status"))
	if err != nil {
		return 0, false
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "Cpus_allowed_list:") {
			continue
		}
		return countCPUList(strings.TrimSpace(strings.TrimPrefix(line, "Cpus_allowed_list:")))
	}
	return 0, false
}

func countCPUList(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	total := 0
	for _, part := range strings.Split(value, ",") {
		bounds := strings.SplitN(strings.TrimSpace(part), "-", 2)
		first, err := strconv.Atoi(bounds[0])
		if err != nil || first < 0 {
			return 0, false
		}
		last := first
		if len(bounds) == 2 {
			last, err = strconv.Atoi(bounds[1])
			if err != nil || last < first {
				return 0, false
			}
		}
		total += last - first + 1
	}
	return total, total > 0
}

func readCPUQuota(root string) (int, bool) {
	best := math.MaxInt
	found := false
	for _, candidate := range cgroupCandidates(root, "cpu.max", "cpu") {
		data, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		fields := strings.Fields(string(data))
		if len(fields) != 2 || fields[0] == "max" {
			continue
		}
		quota, qerr := strconv.ParseInt(fields[0], 10, 64)
		period, perr := strconv.ParseInt(fields[1], 10, 64)
		if qerr == nil && perr == nil && quota > 0 && period > 0 {
			best = min(best, max(1, int(math.Ceil(float64(quota)/float64(period)))))
			found = true
		}
	}

	quotaCandidates := cgroupCandidates(root, "cpu.cfs_quota_us", "cpu")
	periodCandidates := cgroupCandidates(root, "cpu.cfs_period_us", "cpu")
	for i := 0; i < min(len(quotaCandidates), len(periodCandidates)); i++ {
		quota, qok := readPositiveInt64(quotaCandidates[i])
		period, pok := readPositiveInt64(periodCandidates[i])
		if qok && pok {
			best = min(best, max(1, int(math.Ceil(float64(quota)/float64(period)))))
			found = true
		}
	}
	return best, found
}

func readMemoryLimit(root string) (int64, bool) {
	best := int64(math.MaxInt64)
	found := false
	for _, name := range []string{"memory.max", "memory.limit_in_bytes"} {
		for _, candidate := range cgroupCandidates(root, name, "memory") {
			data, err := os.ReadFile(candidate)
			if err != nil {
				continue
			}
			value := strings.TrimSpace(string(data))
			if value == "max" {
				continue
			}
			limit, err := strconv.ParseInt(value, 10, 64)
			if err == nil && finiteMemoryLimit(limit) {
				best = min(best, limit)
				found = true
			}
		}
	}
	return best, found
}

func cgroupCandidates(root, filename, controller string) []string {
	base := hostPath(root, "/sys/fs/cgroup")
	paths := []string{""}
	data, err := os.ReadFile(hostPath(root, "/proc/self/cgroup"))
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			parts := strings.SplitN(line, ":", 3)
			if len(parts) != 3 {
				continue
			}
			controllers := strings.Split(parts[1], ",")
			if parts[1] == "" || contains(controllers, controller) {
				paths = append(paths, strings.TrimPrefix(filepath.Clean(parts[2]), string(filepath.Separator)))
			}
		}
	}

	seen := make(map[string]struct{})
	var candidates []string
	for _, relative := range paths {
		levels := cgroupPathLevels(relative)
		prefixes := []string{"", controller}
		if controller == "cpu" {
			prefixes = append(prefixes, "cpu,cpuacct")
		}
		for _, prefix := range prefixes {
			for _, level := range levels {
				candidate := filepath.Join(base, prefix, level, filename)
				if _, ok := seen[candidate]; ok {
					continue
				}
				seen[candidate] = struct{}{}
				candidates = append(candidates, candidate)
			}
		}
	}
	return candidates
}

func cgroupPathLevels(relative string) []string {
	relative = strings.Trim(filepath.Clean(relative), string(filepath.Separator))
	if relative == "" || relative == "." {
		return []string{""}
	}
	parts := strings.Split(relative, string(filepath.Separator))
	levels := []string{""}
	for i := range parts {
		levels = append(levels, filepath.Join(parts[:i+1]...))
	}
	return levels
}

func hostPath(root, path string) string {
	return filepath.Join(root, strings.TrimPrefix(path, string(filepath.Separator)))
}

func readPositiveInt64(path string) (int64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	value, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return value, err == nil && value > 0
}

func finiteMemoryLimit(value int64) bool {
	return value > 0 && value < math.MaxInt64/2
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
