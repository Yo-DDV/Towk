package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"hmans.de/chatto/internal/perfmedia"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("towk-media-preflight", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	repoRoot := flags.String("repo-root", ".", "Towk repository root")
	workDir := flags.String("work-dir", "", "benchmark temporary-work directory; defaults to the repository root")
	targetPID := flags.Int("target-pid", 0, "host PID of the Towk process whose resource envelope is measured")
	outputPath := flags.String("output", "", "atomic JSON report output path")
	networkName := flags.String("network", string(perfmedia.NetworkLocal), "network profile: local, lan, normal, degraded")
	rate := flags.Float64("measured-rate-mbps", 0, "measured useful network rate")
	rtt := flags.Float64("measured-rtt-ms", 0, "measured round-trip latency")
	loss := flags.Float64("measured-loss-percent", 0, "measured packet loss percentage")
	seed := flags.Uint64("netem-seed", 0, "deterministic netem seed when loss is injected")
	shapedBoth := flags.Bool("shaped-both-directions", false, "evidence confirms shaping in both directions")
	receiverIngress := flags.Bool("receiver-ingress", false, "evidence confirms receiver-ingress placement")
	senderQdisc := flags.String("sender-qdisc-snapshot", "", "tc qdisc snapshot for the sender")
	receiverQdisc := flags.String("receiver-qdisc-snapshot", "", "tc qdisc snapshot for the receiver")
	expectedArch := flags.String("expected-arch", runtime.GOARCH, "required architecture")
	expectedCPUs := flags.Float64("expected-cpus", 0, "required effective cgroup CPU quota")
	expectedMemory := flags.Int64("expected-memory-bytes", 0, "required cgroup memory.max in bytes")
	minDisk := flags.Float64("min-disk-free-percent", 20, "minimum free space on the work volume")
	maxSome := flags.Float64("max-pressure-some-avg10", 0.1, "maximum pre-campaign memory/IO PSI some avg10")
	maxFull := flags.Float64("max-pressure-full-avg10", 0, "maximum pre-campaign memory/IO PSI full avg10")
	fullStack := flags.Bool("full-stack", false, "require a separately proven load generator")
	separateGenerator := flags.Bool("separate-generator-proven", false, "a separate or reserved load generator is proven")
	allowUnverified := flags.Bool("allow-unverified", false, "write an UNVERIFIED report without returning an error")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *seed > math.MaxUint32 {
		return errors.New("--netem-seed exceeds uint32")
	}
	if *targetPID < 0 {
		return errors.New("--target-pid must not be negative")
	}
	if *expectedArch != "amd64" && *expectedArch != "arm64" {
		return errors.New("--expected-arch must be amd64 or arm64")
	}
	for name, value := range map[string]float64{
		"--measured-rate-mbps": *rate, "--measured-rtt-ms": *rtt,
		"--measured-loss-percent": *loss, "--expected-cpus": *expectedCPUs,
		"--min-disk-free-percent": *minDisk, "--max-pressure-some-avg10": *maxSome,
		"--max-pressure-full-avg10": *maxFull,
	} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("%s must be finite", name)
		}
	}

	absRoot, err := filepath.Abs(*repoRoot)
	if err != nil {
		return err
	}
	absWorkDir := absRoot
	if *workDir != "" {
		absWorkDir, err = filepath.Abs(*workDir)
		if err != nil {
			return err
		}
	}
	profile, err := perfmedia.NetworkProfileFor(perfmedia.NetworkProfileName(*networkName))
	if err != nil {
		return err
	}
	evidence := perfmedia.NetworkEvidence{
		Profile: profile.Name, MeasuredRateMbps: *rate, MeasuredRTTMillis: *rtt,
		MeasuredLossPercent: *loss, Seed: uint32(*seed), ShapedBothDirections: *shapedBoth,
		ReceiverIngress: *receiverIngress,
	}
	if *senderQdisc != "" {
		evidence.SenderQdiscSHA256, err = fileSHA256(*senderQdisc)
		if err != nil {
			return fmt.Errorf("hash sender qdisc snapshot: %w", err)
		}
	}
	if *receiverQdisc != "" {
		evidence.ReceiverQdiscSHA256, err = fileSHA256(*receiverQdisc)
		if err != nil {
			return fmt.Errorf("hash receiver qdisc snapshot: %w", err)
		}
	}

	snapshot, err := perfmedia.CapturePreflightForPID(ctx, absRoot, absWorkDir, *targetPID)
	if err != nil {
		return err
	}
	report := perfmedia.EvaluatePreflight(snapshot, perfmedia.PreflightExpectations{
		MinDiskFreePercent: *minDisk, ExpectedArchitecture: *expectedArch,
		ExpectedCPUs: *expectedCPUs, ExpectedMemoryBytes: *expectedMemory,
		MaxPressureSomeAvg10: *maxSome, MaxPressureFullAvg10: *maxFull,
		NetworkProfile: profile, NetworkEvidence: evidence,
		RequireSeparateGenerator: *fullStack || *expectedCPUs >= 12,
		SeparateGeneratorProven:  *separateGenerator,
	})
	report.ProtocolCommand = protocolCommand(profile.Name, *expectedArch, *expectedCPUs, *expectedMemory, *fullStack, *targetPID > 0)
	if *outputPath != "" {
		if err := writeJSONAtomic(*outputPath, report); err != nil {
			return err
		}
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		return err
	}
	if !report.Canonical && !*allowUnverified {
		return errors.New("media preflight is UNVERIFIED; inspect the structured reasons")
	}
	return nil
}

func protocolCommand(network perfmedia.NetworkProfileName, arch string, cpus float64, memory int64, fullStack, targetsProcess bool) string {
	parts := []string{
		"mise run perf-media-preflight --",
		"--network", string(network),
		"--expected-arch", arch,
		"--expected-cpus", fmt.Sprintf("%.3f", cpus),
		"--expected-memory-bytes", fmt.Sprint(memory),
	}
	if targetsProcess {
		parts = append(parts, "--target-pid", "TARGET_PID")
	}
	if fullStack {
		parts = append(parts, "--full-stack")
	}
	return strings.Join(parts, " ")
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("qdisc snapshot must be a regular file")
	}
	if info.Size() > 1<<20 {
		return "", errors.New("qdisc snapshot exceeds 1 MiB")
	}
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(file, (1<<20)+1))
	if err != nil {
		return "", err
	}
	if written > 1<<20 {
		return "", errors.New("qdisc snapshot exceeds 1 MiB")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeJSONAtomic(path string, value any) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(directory, ".towk-media-preflight-*.json")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempName, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return err
	}
	dir, err := os.Open(directory)
	if err != nil {
		return err
	}
	if err := dir.Sync(); err != nil {
		dir.Close()
		return err
	}
	return dir.Close()
}
