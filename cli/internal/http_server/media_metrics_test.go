package http_server

import (
	"context"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"hmans.de/chatto/internal/connectapi"
)

func TestMediaMetricsHaveBoundedCardinality(t *testing.T) {
	metrics := newProcessMetrics()
	registry := prometheus.NewPedanticRegistry()
	registry.MustRegister(metrics.collectors()...)

	operations := []mediaOperation{
		mediaOperationServerOriginal,
		mediaOperationServerTransform,
		mediaOperationAttachmentOriginal,
		mediaOperationAttachmentTransform,
		mediaOperation("untrusted-asset-id"),
	}
	statuses := []int{200, 302, 400, 401, 404, 500}
	sizes := []int64{-1, 1, 1<<20 + 1, 32<<20 + 1}
	caches := []mediaCacheResult{
		mediaCacheNone,
		mediaCacheHit,
		mediaCacheMiss,
		mediaCacheError,
		mediaCacheResult("untrusted-cache-key"),
	}
	for _, operation := range operations {
		for _, status := range statuses {
			for _, size := range sizes {
				for _, cache := range caches {
					metrics.observeMediaRequest(operation, cache, status, size, time.Millisecond)
				}
			}
		}
		for _, status := range []int{200, 206, 416, 500} {
			metrics.observeMediaRange(operation, status)
		}
	}
	for _, outcome := range []mediaTransformOutcome{
		mediaTransformSuccess,
		mediaTransformError,
		mediaTransformOutcome("untrusted-transform-outcome"),
	} {
		for _, size := range sizes {
			metrics.observeMediaTransform(outcome, size, time.Millisecond)
		}
	}
	uploadOperations := []connectapi.AssetUploadOperation{
		connectapi.AssetUploadCreate,
		connectapi.AssetUploadChunk,
		connectapi.AssetUploadComplete,
		connectapi.AssetUploadCancel,
		connectapi.AssetUploadOperation("untrusted-upload-id"),
	}
	uploadOutcomes := []connectapi.AssetUploadOutcome{
		connectapi.AssetUploadSuccess,
		connectapi.AssetUploadError,
		connectapi.AssetUploadOutcome("untrusted-upload-outcome"),
	}
	for _, operation := range uploadOperations {
		for _, outcome := range uploadOutcomes {
			for _, size := range sizes {
				metrics.ObserveAssetUpload(operation, outcome, size, time.Millisecond)
			}
		}
	}

	families, err := registry.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	series := 0
	for _, family := range families {
		for _, metric := range family.GetMetric() {
			if histogram := metric.GetHistogram(); histogram != nil {
				series += len(histogram.GetBucket()) + 2 // buckets + sum + count
			} else {
				series++
			}
			for _, label := range metric.GetLabel() {
				if label.GetValue() == "untrusted-asset-id" ||
					label.GetValue() == "untrusted-cache-key" ||
					label.GetValue() == "untrusted-transform-outcome" ||
					label.GetValue() == "untrusted-upload-id" ||
					label.GetValue() == "untrusted-upload-outcome" {
					t.Fatalf("unbounded label value exported: %s=%q", label.GetName(), label.GetValue())
				}
			}
		}
	}
	if series != mediaMetricsMaximumSeries {
		t.Fatalf("media metric series = %d, want bounded maximum %d", series, mediaMetricsMaximumSeries)
	}
}

func TestMediaTransformJobGaugesTrackCoordinatorQueue(t *testing.T) {
	metrics := newProcessMetrics()
	coordinator := newAssetTransformCoordinator(1, 2, metrics.setMediaTransformJobs)
	t.Cleanup(coordinator.Close)

	firstStarted := make(chan struct{})
	secondStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	releaseSecond := make(chan struct{})
	results := make(chan error, 2)

	go func() {
		_, err := coordinator.Do(context.Background(), "first", func(context.Context) (*assetTransformOutput, error) {
			close(firstStarted)
			<-releaseFirst
			return &assetTransformOutput{}, nil
		})
		results <- err
	}()
	<-firstStarted

	go func() {
		_, err := coordinator.Do(context.Background(), "second", func(context.Context) (*assetTransformOutput, error) {
			close(secondStarted)
			<-releaseSecond
			return &assetTransformOutput{}, nil
		})
		results <- err
	}()

	waitForMediaTransformJobGauges(t, metrics, 1, 1)
	close(releaseFirst)
	<-secondStarted
	waitForMediaTransformJobGauges(t, metrics, 1, 0)
	close(releaseSecond)

	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	waitForMediaTransformJobGauges(t, metrics, 0, 0)
}

func TestMediaTransformJobGaugesReturnToZeroAfterCancellationAndPanic(t *testing.T) {
	metrics := newProcessMetrics()
	coordinator := newAssetTransformCoordinator(1, 2, metrics.setMediaTransformJobs)
	t.Cleanup(coordinator.Close)

	ctx, cancel := context.WithCancel(context.Background())
	results := make(chan error, 2)
	work := func(ctx context.Context) (*assetTransformOutput, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	for _, key := range []string{"active", "pending"} {
		go func(key string) {
			_, err := coordinator.Do(ctx, key, work)
			results <- err
		}(key)
	}
	waitForMediaTransformJobGauges(t, metrics, 1, 1)
	cancel()
	for range 2 {
		if err := <-results; err == nil {
			t.Fatal("cancelled transform returned nil error")
		}
	}
	waitForMediaTransformJobGauges(t, metrics, 0, 0)

	if _, err := coordinator.Do(context.Background(), "panic", func(context.Context) (*assetTransformOutput, error) {
		panic("metric cleanup")
	}); err == nil {
		t.Fatal("panicking transform returned nil error")
	}
	waitForMediaTransformJobGauges(t, metrics, 0, 0)
}

func waitForMediaTransformJobGauges(t *testing.T, metrics *processMetrics, active, pending float64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if mediaTransformJobGauge(t, metrics, "active") == active &&
			mediaTransformJobGauge(t, metrics, "pending") == pending {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf(
		"transform job gauges active=%v pending=%v, want active=%v pending=%v",
		mediaTransformJobGauge(t, metrics, "active"),
		mediaTransformJobGauge(t, metrics, "pending"),
		active,
		pending,
	)
}

func mediaTransformJobGauge(t *testing.T, metrics *processMetrics, state string) float64 {
	t.Helper()
	registry := prometheus.NewPedanticRegistry()
	registry.MustRegister(metrics.collectors()...)
	families, err := registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range families {
		if family.GetName() != "towk_media_transform_jobs" {
			continue
		}
		for _, metric := range family.GetMetric() {
			if len(metric.GetLabel()) == 1 && metric.GetLabel()[0].GetValue() == state {
				return metric.GetGauge().GetValue()
			}
		}
	}
	t.Fatalf("towk_media_transform_jobs{%q} is missing", state)
	return 0
}
