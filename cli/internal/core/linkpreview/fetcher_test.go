package linkpreview

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadProcessedImageEnforcesOutputLimit(t *testing.T) {
	allowed := bytes.Repeat([]byte{0x42}, MaxProcessedImageSize)
	got, err := readProcessedImage(bytes.NewReader(allowed))
	if err != nil {
		t.Fatalf("readProcessedImage at limit: %v", err)
	}
	if len(got) != MaxProcessedImageSize {
		t.Fatalf("readProcessedImage size = %d, want %d", len(got), MaxProcessedImageSize)
	}

	_, err = readProcessedImage(bytes.NewReader(append(allowed, 0x43)))
	if err == nil || !strings.Contains(err.Error(), "processed image too large") {
		t.Fatalf("readProcessedImage over limit error = %v", err)
	}
}

func TestSafeLogOriginDropsCredentialsPathQueryAndFragment(t *testing.T) {
	got := SafeLogOrigin("https://user:secret@example.com:8443/reset/private-token?code=sensitive#fragment")
	if got != "https://example.com:8443" {
		t.Fatalf("safeLogOrigin = %q", got)
	}
}

func TestFetcherBoundsConcurrentRemoteWork(t *testing.T) {
	fetcher := NewFetcher(nil, nil, nil)
	var active atomic.Int32
	var maximum atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := fetcher.withFetchSlot(context.Background(), func() (*FetchResult, error) {
				current := active.Add(1)
				defer active.Add(-1)
				for {
					observed := maximum.Load()
					if current <= observed || maximum.CompareAndSwap(observed, current) {
						break
					}
				}
				time.Sleep(20 * time.Millisecond)
				return &FetchResult{}, nil
			})
			if err != nil {
				t.Errorf("withFetchSlot: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := maximum.Load(); got != MaxConcurrentFetches {
		t.Fatalf("maximum concurrent work = %d, want %d", got, MaxConcurrentFetches)
	}
}

func TestFetcherUsesLiveWorkerLimit(t *testing.T) {
	fetcher := NewFetcher(nil, nil, nil)
	var limit atomic.Int32
	limit.Store(1)
	fetcher.SetWorkerLimit(func() int { return int(limit.Load()) })

	started := make(chan struct{}, 2)
	release := make(chan struct{})
	work := func() (*FetchResult, error) {
		started <- struct{}{}
		<-release
		return &FetchResult{}, nil
	}
	done := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := fetcher.withFetchSlot(context.Background(), work)
			done <- err
		}()
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("first link-preview worker did not start")
	}
	select {
	case <-started:
		t.Fatal("second link-preview worker started above live limit")
	case <-time.After(50 * time.Millisecond):
	}
	limit.Store(2)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("waiting link-preview worker did not observe raised limit")
	}
	close(release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}

func TestFetcherCoalescesConcurrentRequestsForNormalizedURL(t *testing.T) {
	restoreLocalhost := AllowLocalhostForTesting()
	defer restoreLocalhost()

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		<-release
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><meta property="og:title" content="Shared"></head></html>`))
	}))
	defer server.Close()

	fetcher := NewFetcher(nil, nil, nil)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := fetcher.Fetch(context.Background(), server.URL+"/#fragment")
			if err != nil {
				t.Errorf("Fetch: %v", err)
				return
			}
			if result.Title != "Shared" {
				t.Errorf("Fetch title = %q", result.Title)
			}
		}()
	}
	close(start)
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("fetch did not start")
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream request count = %d, want 1", got)
	}
}
