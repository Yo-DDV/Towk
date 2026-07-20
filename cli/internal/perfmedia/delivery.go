package perfmedia

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxDeliveryRequests         = 64
	maxDeliveryCampaignRequests = 100_000
	maxDeliveryConcurrency      = 128
	maxDeliveryRounds           = 10_000
	maxDeliveryBodyBytes        = 512 << 20
	maxDeliveryURLBytes         = 8 << 10
	minDeliveryTimeoutMillis    = 100
	maxDeliveryTimeoutMillis    = 120_000
	maxDeliveryReasons          = 32
)

var deliveryRequestIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
var deliveryRunIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

type DeliveryRequest struct {
	ID                  string `json:"id"`
	URL                 string `json:"url"`
	Range               string `json:"range,omitempty"`
	ExpectedStatus      int    `json:"expected_status"`
	ExpectedBytes       int64  `json:"expected_bytes"`
	ExpectedSHA256      string `json:"expected_sha256,omitempty"`
	ExpectedContentType string `json:"expected_content_type,omitempty"`
}

type DeliveryWorkload struct {
	Conditions           CampaignConditions `json:"conditions"`
	Concurrency          int                `json:"concurrency"`
	Rounds               int                `json:"rounds"`
	RequestTimeoutMillis int                `json:"request_timeout_millis"`
	Requests             []DeliveryRequest  `json:"requests"`
}

type DeliveryCampaignResult struct {
	RunID            string         `json:"run_id"`
	Status           string         `json:"status"`
	Sample           CampaignSample `json:"sample"`
	RequestCount     int            `json:"request_count"`
	ResponseBytes    int64          `json:"response_bytes"`
	DurationMillis   float64        `json:"duration_millis"`
	BytesPerSecond   float64        `json:"bytes_per_second"`
	MaxLatencyMillis float64        `json:"max_latency_millis"`
	FailureCount     int            `json:"failure_count"`
	Reasons          []string       `json:"reasons,omitempty"`
}

type deliverySample struct {
	duration time.Duration
	bytes    int64
	reason   string
}

type deliveryRange struct {
	start  int64
	end    int64
	suffix int64
	open   bool
}

type semanticDeliveryRequest struct {
	ID                  string `json:"id"`
	Range               string `json:"range,omitempty"`
	ExpectedStatus      int    `json:"expected_status"`
	ExpectedBytes       int64  `json:"expected_bytes"`
	ExpectedSHA256      string `json:"expected_sha256,omitempty"`
	ExpectedContentType string `json:"expected_content_type,omitempty"`
}

type semanticDeliveryWorkload struct {
	Concurrency          int                       `json:"concurrency"`
	Rounds               int                       `json:"rounds"`
	RequestTimeoutMillis int                       `json:"request_timeout_millis"`
	Requests             []semanticDeliveryRequest `json:"requests"`
}

func DeliveryWorkloadSHA256(workload DeliveryWorkload) (string, error) {
	semantic := semanticDeliveryWorkload{
		Concurrency:          workload.Concurrency,
		Rounds:               workload.Rounds,
		RequestTimeoutMillis: workload.RequestTimeoutMillis,
		Requests:             make([]semanticDeliveryRequest, 0, len(workload.Requests)),
	}
	for _, request := range workload.Requests {
		semantic.Requests = append(semantic.Requests, semanticDeliveryRequest{
			ID:                  request.ID,
			Range:               request.Range,
			ExpectedStatus:      request.ExpectedStatus,
			ExpectedBytes:       request.ExpectedBytes,
			ExpectedSHA256:      strings.ToLower(request.ExpectedSHA256),
			ExpectedContentType: strings.ToLower(request.ExpectedContentType),
		})
	}
	encoded, err := json.Marshal(semantic)
	if err != nil {
		return "", fmt.Errorf("encode semantic delivery workload: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func ValidateDeliveryWorkload(workload DeliveryWorkload) []string {
	var reasons []string
	if workload.Concurrency < 1 || workload.Concurrency > maxDeliveryConcurrency {
		reasons = append(reasons, fmt.Sprintf("concurrency must be between 1 and %d", maxDeliveryConcurrency))
	}
	if workload.Rounds < 1 || workload.Rounds > maxDeliveryRounds {
		reasons = append(reasons, fmt.Sprintf("rounds must be between 1 and %d", maxDeliveryRounds))
	}
	if workload.RequestTimeoutMillis < minDeliveryTimeoutMillis || workload.RequestTimeoutMillis > maxDeliveryTimeoutMillis {
		reasons = append(reasons, fmt.Sprintf("request timeout must be between %d and %d milliseconds", minDeliveryTimeoutMillis, maxDeliveryTimeoutMillis))
	}
	if len(workload.Requests) == 0 || len(workload.Requests) > maxDeliveryRequests {
		reasons = append(reasons, fmt.Sprintf("delivery workload must contain between 1 and %d requests", maxDeliveryRequests))
	}
	if len(workload.Requests) > 0 && workload.Rounds > 0 && len(workload.Requests) > maxDeliveryCampaignRequests/workload.Rounds {
		reasons = append(reasons, fmt.Sprintf("delivery campaign exceeds %d requests", maxDeliveryCampaignRequests))
	}
	requestIDs := make(map[string]struct{}, len(workload.Requests))
	origin := ""
	hasSuccessfulBody := false
	for i, request := range workload.Requests {
		prefix := fmt.Sprintf("delivery request %d", i+1)
		if !deliveryRequestIDPattern.MatchString(request.ID) {
			reasons = append(reasons, prefix+" id must be a bounded lowercase identifier")
		} else if _, exists := requestIDs[request.ID]; exists {
			reasons = append(reasons, prefix+" id must be unique")
		} else {
			requestIDs[request.ID] = struct{}{}
		}
		parsed, err := url.Parse(request.URL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			reasons = append(reasons, prefix+" URL must be absolute")
		} else {
			if parsed.Scheme != "http" && parsed.Scheme != "https" {
				reasons = append(reasons, prefix+" URL scheme must be http or https")
			}
			if parsed.User != nil {
				reasons = append(reasons, prefix+" URL must not contain userinfo")
			}
			if parsed.Fragment != "" {
				reasons = append(reasons, prefix+" URL must not contain a fragment")
			}
			currentOrigin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
			if origin == "" {
				origin = currentOrigin
			} else if currentOrigin != origin {
				reasons = append(reasons, prefix+" URL must use the campaign origin")
			}
		}
		if len(request.URL) > maxDeliveryURLBytes {
			reasons = append(reasons, prefix+" URL is too long")
		}
		if request.Range == "" && request.ExpectedStatus == http.StatusPartialContent {
			reasons = append(reasons, prefix+" expects a partial response without a Range")
		}
		if request.Range != "" {
			if !safeDeliveryRangeHeader(request.Range) {
				reasons = append(reasons, prefix+" Range header is unsafe or unbounded")
			} else if request.ExpectedStatus != http.StatusPartialContent && request.ExpectedStatus != http.StatusRequestedRangeNotSatisfiable {
				reasons = append(reasons, prefix+" Range must expect status 206 or 416")
			} else if request.ExpectedStatus == http.StatusPartialContent {
				parsedRange, err := parseDeliveryRange(request.Range)
				if err != nil {
					reasons = append(reasons, prefix+" successful Range must use one valid byte interval")
				} else if !parsedRange.open && parsedRange.suffix == 0 && parsedRange.end-parsedRange.start+1 != request.ExpectedBytes {
					reasons = append(reasons, prefix+" bounded Range length must match expected bytes")
				} else if parsedRange.suffix > 0 && request.ExpectedBytes > parsedRange.suffix {
					reasons = append(reasons, prefix+" suffix Range cannot return more than the requested suffix")
				}
			}
		}
		if request.ExpectedStatus < 100 || request.ExpectedStatus > 599 {
			reasons = append(reasons, prefix+" expected status is invalid")
		}
		if request.ExpectedBytes < 0 || request.ExpectedBytes > maxDeliveryBodyBytes {
			reasons = append(reasons, fmt.Sprintf("%s expected bytes must be between 0 and %d", prefix, maxDeliveryBodyBytes))
		}
		if request.ExpectedStatus >= 200 && request.ExpectedStatus < 300 && !isSHA256(request.ExpectedSHA256) {
			reasons = append(reasons, prefix+" successful response requires a SHA-256 digest")
		}
		if request.ExpectedStatus >= 200 && request.ExpectedStatus < 300 && request.ExpectedBytes > 0 {
			hasSuccessfulBody = true
		}
		if request.ExpectedContentType != "" {
			mediaType, _, err := mime.ParseMediaType(request.ExpectedContentType)
			if err != nil || request.ExpectedContentType != strings.ToLower(request.ExpectedContentType) || mediaType != request.ExpectedContentType {
				reasons = append(reasons, prefix+" expected content type must be a lowercase media type without parameters")
			}
		}
	}
	if len(workload.Requests) > 0 && !hasSuccessfulBody {
		reasons = append(reasons, "delivery workload must include at least one successful non-empty media response")
	}
	return reasons
}

func RunDeliveryCampaign(ctx context.Context, client *http.Client, bearerToken string, workload DeliveryWorkload) (DeliveryCampaignResult, error) {
	result := DeliveryCampaignResult{Status: "UNVERIFIED", Sample: CampaignSample{Conditions: workload.Conditions}}
	runID, err := newDeliveryRunID()
	if err != nil {
		return result, err
	}
	result.RunID = runID
	digest, err := DeliveryWorkloadSHA256(workload)
	if err != nil {
		return result, err
	}
	if workload.Conditions.WorkloadSHA256 != "" && workload.Conditions.WorkloadSHA256 != digest {
		result.Reasons = append(result.Reasons, "declared workload digest does not match the semantic delivery workload")
	}
	workload.Conditions.WorkloadSHA256 = digest
	result.Sample.Conditions = workload.Conditions
	result.Reasons = append(result.Reasons, ValidateDeliveryWorkload(workload)...)
	result.Reasons = append(result.Reasons, validateCampaignConditions(workload.Conditions)...)
	if len(bearerToken) > 16<<10 {
		result.Reasons = append(result.Reasons, "bearer credential exceeds 16 KiB")
	}
	if len(result.Reasons) != 0 {
		return result, nil
	}

	campaignClient := deliveryHTTPClient(client, workload)
	defer campaignClient.CloseIdleConnections()
	totalRequests := len(workload.Requests) * workload.Rounds
	workers := min(workload.Concurrency, totalRequests)
	jobs := make(chan int)
	samples := make(chan deliverySample, workers*2)
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for job := range jobs {
				spec := workload.Requests[job%len(workload.Requests)]
				samples <- runDeliveryRequest(ctx, campaignClient, bearerToken, spec, job+1)
			}
		}()
	}

	started := time.Now()
	go func() {
		defer close(jobs)
		for i := range totalRequests {
			select {
			case jobs <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		group.Wait()
		close(samples)
	}()

	latencies := make([]float64, 0, totalRequests)
	for sample := range samples {
		result.RequestCount++
		result.ResponseBytes += sample.bytes
		latencyMillis := float64(sample.duration) / float64(time.Millisecond)
		latencies = append(latencies, latencyMillis)
		if sample.reason != "" {
			result.FailureCount++
			if len(result.Reasons) < maxDeliveryReasons {
				result.Reasons = append(result.Reasons, sample.reason)
			}
		}
	}
	result.DurationMillis = float64(time.Since(started)) / float64(time.Millisecond)
	if result.RequestCount != totalRequests {
		result.Reasons = append(result.Reasons, "campaign stopped before every scheduled request completed")
	}
	if result.FailureCount > maxDeliveryReasons {
		result.Reasons = append(result.Reasons, fmt.Sprintf("%d additional delivery failures were suppressed", result.FailureCount-maxDeliveryReasons))
	}
	if result.DurationMillis > 0 {
		seconds := result.DurationMillis / 1000
		result.Sample.Throughput = float64(result.RequestCount) / seconds
		result.BytesPerSecond = float64(result.ResponseBytes) / seconds
	}
	if len(latencies) > 0 {
		slices.Sort(latencies)
		index := max(0, int(math.Ceil(float64(len(latencies))*0.95))-1)
		result.Sample.P95Millis = latencies[index]
		result.MaxLatencyMillis = latencies[len(latencies)-1]
	}
	slices.Sort(result.Reasons)
	if len(result.Reasons) == 0 && result.RequestCount == totalRequests && finitePositive(result.Sample.Throughput) && finitePositive(result.Sample.P95Millis) {
		result.Status = "VERIFIED"
	}
	return result, nil
}

func ValidDeliveryRunID(value string) bool {
	return deliveryRunIDPattern.MatchString(value)
}

func newDeliveryRunID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate delivery campaign run id: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func deliveryHTTPClient(base *http.Client, workload DeliveryWorkload) *http.Client {
	client := &http.Client{}
	if base != nil {
		*client = *base
	}
	if base == nil || base.Transport == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.DisableCompression = true
		transport.ForceAttemptHTTP2 = true
		transport.MaxConnsPerHost = workload.Concurrency
		transport.MaxIdleConnsPerHost = workload.Concurrency
		client.Transport = transport
	}
	client.Timeout = time.Duration(workload.RequestTimeoutMillis) * time.Millisecond
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return client
}

func runDeliveryRequest(ctx context.Context, client *http.Client, bearerToken string, spec DeliveryRequest, ordinal int) deliverySample {
	started := time.Now()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, spec.URL, nil)
	if err != nil {
		return deliverySample{duration: time.Since(started), reason: fmt.Sprintf("delivery request %d could not be created", ordinal)}
	}
	request.Header.Set("Accept-Encoding", "identity")
	if spec.Range != "" {
		request.Header.Set("Range", spec.Range)
	}
	if bearerToken != "" {
		request.Header.Set("Authorization", "Bearer "+bearerToken)
	}
	response, err := client.Do(request)
	if err != nil {
		return deliverySample{duration: time.Since(started), reason: fmt.Sprintf("delivery request %d transport failed", ordinal)}
	}
	defer response.Body.Close()

	hasher := sha256.New()
	read, readErr := copyDeliveryBody(hasher, response.Body, spec.ExpectedBytes)
	sample := deliverySample{duration: time.Since(started), bytes: read}
	if readErr != nil {
		sample.reason = fmt.Sprintf("delivery request %d response body could not be read", ordinal)
		return sample
	}
	if response.StatusCode != spec.ExpectedStatus {
		sample.reason = fmt.Sprintf("delivery request %d returned an unexpected status", ordinal)
		return sample
	}
	if spec.ExpectedStatus == http.StatusPartialContent && !deliveryContentRangeMatches(spec.Range, response.Header.Get("Content-Range"), spec.ExpectedBytes) {
		sample.reason = fmt.Sprintf("delivery request %d returned an invalid Content-Range", ordinal)
		return sample
	}
	if read != spec.ExpectedBytes {
		sample.reason = fmt.Sprintf("delivery request %d returned an unexpected byte count", ordinal)
		return sample
	}
	if spec.ExpectedSHA256 != "" && hex.EncodeToString(hasher.Sum(nil)) != strings.ToLower(spec.ExpectedSHA256) {
		sample.reason = fmt.Sprintf("delivery request %d returned an unexpected content digest", ordinal)
		return sample
	}
	if spec.ExpectedContentType != "" {
		mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if err != nil || strings.ToLower(mediaType) != spec.ExpectedContentType {
			sample.reason = fmt.Sprintf("delivery request %d returned an unexpected content type", ordinal)
		}
	}
	return sample
}

func copyDeliveryBody(hasher hash.Hash, body io.Reader, expectedBytes int64) (int64, error) {
	limit := min(expectedBytes+1, int64(maxDeliveryBodyBytes)+1)
	return io.Copy(hasher, io.LimitReader(body, limit))
}

func safeDeliveryRangeHeader(value string) bool {
	if len(value) == 0 || len(value) > 128 || !strings.HasPrefix(value, "bytes=") {
		return false
	}
	for _, character := range strings.TrimPrefix(value, "bytes=") {
		if (character < '0' || character > '9') && character != '-' && character != ',' {
			return false
		}
	}
	return true
}

func parseDeliveryRange(value string) (deliveryRange, error) {
	if !safeDeliveryRangeHeader(value) || strings.Contains(value, ",") {
		return deliveryRange{}, errors.New("invalid Range")
	}
	startText, endText, found := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !found || (startText == "" && endText == "") {
		return deliveryRange{}, errors.New("invalid Range")
	}
	if startText == "" {
		suffix, err := strconv.ParseInt(endText, 10, 64)
		if err != nil || suffix <= 0 || suffix > maxDeliveryBodyBytes {
			return deliveryRange{}, errors.New("invalid suffix Range")
		}
		return deliveryRange{suffix: suffix}, nil
	}
	start, startErr := strconv.ParseInt(startText, 10, 64)
	if startErr != nil || start < 0 {
		return deliveryRange{}, errors.New("invalid Range start")
	}
	if endText == "" {
		return deliveryRange{start: start, open: true}, nil
	}
	end, endErr := strconv.ParseInt(endText, 10, 64)
	if endErr != nil || end < start || end-start >= maxDeliveryBodyBytes {
		return deliveryRange{}, errors.New("invalid Range end")
	}
	return deliveryRange{start: start, end: end}, nil
}

func deliveryContentRangeMatches(requestRange, contentRange string, expectedBytes int64) bool {
	requested, err := parseDeliveryRange(requestRange)
	if err != nil || !strings.HasPrefix(contentRange, "bytes ") {
		return false
	}
	interval, totalText, found := strings.Cut(strings.TrimPrefix(contentRange, "bytes "), "/")
	if !found || totalText == "" || totalText == "*" {
		return false
	}
	startText, endText, found := strings.Cut(interval, "-")
	if !found {
		return false
	}
	start, startErr := strconv.ParseInt(startText, 10, 64)
	end, endErr := strconv.ParseInt(endText, 10, 64)
	total, totalErr := strconv.ParseInt(totalText, 10, 64)
	if startErr != nil || endErr != nil || totalErr != nil || start < 0 || end < start || total <= end || end-start+1 != expectedBytes {
		return false
	}
	if requested.suffix > 0 {
		return expectedBytes <= requested.suffix && end == total-1
	}
	if requested.open {
		return start == requested.start
	}
	return start == requested.start && end == requested.end
}
