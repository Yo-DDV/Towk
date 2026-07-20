package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"hmans.de/chatto/internal/perfmedia"
)

func TestDecodeStrictRejectsUnknownAndTrailingJSON(t *testing.T) {
	for _, input := range []string{
		`{"samples":[],"maximum_deviation_percent":10,"unknown":true}`,
		`{"samples":[],"maximum_deviation_percent":10} {}`,
	} {
		var request stabilityInput
		if err := decodeStrict(strings.NewReader(input), &request); err == nil {
			t.Fatalf("decodeStrict accepted %q", input)
		}
	}
}

func TestDeliveryStabilityAcceptsThreeVerifiedResults(t *testing.T) {
	conditions := perfmedia.CampaignConditions{
		Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
		Network: perfmedia.NetworkLAN, Path: "direct", CgroupFingerprint: strings.Repeat("b", 64),
		CorpusSHA256: strings.Repeat("a", 64), WorkloadSHA256: strings.Repeat("c", 64),
	}
	arguments := []string{"--kind", "delivery-stability"}
	for index, throughput := range []float64{100, 104, 96} {
		result := perfmedia.DeliveryCampaignResult{
			RunID:  fmt.Sprintf("%032x", index+1),
			Status: "VERIFIED", Sample: perfmedia.CampaignSample{Conditions: conditions, Throughput: throughput, P95Millis: 100 + float64(index)},
			RequestCount: 10,
		}
		path := filepath.Join(t.TempDir(), "delivery.json")
		writeResult(t, path, result)
		arguments = append(arguments, "--input", path)
	}
	var output bytes.Buffer
	if err := runWithOutput(arguments, &output); err != nil {
		t.Fatalf("runWithOutput: %v", err)
	}
	if !strings.Contains(output.String(), `"status": "VERIFIED"`) {
		t.Fatalf("output = %s, want VERIFIED", output.String())
	}
}

func TestDeliveryStabilityRejectsCopiedCampaignResult(t *testing.T) {
	conditions := perfmedia.CampaignConditions{
		Revision: "0123456789abcdef0123456789abcdef01234567", Backend: "nats", CacheState: "warm",
		Network: perfmedia.NetworkLAN, Path: "direct", CgroupFingerprint: strings.Repeat("b", 64),
		CorpusSHA256: strings.Repeat("a", 64), WorkloadSHA256: strings.Repeat("c", 64),
	}
	result := perfmedia.DeliveryCampaignResult{
		RunID: "0123456789abcdef0123456789abcdef", Status: "VERIFIED",
		Sample: perfmedia.CampaignSample{Conditions: conditions, Throughput: 100, P95Millis: 100}, RequestCount: 10,
	}
	arguments := []string{"--kind", "delivery-stability"}
	for range 3 {
		path := filepath.Join(t.TempDir(), "delivery.json")
		writeResult(t, path, result)
		arguments = append(arguments, "--input", path)
	}
	if err := runWithOutput(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "repeats a campaign run id") {
		t.Fatalf("runWithOutput error = %v, want copied campaign rejection", err)
	}
}

func TestDeliveryStabilityRejectsUnverifiedResult(t *testing.T) {
	arguments := []string{"--kind", "delivery-stability"}
	for index := range 3 {
		status := "VERIFIED"
		if index == 1 {
			status = "UNVERIFIED"
		}
		path := filepath.Join(t.TempDir(), "delivery.json")
		writeResult(t, path, perfmedia.DeliveryCampaignResult{RunID: fmt.Sprintf("%032x", index+1), Status: status})
		arguments = append(arguments, "--input", path)
	}
	if err := runWithOutput(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "not VERIFIED") {
		t.Fatalf("runWithOutput error = %v, want rejected result", err)
	}
}

func writeResult(t *testing.T, path string, value any) {
	t.Helper()
	content, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}
