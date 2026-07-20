package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"hmans.de/chatto/internal/perfmedia"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	var output string
	var profile string
	var repoRoot string
	flag.StringVar(&output, "output", "", "directory to create for the generated corpus")
	flag.StringVar(&profile, "profile", string(perfmedia.ProfileStandard), "corpus profile: smoke, standard, or qualification")
	flag.StringVar(&repoRoot, "repo-root", "..", "Towk repository root containing the versioned media fixtures")
	flag.Parse()
	if output == "" {
		return fmt.Errorf("--output is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	manifest, err := perfmedia.GenerateCorpus(ctx, repoRoot, output, perfmedia.Profile(profile))
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(manifest)
}
