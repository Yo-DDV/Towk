package linkpreview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	// Register image decoders used by the link-preview pixel preflight and
	// processing pipeline.
	_ "image/jpeg"
	_ "image/png"

	"github.com/charmbracelet/log"
	"github.com/otiai10/opengraph/v2"
	"golang.org/x/sync/singleflight"
	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	// MaxImageSize is the maximum size of a preview image to download (5MB).
	MaxImageSize = 5 * 1024 * 1024

	// MaxPageSize is the maximum size of an HTML page to read for OG metadata (2MB).
	// OG meta tags are in the <head>, so even very large pages need minimal data.
	MaxPageSize = 2 * 1024 * 1024

	// MaxProcessedImageSize bounds the WebP object written after decoding and
	// conversion. The downloaded source limit alone does not bound encoder output.
	MaxProcessedImageSize = 1 * 1024 * 1024

	// MaxDecodedPreviewPixels caps the largest decoded remote image buffer at
	// about 40 MB for four-byte pixel formats before resize/encoding overhead.
	MaxDecodedPreviewPixels int64 = 10_000_000

	// MaxConcurrentFetches bounds remote page/image work and image decoding per
	// process. Distributed rate limits bound requests across replicas; this
	// local limit protects each process's memory and file-descriptor budget.
	MaxConcurrentFetches = 2

	// ImageFetchTimeout is the timeout for downloading preview images.
	ImageFetchTimeout = 10 * time.Second

	// PageFetchTimeout is the timeout for fetching page metadata.
	PageFetchTimeout = 10 * time.Second
)

// ErrUnavailable marks URLs that were fetched or inspected successfully enough
// to know that Towk cannot produce a useful preview for them.
var ErrUnavailable = errors.New("link preview unavailable")

// StoreImageFunc persists a processed preview image under the supplied asset ID.
type StoreImageFunc func(ctx context.Context, assetID string, data []byte, contentType string) (*corev1.AssetRecord, error)

// Fetcher fetches link preview metadata using OpenGraph.
type Fetcher struct {
	httpClient   *http.Client
	imageClient  *http.Client
	assetsConfig *assets.Config
	newAssetID   func() string // Generates new asset IDs
	storeImage   StoreImageFunc
	logger       *log.Logger
	fetchGroup   singleflight.Group
	fetchSlots   chan struct{}
}

// NewFetcher creates a new link preview fetcher.
// The newAssetID function is used to generate asset IDs for stored images.
func NewFetcher(assetsConfig *assets.Config, newAssetID func() string, storeImage StoreImageFunc) *Fetcher {
	return &Fetcher{
		httpClient:   NewSSRFSafeClient(PageFetchTimeout),
		imageClient:  NewSSRFSafeClient(ImageFetchTimeout),
		assetsConfig: assetsConfig,
		newAssetID:   newAssetID,
		storeImage:   storeImage,
		logger:       log.WithPrefix("linkpreview"),
		fetchSlots:   make(chan struct{}, MaxConcurrentFetches),
	}
}

// FetchResult contains the fetched link preview metadata.
type FetchResult struct {
	Title       string
	Description string
	SiteName    string
	ImageAsset  *corev1.AssetRecord // Image asset if image was downloaded, nil otherwise
	EmbedType   string              // "generic", "youtube"
	EmbedID     string              // For YouTube: video ID
}

// Fetch fetches link preview metadata for a URL.
func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (*FetchResult, error) {
	key := NormalizeURLString(rawURL)
	result, err, _ := f.fetchGroup.Do(key, func() (any, error) {
		return f.fetchWithSlot(ctx, rawURL)
	})
	if err != nil {
		return nil, err
	}
	return result.(*FetchResult), nil
}

func (f *Fetcher) fetchWithSlot(ctx context.Context, rawURL string) (*FetchResult, error) {
	return f.withFetchSlot(ctx, func() (*FetchResult, error) {
		return f.fetch(ctx, rawURL)
	})
}

func (f *Fetcher) withFetchSlot(ctx context.Context, work func() (*FetchResult, error)) (*FetchResult, error) {
	select {
	case f.fetchSlots <- struct{}{}:
		defer func() { <-f.fetchSlots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return work()
}

func (f *Fetcher) fetch(ctx context.Context, rawURL string) (*FetchResult, error) {
	f.logger.Debug("Fetching link preview", "origin", SafeLogOrigin(rawURL))

	// Check for YouTube first - we can extract the video ID without fetching
	if videoID := ParseYouTubeVideoID(rawURL); videoID != "" {
		f.logger.Debug("Detected YouTube URL", "video_id", videoID)
		return &FetchResult{
			Title:     "YouTube Video",
			EmbedType: "youtube",
			EmbedID:   videoID,
		}, nil
	}

	// Fetch the page with a size limit to prevent memory exhaustion
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; TowkBot/1.0; Link Preview)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		f.logger.Warn("Failed to fetch page", "origin", SafeLogOrigin(rawURL), "error_type", fmt.Sprintf("%T", err))
		return nil, fmt.Errorf("%w: fetch page: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: page returned status %d", ErrUnavailable, resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(contentType, "text/html") && !strings.HasPrefix(contentType, "application/xhtml") {
		return nil, fmt.Errorf("%w: not an HTML page: %s", ErrUnavailable, contentType)
	}

	// Parse OG metadata with a size-limited reader
	og := opengraph.New(rawURL)
	if err := og.Parse(io.LimitReader(resp.Body, MaxPageSize)); err != nil {
		f.logger.Warn("Failed to parse OG metadata", "origin", SafeLogOrigin(rawURL), "error_type", fmt.Sprintf("%T", err))
		return nil, fmt.Errorf("%w: parse metadata: %v", ErrUnavailable, err)
	}

	// Convert relative URLs to absolute
	og.ToAbs()

	var imageURL string
	if len(og.Image) > 0 {
		imageURL = og.Image[0].URL
	}
	f.logger.Debug("Fetched OG metadata",
		"origin", SafeLogOrigin(rawURL),
		"image_count", len(og.Image),
		"image_origin", SafeLogOrigin(imageURL),
	)

	result := &FetchResult{
		Title:       og.Title,
		Description: og.Description,
		SiteName:    og.SiteName,
		EmbedType:   "generic",
	}

	// Check if OG detected a video type (YouTube, etc.)
	if strings.Contains(strings.ToLower(og.Type), "video") {
		// Try to extract YouTube video ID from the URL
		if videoID := ParseYouTubeVideoID(rawURL); videoID != "" {
			result.EmbedType = "youtube"
			result.EmbedID = videoID
		}
	}

	// Download and store the preview image if available
	if len(og.Image) > 0 && og.Image[0].URL != "" {
		imageURL := og.Image[0].URL
		f.logger.Debug("Attempting to download preview image", "image_origin", SafeLogOrigin(imageURL))
		asset, err := f.downloadAndStoreImage(ctx, imageURL)
		if err != nil {
			f.logger.Warn("Failed to download preview image", "image_origin", SafeLogOrigin(imageURL), "error_type", fmt.Sprintf("%T", err))
			// Continue without image - don't fail the whole preview
		} else {
			f.logger.Debug("Successfully stored preview image", "asset_id", asset.GetId())
			result.ImageAsset = asset
		}
	} else {
		f.logger.Debug("No preview image found", "origin", SafeLogOrigin(rawURL))
	}

	return result, nil
}

// SafeLogOrigin returns only scheme and host for observability. Userinfo,
// paths, queries, and fragments may carry credentials or personal data.
func SafeLogOrigin(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "invalid"
	}
	return parsed.Scheme + "://" + parsed.Host
}

// downloadAndStoreImage downloads an image and stores it as an server asset.
func (f *Fetcher) downloadAndStoreImage(ctx context.Context, imageURL string) (*corev1.AssetRecord, error) {
	// Create request with context
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "TowkBot/1.0 (Link Preview)")

	// Fetch the image
	resp, err := f.imageClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch image: %w", err)
	}
	defer resp.Body.Close()

	f.logger.Debug("Image fetch response",
		"origin", SafeLogOrigin(imageURL),
		"status", resp.StatusCode,
		"content_type", resp.Header.Get("Content-Type"),
		"content_length", resp.Header.Get("Content-Length"),
	)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("image returned status %d", resp.StatusCode)
	}

	// Check content type - be lenient since some servers don't set it properly
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(contentType, "image/") && contentType != "application/octet-stream" {
		return nil, fmt.Errorf("not an image: %s", contentType)
	}

	// Read with size limit
	limitedReader := io.LimitReader(resp.Body, MaxImageSize+1)
	imageData, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("read image: %w", err)
	}
	if len(imageData) > MaxImageSize {
		return nil, fmt.Errorf("image too large (>%d bytes)", MaxImageSize)
	}
	if err := assets.ValidateImagePixelLimit(imageData, MaxDecodedPreviewPixels); err != nil {
		return nil, fmt.Errorf("preview image dimensions: %w", err)
	}

	f.logger.Debug("Downloaded image data", "size", len(imageData))

	// Process the image (resize to fit OG dimensions, convert to WebP)
	processedReader, err := assets.ProcessLinkPreviewImageWithConfig(bytes.NewReader(imageData), *f.assetsConfig)
	if err != nil {
		return nil, fmt.Errorf("process image: %w", err)
	}

	processedData, err := readProcessedImage(processedReader)
	if err != nil {
		return nil, err
	}

	f.logger.Debug("Processed image", "original_size", len(imageData), "processed_size", len(processedData))

	// Generate asset ID and store
	assetID := f.newAssetID()

	if f.storeImage == nil {
		return nil, fmt.Errorf("store image: no image store configured")
	}
	asset, err := f.storeImage(ctx, assetID, processedData, "image/webp")
	if err != nil {
		return nil, fmt.Errorf("store image: %w", err)
	}

	f.logger.Debug("Stored image asset", "asset_id", assetID)

	return asset, nil
}

func readProcessedImage(reader io.Reader) ([]byte, error) {
	processedData, err := io.ReadAll(io.LimitReader(reader, MaxProcessedImageSize+1))
	if err != nil {
		return nil, fmt.Errorf("read processed image: %w", err)
	}
	if len(processedData) > MaxProcessedImageSize {
		return nil, fmt.Errorf("processed image too large (>%d bytes)", MaxProcessedImageSize)
	}
	return processedData, nil
}

// ToProto converts a FetchResult to a protobuf LinkPreview.
func (r *FetchResult) ToProto(url string) *corev1.LinkPreview {
	lp := &corev1.LinkPreview{
		Url:         url,
		Title:       r.Title,
		Description: r.Description,
		SiteName:    r.SiteName,
		EmbedType:   r.EmbedType,
	}
	if r.ImageAsset != nil && r.ImageAsset.GetId() != "" {
		imageAssetID := r.ImageAsset.GetId()
		lp.ImageAssetId = &imageAssetID
		lp.ImageAsset = proto.Clone(r.ImageAsset).(*corev1.AssetRecord)
	}
	if r.EmbedID != "" {
		lp.EmbedId = &r.EmbedID
	}
	return lp
}
