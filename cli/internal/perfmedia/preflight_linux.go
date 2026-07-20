//go:build linux

package perfmedia

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

func capturePlatformPreflight(workDir string, targetPID int) (PreflightSnapshot, error) {
	processIdentity := ""
	if targetPID > 0 {
		var err error
		processIdentity, err = processStartTime(targetPID)
		if err != nil {
			return PreflightSnapshot{}, err
		}
	}
	absWorkDir, err := filepath.Abs(workDir)
	if err != nil {
		return PreflightSnapshot{}, err
	}
	var fs syscall.Statfs_t
	if err := syscall.Statfs(absWorkDir, &fs); err != nil {
		return PreflightSnapshot{}, fmt.Errorf("stat filesystem: %w", err)
	}
	workInfo, err := os.Stat(absWorkDir)
	if err != nil {
		return PreflightSnapshot{}, fmt.Errorf("stat work directory: %w", err)
	}
	if !workInfo.IsDir() {
		return PreflightSnapshot{}, errors.New("benchmark work path must be a directory")
	}
	workStat, ok := workInfo.Sys().(*syscall.Stat_t)
	if !ok {
		return PreflightSnapshot{}, errors.New("work filesystem identity is unavailable")
	}
	totalBlocks := float64(fs.Blocks)
	freePercent := 0.0
	if totalBlocks > 0 {
		freePercent = float64(fs.Bavail) / totalBlocks * 100
	}

	workDirDigest := sha256.Sum256([]byte(absWorkDir))
	workVolumeDigest := sha256.Sum256([]byte(fmt.Sprintf("%d\n%d", workStat.Dev, fs.Type)))
	snapshot := PreflightSnapshot{
		OS: "linux", Architecture: runtime.GOARCH, LogicalCPUs: runtime.NumCPU(),
		WorkDirFingerprint: hex.EncodeToString(workDirDigest[:]), WorkVolumeFingerprint: hex.EncodeToString(workVolumeDigest[:]),
		DiskFreePercent: freePercent,
		KernelRelease:   strings.TrimSpace(readText("/proc/sys/kernel/osrelease")),
		CPUModel:        cpuModel(), MemoryTotalBytes: memoryTotalBytes(),
		ScalingGovernors: scalingGovernors(), ThermalThrottleCount: thermalThrottleCount(),
		ThermalMaxMilliC: thermalMaxMilliC(), ThermalEvidence: thermalEvidence(),
		ThermalHeadroomMilliC: thermalHeadroomMilliC(),
		ClockSource:           readText("/sys/devices/system/clocksource/clocksource0/current_clocksource"),
	}
	snapshot.Cgroup, snapshot.Pressure, err = captureCgroupAndPressure(targetPID)
	if err != nil {
		return PreflightSnapshot{}, err
	}
	if targetPID > 0 {
		if allowed := countCPUSet(snapshot.Cgroup.ProcessCPUSet); allowed > 0 {
			snapshot.LogicalCPUs = allowed
		}
		after, identityErr := processStartTime(targetPID)
		if identityErr != nil || after != processIdentity {
			return PreflightSnapshot{}, errors.New("target process changed during preflight capture")
		}
	}
	return snapshot, nil
}

func captureCgroupAndPressure(targetPID int) (CgroupSnapshot, ResourcePressure, error) {
	cgroup := CgroupSnapshot{}
	pressure := ResourcePressure{Scope: "system"}
	if _, err := os.Stat("/sys/fs/cgroup/cgroup.controllers"); err == nil {
		cgroup.Version = 2
		path, err := currentCgroupV2Path(targetPID)
		if err != nil {
			return CgroupSnapshot{}, ResourcePressure{}, err
		}
		base := filepath.Join("/sys/fs/cgroup", strings.TrimPrefix(filepath.Clean(path), "/"))
		if path == "/" || path == "" {
			base = "/sys/fs/cgroup"
		}
		pathDigest := sha256.Sum256([]byte(path))
		cgroup.PathFingerprint = hex.EncodeToString(pathDigest[:])
		cgroup.CPUMax = readText(filepath.Join(base, "cpu.max"))
		cgroup.CPUWeight = readText(filepath.Join(base, "cpu.weight"))
		cgroup.CPUSetEffective = readText(filepath.Join(base, "cpuset.cpus.effective"))
		cgroup.ProcessCPUSet, err = processCPUSet(targetPID)
		if err != nil {
			return CgroupSnapshot{}, ResourcePressure{}, err
		}
		cgroup.EffectiveCPUs = effectiveCPUs(cgroup.CPUMax, cgroup.CPUSetEffective, cgroup.ProcessCPUSet)
		cgroup.MemoryMax = readText(filepath.Join(base, "memory.max"))
		cgroup.MemoryHigh = readText(filepath.Join(base, "memory.high"))
		cgroup.MemorySwapMax = readText(filepath.Join(base, "memory.swap.max"))
		cgroup.MemoryMaxBytes = parseLimit(cgroup.MemoryMax)
		cgroup.MemoryCurrentBytes = parseLimit(readText(filepath.Join(base, "memory.current")))
		cgroup.CPUStat = parseUintFields(readText(filepath.Join(base, "cpu.stat")))
		ioStat := readText(filepath.Join(base, "io.stat"))
		cgroup.IOStatTotals = parseIOStatTotals(ioStat)
		cgroup.IOMaxSHA256 = hashText(readText(filepath.Join(base, "io.max")))
		cgroup.PIDsMax = readText(filepath.Join(base, "pids.max"))
		cgroup.ResourceFingerprint = cgroupResourceFingerprint(cgroup)
		cpu, cpuErr := parsePressureFile(filepath.Join(base, "cpu.pressure"))
		memory, memoryErr := parsePressureFile(filepath.Join(base, "memory.pressure"))
		ioPressure, ioErr := parsePressureFile(filepath.Join(base, "io.pressure"))
		if cpuErr == nil && memoryErr == nil && ioErr == nil {
			pressure.CPU, pressure.Memory, pressure.IO = cpu, memory, ioPressure
			pressure.Scope = "cgroup"
			pressure.Available = true
		}
	}
	if pressure.Scope != "cgroup" {
		cpu, cpuErr := parsePressureFile("/proc/pressure/cpu")
		memory, memoryErr := parsePressureFile("/proc/pressure/memory")
		ioPressure, ioErr := parsePressureFile("/proc/pressure/io")
		if cpuErr == nil && memoryErr == nil && ioErr == nil {
			pressure.CPU, pressure.Memory, pressure.IO = cpu, memory, ioPressure
			pressure.Available = true
		}
	}
	return cgroup, pressure, nil
}

func cgroupResourceFingerprint(cgroup CgroupSnapshot) string {
	fingerprint := sha256.Sum256([]byte(strings.Join([]string{
		cgroup.CPUMax, cgroup.CPUWeight, cgroup.CPUSetEffective, cgroup.ProcessCPUSet,
		cgroup.MemoryMax, cgroup.MemoryHigh, cgroup.MemorySwapMax,
		cgroup.IOMaxSHA256, cgroup.PIDsMax,
	}, "\n")))
	return hex.EncodeToString(fingerprint[:])
}

func parsePressureFile(path string) (PressureSample, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return PressureSample{}, err
	}
	return ParsePressureSample(string(data))
}

func currentCgroupV2Path(targetPID int) (string, error) {
	data, err := os.ReadFile(processFile(targetPID, "cgroup"))
	if err != nil {
		return "", errors.New("target process cgroup is unavailable")
	}
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if strings.HasPrefix(line, "0::") {
			path := strings.TrimPrefix(line, "0::")
			if !filepath.IsAbs(path) || strings.Contains(filepath.Clean(path), "..") {
				return "", errors.New("target process cgroup path is invalid")
			}
			return path, nil
		}
	}
	return "", errors.New("target process cgroup v2 membership is unavailable")
}

func effectiveCPUs(cpuMax, cpuSet, processCPUSet string) float64 {
	limit := float64(runtime.NumCPU())
	if quota, ok := parseCPUQuota(cpuMax); ok {
		limit = min(limit, quota)
	}
	if count := countCPUSet(cpuSet); count > 0 {
		limit = min(limit, float64(count))
	}
	if count := countCPUSet(processCPUSet); count > 0 {
		limit = min(limit, float64(count))
	}
	return limit
}

func processCPUSet(targetPID int) (string, error) {
	data, err := os.ReadFile(processFile(targetPID, "status"))
	if err != nil {
		return "", errors.New("target process CPU affinity is unavailable")
	}
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(line, "Cpus_allowed_list:"); ok {
			cpuSet := strings.TrimSpace(value)
			if countCPUSet(cpuSet) == 0 {
				return "", errors.New("target process CPU affinity is invalid")
			}
			return cpuSet, nil
		}
	}
	return "", errors.New("target process CPU affinity is unavailable")
}

func processFile(targetPID int, name string) string {
	if targetPID <= 0 {
		return filepath.Join("/proc/self", name)
	}
	return filepath.Join("/proc", strconv.Itoa(targetPID), name)
}

func processStartTime(targetPID int) (string, error) {
	data, err := os.ReadFile(processFile(targetPID, "stat"))
	if err != nil {
		return "", errors.New("target process is unavailable")
	}
	closingParen := strings.LastIndexByte(string(data), ')')
	if closingParen < 0 {
		return "", errors.New("target process identity is invalid")
	}
	fields := strings.Fields(string(data)[closingParen+1:])
	if len(fields) <= 19 {
		return "", errors.New("target process identity is invalid")
	}
	if _, err := strconv.ParseUint(fields[19], 10, 64); err != nil {
		return "", errors.New("target process identity is invalid")
	}
	return fields[19], nil
}

func parseLimit(value string) int64 {
	if value == "" || value == "max" {
		return 0
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}

func parseUintFields(input string) map[string]uint64 {
	result := map[string]uint64{}
	for _, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			result[fields[0]] = value
		}
	}
	return result
}

func parseIOStatTotals(input string) map[string]uint64 {
	totals := map[string]uint64{}
	for _, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		for _, field := range fields[1:] {
			key, valueText, ok := strings.Cut(field, "=")
			if !ok {
				continue
			}
			value, err := strconv.ParseUint(valueText, 10, 64)
			if err == nil {
				if ^uint64(0)-totals[key] < value {
					totals[key] = ^uint64(0)
				} else {
					totals[key] += value
				}
			}
		}
	}
	return totals
}

func hashText(value string) string {
	if value == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func cpuModel() string {
	for _, line := range strings.Split(readText("/proc/cpuinfo"), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok && (strings.TrimSpace(key) == "model name" || strings.TrimSpace(key) == "Hardware") {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func memoryTotalBytes() int64 {
	for _, line := range strings.Split(readText("/proc/meminfo"), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			kib, err := strconv.ParseInt(fields[1], 10, 64)
			if err == nil {
				return kib << 10
			}
		}
	}
	return 0
}

func scalingGovernors() []string {
	paths, _ := filepath.Glob("/sys/devices/system/cpu/cpu*/cpufreq/scaling_governor")
	seen := map[string]struct{}{}
	for _, path := range paths {
		if value := readText(path); value != "" {
			seen[value] = struct{}{}
		}
	}
	values := make([]string, 0, len(seen))
	for value := range seen {
		values = append(values, value)
	}
	slices.Sort(values)
	return values
}

func thermalThrottleCount() uint64 {
	paths, _ := filepath.Glob("/sys/devices/system/cpu/cpu*/thermal_throttle/*_throttle_count")
	var total uint64
	for _, path := range paths {
		value, err := strconv.ParseUint(readText(path), 10, 64)
		if err == nil {
			total += value
		}
	}
	return total
}

func thermalEvidence() string {
	throttlePaths, _ := filepath.Glob("/sys/devices/system/cpu/cpu*/thermal_throttle/*_throttle_count")
	if len(throttlePaths) > 0 {
		return "throttle_counters"
	}
	temperaturePaths, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	if len(temperaturePaths) > 0 {
		return "temperature_only"
	}
	return "unavailable"
}

func thermalHeadroomMilliC() int64 {
	zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*")
	var minimum int64
	for _, zone := range zones {
		current, err := strconv.ParseInt(readText(filepath.Join(zone, "temp")), 10, 64)
		if err != nil {
			continue
		}
		types, _ := filepath.Glob(filepath.Join(zone, "trip_point_*_type"))
		for _, typePath := range types {
			kind := readText(typePath)
			if kind != "critical" && kind != "hot" {
				continue
			}
			tempPath := strings.TrimSuffix(typePath, "_type") + "_temp"
			limit, err := strconv.ParseInt(readText(tempPath), 10, 64)
			if err != nil || limit <= current {
				continue
			}
			headroom := limit - current
			if minimum == 0 || headroom < minimum {
				minimum = headroom
			}
		}
	}
	return minimum
}

func thermalMaxMilliC() int64 {
	paths, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	var maximum int64
	for _, path := range paths {
		value, err := strconv.ParseInt(readText(path), 10, 64)
		if err == nil {
			maximum = max(maximum, value)
		}
	}
	return maximum
}

func readText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
