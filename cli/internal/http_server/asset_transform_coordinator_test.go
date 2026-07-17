package http_server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/pkg/signedurl"
)

func waitForTransformWaiters(t *testing.T, coordinator *assetTransformCoordinator, key string, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if coordinator.waiterCount(key) == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("waiters for %q = %d, want %d", key, coordinator.waiterCount(key), want)
}

func waitForTransformJobs(t *testing.T, coordinator *assetTransformCoordinator, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if coordinator.jobCount() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("jobs = %d, want %d", coordinator.jobCount(), want)
}

func TestAssetTransformCoordinatorCoalescesFiftyWaiters(t *testing.T) {
	coordinator := newAssetTransformCoordinator(2, 8)
	t.Cleanup(coordinator.Close)

	const waiterCount = 50
	start := make(chan struct{})
	workStarted := make(chan struct{})
	releaseWork := make(chan struct{})
	var workCalls atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, waiterCount)

	work := func(ctx context.Context) (*assetTransformOutput, error) {
		if workCalls.Add(1) == 1 {
			close(workStarted)
		}
		select {
		case <-releaseWork:
			return &assetTransformOutput{data: []byte("coalesced"), contentType: "image/webp"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	for i := 0; i < waiterCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := coordinator.Do(context.Background(), "same-derivative", work)
			if err == nil && (result == nil || string(result.data) != "coalesced") {
				err = fmt.Errorf("unexpected result: %#v", result)
			}
			errs <- err
		}()
	}
	close(start)
	select {
	case <-workStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("shared transform did not start")
	}
	waitForTransformWaiters(t, coordinator, "same-derivative", waiterCount)
	close(releaseWork)
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("coalesced waiter failed: %v", err)
		}
	}
	if got := workCalls.Load(); got != 1 {
		t.Fatalf("work calls = %d, want 1", got)
	}
}

func TestTransformedAssetHandlerCoalescesFiftyColdRequests(t *testing.T) {
	env := setupAssetTestServer(t)
	coordinator := newAssetTransformCoordinator(2, 8)
	t.Cleanup(coordinator.Close)
	server := &HTTPServer{
		core:            env.core,
		logger:          log.WithPrefix("test"),
		assetTransforms: coordinator,
	}

	imageData := createAssetTestPNG(t, 320, 240)
	workStarted := make(chan struct{})
	releaseWork := make(chan struct{})
	var fetchCalls atomic.Int32
	req := transformRequest{
		CachePrefix: "coalescing-test",
		AssetID:     "same-asset",
		FetchAsset: func(ctx context.Context) (io.Reader, string, error) {
			if fetchCalls.Add(1) == 1 {
				close(workStarted)
			}
			select {
			case <-releaseWork:
				return bytes.NewReader(imageData), "image/png", nil
			case <-ctx.Done():
				return nil, "", ctx.Err()
			}
		},
	}
	params := &signedurl.TransformParams{Width: 64, Height: 64, Fit: "contain"}
	cacheKey := core.ImageCacheKey(req.CachePrefix, req.AssetID, params.Width, params.Height, params.Fit)

	router := gin.New()
	router.GET("/transform", func(c *gin.Context) {
		server.serveTransformedAssetWithParams(c, req, params)
	})
	ts := httptest.NewServer(router)
	t.Cleanup(ts.Close)

	const requestCount = 50
	start := make(chan struct{})
	responses := make(chan error, requestCount)
	var wg sync.WaitGroup
	for i := 0; i < requestCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := ts.Client().Get(ts.URL + "/transform")
			if err != nil {
				responses <- err
				return
			}
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				responses <- readErr
				return
			}
			if resp.StatusCode != http.StatusOK || len(body) == 0 {
				responses <- fmt.Errorf("status=%d body=%d", resp.StatusCode, len(body))
				return
			}
			responses <- nil
		}()
	}
	close(start)
	select {
	case <-workStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("cold transform did not start")
	}
	waitForTransformWaiters(t, coordinator, cacheKey, requestCount)
	close(releaseWork)
	wg.Wait()
	close(responses)

	for err := range responses {
		if err != nil {
			t.Fatalf("coalesced HTTP request failed: %v", err)
		}
	}
	if got := fetchCalls.Load(); got != 1 {
		t.Fatalf("cold fetch calls = %d, want 1", got)
	}
}

func TestAssetTransformCoordinatorCancellationKeepsUsefulSharedWork(t *testing.T) {
	coordinator := newAssetTransformCoordinator(1, 4)
	t.Cleanup(coordinator.Close)

	workStarted := make(chan struct{})
	releaseWork := make(chan struct{})
	workCancelled := make(chan struct{}, 1)
	work := func(ctx context.Context) (*assetTransformOutput, error) {
		close(workStarted)
		select {
		case <-releaseWork:
			return &assetTransformOutput{data: []byte("done"), contentType: "image/webp"}, nil
		case <-ctx.Done():
			workCancelled <- struct{}{}
			return nil, ctx.Err()
		}
	}

	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstResult := make(chan error, 1)
	go func() {
		_, err := coordinator.Do(firstCtx, "shared", work)
		firstResult <- err
	}()
	<-workStarted

	secondResult := make(chan error, 1)
	go func() {
		result, err := coordinator.Do(context.Background(), "shared", work)
		if err == nil && (result == nil || string(result.data) != "done") {
			err = fmt.Errorf("unexpected second result: %#v", result)
		}
		secondResult <- err
	}()
	waitForTransformWaiters(t, coordinator, "shared", 2)

	cancelFirst()
	if err := <-firstResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("first waiter error = %v, want context canceled", err)
	}
	select {
	case <-workCancelled:
		t.Fatal("one cancelled waiter cancelled work still needed by another")
	case <-time.After(50 * time.Millisecond):
	}

	close(releaseWork)
	if err := <-secondResult; err != nil {
		t.Fatalf("second waiter failed: %v", err)
	}
}

func TestAssetTransformCoordinatorBoundsDistinctAdmission(t *testing.T) {
	coordinator := newAssetTransformCoordinator(1, 2)
	t.Cleanup(coordinator.Close)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	work := func(ctx context.Context) (*assetTransformOutput, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}

	results := make(chan error, 2)
	for _, key := range []string{"first", "second"} {
		go func(key string) {
			_, err := coordinator.Do(ctx, key, work)
			results <- err
		}(key)
	}
	waitForTransformJobs(t, coordinator, 2)

	if _, err := coordinator.Do(context.Background(), "third", work); !errors.Is(err, errAssetTransformBusy) {
		t.Fatalf("third distinct job error = %v, want errAssetTransformBusy", err)
	}

	cancel()
	for range 2 {
		if err := <-results; !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled admitted job error = %v, want context canceled", err)
		}
	}
}

func TestAssetTransformCoordinatorPanicDoesNotLeakAdmission(t *testing.T) {
	coordinator := newAssetTransformCoordinator(1, 1)
	t.Cleanup(coordinator.Close)

	if _, err := coordinator.Do(context.Background(), "panic", func(context.Context) (*assetTransformOutput, error) {
		panic("boom")
	}); err == nil {
		t.Fatal("panicking work returned nil error")
	}
	waitForTransformJobs(t, coordinator, 0)

	result, err := coordinator.Do(context.Background(), "healthy", func(context.Context) (*assetTransformOutput, error) {
		return &assetTransformOutput{data: []byte("healthy"), contentType: "image/webp"}, nil
	})
	if err != nil {
		t.Fatalf("job after panic failed: %v", err)
	}
	if result == nil || string(result.data) != "healthy" {
		t.Fatalf("job after panic result = %#v", result)
	}
}
