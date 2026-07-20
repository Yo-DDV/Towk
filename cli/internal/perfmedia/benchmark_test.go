package perfmedia

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"hmans.de/chatto/internal/assets"
)

var benchmarkTransformedImageBytes int64

type imageBenchmarkInput struct {
	name   string
	path   string
	width  int
	height int
	fit    assets.FitMode
	data   []byte
}

func BenchmarkImageTransform(b *testing.B) {
	inputs := loadImageBenchmarkInputs(b)
	for _, input := range inputs {
		input := input
		b.Run(input.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(input.data)))
			var written int64
			for b.Loop() {
				result, err := assets.TransformImage(input.data, input.width, input.height, input.fit)
				if err != nil {
					b.Fatal(err)
				}
				n, err := io.Copy(io.Discard, result.Reader)
				if err != nil {
					b.Fatal(err)
				}
				written += n
			}
			benchmarkTransformedImageBytes = written
			b.ReportMetric(float64(written)/float64(b.N), "output-B/op")
		})
	}
}

func TestImageBenchmarkInputsUseValidCorpusEntries(t *testing.T) {
	inputs := loadImageBenchmarkInputs(t)
	if len(inputs) != 4 {
		t.Fatalf("benchmark input count = %d, want 4", len(inputs))
	}
	for _, input := range inputs {
		if len(input.data) == 0 {
			t.Errorf("benchmark input %q is empty", input.name)
		}
		if _, err := assets.TransformImage(input.data, input.width, input.height, input.fit); err != nil {
			t.Errorf("benchmark input %q failed Towk transform: %v", input.name, err)
		}
	}
}

func loadImageBenchmarkInputs(tb testing.TB) []imageBenchmarkInput {
	tb.Helper()
	corpusDir := filepath.Join(tb.TempDir(), "corpus")
	manifest, err := GenerateCorpus(context.Background(), findBenchmarkRepoRoot(tb), corpusDir, ProfileSmoke)
	if err != nil {
		tb.Fatalf("GenerateCorpus: %v", err)
	}

	wanted := []imageBenchmarkInput{
		{name: "hd_jpeg_to_960x540_contain", path: "images/hd-1920x1080.jpg", width: 960, height: 540, fit: assets.FitContain},
		{name: "large_jpeg_to_960x720_contain", path: "images/large-4000x3000.jpg", width: 960, height: 720, fit: assets.FitContain},
		{name: "alpha_png_to_512x384_contain", path: "images/alpha-1024x768.png", width: 512, height: 384, fit: assets.FitContain},
		{name: "animated_gif_to_320x180_contain", path: "images/animated-320x180.gif", width: 320, height: 180, fit: assets.FitContain},
	}

	entries := make(map[string]Entry, len(manifest.Entries))
	for _, entry := range manifest.Entries {
		entries[entry.Path] = entry
	}
	for i := range wanted {
		entry, ok := entries[wanted[i].path]
		if !ok || entry.Invalid || entry.Kind != "image" {
			tb.Fatalf("valid image corpus entry %q is missing", wanted[i].path)
		}
		data, err := os.ReadFile(filepath.Join(corpusDir, filepath.FromSlash(wanted[i].path)))
		if err != nil {
			tb.Fatalf("read benchmark input %q: %v", wanted[i].path, err)
		}
		wanted[i].data = data
	}
	return wanted
}

func findBenchmarkRepoRoot(tb testing.TB) string {
	tb.Helper()
	root, err := os.Getwd()
	if err != nil {
		tb.Fatalf("get benchmark working directory: %v", err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(root, "mise.toml")); statErr == nil {
			if _, fixtureErr := os.Stat(filepath.Join(root, "apps", "frontend", "e2e", "fixtures", "test-audio.mp3")); fixtureErr == nil {
				return root
			}
		}
		parent := filepath.Dir(root)
		if parent == root {
			tb.Fatal("Towk repository root not found from benchmark working directory")
		}
		root = parent
	}
}
