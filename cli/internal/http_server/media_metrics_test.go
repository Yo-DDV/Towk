package http_server

import (
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

func TestMediaTransformActiveGaugeReturnsToZero(t *testing.T) {
	metrics := newProcessMetrics()
	done := metrics.mediaTransformStarted()
	done()
	done() // completion is idempotent so error paths cannot underflow the gauge

	registry := prometheus.NewPedanticRegistry()
	registry.MustRegister(metrics.collectors()...)
	families, err := registry.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	for _, family := range families {
		if family.GetName() != "towk_media_transform_jobs" {
			continue
		}
		for _, metric := range family.GetMetric() {
			if len(metric.GetLabel()) == 1 && metric.GetLabel()[0].GetValue() == "active" && metric.GetGauge().GetValue() != 0 {
				t.Fatalf("active transform jobs = %v, want 0", metric.GetGauge().GetValue())
			}
		}
		return
	}
	t.Fatal("towk_media_transform_jobs metric is missing")
}
