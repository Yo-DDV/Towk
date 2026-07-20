package main

import (
	"context"
	"os"
	"strings"
	"testing"

	"hmans.de/chatto/internal/perfmedia"
)

func TestFileSHA256IsBounded(t *testing.T) {
	path := t.TempDir() + "/qdisc.json"
	if err := os.WriteFile(path, []byte("bounded qdisc evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	digest, err := fileSHA256(path)
	if err != nil {
		t.Fatalf("fileSHA256: %v", err)
	}
	if len(digest) != 64 {
		t.Fatalf("digest length = %d, want 64", len(digest))
	}
	if err := os.WriteFile(path, make([]byte, (1<<20)+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fileSHA256(path); err == nil {
		t.Fatal("oversized qdisc evidence was accepted")
	}
}

func TestProtocolCommandContainsNoLocalPaths(t *testing.T) {
	command := protocolCommand(perfmedia.NetworkNormal, "amd64", 2, 4<<30, true, false)
	if strings.ContainsAny(command, `/\`) {
		t.Fatalf("protocol command exposed a local path: %q", command)
	}
}

func TestProtocolCommandRedactsTargetPID(t *testing.T) {
	command := protocolCommand(perfmedia.NetworkLocal, "amd64", 2, 4<<30, false, true)
	if !strings.Contains(command, "--target-pid TARGET_PID") {
		t.Fatalf("protocol command missing redacted target process placeholder: %q", command)
	}
}

func TestRunRejectsNegativeTargetPID(t *testing.T) {
	if err := run(context.Background(), []string{"--target-pid=-1"}); err == nil || !strings.Contains(err.Error(), "must not be negative") {
		t.Fatalf("run error = %v, want negative target PID rejection", err)
	}
}
