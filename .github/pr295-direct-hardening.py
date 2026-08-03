from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Frontend validation, cancellation, accessibility, and tests.
# ---------------------------------------------------------------------------
profile_banner_path = "apps/frontend/src/lib/profileBanner.ts"
replace_once(
    profile_banner_path,
    "export const PROFILE_BANNER_MIN_WIDTH = 600;\nexport const PROFILE_BANNER_MIN_HEIGHT = 200;\n",
    "export const PROFILE_BANNER_MIN_WIDTH = 600;\n"
    "export const PROFILE_BANNER_MIN_HEIGHT = 200;\n"
    "export const PROFILE_BANNER_MAX_DIMENSION = 8192;\n"
    "export const PROFILE_BANNER_MAX_PIXELS = 24_000_000;\n",
)
replace_once(
    profile_banner_path,
    "export type ProfileBannerValidationCode = 'invalid_type' | 'too_large';",
    "export type ProfileBannerValidationCode =\n"
    "  | 'invalid_type'\n"
    "  | 'too_large'\n"
    "  | 'too_small'\n"
    "  | 'dimensions_too_large';",
)
replace_once(
    profile_banner_path,
    "export function isProfileBannerBelowRecommendation(dimensions: ProfileBannerDimensions): boolean {\n"
    "  return (\n"
    "    dimensions.width < PROFILE_BANNER_RECOMMENDED_WIDTH ||\n"
    "    dimensions.height < PROFILE_BANNER_RECOMMENDED_HEIGHT\n"
    "  );\n"
    "}\n",
    "export function validateProfileBannerDimensions(\n"
    "  dimensions: ProfileBannerDimensions\n"
    "): Extract<ProfileBannerValidationCode, 'too_small' | 'dimensions_too_large'> | null {\n"
    "  if (\n"
    "    !Number.isSafeInteger(dimensions.width) ||\n"
    "    !Number.isSafeInteger(dimensions.height) ||\n"
    "    dimensions.width < PROFILE_BANNER_MIN_WIDTH ||\n"
    "    dimensions.height < PROFILE_BANNER_MIN_HEIGHT\n"
    "  ) {\n"
    "    return 'too_small';\n"
    "  }\n"
    "  if (\n"
    "    dimensions.width > PROFILE_BANNER_MAX_DIMENSION ||\n"
    "    dimensions.height > PROFILE_BANNER_MAX_DIMENSION ||\n"
    "    dimensions.width * dimensions.height > PROFILE_BANNER_MAX_PIXELS\n"
    "  ) {\n"
    "    return 'dimensions_too_large';\n"
    "  }\n"
    "  return null;\n"
    "}\n\n"
    "export function isProfileBannerBelowRecommendation(dimensions: ProfileBannerDimensions): boolean {\n"
    "  return (\n"
    "    dimensions.width < PROFILE_BANNER_RECOMMENDED_WIDTH ||\n"
    "    dimensions.height < PROFILE_BANNER_RECOMMENDED_HEIGHT\n"
    "  );\n"
    "}\n",
)

profile_banner_spec = "apps/frontend/src/lib/profileBanner.spec.ts"
replace_once(
    profile_banner_spec,
    "  PROFILE_BANNER_MAX_UPLOAD_BYTES,\n"
    "  PROFILE_BANNER_RECOMMENDED_HEIGHT,\n"
    "  PROFILE_BANNER_RECOMMENDED_WIDTH,\n",
    "  PROFILE_BANNER_MAX_DIMENSION,\n"
    "  PROFILE_BANNER_MAX_PIXELS,\n"
    "  PROFILE_BANNER_MAX_UPLOAD_BYTES,\n"
    "  PROFILE_BANNER_MIN_HEIGHT,\n"
    "  PROFILE_BANNER_MIN_WIDTH,\n"
    "  PROFILE_BANNER_RECOMMENDED_HEIGHT,\n"
    "  PROFILE_BANNER_RECOMMENDED_WIDTH,\n",
)
replace_once(
    profile_banner_spec,
    "  supportsProfileBanners,\n  validateProfileBannerFile\n",
    "  supportsProfileBanners,\n"
    "  validateProfileBannerDimensions,\n"
    "  validateProfileBannerFile\n",
)
replace_once(
    profile_banner_spec,
    "  it('marks dimensions below the documented recommendation', () => {\n",
    "  it('rejects dimensions outside the server-side decoding envelope', () => {\n"
    "    expect(\n"
    "      validateProfileBannerDimensions({\n"
    "        width: PROFILE_BANNER_MIN_WIDTH - 1,\n"
    "        height: PROFILE_BANNER_MIN_HEIGHT\n"
    "      })\n"
    "    ).toBe('too_small');\n"
    "    expect(\n"
    "      validateProfileBannerDimensions({\n"
    "        width: PROFILE_BANNER_MAX_DIMENSION + 1,\n"
    "        height: PROFILE_BANNER_MIN_HEIGHT\n"
    "      })\n"
    "    ).toBe('dimensions_too_large');\n"
    "    expect(\n"
    "      validateProfileBannerDimensions({\n"
    "        width: PROFILE_BANNER_MAX_DIMENSION,\n"
    "        height: Math.floor(PROFILE_BANNER_MAX_PIXELS / PROFILE_BANNER_MAX_DIMENSION) + 1\n"
    "      })\n"
    "    ).toBe('dimensions_too_large');\n"
    "    expect(\n"
    "      validateProfileBannerDimensions({\n"
    "        width: PROFILE_BANNER_RECOMMENDED_WIDTH,\n"
    "        height: PROFILE_BANNER_RECOMMENDED_HEIGHT\n"
    "      })\n"
    "    ).toBeNull();\n"
    "  });\n\n"
    "  it('marks dimensions below the documented recommendation', () => {\n",
)

editor_path = "apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte"
replace_once(
    editor_path,
    "    uploadProfileBanner,\n    validateProfileBannerFile\n",
    "    uploadProfileBanner,\n"
    "    validateProfileBannerDimensions,\n"
    "    validateProfileBannerFile\n",
)
replace_once(
    editor_path,
    "  let saving = $state(false);\n  let removing = $state(false);\n",
    "  let saving = $state(false);\n"
    "  let removing = $state(false);\n"
    "  let selectionGeneration = 0;\n"
    "  let destroyed = false;\n",
)
old_editor_logic = """  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedFile = null;
    dimensions = null;
    validationMessage = '';
    if (fileInput) fileInput.value = '';
  }

  onDestroy(clearPreview);

  async function selectFile(file: File | undefined) {
    if (!file || saving || removing) return;
    const validation = validateProfileBannerFile(file);
    if (validation) {
      validationMessage = profileBannerMessage(validation);
      return;
    }

    let decoded: { width: number; height: number };
    try {
      decoded = await inspectProfileBannerDimensions(file);
    } catch {
      validationMessage = profileBannerMessage('decode_failed');
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
    dimensions = decoded;
    validationMessage = '';
  }
"""
new_editor_logic = """  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedFile = null;
    dimensions = null;
    validationMessage = '';
    if (fileInput) fileInput.value = '';
  }

  function invalidateSelection() {
    selectionGeneration += 1;
    resetPreview();
  }

  onDestroy(() => {
    destroyed = true;
    invalidateSelection();
  });

  async function selectFile(file: File | undefined) {
    if (!file || saving || removing) return;

    const generation = ++selectionGeneration;
    resetPreview();

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
    validationMessage = '';
  }
"""
replace_once(editor_path, old_editor_logic, new_editor_logic)
content = read(editor_path)
if content.count("clearPreview();") != 2:
    raise SystemExit(f"{editor_path}: unexpected clearPreview call count")
write(editor_path, content.replace("clearPreview();", "invalidateSelection();"))

editor_spec_path = "apps/frontend/src/lib/components/users/ProfileBannerEditor.svelte.spec.ts"
editor_spec = read(editor_spec_path)
insert = r'''

  it('clears a previous valid selection when the replacement is invalid', async () => {
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    const valid = new File(['image'], 'valid.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [valid] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith(valid));

    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    await vi.waitFor(() => expect(save.disabled).toBe(false));

    const invalid = new File(['svg'], 'invalid.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(save.disabled).toBe(true));
    expect(container.textContent).toContain('JPEG, PNG or WebP');
  });

  it('keeps only the latest asynchronous selection result', async () => {
    let resolveFirst!: (dimensions: { width: number; height: number }) => void;
    const firstResult = new Promise<{ width: number; height: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    mocks.inspect.mockImplementation((file: File) =>
      file === first ? firstResult : Promise.resolve({ width: 1800, height: 600 })
    );

    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    Object.defineProperty(input, 'files', { configurable: true, value: [first] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Object.defineProperty(input, 'files', { configurable: true, value: [second] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(second));
    resolveFirst({ width: 1536, height: 512 });
    await Promise.resolve();

    expect(URL.createObjectURL).not.toHaveBeenCalledWith(first);
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    save.click();
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(config, second));
  });

  it('rejects decoded dimensions below the server minimum', async () => {
    mocks.inspect.mockResolvedValue({ width: 599, height: 200 });
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');
    const file = new File(['image'], 'small.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(container.textContent).toContain('600'));
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    expect(save.disabled).toBe(true);
  });
'''
if not editor_spec.rstrip().endswith("});"):
    raise SystemExit("unexpected editor spec ending")
write(editor_spec_path, editor_spec.rstrip()[:-3] + insert + "\n});\n")

translations = {
    "en": {
        "too_small": "Choose an image at least 600 × 200 px.",
        "dimensions_too_large": "This image is too large to process safely. Use at most 8192 px per side and 24 megapixels.",
    },
    "fr": {
        "too_small": "Choisissez une image d’au moins 600 × 200 px.",
        "dimensions_too_large": "Cette image est trop grande pour être traitée en sécurité. Utilisez au maximum 8192 px par côté et 24 mégapixels.",
    },
    "de": {
        "too_small": "Wähle ein Bild mit mindestens 600 × 200 px.",
        "dimensions_too_large": "Dieses Bild ist für eine sichere Verarbeitung zu groß. Verwende höchstens 8192 px pro Seite und 24 Megapixel.",
    },
    "es": {
        "too_small": "Elige una imagen de al menos 600 × 200 px.",
        "dimensions_too_large": "Esta imagen es demasiado grande para procesarla de forma segura. Usa como máximo 8192 px por lado y 24 megapíxeles.",
    },
    "pt": {
        "too_small": "Escolha uma imagem com pelo menos 600 × 200 px.",
        "dimensions_too_large": "Esta imagem é grande demais para ser processada com segurança. Use no máximo 8192 px por lado e 24 megapixels.",
    },
}
for locale, additions in translations.items():
    path = ROOT / f"apps/frontend/messages/{locale}/profile-banner.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.update(additions)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

story_path = "apps/frontend/src/lib/components/users/ProfileBannerEditor.stories.svelte"
write(
    story_path,
    '''<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ProfileBannerEditor from './ProfileBannerEditor.svelte';

  const { Story } = defineMeta({
    title: 'Components/Users/ProfileBannerEditor',
    component: ProfileBannerEditor,
    tags: ['autodocs']
  });

  const config = {
    serverId: 'story-server',
    baseUrl: '/api/connect',
    bearerToken: 'story-token'
  };
  const noop = () => {};
</script>

<Story name="Empty banner" asChild>
  <div class="mx-auto w-full max-w-3xl bg-surface-100 p-4 sm:p-8">
    <ProfileBannerEditor
      {config}
      currentBannerUrl={null}
      onClose={noop}
      onChanged={noop}
    />
  </div>
</Story>
''',
)

# ---------------------------------------------------------------------------
# Static image validation and storage lifecycle.
# ---------------------------------------------------------------------------
processor_path = "cli/internal/assets/profile_banner.go"
replace_once(processor_path, '"bytes"\n\t"fmt"', '"bytes"\n\t"encoding/binary"\n\t"fmt"')
replace_once(
    processor_path,
    "type ProcessedProfileBanner struct {\n",
    "func isAnimatedProfileBannerWebP(data []byte) bool {\n"
    "\tif len(data) < 20 || string(data[:4]) != \"RIFF\" || string(data[8:12]) != \"WEBP\" {\n"
    "\t\treturn false\n"
    "\t}\n"
    "\tfor offset := 12; offset+8 <= len(data); {\n"
    "\t\tchunkType := string(data[offset : offset+4])\n"
    "\t\tchunkSize := int64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))\n"
    "\t\tif chunkType == \"ANIM\" || chunkType == \"ANMF\" {\n"
    "\t\t\treturn true\n"
    "\t\t}\n"
    "\t\tif chunkType == \"VP8X\" && chunkSize >= 10 && offset+9 <= len(data) && data[offset+8]&0x02 != 0 {\n"
    "\t\t\treturn true\n"
    "\t\t}\n"
    "\t\tadvance := int64(8) + chunkSize + chunkSize%2\n"
    "\t\tif advance <= 0 || advance > int64(len(data)-offset) {\n"
    "\t\t\treturn false\n"
    "\t\t}\n"
    "\t\toffset += int(advance)\n"
    "\t}\n"
    "\treturn false\n"
    "}\n\n"
    "type ProcessedProfileBanner struct {\n",
)
replace_once(
    processor_path,
    "\tcase \"image/jpeg\", \"image/png\", \"image/webp\":\n\tdefault:\n",
    "\tcase \"image/jpeg\", \"image/png\", \"image/webp\":\n"
    "\t\tif contentType == \"image/webp\" && isAnimatedProfileBannerWebP(data) {\n"
    "\t\t\treturn nil, fmt.Errorf(\"animated WebP profile banners are not supported\")\n"
    "\t\t}\n"
    "\tdefault:\n",
)

processor_spec_path = "cli/internal/assets/profile_banner_test.go"
replace_once(processor_spec_path, '"bytes"\n\t"image"', '"bytes"\n\t"encoding/binary"\n\t"image"')
replace_once(
    processor_spec_path,
    "func TestProcessProfileBannerAssetRejectsUnsupportedAndAnimatedInputs(t *testing.T) {\n",
    "func animatedProfileBannerWebPFixture() []byte {\n"
    "\tdata := make([]byte, 30)\n"
    "\tcopy(data[:4], \"RIFF\")\n"
    "\tbinary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))\n"
    "\tcopy(data[8:12], \"WEBP\")\n"
    "\tcopy(data[12:16], \"VP8X\")\n"
    "\tbinary.LittleEndian.PutUint32(data[16:20], 10)\n"
    "\tdata[20] = 0x02\n"
    "\treturn data\n"
    "}\n\n"
    "func TestProcessProfileBannerAssetRejectsUnsupportedAndAnimatedInputs(t *testing.T) {\n",
)
replace_once(
    processor_spec_path,
    '"gif":  gifData.Bytes(),\n\t\t"svg":',
    '"animated-webp": animatedProfileBannerWebPFixture(),\n\t\t"gif":           gifData.Bytes(),\n\t\t"svg":',
)

core_banner_path = "cli/internal/core/user_profile_banner.go"
replace_once(core_banner_path, '"io"\n', '"io"\n\t"strings"\n')
replace_once(
    core_banner_path,
    "func ProfileBannerAssetID(userID string) string {\n",
    "func IsProfileBannerAssetID(assetID string) bool {\n"
    "\treturn strings.HasPrefix(assetID, profileBannerAssetPrefix)\n"
    "}\n\n"
    "func ProfileBannerAssetID(userID string) string {\n",
)

core_banner_spec_path = "cli/internal/core/user_profile_banner_test.go"
write(
    core_banner_spec_path,
    '''package core

import (
    "bytes"
    "context"
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

func profileBannerPNG(t *testing.T, width, height int, blue uint8) []byte {
    t.Helper()
    img := image.NewRGBA(image.Rect(0, 0, width, height))
    for y := 0; y < height; y++ {
        for x := 0; x < width; x++ {
            img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: blue, A: 255})
        }
    }
    var buf bytes.Buffer
    if err := png.Encode(&buf, img); err != nil {
        t.Fatal(err)
    }
    return buf.Bytes()
}

func profileBannerCore(t *testing.T, backend config.StorageBackend) *ChattoCore {
    t.Helper()
    _, nc := testutil.StartSharedNATS(t)
    cfg := config.CoreConfig{
        SecretKey: "profile-banner-test-secret",
        Assets: config.AssetsConfig{
            SigningSecret:  "profile-banner-signing-secret",
            StorageBackend: backend,
        },
    }
    if backend == config.StorageBackendS3 {
        useSSL := false
        pathStyle := true
        cfg.Assets.S3 = config.S3Config{
            Endpoint:        fakes3.NewServer(t).EndpointHost(),
            Bucket:          "profile-banner-tests",
            AccessKeyID:     "test-key",
            SecretAccessKey: "test-secret",
            UseSSL:          &useSSL,
            PathStyle:       &pathStyle,
        }
    }
    ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    t.Cleanup(cancel)
    instance, err := NewChattoCore(ctx, nc, cfg)
    if err != nil {
        t.Fatalf("NewChattoCore: %v", err)
    }
    startCoreServices(t, instance)
    return instance
}

func readProfileBannerBytes(t *testing.T, instance *ChattoCore, userID string) []byte {
    t.Helper()
    reader, _, err := instance.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
    if err != nil {
        t.Fatalf("read profile banner: %v", err)
    }
    if closer, ok := reader.(io.Closer); ok {
        defer closer.Close()
    }
    data, err := io.ReadAll(reader)
    if err != nil {
        t.Fatal(err)
    }
    return data
}

func waitForProfileBannerMissing(t *testing.T, instance *ChattoCore, userID string) {
    t.Helper()
    deadline := time.Now().Add(5 * time.Second)
    for {
        reader, _, err := instance.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
        if err != nil {
            return
        }
        if closer, ok := reader.(io.Closer); ok {
            closer.Close()
        }
        if time.Now().After(deadline) {
            t.Fatal("profile banner remained in storage")
        }
        time.Sleep(20 * time.Millisecond)
    }
}

func TestProfileBannerAssetIDIsDeterministicAndStorageSafe(t *testing.T) {
    first := ProfileBannerAssetID("user/with spaces?and=query")
    second := ProfileBannerAssetID("user/with spaces?and=query")
    other := ProfileBannerAssetID("another-user")
    if first != second || first == other || !IsProfileBannerAssetID(first) {
        t.Fatalf("unexpected deterministic IDs: %q %q %q", first, second, other)
    }
    if strings.ContainsAny(first, "/ ?#") {
        t.Fatalf("asset ID contains path-unsafe characters: %q", first)
    }
}

func TestUserProfileBannerLifecycleAcrossStorageBackends(t *testing.T) {
    for _, backend := range []config.StorageBackend{config.StorageBackendNATS, config.StorageBackendS3} {
        t.Run(string(backend), func(t *testing.T) {
            instance := profileBannerCore(t, backend)
            ctx := testContext(t)
            user, err := instance.CreateUser(ctx, "", "banner-user-"+string(backend), "Banner User", "password123")
            if err != nil {
                t.Fatal(err)
            }

            first, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 80)))
            if err != nil {
                t.Fatal(err)
            }
            firstBytes := readProfileBannerBytes(t, instance, user.Id)

            second, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 1200, 400, 180)))
            if err != nil {
                t.Fatal(err)
            }
            if first.Id != second.Id || first.Id != ProfileBannerAssetID(user.Id) {
                t.Fatalf("replacement changed canonical ID: %q -> %q", first.Id, second.Id)
            }
            secondBytes := readProfileBannerBytes(t, instance, user.Id)
            if bytes.Equal(firstBytes, secondBytes) {
                t.Fatal("replacement did not change stored bytes")
            }

            if _, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, strings.NewReader("not an image")); err == nil {
                t.Fatal("invalid replacement was accepted")
            }
            if got := readProfileBannerBytes(t, instance, user.Id); !bytes.Equal(got, secondBytes) {
                t.Fatal("invalid replacement changed the current banner")
            }

            if err := instance.DeleteUserProfileBanner(ctx, user.Id); err != nil {
                t.Fatal(err)
            }
            waitForProfileBannerMissing(t, instance, user.Id)

            if _, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 220))); err != nil {
                t.Fatal(err)
            }
            if err := instance.DeleteUser(ctx, SystemActorID, user.Id); err != nil {
                t.Fatal(err)
            }
            waitForProfileBannerMissing(t, instance, user.Id)
        })
    }
}
''',
)

# ---------------------------------------------------------------------------
# HTTP authority boundaries, CORS, private delivery, and negative tests.
# ---------------------------------------------------------------------------
cors_path = "cli/internal/http_server/cors.go"
content = read(cors_path)
old_methods = 'c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")'
if content.count(old_methods) != 1:
    raise SystemExit("unexpected CORS method declaration")
write(cors_path, content.replace(old_methods, 'c.Header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")'))

cors_spec_path = "cli/internal/http_server/cors_test.go"
content = read(cors_spec_path)
if '"GET, POST, OPTIONS"' not in content:
    raise SystemExit("CORS test baseline missing")
write(cors_spec_path, content.replace('"GET, POST, OPTIONS"', '"GET, HEAD, POST, PUT, DELETE, OPTIONS"'))

assets_route_path = "cli/internal/http_server/assets.go"
replace_once(
    assets_route_path,
    "\t// Check if this is a transform request: path ends with /t/{signedPath}\n",
    "\tcanonicalAssetID := path\n"
    "\tif transformIndex := strings.Index(canonicalAssetID, \"/t/\"); transformIndex >= 0 {\n"
    "\t\tcanonicalAssetID = canonicalAssetID[:transformIndex]\n"
    "\t}\n"
    "\tif core.IsProfileBannerAssetID(canonicalAssetID) {\n"
    "\t\twriteLocalizedError(c, http.StatusNotFound, \"asset.not_found\")\n"
    "\t\treturn\n"
    "\t}\n\n"
    "\t// Check if this is a transform request: path ends with /t/{signedPath}\n",
)

integration_path = "cli/internal/http_server/profile_banner_integration_test.go"
write(
    integration_path,
    '''package http_server

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

func profileBannerHTTPPNG(t *testing.T) []byte {
    t.Helper()
    img := image.NewRGBA(image.Rect(0, 0, 900, 300))
    for y := 0; y < 300; y++ {
        for x := 0; x < 900; x++ {
            img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 150, A: 255})
        }
    }
    var buf bytes.Buffer
    if err := png.Encode(&buf, img); err != nil {
        t.Fatal(err)
    }
    return buf.Bytes()
}

func setupProfileBannerHTTPServer(t *testing.T) (*httptest.Server, *http.Client, *core.ChattoCore, string) {
    t.Helper()
    gin.SetMode(gin.TestMode)
    router := gin.New()
    cookieSecret := "profile-banner-cookie-secret-32-bytes"
    store := cookie.NewStore([]byte(cookieSecret))
    store.Options(sessions.Options{MaxAge: 86400, HttpOnly: true, Secure: false, Path: "/"})
    router.Use(sessions.Sessions("chatto_session", store))

    _, nc := testutil.StartSharedNATS(t)
    ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    t.Cleanup(cancel)
    instance, err := core.NewChattoCore(ctx, nc, config.CoreConfig{})
    if err != nil {
        t.Fatal(err)
    }
    startCoreServices(t, instance)
    user, err := instance.CreateUser(ctx, "", "profile-banner-http", "Profile Banner HTTP", "password123")
    if err != nil {
        t.Fatal(err)
    }

    server := &HTTPServer{
        config: config.ChattoConfig{Webserver: config.WebserverConfig{URL: "http://localhost:4000", CookieSigningSecret: cookieSecret}},
        router: router,
        core: instance,
    }
    router.Use(server.corsMiddleware(server.buildAllowedOrigins()))
    router.Use(server.csrfMiddleware())
    router.GET("/login-test", func(c *gin.Context) {
        if err := server.createCookieSession(c, user.Id, "profile_banner_test"); err != nil {
            c.String(http.StatusInternalServerError, err.Error())
            return
        }
        if err := server.ensureCSRFToken(c); err != nil {
            c.String(http.StatusInternalServerError, err.Error())
            return
        }
        c.Status(http.StatusNoContent)
    })
    server.setupProfileBannerRoutes()
    router.GET("/assets/server/*path", server.serveServerAsset)

    httpServer := httptest.NewServer(router)
    t.Cleanup(httpServer.Close)
    jar, err := cookiejar.New(nil)
    if err != nil {
        t.Fatal(err)
    }
    return httpServer, &http.Client{Jar: jar}, instance, user.Id
}

func profileBannerRequest(t *testing.T, client *http.Client, method, url string, body io.Reader, token string) *http.Response {
    t.Helper()
    request, err := http.NewRequest(method, url, body)
    if err != nil {
        t.Fatal(err)
    }
    if body != nil {
        request.Header.Set("Content-Type", "image/png")
    }
    if token != "" {
        request.Header.Set(csrfHeaderName, token)
    }
    response, err := client.Do(request)
    if err != nil {
        t.Fatal(err)
    }
    return response
}

func TestProfileBannerHTTPAuthorizationCSRFAndDelivery(t *testing.T) {
    server, client, _, userID := setupProfileBannerHTTPServer(t)

    response, err := http.Get(server.URL + profileBannerCapabilityPath)
    if err != nil {
        t.Fatal(err)
    }
    response.Body.Close()
    if response.StatusCode != http.StatusUnauthorized {
        t.Fatalf("unauthenticated capability status = %d", response.StatusCode)
    }

    token := csrfCookieValue(t, client, server.URL)
    banner := profileBannerHTTPPNG(t)

    response = profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(banner), "")
    response.Body.Close()
    if response.StatusCode != http.StatusForbidden {
        t.Fatalf("cookie upload without CSRF status = %d", response.StatusCode)
    }

    response = profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, bytes.NewReader(banner), token)
    response.Body.Close()
    if response.StatusCode != http.StatusNoContent {
        t.Fatalf("valid upload status = %d", response.StatusCode)
    }

    response = profileBannerRequest(t, client, http.MethodGet, server.URL+"/api/profile/banner/"+userID, nil, "")
    body, _ := io.ReadAll(response.Body)
    response.Body.Close()
    if response.StatusCode != http.StatusOK || len(body) == 0 {
        t.Fatalf("read status=%d bytes=%d", response.StatusCode, len(body))
    }
    if response.Header.Get("ETag") == "" || response.Header.Get("X-Content-Type-Options") != "nosniff" || response.Header.Get("Cache-Control") != "private, no-cache" {
        t.Fatalf("unexpected protected headers: %#v", response.Header)
    }
    etag := response.Header.Get("ETag")

    head := profileBannerRequest(t, client, http.MethodHead, server.URL+"/api/profile/banner/"+userID, nil, "")
    headBody, _ := io.ReadAll(head.Body)
    head.Body.Close()
    if head.StatusCode != http.StatusOK || len(headBody) != 0 {
        t.Fatalf("HEAD status=%d bytes=%d", head.StatusCode, len(headBody))
    }

    conditional, err := http.NewRequest(http.MethodGet, server.URL+"/api/profile/banner/"+userID, nil)
    if err != nil {
        t.Fatal(err)
    }
    conditional.Header.Set("If-None-Match", etag)
    conditionalResponse, err := client.Do(conditional)
    if err != nil {
        t.Fatal(err)
    }
    conditionalResponse.Body.Close()
    if conditionalResponse.StatusCode != http.StatusNotModified {
        t.Fatalf("conditional status = %d", conditionalResponse.StatusCode)
    }

    publicResponse, err := http.Get(server.URL + "/assets/server/" + core.ProfileBannerAssetID(userID))
    if err != nil {
        t.Fatal(err)
    }
    publicResponse.Body.Close()
    if publicResponse.StatusCode != http.StatusNotFound {
        t.Fatalf("generic public profile-banner route status = %d", publicResponse.StatusCode)
    }

    response = profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, "")
    response.Body.Close()
    if response.StatusCode != http.StatusForbidden {
        t.Fatalf("cookie delete without CSRF status = %d", response.StatusCode)
    }
    response = profileBannerRequest(t, client, http.MethodDelete, server.URL+profileBannerMutationPath, nil, token)
    response.Body.Close()
    if response.StatusCode != http.StatusNoContent {
        t.Fatalf("valid delete status = %d", response.StatusCode)
    }
}

func TestProfileBannerHTTPRejectsForgedMalformedAndOversizedBodies(t *testing.T) {
    server, client, _, _ := setupProfileBannerHTTPServer(t)
    token := csrfCookieValue(t, client, server.URL)

    forged := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, strings.NewReader("<html>not an image</html>"), token)
    forged.Body.Close()
    if forged.StatusCode != http.StatusBadRequest {
        t.Fatalf("forged image status = %d", forged.StatusCode)
    }

    oversizedBody := bytes.NewReader(make([]byte, assets.MaxProfileBannerUploadSize+1))
    oversized := profileBannerRequest(t, client, http.MethodPut, server.URL+profileBannerMutationPath, oversizedBody, token)
    oversized.Body.Close()
    if oversized.StatusCode != http.StatusRequestEntityTooLarge {
        t.Fatalf("oversized image status = %d", oversized.StatusCode)
    }
}

func TestProfileBannerCORSPreflightAllowsMutationMethods(t *testing.T) {
    server := setupCORSServer(t, config.WebserverConfig{
        URL: "https://chat.example.com",
        AllowedOrigins: []string{"https://app.example.com"},
    })
    request := httptest.NewRequest(http.MethodOptions, profileBannerMutationPath, nil)
    request.Header.Set("Origin", "https://app.example.com")
    request.Header.Set("Access-Control-Request-Method", http.MethodPut)
    request.Header.Set("Access-Control-Request-Headers", "authorization, content-type, x-csrf-token")
    response := httptest.NewRecorder()
    server.router.ServeHTTP(response, request)
    if response.Code != http.StatusNoContent {
        t.Fatalf("preflight status = %d", response.Code)
    }
    methods := response.Header().Get("Access-Control-Allow-Methods")
    for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions} {
        if !strings.Contains(methods, method) {
            t.Fatalf("CORS methods %q missing %q", methods, method)
        }
    }
}
''',
)

# ---------------------------------------------------------------------------
# Durable product contract documentation.
# ---------------------------------------------------------------------------
fdr_path = "docs/fdr/FDR-022-user-profile.md"
replace_once(
    fdr_path,
    "- **Custom status** — users can set an emoji plus short text.",
    "- **Profile banner** — users can upload a static JPEG, PNG, or WebP banner up to 8 MiB for the wide 3:1 identity stage behind their avatar. The server validates magic bytes and decoded dimensions, rejects animation and active formats, requires at least 600 × 200 px, caps each side at 8,192 px and decoded area at 24 megapixels, then center-crops and re-encodes a canonical 1,536 × 512 JPEG or WebP. Replacement preserves the previous banner until the new image is valid, and explicit or account deletion removes the stored object from NATS ObjectStore or S3.\n"
    "- **Custom status** — users can set an emoji plus short text.",
)
replace_once(
    fdr_path,
    "## Permissions\n",
    "### 17. Profile banners are private authenticated canonical assets\n\n"
    "**Decision:** Profile banners use a versioned deterministic storage key but are served only by the authenticated profile-banner route. The generic public server-asset route refuses this reserved key family. Cookie mutations require the existing signed CSRF token; bearer clients use the normal Authorization contract. A valid upload is decoded and canonicalized before replacing the current object, while deletion is idempotent and participates in account cleanup for both NATS and S3 backends.\n\n"
    "**Why:** A stable key avoids adding a new durable pointer or migration while still allowing replacement and cross-device reads. Restricting delivery to the dedicated route prevents a predictable key from bypassing authentication. Server-side image validation bounds CPU, memory, storage, and active-content risk regardless of client checks.\n\n"
    "**Tradeoff:** Banner reads require authentication and revalidation rather than a public immutable URL. Old servers expose no banner capability, so new clients hide the editor and retain the neutral generated cover. Originals are discarded; changing composition later requires another upload.\n\n"
    "## Permissions\n",
)
replace_once(
    fdr_path,
    "- Self-edit (display name, avatar, biography, custom status, settings, own login subject to cooldown) — no explicit permission; just authentication.\n",
    "- Self-edit (display name, avatar, profile banner, biography, custom status, settings, own login subject to cooldown) — no explicit permission; just authentication.\n"
    "- Read a profile banner — authentication on the same server; the generic public asset route cannot serve reserved banner keys.\n",
)

print("PR #295 direct hardening patch materialized")
