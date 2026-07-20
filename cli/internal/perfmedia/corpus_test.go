package perfmedia

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/disintegration/imageorient"
	"hmans.de/chatto/internal/assets"
)

const smokeManifestSHA256 = "57fa8db45b908a03bc58f597a4a88dd062e34c080ae2279a2ff9893831d904eb"

func TestGenerateCorpusIsDeterministic(t *testing.T) {
	repoRoot := testRepoRoot(t)
	firstDir := filepath.Join(t.TempDir(), "first")
	secondDir := filepath.Join(t.TempDir(), "second")

	first, err := GenerateCorpus(context.Background(), repoRoot, firstDir, ProfileSmoke)
	if err != nil {
		t.Fatalf("GenerateCorpus(first): %v", err)
	}
	second, err := GenerateCorpus(context.Background(), repoRoot, secondDir, ProfileSmoke)
	if err != nil {
		t.Fatalf("GenerateCorpus(second): %v", err)
	}

	if !reflect.DeepEqual(first, second) {
		t.Fatalf("manifests differ across identical generations\nfirst: %#v\nsecond: %#v", first, second)
	}

	wantKinds := map[string]bool{
		"audio":     false,
		"file":      false,
		"image":     false,
		"malformed": false,
		"video":     false,
	}
	seenNames := make(map[string]struct{}, len(first.Entries))
	for _, entry := range first.Entries {
		if _, exists := seenNames[entry.Path]; exists {
			t.Fatalf("duplicate corpus path %q", entry.Path)
		}
		seenNames[entry.Path] = struct{}{}
		if _, tracked := wantKinds[entry.Kind]; tracked {
			wantKinds[entry.Kind] = true
		}
		assertEntryMatchesDisk(t, firstDir, entry)
		assertEntryMatchesDisk(t, secondDir, entry)
		if entry.Kind == "image" && !entry.Invalid {
			contents, readErr := os.ReadFile(filepath.Join(firstDir, filepath.FromSlash(entry.Path)))
			if readErr != nil {
				t.Fatalf("read generated image %s: %v", entry.Path, readErr)
			}
			if validateErr := assets.ValidateImagePixelLimit(contents, assets.MaxDecodedImagePixels); validateErr != nil {
				t.Errorf("generated image %s failed Towk validation: %v", entry.Path, validateErr)
			}
		}
	}
	for kind, present := range wantKinds {
		if !present {
			t.Errorf("corpus is missing %q coverage", kind)
		}
	}

	firstManifest, err := os.ReadFile(filepath.Join(firstDir, ManifestFilename))
	if err != nil {
		t.Fatalf("read first manifest: %v", err)
	}
	secondManifest, err := os.ReadFile(filepath.Join(secondDir, ManifestFilename))
	if err != nil {
		t.Fatalf("read second manifest: %v", err)
	}
	if !reflect.DeepEqual(firstManifest, secondManifest) {
		t.Fatal("serialized manifests differ across identical generations")
	}
	manifestSum := sha256.Sum256(firstManifest)
	if got := hex.EncodeToString(manifestSum[:]); got != smokeManifestSHA256 {
		t.Fatalf("smoke manifest sha256 = %s, want %s", got, smokeManifestSHA256)
	}
}

func TestGeneratedOrientationFixtureIsApplied(t *testing.T) {
	outputDir := filepath.Join(t.TempDir(), "corpus")
	if _, err := GenerateCorpus(context.Background(), testRepoRoot(t), outputDir, ProfileSmoke); err != nil {
		t.Fatalf("GenerateCorpus: %v", err)
	}
	file, err := os.Open(filepath.Join(outputDir, "images", "oriented-320x240.jpg"))
	if err != nil {
		t.Fatalf("open oriented fixture: %v", err)
	}
	defer file.Close()
	img, _, err := imageorient.Decode(file)
	if err != nil {
		t.Fatalf("decode oriented fixture: %v", err)
	}
	if got := img.Bounds().Size(); got.X != 240 || got.Y != 320 {
		t.Fatalf("oriented fixture dimensions = %dx%d, want 240x320", got.X, got.Y)
	}
}

func TestPayloadSizesByProfile(t *testing.T) {
	tests := []struct {
		profile Profile
		want    []int64
	}{
		{profile: ProfileSmoke, want: []int64{1 << 20}},
		{profile: ProfileStandard, want: []int64{1 << 20, 25 << 20}},
		{profile: ProfileQualification, want: []int64{1 << 20, 25 << 20, 100 << 20, 250 << 20}},
	}
	for _, tt := range tests {
		t.Run(string(tt.profile), func(t *testing.T) {
			if got := PayloadSizes(tt.profile); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("PayloadSizes(%q) = %v, want %v", tt.profile, got, tt.want)
			}
		})
	}

	if got := PayloadSizes(Profile("unknown")); got != nil {
		t.Fatalf("PayloadSizes(unknown) = %v, want nil", got)
	}
}

func TestGenerateCorpusRejectsUnknownProfileWithoutPartialOutput(t *testing.T) {
	outputDir := filepath.Join(t.TempDir(), "corpus")
	_, err := GenerateCorpus(context.Background(), testRepoRoot(t), outputDir, Profile("unknown"))
	if err == nil {
		t.Fatal("GenerateCorpus(unknown) succeeded")
	}
	if _, statErr := os.Stat(outputDir); !os.IsNotExist(statErr) {
		t.Fatalf("partial output exists after rejected profile: %v", statErr)
	}
}

func TestGenerateCorpusCancellationLeavesNoPartialOutput(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	outputDir := filepath.Join(t.TempDir(), "corpus")
	_, err := GenerateCorpus(ctx, testRepoRoot(t), outputDir, ProfileSmoke)
	if err == nil {
		t.Fatal("GenerateCorpus(canceled) succeeded")
	}
	if _, statErr := os.Stat(outputDir); !os.IsNotExist(statErr) {
		t.Fatalf("partial output exists after cancellation: %v", statErr)
	}
}

func TestGenerateCorpusFixtureFailureLeavesNoPartialOutput(t *testing.T) {
	outputDir := filepath.Join(t.TempDir(), "corpus")
	_, err := GenerateCorpus(context.Background(), t.TempDir(), outputDir, ProfileSmoke)
	if err == nil {
		t.Fatal("GenerateCorpus(missing fixtures) succeeded")
	}
	if _, statErr := os.Stat(outputDir); !os.IsNotExist(statErr) {
		t.Fatalf("partial output exists after fixture failure: %v", statErr)
	}
}

func assertEntryMatchesDisk(t *testing.T, root string, entry Entry) {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(entry.Path)))
	if err != nil {
		t.Fatalf("read %s: %v", entry.Path, err)
	}
	if int64(len(contents)) != entry.SizeBytes {
		t.Errorf("%s size = %d, want %d", entry.Path, len(contents), entry.SizeBytes)
	}
	sum := sha256.Sum256(contents)
	if got := hex.EncodeToString(sum[:]); got != entry.SHA256 {
		t.Errorf("%s sha256 = %s, want %s", entry.Path, got, entry.SHA256)
	}
}

func testRepoRoot(t *testing.T) string {
	t.Helper()
	return findBenchmarkRepoRoot(t)
}
