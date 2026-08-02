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

// Capacity describes the process-visible resource envelope. MemoryBytes is the
// smallest currently available budget observed from the Go runtime, the host,
// and the process cgroup. It is deliberately a headroom value rather than
// MemTotal: the adaptive scheduler must back off when another process or
// container consumes RAM. A zero memory value means that no finite memory
// signal could be detected.
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

	capacity.MemoryBytes, capacity.MemorySource = detectMemory(root, goMemoryLimit)
	return capacity
}

type memoryCandidate struct {
	bytes  int64
	source string
}

func detectMemory(root string, goMemoryLimit int64) (int64, string) {
	candidates := make([]memoryCandidate, 0, 3)
	if finiteMemoryLimit(goMemoryLimit) {
		candidates = append(candidates, memoryCandidate{bytes: goMemoryLimit, source: "go_runtime"})
	}

	_, available, availableObserved, ok := readHostMemory(root)
	if ok {
		if finiteMemoryLimit(available) {
			source := "host_memory"
			if availableObserved {
				source = "host_available"
			}
			candidates = append(candidates, memoryCandidate{bytes: available, source: source})
		}
	}

	if available, source, ok := readMemoryHeadroom(root); ok {
		candidates = append(candidates, memoryCandidate{bytes: available, source: source})
	}

	var best memoryCandidate
	for _, candidate := range candidates {
		if candidate.bytes <= 0 || (best.bytes > 0 && candidate.bytes >= best.bytes) {
			continue
		}
		best = candidate
	}
	return best.bytes, best.source
}

func readHostMemory(root string) (total, available int64, availableObserved, ok bool) {
	file, err := os.Open(hostPath(root, "/proc/meminfo"))
	if err != nil {
		return 0, 0, false, false
	}
	defer file.Close()
	var hasTotal, hasAvailable bool
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		kilobytes, parseErr := strconv.ParseInt(fields[1], 10, 64)
		if parseErr != nil || kilobytes <= 0 {
			continue
		}
		if kilobytes > math.MaxInt64/1024 {
			continue
		}
		bytes := kilobytes * 1024
		switch fields[0] {
		case "MemTotal:":
			total, hasTotal = bytes, true
		case "MemAvailable:":
			available, hasAvailable = bytes, true
		}
	}
	if hasAvailable {
		return total, available, true, true
	}
	if hasTotal {
		return total, total, false, true
	}
	return 0, 0, false, false
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

// readMemoryHeadroom keeps each cgroup's limit paired with its own usage. A
// process can be below several nested cgroups; taking the smallest limit and
// the deepest usage independently would mix unrelated levels and overstate
// the remaining budget when a parent is close to its limit.
func readMemoryHeadroom(root string) (int64, string, bool) {
	best := memoryCandidate{}
	for _, directory := range cgroupDirectories(root, "memory") {
		for _, files := range []struct {
			limit string
			usage string
		}{
			{limit: "memory.max", usage: "memory.current"},
			{limit: "memory.limit_in_bytes", usage: "memory.usage_in_bytes"},
		} {
			limit, ok := readFiniteMemoryValue(filepath.Join(directory, files.limit))
			if !ok {
				continue
			}
			available := limit
			source := "cgroup_limit"
			if usage, usageOK := readNonNegativeInt64(filepath.Join(directory, files.usage)); usageOK {
				source = "cgroup_available"
				switch {
				case usage >= limit:
					// A saturated or inconsistent cgroup must collapse to the
					// fail-safe minimum, never advertise the full limit again.
					available = 1
				default:
					available = limit - usage
				}
			}
			if available <= 0 {
				available = 1
			}
			if best.bytes == 0 || available < best.bytes {
				best = memoryCandidate{bytes: available, source: source}
			}
		}
	}
	return best.bytes, best.source, best.bytes > 0
}

func cgroupCandidates(root, filename, controller string) []string {
	directories := cgroupDirectories(root, controller)
	candidates := make([]string, 0, len(directories))
	for _, directory := range directories {
		candidates = append(candidates, filepath.Join(directory, filename))
	}
	return candidates
}

func cgroupDirectories(root, controller string) []string {
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
				candidate := filepath.Join(base, prefix, level)
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
	value, ok := readNonNegativeInt64(path)
	return value, ok && value > 0
}

func readNonNegativeInt64(path string) (int64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	value, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return value, err == nil && value >= 0
}

func readFiniteMemoryValue(path string) (int64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	value := strings.TrimSpace(string(data))
	if value == "max" {
		return 0, false
	}
	limit, err := strconv.ParseInt(value, 10, 64)
	return limit, err == nil && finiteMemoryLimit(limit)
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
