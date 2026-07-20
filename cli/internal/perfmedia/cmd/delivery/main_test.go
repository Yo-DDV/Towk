package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"hmans.de/chatto/internal/perfmedia"
)

func TestRunWritesVerifiedRedactedResult(t *testing.T) {
	payload := []byte("synthetic media payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer private-token" {
			t.Errorf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)

	digest := sha256.Sum256(payload)
	workload := perfmedia.DeliveryWorkload{
		Conditions: perfmedia.CampaignConditions{
			Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
			Network: perfmedia.NetworkLAN, Path: "direct",
			CgroupFingerprint: strings.Repeat("b", 64), CorpusSHA256: strings.Repeat("a", 64),
		},
		Concurrency: 1, Rounds: 1, RequestTimeoutMillis: 5000,
		Requests: []perfmedia.DeliveryRequest{{
			ID:  "synthetic-original",
			URL: server.URL + "/asset?signature=private-signature", ExpectedStatus: http.StatusOK,
			ExpectedBytes: int64(len(payload)), ExpectedSHA256: hex.EncodeToString(digest[:]),
			ExpectedContentType: "application/octet-stream",
		}},
	}
	directory := t.TempDir()
	inputPath := filepath.Join(directory, "workload.json")
	outputPath := filepath.Join(directory, "result.json")
	bearerPath := filepath.Join(directory, "bearer")
	writeJSON(t, inputPath, workload)
	if err := os.WriteFile(bearerPath, []byte("private-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	err := run(context.Background(), []string{"--input", inputPath, "--output", outputPath, "--bearer-file", bearerPath}, &stdout)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	for _, output := range []string{stdout.String(), string(readFile(t, outputPath))} {
		for _, forbidden := range []string{server.URL, "private-signature", "private-token", inputPath, bearerPath} {
			if strings.Contains(output, forbidden) {
				t.Fatalf("redacted output leaked %q: %s", forbidden, output)
			}
		}
		if !strings.Contains(output, `"status": "VERIFIED"`) {
			t.Fatalf("output = %s, want VERIFIED", output)
		}
	}
}

func TestRunRejectsUnknownOrTrailingJSON(t *testing.T) {
	for _, content := range []string{
		`{"unknown":true}`,
		`{"conditions":{},"concurrency":1,"rounds":1,"request_timeout_millis":100,"requests":[]} {}`,
	} {
		path := filepath.Join(t.TempDir(), "workload.json")
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := run(context.Background(), []string{"--input", path}, ioDiscard{}); err == nil {
			t.Fatalf("run accepted invalid JSON %q", content)
		}
	}
}

func TestRunHelpReturnsSuccess(t *testing.T) {
	if err := run(context.Background(), []string{"--help"}, ioDiscard{}); err != nil {
		t.Fatalf("run --help: %v", err)
	}
}

func TestReadBoundedRegularFileRejectsSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	link := filepath.Join(directory, "link")
	if err := os.WriteFile(target, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readBoundedRegularFile(link, 1024); err == nil || !strings.Contains(err.Error(), "regular file") {
		t.Fatalf("readBoundedRegularFile error = %v, want symlink rejection", err)
	}
}

func TestReadBoundedPrivateFileRejectsPermissiveMode(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("Windows does not expose Unix permission bits")
	}
	path := filepath.Join(t.TempDir(), "bearer")
	if err := os.WriteFile(path, []byte("private-token"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readBoundedPrivateFile(path, 1024); err == nil || !strings.Contains(err.Error(), "permissions") {
		t.Fatalf("readBoundedPrivateFile error = %v, want permission rejection", err)
	}
}

type ioDiscard struct{}

func (ioDiscard) Write(payload []byte) (int, error) { return len(payload), nil }

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	content, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}
