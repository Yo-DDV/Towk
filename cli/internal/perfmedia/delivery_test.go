package perfmedia

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunDeliveryCampaignValidatesFullAndRangeResponses(t *testing.T) {
	payload := deterministicDeliveryPayload(64 << 10)
	rangePayload := payload[1024:4096]
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		if r.Header.Get("Range") == "bytes=1024-4095" {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 1024-4095/%d", len(payload)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(rangePayload)
			return
		}
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)

	workload := validDeliveryWorkload(server.URL, payload, rangePayload)
	result, err := RunDeliveryCampaign(context.Background(), server.Client(), "", workload)
	if err != nil {
		t.Fatalf("RunDeliveryCampaign: %v", err)
	}
	if result.Status != "VERIFIED" || len(result.Reasons) != 0 {
		t.Fatalf("delivery result = %+v, want verified", result)
	}
	if !ValidDeliveryRunID(result.RunID) {
		t.Fatalf("delivery run id = %q, want a bounded random id", result.RunID)
	}
	if result.RequestCount != 4 {
		t.Fatalf("request count = %d, want 4", result.RequestCount)
	}
	wantBytes := int64(2 * (len(payload) + len(rangePayload)))
	if result.ResponseBytes != wantBytes {
		t.Fatalf("response bytes = %d, want %d", result.ResponseBytes, wantBytes)
	}
	if !isSHA256(result.Sample.Conditions.WorkloadSHA256) {
		t.Fatalf("workload digest = %q, want SHA-256", result.Sample.Conditions.WorkloadSHA256)
	}
	if !finitePositive(result.Sample.Throughput) || !finitePositive(result.Sample.P95Millis) {
		t.Fatalf("delivery metrics = %+v, want positive throughput and p95", result)
	}
	assessment := AssessCampaignStability([]CampaignSample{result.Sample, result.Sample, result.Sample}, 10)
	if !assessment.Canonical || assessment.Status != "VERIFIED" {
		t.Fatalf("delivery sample is not reusable by the stability validator: %+v", assessment)
	}
}

func TestRunDeliveryCampaignDoesNotFollowRedirectsOrLeakTargets(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect target must not be contacted")
	}))
	t.Cleanup(target.Close)
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, target.URL+"/private-target", http.StatusFound)
	}))
	t.Cleanup(redirect.Close)

	payload := []byte("not returned")
	workload := validDeliveryWorkload(redirect.URL+"/asset?signature=private-value", payload, payload)
	workload.Requests = workload.Requests[:1]
	workload.Requests[0].ExpectedStatus = http.StatusOK
	workload.Rounds = 1
	result, err := RunDeliveryCampaign(context.Background(), redirect.Client(), "secret-bearer", workload)
	if err != nil {
		t.Fatalf("RunDeliveryCampaign: %v", err)
	}
	if result.Status != "UNVERIFIED" || len(result.Reasons) == 0 {
		t.Fatalf("redirect result = %+v, want unverified", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{redirect.URL, target.URL, "private-value", "secret-bearer"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("result leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestDeliveryCampaignRunIDsAreIndependent(t *testing.T) {
	first, err := newDeliveryRunID()
	if err != nil {
		t.Fatal(err)
	}
	second, err := newDeliveryRunID()
	if err != nil {
		t.Fatal(err)
	}
	if !ValidDeliveryRunID(first) || !ValidDeliveryRunID(second) {
		t.Fatalf("run ids = %q, %q, want bounded hexadecimal values", first, second)
	}
	if first == second {
		t.Fatalf("independent campaign run ids collided: %q", first)
	}
}

func TestRunDeliveryCampaignBoundsFailureEvidence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	payload := []byte("expected payload")
	workload := validDeliveryWorkload(server.URL+"/private?signature=secret", payload, payload)
	workload.Requests = workload.Requests[:1]
	workload.Rounds = 100
	workload.Concurrency = 8
	result, err := RunDeliveryCampaign(context.Background(), server.Client(), "", workload)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "UNVERIFIED" || result.FailureCount != 100 {
		t.Fatalf("failure result = %+v, want 100 bounded failures", result)
	}
	if len(result.Reasons) != maxDeliveryReasons+1 {
		t.Fatalf("reason count = %d, want %d bounded reasons plus summary", len(result.Reasons), maxDeliveryReasons+1)
	}
	encoded, _ := json.Marshal(result)
	for _, forbidden := range []string{server.URL, "private", "secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("failure output leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestRunDeliveryCampaignRejectsMismatchedContentRange(t *testing.T) {
	payload := deterministicDeliveryPayload(64 << 10)
	rangePayload := payload[1024:4096]
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(rangePayload)-1, len(payload)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(rangePayload)
	}))
	t.Cleanup(server.Close)
	workload := validDeliveryWorkload(server.URL, payload, rangePayload)
	workload.Requests = workload.Requests[1:]
	workload.Rounds = 1
	result, err := RunDeliveryCampaign(context.Background(), server.Client(), "", workload)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "UNVERIFIED" || !strings.Contains(strings.Join(result.Reasons, " "), "Content-Range") {
		t.Fatalf("content-range result = %+v, want unverified", result)
	}
}

func TestDeliveryWorkloadDigestIgnoresEndpointAndSignedQuery(t *testing.T) {
	payload := []byte("stable payload")
	first := validDeliveryWorkload("https://direct.invalid/assets/A1?signature=first", payload, payload)
	first.Requests = first.Requests[:1]
	second := first
	second.Requests = append([]DeliveryRequest(nil), first.Requests...)
	second.Requests[0].ID = first.Requests[0].ID
	second.Requests[0].URL = "https://proxy.invalid/assets/A1?signature=second"

	firstDigest, err := DeliveryWorkloadSHA256(first)
	if err != nil {
		t.Fatal(err)
	}
	secondDigest, err := DeliveryWorkloadSHA256(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstDigest != secondDigest {
		t.Fatalf("semantic workload digests differ: %s != %s", firstDigest, secondDigest)
	}
}

func TestValidateDeliveryWorkloadRejectsUnsafeOrUnboundedInput(t *testing.T) {
	payload := []byte("payload")
	workload := validDeliveryWorkload("https://user:password@example.invalid/asset", payload, payload)
	workload.Concurrency = 0
	workload.Rounds = 100001
	workload.Requests[0].ExpectedBytes = (512 << 20) + 1
	workload.Requests[0].ID = "INVALID ID"
	reasons := ValidateDeliveryWorkload(workload)
	joined := strings.Join(reasons, " ")
	for _, wanted := range []string{"concurrency", "rounds", "userinfo", "expected bytes", "lowercase identifier"} {
		if !strings.Contains(joined, wanted) {
			t.Fatalf("reasons = %v, want %q", reasons, wanted)
		}
	}
}

func TestDeliveryRangeValidationCoversValidAndInvalidScenarios(t *testing.T) {
	for _, value := range []string{"bytes=0-0", "bytes=128-", "bytes=-128"} {
		if _, err := parseDeliveryRange(value); err != nil {
			t.Errorf("parseDeliveryRange(%q): %v", value, err)
		}
	}
	for _, value := range []string{"bytes=", "bytes=0-1,4-5", "bytes=9223372036854775808-", "units=0-1", "bytes=0-1\r\nX-Test: value"} {
		if _, err := parseDeliveryRange(value); err == nil {
			t.Errorf("parseDeliveryRange(%q) accepted invalid input", value)
		}
	}

	payload := []byte("payload")
	workload := validDeliveryWorkload("https://example.invalid/asset", payload, payload)
	workload.Requests = append(workload.Requests[:1], DeliveryRequest{
		ID: "invalid-multirange", URL: "https://example.invalid/asset", Range: "bytes=0-1,4-5",
		ExpectedStatus: http.StatusRequestedRangeNotSatisfiable, ExpectedBytes: 0,
	})
	if reasons := ValidateDeliveryWorkload(workload); len(reasons) != 0 {
		t.Fatalf("safe invalid-Range scenario rejected: %v", reasons)
	}
}

func validDeliveryWorkload(baseURL string, payload, rangePayload []byte) DeliveryWorkload {
	return DeliveryWorkload{
		Conditions: CampaignConditions{
			Revision:          "0123456789abcdef0123456789abcdef01234567",
			Backend:           "nats",
			CacheState:        "warm",
			Network:           NetworkLAN,
			Path:              "direct",
			CgroupFingerprint: strings.Repeat("b", 64),
			CorpusSHA256:      strings.Repeat("a", 64),
		},
		Concurrency:          2,
		Rounds:               2,
		RequestTimeoutMillis: 5000,
		Requests: []DeliveryRequest{
			{
				ID:  "full",
				URL: baseURL, ExpectedStatus: http.StatusOK,
				ExpectedBytes: int64(len(payload)), ExpectedSHA256: deliveryDigest(payload),
				ExpectedContentType: "application/octet-stream",
			},
			{
				ID:  "range-1024-4095",
				URL: baseURL, Range: "bytes=1024-4095", ExpectedStatus: http.StatusPartialContent,
				ExpectedBytes: int64(len(rangePayload)), ExpectedSHA256: deliveryDigest(rangePayload),
				ExpectedContentType: "application/octet-stream",
			},
		},
	}
}

func deliveryDigest(payload []byte) string {
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

func deterministicDeliveryPayload(size int) []byte {
	payload := make([]byte, size)
	for i := range payload {
		payload[i] = byte((i*31 + 17) % 251)
	}
	return payload
}

func FuzzParseDeliveryRange(f *testing.F) {
	for _, seed := range []string{"bytes=0-0", "bytes=128-", "bytes=-128", "bytes=0-1,4-5", "bytes=9223372036854775808-", ""} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, value string) {
		parsed, err := parseDeliveryRange(value)
		if err == nil && parsed.suffix == 0 && !parsed.open && parsed.end < parsed.start {
			t.Fatalf("invalid parsed Range: %+v", parsed)
		}
	})
}
