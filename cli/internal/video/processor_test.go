package video

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestTranscodeUsesEffectiveFrameRateAndCapsAt30(t *testing.T) {
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the variable-frame-rate regression test")
	}
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is required for the variable-frame-rate regression test")
	}

	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "misleading-rate.mp4")
	outputPath := filepath.Join(tmpDir, "portable.mp4")

	// One one-tick sample makes the MP4 advertise a 90 kHz nominal rate while
	// the remaining timestamps still describe an ordinary short mobile clip.
	// Default CFR synchronization amplifies this fixture to roughly 90k frames.
	fixture := exec.Command(
		ffmpegPath,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi",
		"-i", "testsrc2=duration=1:size=64x64:rate=85",
		"-vf", `settb=1/90000,setpts=N*1059-if(gte(N\,10)\,1058\,0)`,
		"-fps_mode", "passthrough",
		"-enc_time_base", "1/90000",
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-video_track_timescale", "90000",
		"-an", "-y", inputPath,
	)
	if output, err := fixture.CombinedOutput(); err != nil {
		t.Fatalf("create misleading-rate fixture: %v\n%s", err, output)
	}

	service := &Service{ffmpegPath: ffmpegPath, ffprobePath: ffprobePath}
	probe, err := service.probe(context.Background(), inputPath, "video/mp4")
	if err != nil {
		t.Fatalf("probe misleading-rate fixture: %v", err)
	}
	if probe.AvgFrameRate < 80 || probe.AvgFrameRate > 90 {
		t.Fatalf("effective fixture frame rate = %.3f, want about 85", probe.AvgFrameRate)
	}

	inputFrames := videoFrameCount(t, ffprobePath, inputPath)
	if inputFrames != 85 {
		t.Fatalf("fixture frame count = %d, want 85", inputFrames)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := service.transcode(ctx, inputPath, outputPath, 64, probe.AvgFrameRate, false, nil); err != nil {
		t.Fatalf("transcode misleading-rate input: %v", err)
	}

	outputFrames := videoFrameCount(t, ffprobePath, outputPath)
	if outputFrames < 29 || outputFrames > 30 {
		t.Fatalf("transcode produced %d frames from %d source frames, want 29-30", outputFrames, inputFrames)
	}
}

func TestTranscodeDoesNotUpsampleSlowerVideo(t *testing.T) {
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the frame-rate regression test")
	}
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is required for the frame-rate regression test")
	}

	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "24fps.mp4")
	outputPath := filepath.Join(tmpDir, "portable.mp4")
	fixture := exec.Command(
		ffmpegPath,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi",
		"-i", "testsrc2=duration=1:size=64x64:rate=24",
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-an", "-y", inputPath,
	)
	if output, err := fixture.CombinedOutput(); err != nil {
		t.Fatalf("create 24 fps fixture: %v\n%s", err, output)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	service := &Service{ffmpegPath: ffmpegPath, ffprobePath: ffprobePath}
	probe, err := service.probe(context.Background(), inputPath, "video/mp4")
	if err != nil {
		t.Fatalf("probe 24 fps fixture: %v", err)
	}
	if err := service.transcode(ctx, inputPath, outputPath, 64, probe.AvgFrameRate, false, nil); err != nil {
		t.Fatalf("transcode 24 fps input: %v", err)
	}

	inputFrames := videoFrameCount(t, ffprobePath, inputPath)
	outputFrames := videoFrameCount(t, ffprobePath, outputPath)
	if outputFrames != inputFrames {
		t.Fatalf("transcode changed slower source from %d to %d frames", inputFrames, outputFrames)
	}
}

func TestTranscodeHighResolutionDesktopRecording(t *testing.T) {
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is required for the high-resolution regression test")
	}
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is required for the high-resolution regression test")
	}

	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "desktop-4096x2648.mp4")
	outputPath := filepath.Join(tmpDir, "portable-720p.mp4")
	fixture := exec.Command(
		ffmpegPath,
		"-hide_banner", "-loglevel", "error",
		"-f", "lavfi",
		"-i", "color=c=black:size=4096x2648:rate=1:duration=1",
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-pix_fmt", "yuv420p",
		"-an", "-y", inputPath,
	)
	if output, err := fixture.CombinedOutput(); err != nil {
		t.Fatalf("create high-resolution fixture: %v\n%s", err, output)
	}

	service := &Service{ffmpegPath: ffmpegPath, ffprobePath: ffprobePath}
	probe, err := service.probe(context.Background(), inputPath, "video/mp4")
	if err != nil {
		t.Fatalf("probe high-resolution fixture: %v", err)
	}
	if probe.Width != 4096 || probe.Height != 2648 {
		t.Fatalf("fixture dimensions = %dx%d, want 4096x2648", probe.Width, probe.Height)
	}
	if err := service.validateSourceForProcessing(probe); err != nil {
		t.Fatalf("validate high-resolution fixture: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := service.transcode(ctx, inputPath, outputPath, 720, probe.AvgFrameRate, false, nil); err != nil {
		t.Fatalf("transcode high-resolution fixture: %v", err)
	}

	outputProbe, err := service.probe(context.Background(), outputPath, "video/mp4")
	if err != nil {
		t.Fatalf("probe high-resolution output: %v", err)
	}
	if outputProbe.Height != 720 || outputProbe.Width <= 0 {
		t.Fatalf("portable dimensions = %dx%d, want a positive-width 720p output", outputProbe.Width, outputProbe.Height)
	}
}

func TestCappedOutputFrameRate(t *testing.T) {
	tests := []struct {
		name   string
		source float64
		want   float64
	}{
		{name: "preserves 24 fps", source: 24, want: 24},
		{name: "preserves 29.97 fps", source: 30000.0 / 1001.0, want: 30000.0 / 1001.0},
		{name: "caps high frame rate", source: 85, want: 30},
		{name: "caps missing frame rate", source: 0, want: 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cappedOutputFrameRate(tt.source); got != tt.want {
				t.Fatalf("cappedOutputFrameRate(%v) = %v, want %v", tt.source, got, tt.want)
			}
		})
	}
}

func TestVideoTerminalContextOutlivesExpiredJob(t *testing.T) {
	tests := []struct {
		name      string
		expireJob func() context.Context
	}{
		{
			name: "cancellation",
			expireJob: func() context.Context {
				jobCtx, cancelJob := context.WithCancel(context.Background())
				cancelJob()
				return jobCtx
			},
		},
		{
			name: "deadline",
			expireJob: func() context.Context {
				jobCtx, cancelJob := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				defer cancelJob()
				return jobCtx
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			terminalCtx, cancelTerminal := videoTerminalContext(tt.expireJob())
			defer cancelTerminal()

			if err := terminalCtx.Err(); err != nil {
				t.Fatalf("terminal context inherited job expiry: %v", err)
			}
			deadline, ok := terminalCtx.Deadline()
			if !ok {
				t.Fatal("terminal context must remain bounded")
			}
			remaining := time.Until(deadline)
			if remaining <= 0 || remaining > videoProcessingTerminalTimeout {
				t.Fatalf("terminal context remaining lifetime = %s", remaining)
			}
		})
	}
}

func videoFrameCount(t *testing.T, ffprobePath, path string) int {
	t.Helper()
	output, err := exec.Command(
		ffprobePath,
		"-v", "error",
		"-select_streams", "v:0",
		"-count_frames",
		"-show_entries", "stream=nb_read_frames",
		"-of", "default=nokey=1:noprint_wrappers=1",
		path,
	).Output()
	if err != nil {
		t.Fatalf("count frames in %s: %v", path, err)
	}
	count, err := strconv.Atoi(strings.TrimSpace(string(output)))
	if err != nil {
		t.Fatalf("parse frame count %q: %v", output, err)
	}
	return count
}

func TestSelectVariantHeights(t *testing.T) {
	tests := []struct {
		name         string
		sourceHeight int32
		want         []int
	}{
		{
			name:         "1080p source produces 720p and 480p variants",
			sourceHeight: 1080,
			want:         []int{720, 480},
		},
		{
			name:         "720p source produces 720p and 480p variants",
			sourceHeight: 720,
			want:         []int{720, 480},
		},
		{
			name:         "1440p source produces 720p and 480p variants",
			sourceHeight: 1440,
			want:         []int{720, 480},
		},
		{
			name:         "4K source produces 720p and 480p variants",
			sourceHeight: 2160,
			want:         []int{720, 480},
		},
		{
			name:         "480p source produces one 480p variant",
			sourceHeight: 480,
			want:         []int{480},
		},
		{
			name:         "source between 480p and 720p produces one 480p variant",
			sourceHeight: 576,
			want:         []int{480},
		},
		{
			name:         "small source transcodes at original resolution",
			sourceHeight: 360,
			want:         []int{360},
		},
		{
			name:         "very small source transcodes at original resolution",
			sourceHeight: 240,
			want:         []int{240},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectVariantHeights(tt.sourceHeight)
			if len(got) != len(tt.want) {
				t.Errorf("selectVariantHeights(%d) = %v, want %v", tt.sourceHeight, got, tt.want)
				return
			}
			for i, h := range got {
				if h != tt.want[i] {
					t.Errorf("selectVariantHeights(%d)[%d] = %d, want %d", tt.sourceHeight, i, h, tt.want[i])
				}
			}
		})
	}
}

func TestVideoDisplayDimensions(t *testing.T) {
	tests := []struct {
		name       string
		stream     ffprobeStream
		wantWidth  int32
		wantHeight int32
	}{
		{
			name: "plain 16:9 stays unchanged",
			stream: ffprobeStream{
				Width:  1920,
				Height: 1080,
			},
			wantWidth:  1920,
			wantHeight: 1080,
		},
		{
			name: "display aspect ratio expands anamorphic storage pixels",
			stream: ffprobeStream{
				Width:              1440,
				Height:             1080,
				DisplayAspectRatio: "16:9",
			},
			wantWidth:  1920,
			wantHeight: 1080,
		},
		{
			name: "sample aspect ratio expands anamorphic storage pixels",
			stream: ffprobeStream{
				Width:             1440,
				Height:            1080,
				SampleAspectRatio: "4:3",
			},
			wantWidth:  1920,
			wantHeight: 1080,
		},
		{
			name: "quarter-turn rotation swaps display dimensions",
			stream: ffprobeStream{
				Width:  1920,
				Height: 1080,
				Tags:   map[string]string{"rotate": "90"},
			},
			wantWidth:  1080,
			wantHeight: 1920,
		},
		{
			name: "invalid aspect ratio falls back to storage dimensions",
			stream: ffprobeStream{
				Width:              1280,
				Height:             720,
				DisplayAspectRatio: "0:0",
				SampleAspectRatio:  "not-a-ratio",
			},
			wantWidth:  1280,
			wantHeight: 720,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotWidth, gotHeight := videoDisplayDimensions(tt.stream)
			if gotWidth != tt.wantWidth || gotHeight != tt.wantHeight {
				t.Fatalf("videoDisplayDimensions() = %dx%d, want %dx%d", gotWidth, gotHeight, tt.wantWidth, tt.wantHeight)
			}
		})
	}
}

func TestThumbnailDimensions(t *testing.T) {
	tests := []struct {
		name       string
		width      int32
		height     int32
		wantWidth  int32
		wantHeight int32
		wantOK     bool
	}{
		{
			name:       "16:9 display dimensions scale to square-pixel thumbnail",
			width:      1920,
			height:     1080,
			wantWidth:  640,
			wantHeight: 360,
			wantOK:     true,
		},
		{
			name:       "4:3 display dimensions stay 4:3",
			width:      1024,
			height:     768,
			wantWidth:  640,
			wantHeight: 480,
			wantOK:     true,
		},
		{
			name:       "small display dimensions are not upscaled",
			width:      320,
			height:     180,
			wantWidth:  320,
			wantHeight: 180,
			wantOK:     true,
		},
		{
			name:   "invalid display dimensions fall back to legacy filter",
			width:  0,
			height: 1080,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotWidth, gotHeight, gotOK := thumbnailDimensions(tt.width, tt.height)
			if gotOK != tt.wantOK {
				t.Fatalf("thumbnailDimensions() ok = %v, want %v", gotOK, tt.wantOK)
			}
			if gotOK && (gotWidth != tt.wantWidth || gotHeight != tt.wantHeight) {
				t.Fatalf("thumbnailDimensions() = %dx%d, want %dx%d", gotWidth, gotHeight, tt.wantWidth, tt.wantHeight)
			}
		})
	}
}

func TestValidateSourceForProcessing(t *testing.T) {
	t.Run("accepts source within configured bounds", func(t *testing.T) {
		svc := &Service{config: config.VideoConfig{
			MaxDuration: config.Duration(10 * time.Second),
			MaxPixels:   640 * 480,
		}}
		if err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: int64((10 * time.Second) / time.Millisecond),
			Width:      640,
			Height:     480,
		}); err != nil {
			t.Fatalf("validateSourceForProcessing returned error: %v", err)
		}
	})

	t.Run("rejects source longer than configured duration", func(t *testing.T) {
		svc := &Service{config: config.VideoConfig{MaxDuration: config.Duration(10 * time.Second)}}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: int64((10*time.Second + time.Millisecond) / time.Millisecond),
			Width:      1280,
			Height:     720,
		})
		if err == nil || !strings.Contains(err.Error(), "video.max_duration") || !errors.Is(err, errVideoProcessingLimitExceeded) {
			t.Fatalf("validateSourceForProcessing error = %v, want video.max_duration rejection", err)
		}
		if got := processingFailureCode(err); got != corev1.AssetProcessingFailureCode_ASSET_PROCESSING_FAILURE_CODE_PROCESSING_LIMIT_EXCEEDED {
			t.Fatalf("processingFailureCode() = %v, want PROCESSING_LIMIT_EXCEEDED", got)
		}
	})

	t.Run("rejects non-gif source without detectable duration", func(t *testing.T) {
		svc := &Service{}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 0,
			Width:      1280,
			Height:     720,
			VideoCodec: "h264",
		})
		if err == nil || !strings.Contains(err.Error(), "duration") {
			t.Fatalf("validateSourceForProcessing error = %v, want duration rejection", err)
		}
	})

	t.Run("accepts gif source without detectable duration", func(t *testing.T) {
		svc := &Service{}
		if err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 0,
			Width:      320,
			Height:     240,
			VideoCodec: "gif",
		}); err != nil {
			t.Fatalf("validateSourceForProcessing gif fallback returned error: %v", err)
		}
	})

	t.Run("rejects source without detectable dimensions", func(t *testing.T) {
		svc := &Service{}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 1_000,
			Width:      0,
			Height:     720,
			VideoCodec: "h264",
		})
		if err == nil || !strings.Contains(err.Error(), "dimensions") {
			t.Fatalf("validateSourceForProcessing error = %v, want dimensions rejection", err)
		}
	})

	t.Run("rejects source above configured pixel area", func(t *testing.T) {
		svc := &Service{config: config.VideoConfig{MaxPixels: 640 * 480}}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 1_000,
			Width:      641,
			Height:     480,
		})
		if err == nil || !strings.Contains(err.Error(), "video.max_pixels") || !errors.Is(err, errVideoProcessingLimitExceeded) {
			t.Fatalf("validateSourceForProcessing error = %v, want video.max_pixels rejection", err)
		}
	})

	t.Run("default accepts 4K within 20 minutes", func(t *testing.T) {
		svc := &Service{}
		if err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: int64((20 * time.Minute) / time.Millisecond),
			Width:      3840,
			Height:     2160,
		}); err != nil {
			t.Fatalf("validateSourceForProcessing returned error: %v", err)
		}
	})

	t.Run("default accepts high-resolution desktop recording", func(t *testing.T) {
		svc := &Service{}
		if err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 1_000,
			Width:      4096,
			Height:     2648,
			VideoCodec: "h264",
		}); err != nil {
			t.Fatalf("validateSourceForProcessing returned error: %v", err)
		}
	})

	t.Run("default accepts 6K desktop boundary", func(t *testing.T) {
		svc := &Service{}
		if err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 1_000,
			Width:      6016,
			Height:     3384,
			VideoCodec: "h264",
		}); err != nil {
			t.Fatalf("validateSourceForProcessing returned error: %v", err)
		}
	})

	t.Run("default rejects longer than 20 minutes", func(t *testing.T) {
		svc := &Service{}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: int64((20*time.Minute + time.Millisecond) / time.Millisecond),
			Width:      1920,
			Height:     1080,
		})
		if err == nil || !strings.Contains(err.Error(), "video.max_duration") {
			t.Fatalf("validateSourceForProcessing error = %v, want default duration rejection", err)
		}
	})

	t.Run("default rejects 8K source area", func(t *testing.T) {
		svc := &Service{}
		err := svc.validateSourceForProcessing(&ProbeResult{
			DurationMs: 1_000,
			Width:      7680,
			Height:     4320,
		})
		if err == nil || !strings.Contains(err.Error(), "video.max_pixels") {
			t.Fatalf("validateSourceForProcessing error = %v, want default pixel rejection", err)
		}
	})

	t.Run("keeps non-limit failures generic", func(t *testing.T) {
		if got := processingFailureCode(errors.New("ffmpeg failed")); got != corev1.AssetProcessingFailureCode_ASSET_PROCESSING_FAILURE_CODE_PROCESSING_FAILED {
			t.Fatalf("processingFailureCode() = %v, want PROCESSING_FAILED", got)
		}
	})
}

func TestServiceRunReturnsWhenShutdownWaitTimesOut(t *testing.T) {
	internalCtx, internalCancel := context.WithCancel(context.Background())
	svc := &Service{
		logger: log.WithPrefix("test.video"),
		ctx:    internalCtx,
		cancel: internalCancel,
	}

	var release sync.WaitGroup
	release.Add(1)
	svc.wg.Add(1)
	go func() {
		release.Wait()
		svc.wg.Done()
	}()
	t.Cleanup(release.Done)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- svc.run(ctx, 25*time.Millisecond) }()

	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not return after shutdown wait timeout")
	}
}
