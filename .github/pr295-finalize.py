from __future__ import annotations

import json
from pathlib import Path

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def insert_before_last(path: str, marker: str, addition: str) -> None:
    text = read(path)
    index = text.rfind(marker)
    if index < 0:
        raise SystemExit(f'{path}: missing final marker {marker!r}')
    write(path, text[:index] + addition + text[index:])


replace_once(
    'cli/internal/http_server/cors.go',
    'c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")',
    'c.Header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")',
)

replace_once(
    'cli/internal/http_server/assets.go',
    '\t// Check if this is a transform request: path ends with /t/{signedPath}\n',
    '\tassetID := path\n\tif separator := strings.IndexByte(assetID, \'/\'); separator >= 0 {\n\t\tassetID = assetID[:separator]\n\t}\n\tif core.IsProfileBannerAssetID(assetID) {\n\t\twriteLocalizedError(c, http.StatusNotFound, "asset.not_found")\n\t\treturn\n\t}\n\n\t// Check if this is a transform request: path ends with /t/{signedPath}\n',
)

replace_once(
    'cli/internal/core/user_profile_banner.go',
    '\t"io"\n',
    '\t"io"\n\t"strings"\n',
)
replace_once(
    'cli/internal/core/user_profile_banner.go',
    'func ProfileBannerAssetID(userID string) string {\n\tsum := sha256.Sum256([]byte(userID))\n\treturn profileBannerAssetPrefix + hex.EncodeToString(sum[:])\n}\n',
    'func ProfileBannerAssetID(userID string) string {\n\tsum := sha256.Sum256([]byte(userID))\n\treturn profileBannerAssetPrefix + hex.EncodeToString(sum[:])\n}\n\nfunc IsProfileBannerAssetID(assetID string) bool {\n\treturn strings.HasPrefix(assetID, profileBannerAssetPrefix)\n}\n',
)

replace_once(
    'cli/internal/assets/profile_banner.go',
    '\t"bytes"\n\t"fmt"\n',
    '\t"bytes"\n\t"encoding/binary"\n\t"fmt"\n',
)
replace_once(
    'cli/internal/assets/profile_banner.go',
    'type ProcessedProfileBanner struct {\n\tData        []byte\n\tFilename    string\n\tContentType string\n\tWidth       int\n\tHeight      int\n}\n',
    'type ProcessedProfileBanner struct {\n\tData        []byte\n\tFilename    string\n\tContentType string\n\tWidth       int\n\tHeight      int\n}\n\nfunc isAnimatedProfileBannerWebP(data []byte) bool {\n\tif len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {\n\t\treturn false\n\t}\n\tfor offset := 12; offset+8 <= len(data); {\n\t\tchunkType := string(data[offset : offset+4])\n\t\tchunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))\n\t\tdataStart := offset + 8\n\t\tdataEnd := dataStart + chunkSize\n\t\tif dataEnd > len(data) || chunkSize < 0 {\n\t\t\treturn false\n\t\t}\n\t\tif chunkType == "ANIM" || chunkType == "ANMF" {\n\t\t\treturn true\n\t\t}\n\t\tif chunkType == "VP8X" && chunkSize >= 1 && data[dataStart]&0x02 != 0 {\n\t\t\treturn true\n\t\t}\n\t\toffset = dataEnd + chunkSize%2\n\t}\n\treturn false\n}\n',
)
replace_once(
    'cli/internal/assets/profile_banner.go',
    '\tcontentType := DetectImageContentType(data)\n\tswitch contentType {\n\tcase "image/jpeg", "image/png", "image/webp":\n\tdefault:\n\t\treturn nil, fmt.Errorf("unsupported profile banner image type")\n\t}\n',
    '\tcontentType := DetectImageContentType(data)\n\tswitch contentType {\n\tcase "image/jpeg", "image/png":\n\tcase "image/webp":\n\t\tif isAnimatedProfileBannerWebP(data) {\n\t\t\treturn nil, fmt.Errorf("animated profile banners are not supported")\n\t\t}\n\tdefault:\n\t\treturn nil, fmt.Errorf("unsupported profile banner image type")\n\t}\n',
)

replace_once(
    'cli/internal/http_server/profile_banner.go',
    '\tif _, err := s.core.ReplaceUserProfileBannerFromUpload(\n\t\toperationCtx,\n\t\tuserID,\n\t\tc.Request.Body,\n\t); err != nil {\n\t\ts.writeProfileBannerFailure(c, err)\n\t\treturn\n\t}\n',
    '\tjobKey := fmt.Sprintf("profile-banner-upload:%s:%p", userID, c.Request)\n\tif _, err := s.transformCoordinator().Do(\n\t\toperationCtx,\n\t\tjobKey,\n\t\tfunc(workCtx context.Context) (*assetTransformOutput, error) {\n\t\t\tif _, err := s.core.ReplaceUserProfileBannerFromUpload(\n\t\t\t\tworkCtx,\n\t\t\t\tuserID,\n\t\t\t\tc.Request.Body,\n\t\t\t); err != nil {\n\t\t\t\treturn nil, err\n\t\t\t}\n\t\t\treturn &assetTransformOutput{}, nil\n\t\t},\n\t); err != nil {\n\t\ts.writeProfileBannerFailure(c, err)\n\t\treturn\n\t}\n',
)
replace_once(
    'cli/internal/http_server/profile_banner.go',
    '\tcase errors.Is(err, context.Canceled):\n\t\twriteProfileBannerError(c, http.StatusServiceUnavailable, "interrupted")\n\tdefault:\n',
    '\tcase errors.Is(err, context.Canceled):\n\t\twriteProfileBannerError(c, http.StatusServiceUnavailable, "interrupted")\n\tcase errors.Is(err, errAssetTransformBusy), errors.Is(err, errAssetTransformClosed):\n\t\twriteProfileBannerError(c, http.StatusServiceUnavailable, "busy")\n\tdefault:\n',
)

replace_once(
    'apps/frontend/src/lib/profileBanner.ts',
    'export const PROFILE_BANNER_MIN_WIDTH = 600;\nexport const PROFILE_BANNER_MIN_HEIGHT = 200;\n',
    'export const PROFILE_BANNER_MIN_WIDTH = 600;\nexport const PROFILE_BANNER_MIN_HEIGHT = 200;\nexport const PROFILE_BANNER_MAX_SOURCE_DIMENSION = 8192;\nexport const PROFILE_BANNER_MAX_SOURCE_PIXELS = 24_000_000;\n',
)
replace_once(
    'apps/frontend/src/lib/profileBanner.ts',
    "export type ProfileBannerValidationCode = 'invalid_type' | 'too_large';\n",
    "export type ProfileBannerValidationCode =\n  | 'invalid_type'\n  | 'too_large'\n  | 'dimensions_too_small'\n  | 'dimensions_too_large';\n",
)
replace_once(
    'apps/frontend/src/lib/profileBanner.ts',
    'export function isProfileBannerBelowRecommendation(dimensions: ProfileBannerDimensions): boolean {\n',
    "export function validateProfileBannerDimensions(\n  dimensions: ProfileBannerDimensions\n): ProfileBannerValidationCode | null {\n  if (\n    dimensions.width < PROFILE_BANNER_MIN_WIDTH ||\n    dimensions.height < PROFILE_BANNER_MIN_HEIGHT\n  ) {\n    return 'dimensions_too_small';\n  }\n  if (\n    dimensions.width > PROFILE_BANNER_MAX_SOURCE_DIMENSION ||\n    dimensions.height > PROFILE_BANNER_MAX_SOURCE_DIMENSION ||\n    dimensions.width * dimensions.height > PROFILE_BANNER_MAX_SOURCE_PIXELS\n  ) {\n    return 'dimensions_too_large';\n  }\n  return null;\n}\n\nexport function isProfileBannerBelowRecommendation(dimensions: ProfileBannerDimensions): boolean {\n",
)

replace_once(
    'apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte',
    '    uploadProfileBanner,\n    validateProfileBannerFile\n',
    '    uploadProfileBanner,\n    validateProfileBannerDimensions,\n    validateProfileBannerFile\n',
)
replace_once(
    'apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte',
    '  let removing = $state(false);\n',
    '  let removing = $state(false);\n  let selectionGeneration = 0;\n  let destroyed = false;\n',
)
editor = read('apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte')
start = editor.index('  function clearPreview() {')
end = editor.index('  function handleInput(event: Event) {')
replacement = '''  function resetSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedFile = null;
    dimensions = null;
    if (fileInput) fileInput.value = '';
  }

  function clearPreview() {
    selectionGeneration += 1;
    resetSelection();
    validationMessage = '';
  }

  onDestroy(() => {
    destroyed = true;
    clearPreview();
  });

  async function selectFile(file: File | undefined) {
    if (!file || saving || removing) return;

    const generation = ++selectionGeneration;
    resetSelection();
    validationMessage = '';

    const validation = validateProfileBannerFile(file);
    if (validation) {
      validationMessage = profileBannerMessage(validation);
      return;
    }

    let decoded: { width: number; height: number };
    try {
      decoded = await inspectProfileBannerDimensions(file);
    } catch {
      if (!destroyed && generation === selectionGeneration) {
        validationMessage = profileBannerMessage('decode_failed');
      }
      return;
    }

    if (destroyed || generation !== selectionGeneration) return;

    const dimensionValidation = validateProfileBannerDimensions(decoded);
    if (dimensionValidation) {
      validationMessage = profileBannerMessage(dimensionValidation);
      return;
    }

    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
    dimensions = decoded;
  }

'''
write('apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte', editor[:start] + replacement + editor[end:])

translations = {
    'en': {'dimensions_too_small': 'Choose an image at least 600 × 200 px.', 'dimensions_too_large': 'Choose an image no larger than 8192 px per side and 24 megapixels.'},
    'fr': {'dimensions_too_small': 'Choisissez une image d’au moins 600 × 200 px.', 'dimensions_too_large': 'Choisissez une image ne dépassant pas 8 192 px par côté et 24 mégapixels.'},
    'de': {'dimensions_too_small': 'Wähle ein Bild mit mindestens 600 × 200 px.', 'dimensions_too_large': 'Wähle ein Bild mit höchstens 8192 px pro Seite und 24 Megapixeln.'},
    'es': {'dimensions_too_small': 'Elige una imagen de al menos 600 × 200 px.', 'dimensions_too_large': 'Elige una imagen de no más de 8192 px por lado y 24 megapíxeles.'},
    'pt': {'dimensions_too_small': 'Escolha uma imagem de pelo menos 600 × 200 px.', 'dimensions_too_large': 'Escolha uma imagem com no máximo 8192 px por lado e 24 megapixels.'},
}
for locale, additions in translations.items():
    path = f'apps/frontend/messages/{locale}/profile-banner.json'
    original = json.loads(read(path))
    updated = {}
    for key, value in original.items():
        updated[key] = value
        if key == 'low_resolution':
            updated.update(additions)
    if not additions.keys() <= updated.keys():
        updated.update(additions)
    write(path, json.dumps(updated, ensure_ascii=False, indent=2) + '\n')

replace_once('apps/frontend/src/lib/profileBanner.spec.ts', '  PROFILE_BANNER_MAX_UPLOAD_BYTES,\n', '  PROFILE_BANNER_MAX_SOURCE_DIMENSION,\n  PROFILE_BANNER_MAX_SOURCE_PIXELS,\n  PROFILE_BANNER_MAX_UPLOAD_BYTES,\n')
replace_once('apps/frontend/src/lib/profileBanner.spec.ts', '  supportsProfileBanners,\n  validateProfileBannerFile\n', '  supportsProfileBanners,\n  validateProfileBannerDimensions,\n  validateProfileBannerFile\n')
insert_before_last('apps/frontend/src/lib/profileBanner.spec.ts', '\n});', '''
  it('rejects source dimensions outside the canonical server envelope', () => {
    expect(validateProfileBannerDimensions({ width: 599, height: 200 })).toBe(
      'dimensions_too_small'
    );
    expect(validateProfileBannerDimensions({ width: 600, height: 199 })).toBe(
      'dimensions_too_small'
    );
    expect(
      validateProfileBannerDimensions({
        width: PROFILE_BANNER_MAX_SOURCE_DIMENSION + 1,
        height: 200
      })
    ).toBe('dimensions_too_large');
    expect(
      validateProfileBannerDimensions({
        width: 6000,
        height: Math.floor(PROFILE_BANNER_MAX_SOURCE_PIXELS / 6000) + 1
      })
    ).toBe('dimensions_too_large');
    expect(validateProfileBannerDimensions({ width: 1536, height: 512 })).toBeNull();
  });
''')

replace_once('apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte.spec.ts', "  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:profile-banner');\n", "  vi.spyOn(URL, 'createObjectURL').mockImplementation(\n    (value) => `blob:${value instanceof File ? value.name : 'profile-banner'}`\n  );\n")
insert_before_last('apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte.spec.ts', '\n});', '''
  it('clears a previous valid selection when the replacement is invalid', async () => {
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    const valid = new File(['valid'], 'valid.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [valid], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith(valid));

    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    await vi.waitFor(() => expect(save.disabled).toBe(false));

    const invalid = new File(['gif'], 'invalid.gif', { type: 'image/gif' });
    Object.defineProperty(input, 'files', { value: [invalid], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(save.disabled).toBe(true));
    expect(container.textContent).toContain('JPEG');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:valid.png');
  });

  it('ignores a late decode result from a superseded selection', async () => {
    let resolveFirst!: (value: { width: number; height: number }) => void;
    mocks.inspect.mockImplementation((file: File) => {
      if (file.name === 'first.png') {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ width: 1536, height: 512 });
    });

    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    const first = new File(['first'], 'first.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [first], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const second = new File(['second'], 'second.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [second], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(second));

    resolveFirst({ width: 1536, height: 512 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    save.click();
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(config, second));
    expect(mocks.upload).not.toHaveBeenCalledWith(config, first);
  });

  it('rejects decoded dimensions below the server minimum', async () => {
    mocks.inspect.mockResolvedValue({ width: 599, height: 200 });
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');
    const file = new File(['small'], 'small.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(container.textContent).toContain('600'));
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    expect(save.disabled).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalledWith(file);
  });
''')

replace_once('cli/internal/assets/profile_banner_test.go', '\t"bytes"\n', '\t"bytes"\n\t"encoding/binary"\n')
insert_before_last('cli/internal/assets/profile_banner_test.go', '\nfunc TestProcessProfileBannerAssetRejectsSmallAndOversizedInputs', '''
func encodedAnimatedProfileBannerWebP() []byte {
	data := make([]byte, 30)
	copy(data[:4], "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:12], "WEBP")
	copy(data[12:16], "VP8X")
	binary.LittleEndian.PutUint32(data[16:20], 10)
	data[20] = 0x02
	return data
}

func TestProcessProfileBannerAssetRejectsAnimatedWebP(t *testing.T) {
	_, err := ProcessProfileBannerAsset(bytes.NewReader(encodedAnimatedProfileBannerWebP()))
	if err == nil || !strings.Contains(err.Error(), "animated") {
		t.Fatalf("expected animated WebP rejection, got %v", err)
	}
}

''')

write('cli/internal/core/user_profile_banner_test.go', '''package core

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/testutil"
	"hmans.de/chatto/internal/testutil/fakes3"
)

func TestProfileBannerAssetIDIsDeterministicAndStorageSafe(t *testing.T) {
	first := ProfileBannerAssetID("user/with spaces?and=query")
	second := ProfileBannerAssetID("user/with spaces?and=query")
	other := ProfileBannerAssetID("another-user")
	if first != second { t.Fatalf("asset ID is not deterministic: %q != %q", first, second) }
	if first == other { t.Fatal("distinct users must not share a banner asset ID") }
	if !IsProfileBannerAssetID(first) || !strings.HasPrefix(first, profileBannerAssetPrefix) { t.Fatalf("missing versioned prefix: %q", first) }
	if strings.ContainsAny(first, "/ ?#") { t.Fatalf("asset ID contains path-unsafe characters: %q", first) }
	if IsProfileBannerAssetID("ordinary-server-asset") { t.Fatal("ordinary asset was classified as a profile banner") }
}

func profileBannerPNG(t *testing.T, width, height int, seed uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ { for x := 0; x < width; x++ { img.Set(x, y, color.RGBA{R: seed + uint8(x%31), G: uint8(y % 251), B: 120, A: 255}) } }
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil { t.Fatal(err) }
	return buffer.Bytes()
}

func setupProfileBannerS3Core(t *testing.T) *ChattoCore {
	t.Helper()
	endpoint := fakes3.NewServer(t).EndpointHost()
	useSSL := false
	pathStyle := true
	_, nc := testutil.StartSharedNATS(t)
	ctx := testContext(t)
	chattoCore, err := NewChattoCore(ctx, nc, config.CoreConfig{SecretKey: "profile-banner-s3-test-secret", Assets: config.AssetsConfig{SigningSecret: "profile-banner-s3-signing-secret", StorageBackend: config.StorageBackendS3, S3: config.S3Config{Endpoint: endpoint, Bucket: "profile-banner-test", AccessKeyID: "test-key", SecretAccessKey: "test-secret", UseSSL: &useSSL, PathStyle: &pathStyle}}})
	if err != nil { t.Fatalf("NewChattoCore with S3: %v", err) }
	if chattoCore.s3Client == nil { t.Fatal("S3 client was not configured") }
	if err := chattoCore.s3Client.EnsureBucket(ctx); err != nil { t.Fatalf("EnsureBucket: %v", err) }
	startCoreServices(t, chattoCore)
	return chattoCore
}

func readProfileBannerBytes(t *testing.T, chattoCore *ChattoCore, userID string) []byte {
	t.Helper()
	reader, _, err := chattoCore.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
	if err != nil { t.Fatalf("read profile banner: %v", err) }
	if closer, ok := reader.(io.Closer); ok { defer closer.Close() }
	data, err := io.ReadAll(reader)
	if err != nil { t.Fatalf("read profile banner bytes: %v", err) }
	return data
}

func waitForProfileBannerMissing(t *testing.T, chattoCore *ChattoCore, userID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		reader, _, err := chattoCore.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
		if err != nil { return }
		if closer, ok := reader.(io.Closer); ok { closer.Close() }
		if time.Now().After(deadline) { t.Fatal("profile banner remained in storage after deletion") }
		time.Sleep(25 * time.Millisecond)
	}
}

func TestUserProfileBannerLifecycleAcrossStorageBackends(t *testing.T) {
	for name, setup := range map[string]func(*testing.T) *ChattoCore{
		"nats": func(t *testing.T) *ChattoCore { chattoCore, _ := setupTestCore(t); return chattoCore },
		"s3": setupProfileBannerS3Core,
	} {
		t.Run(name, func(t *testing.T) {
			chattoCore := setup(t)
			ctx := testContext(t)
			user, err := chattoCore.CreateUser(ctx, SystemActorID, "banner-"+name, "Banner "+name, "password123")
			if err != nil { t.Fatalf("CreateUser: %v", err) }
			first, err := chattoCore.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 20)))
			if err != nil { t.Fatalf("first upload: %v", err) }
			firstBytes := readProfileBannerBytes(t, chattoCore, user.Id)
			second, err := chattoCore.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 1200, 400, 170)))
			if err != nil { t.Fatalf("replacement upload: %v", err) }
			if first.Id != second.Id || first.Id != ProfileBannerAssetID(user.Id) { t.Fatalf("replacement changed canonical asset ID: %q -> %q", first.Id, second.Id) }
			secondBytes := readProfileBannerBytes(t, chattoCore, user.Id)
			if bytes.Equal(firstBytes, secondBytes) { t.Fatal("replacement did not update stored bytes") }
			if _, err := chattoCore.ReplaceUserProfileBannerFromUpload(ctx, user.Id, strings.NewReader("not an image")); !errors.Is(err, ErrInvalidArgument) { t.Fatalf("invalid replacement error = %v, want ErrInvalidArgument", err) }
			if current := readProfileBannerBytes(t, chattoCore, user.Id); !bytes.Equal(current, secondBytes) { t.Fatal("invalid replacement changed the stored banner") }
			if err := chattoCore.DeleteUserProfileBanner(ctx, user.Id); err != nil { t.Fatalf("DeleteUserProfileBanner: %v", err) }
			if err := chattoCore.DeleteUserProfileBanner(ctx, user.Id); err != nil { t.Fatalf("idempotent DeleteUserProfileBanner: %v", err) }
			waitForProfileBannerMissing(t, chattoCore, user.Id)
			if _, err := chattoCore.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 90))); err != nil { t.Fatalf("upload before account deletion: %v", err) }
			if err := chattoCore.DeleteUser(ctx, SystemActorID, user.Id); err != nil { t.Fatalf("DeleteUser: %v", err) }
			waitForProfileBannerMissing(t, chattoCore, user.Id)
		})
	}
}
''')

write('cli/internal/http_server/profile_banner_security_test.go', '''package http_server

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/assets"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/testutil"
)

func profileBannerHTTPPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ { for x := 0; x < width; x++ { img.Set(x, y, color.RGBA{R: uint8(x % 251), G: uint8(y % 251), B: 140, A: 255}) } }
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil { t.Fatal(err) }
	return buffer.Bytes()
}

func setupProfileBannerHTTPTestServer(t *testing.T) (*httptest.Server, *http.Client, *core.ChattoCore, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	cookieSecret := "profile-banner-cookie-secret-32b"
	store := cookie.NewStore([]byte(cookieSecret))
	store.Options(sessions.Options{MaxAge: 86400, HttpOnly: true, Secure: false, Path: "/"})
	router.Use(sessions.Sessions("chatto_session", store))
	_, nc := testutil.StartSharedNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	chattoCore, err := core.NewChattoCore(ctx, nc, config.CoreConfig{SecretKey: "profile-banner-http-core-secret", Assets: config.AssetsConfig{SigningSecret: "profile-banner-http-signing-secret"}})
	if err != nil { t.Fatalf("NewChattoCore: %v", err) }
	startCoreServices(t, chattoCore)
	user, err := chattoCore.CreateUser(ctx, core.SystemActorID, "banner-http", "Banner HTTP", "password123")
	if err != nil { t.Fatalf("CreateUser: %v", err) }
	serverState := &HTTPServer{config: config.ChattoConfig{Webserver: config.WebserverConfig{URL: "http://localhost:4000", CookieSigningSecret: cookieSecret}, Core: config.CoreConfig{Assets: config.AssetsConfig{SigningSecret: "profile-banner-http-signing-secret"}}}, router: router, core: chattoCore}
	router.Use(serverState.csrfMiddleware())
	router.GET("/login-test", func(c *gin.Context) {
		if err := serverState.createCookieSession(c, user.Id, "profile_banner_test"); err != nil { c.String(http.StatusInternalServerError, err.Error()); return }
		if err := serverState.ensureCSRFToken(c); err != nil { c.String(http.StatusInternalServerError, err.Error()); return }
		c.String(http.StatusOK, "logged in")
	})
	serverState.setupAssetRoutes()
	testServer := httptest.NewServer(router)
	t.Cleanup(func() { serverState.closeTransformCoordinator(); testServer.Close() })
	jar, err := cookiejar.New(nil)
	if err != nil { t.Fatalf("cookie jar: %v", err) }
	return testServer, &http.Client{Jar: jar}, chattoCore, user.Id
}

func profileBannerRequest(t *testing.T, client *http.Client, method, url string, body io.Reader, token string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, body)
	if err != nil { t.Fatal(err) }
	if body != nil { request.Header.Set("Content-Type", "image/png") }
	if token != "" { request.Header.Set(csrfHeaderName, token) }
	response, err := client.Do(request)
	if err != nil { t.Fatal(err) }
	return response
}

func TestProfileBannerHTTPAuthorizationCSRFAndDelivery(t *testing.T) {
	server, client, chattoCore, userID := setupProfileBannerHTTPTestServer(t)
	valid := profileBannerHTTPPNG(t, 900, 300)
	unauthenticated := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(valid), "")
	defer unauthenticated.Body.Close()
	if unauthenticated.StatusCode != http.StatusUnauthorized { t.Fatalf("unauthenticated upload status = %d, want 401", unauthenticated.StatusCode) }
	token := csrfCookieValue(t, client, server.URL)
	withoutCSRF := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(valid), "")
	defer withoutCSRF.Body.Close()
	if withoutCSRF.StatusCode != http.StatusForbidden { t.Fatalf("cookie upload without CSRF status = %d, want 403", withoutCSRF.StatusCode) }
	upload := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(valid), token)
	defer upload.Body.Close()
	if upload.StatusCode != http.StatusNoContent { body, _ := io.ReadAll(upload.Body); t.Fatalf("upload status = %d, want 204; body=%s", upload.StatusCode, body) }
	head := profileBannerRequest(t, client, http.MethodHead, server.URL+"/api/profile/banner/"+userID, nil, "")
	defer head.Body.Close()
	if head.StatusCode != http.StatusOK { t.Fatalf("HEAD status = %d, want 200", head.StatusCode) }
	body, err := io.ReadAll(head.Body)
	if err != nil || len(body) != 0 { t.Fatalf("HEAD body length = %d, err=%v", len(body), err) }
	if head.Header.Get("ETag") == "" || head.Header.Get("X-Content-Type-Options") != "nosniff" { t.Fatalf("missing protected delivery headers: %#v", head.Header) }
	if !strings.Contains(head.Header.Get("Cache-Control"), "private") { t.Fatalf("unexpected cache control: %q", head.Header.Get("Cache-Control")) }
	publicRoute := profileBannerRequest(t, client, http.MethodGet, server.URL+"/assets/server/"+core.ProfileBannerAssetID(userID), nil, "")
	defer publicRoute.Body.Close()
	if publicRoute.StatusCode != http.StatusNotFound { t.Fatalf("generic public asset status = %d, want 404", publicRoute.StatusCode) }
	deleteWithoutCSRF := profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, "")
	defer deleteWithoutCSRF.Body.Close()
	if deleteWithoutCSRF.StatusCode != http.StatusForbidden { t.Fatalf("delete without CSRF status = %d, want 403", deleteWithoutCSRF.StatusCode) }
	deleted := profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, token)
	defer deleted.Body.Close()
	if deleted.StatusCode != http.StatusNoContent { t.Fatalf("delete status = %d, want 204", deleted.StatusCode) }
	if reader, _, err := chattoCore.GetServerAssetFromAnyBackend(context.Background(), core.ProfileBannerAssetID(userID)); err == nil { if closer, ok := reader.(io.Closer); ok { closer.Close() }; t.Fatal("deleted banner is still present") }
}

func TestProfileBannerHTTPRejectsInvalidAndOversizedBodies(t *testing.T) {
	server, client, _, _ := setupProfileBannerHTTPTestServer(t)
	token := csrfCookieValue(t, client, server.URL)
	for name, payload := range map[string][]byte{"forged mime": []byte("<html><script>alert(1)</script></html>"), "malformed image": []byte("not-an-image")} {
		t.Run(name, func(t *testing.T) {
			response := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(payload), token)
			defer response.Body.Close()
			if response.StatusCode != http.StatusBadRequest { t.Fatalf("status = %d, want 400", response.StatusCode) }
		})
	}
	oversized := bytes.NewReader(make([]byte, assets.MaxProfileBannerUploadSize+1))
	response := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, oversized, token)
	defer response.Body.Close()
	if response.StatusCode != http.StatusRequestEntityTooLarge { t.Fatalf("oversized status = %d, want 413", response.StatusCode) }
}

func TestProfileBannerCORSAllowsAuthenticatedRESTMethods(t *testing.T) {
	server := setupCORSServer(t, config.WebserverConfig{URL: "https://chat.example.com", AllowedOrigins: []string{"https://app.example.com"}})
	request := httptest.NewRequest(http.MethodOptions, profileBannerMutationPath, nil)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Method", http.MethodPut)
	request.Header.Set("Access-Control-Request-Headers", "authorization, content-type, x-csrf-token")
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent { t.Fatalf("preflight status = %d, want 204", response.Code) }
	methods := response.Header().Get("Access-Control-Allow-Methods")
	for _, method := range []string{"GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"} { if !strings.Contains(methods, method) { t.Fatalf("allowed methods %q missing %s", methods, method) } }
	headers := response.Header().Get("Access-Control-Allow-Headers")
	for _, header := range []string{"Authorization", "Content-Type", "X-CSRF-Token"} { if !strings.Contains(headers, header) { t.Fatalf("allowed headers %q missing %s", headers, header) } }
}
''')

users = read('cli/internal/core/users.go')
if 'DeleteUserProfileBanner' not in users:
    raise SystemExit('users.go does not invoke DeleteUserProfileBanner during account deletion')

print('PR #295 final security and maturity patches materialized')
