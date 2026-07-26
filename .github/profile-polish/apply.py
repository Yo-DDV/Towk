from __future__ import annotations

import json
import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    Path(path).write_text(value, encoding="utf-8")


def replace_once(path: str, old: str, new: str, label: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"{label}: expected source block not found in {path}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, label: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: matched {count} blocks in {path}")
    write(path, updated)


menu = "apps/frontend/src/lib/components/menus/UserContextMenu.svelte"
replace_once(
    menu,
    "  const biographyHeadingId = `${componentId}-biography-heading`;\n  const detailsHeadingId = `${componentId}-details-heading`;",
    "  const biographyHeadingId = `${componentId}-biography-heading`;\n  const biographyContentId = `${componentId}-biography-content`;\n  const detailsHeadingId = `${componentId}-details-heading`;",
    "profile biography content id",
)
replace_once(
    menu,
    "  let loadError = $state('');",
    "  let loadError = $state('');\n  let biographyExpanded = $state(false);",
    "profile biography expansion state",
)
replace_once(
    menu,
    "  const profileRevision = $derived(getDetailedUserProfileRevision(serverId, user.id));",
    "  const biographyCharacterCount = $derived(\n    profile ? Array.from(profile.biographyMarkdown).length : 0\n  );\n  const biographyLineCount = $derived(\n    profile ? profile.biographyMarkdown.split('\\n').length : 0\n  );\n  const biographyCollapsible = $derived(\n    Boolean(profile && (biographyCharacterCount > 720 || biographyLineCount > 14))\n  );\n  const profileRevision = $derived(getDetailedUserProfileRevision(serverId, user.id));",
    "profile biography collapse derivation",
)
replace_once(
    menu,
    "    let cancelled = false;\n    loading = true;",
    "    let cancelled = false;\n    biographyExpanded = false;\n    loading = true;",
    "reset profile biography expansion",
)
replace_once(
    menu,
    '''      <div
        class="pointer-events-none absolute -top-24 -right-24 -z-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute -bottom-24 -left-16 -z-10 h-56 w-56 rounded-full bg-accent/10 blur-3xl"
        aria-hidden="true"
      ></div>

''',
    "",
    "remove decorative profile flares",
)

profile_content = '''    {#if profile}
      <div class="profile-content-stack grid min-w-0 gap-4">
        <section
          class="profile-card profile-facts-card rounded-2xl border border-text/10 bg-background/70 p-3 shadow-sm backdrop-blur-xl"
          aria-labelledby={detailsHeadingId}
        >
          <h4 id={detailsHeadingId} class="sr-only">{m['profile.details']()}</h4>
          <div class="profile-facts-grid">
            <div class="profile-detail-tile">
              <span class="profile-detail-icon iconify uil--calendar-alt" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="block text-xs font-semibold tracking-wide text-muted uppercase">
                  {m['profile.joined']()}
                </span>
                <span class="mt-1 block text-sm font-semibold text-text">
                  {formatDate(profile.joinedAt)}
                </span>
              </span>
            </div>
            <div class="profile-detail-tile">
              <span class="profile-detail-icon iconify uil--clock" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="block text-xs font-semibold tracking-wide text-muted uppercase">
                  {m['profile.last_activity']()}
                </span>
                <span class="mt-1 block text-sm font-semibold text-text">
                  {#if !profile.lastActivityVisible}
                    <span class="inline-flex items-center gap-1.5 text-muted">
                      <span class="iconify uil--eye-slash" aria-hidden="true"></span>
                      {m['profile.last_activity_hidden']()}
                    </span>
                  {:else if profile.lastActivity}
                    {formatDateTime(profile.lastActivity)}
                  {:else}
                    <span class="text-muted">{m['profile.last_activity_unavailable']()}</span>
                  {/if}
                </span>
              </span>
            </div>
          </div>
        </section>

        <section
          class="profile-card profile-biography-card grid min-w-0 gap-3 rounded-2xl border border-text/10 bg-background/70 p-4 shadow-sm backdrop-blur-xl"
          aria-labelledby={biographyHeadingId}
        >
          <h4
            id={biographyHeadingId}
            class="flex items-center gap-2 text-sm font-semibold text-text"
          >
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify uil--file-alt"></span>
            </span>
            {m['profile.biography']()}
          </h4>
          <div
            class="profile-biography-shell"
            class:profile-biography-shell-collapsed={biographyCollapsible && !biographyExpanded}
          >
            <div
              id={biographyContentId}
              class="profile-biography rounded-xl border border-text/10 bg-surface-100/70 p-4 text-sm leading-relaxed shadow-inner"
              class:profile-biography-content-collapsed={biographyCollapsible && !biographyExpanded}
              data-testid="profile-biography-content"
            >
              {#if profile.biographyMarkdown.trim()}
                <MessageContent body={profile.biographyMarkdown} />
              {:else}
                <p class="text-muted">{m['profile.biography_empty']()}</p>
              {/if}
            </div>
            {#if biographyCollapsible && !biographyExpanded}
              <div class="profile-biography-fade" aria-hidden="true"></div>
            {/if}
          </div>
          {#if biographyCollapsible}
            <button
              type="button"
              class="profile-biography-toggle"
              aria-expanded={biographyExpanded}
              aria-controls={biographyContentId}
              onclick={() => (biographyExpanded = !biographyExpanded)}
            >
              <span
                class={[
                  'iconify text-lg',
                  biographyExpanded ? 'uil--angle-up' : 'uil--angle-down'
                ]}
                aria-hidden="true"
              ></span>
              {biographyExpanded
                ? m['profile.biography_collapse']()
                : m['profile.biography_expand']()}
            </button>
          {/if}
        </section>
      </div>
    {/if}

    {#if showActions}'''
regex_once(
    menu,
    r'''    \{#if profile\}\n      <div class="grid gap-4 lg:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(18rem,0\.8fr\)\]">.*?    \{/if\}\n\n    \{#if showActions\}''',
    profile_content,
    "replace stretched profile content grid",
)
replace_once(
    menu,
    '''    box-shadow:
      -0.65rem -0.65rem 1.35rem color-mix(in srgb, white 14%, transparent),
      0.75rem 0.75rem 1.6rem color-mix(in srgb, black 28%, transparent),
      inset 0.16rem 0.16rem 0.35rem color-mix(in srgb, white 22%, transparent),
      inset -0.18rem -0.18rem 0.4rem color-mix(in srgb, black 16%, transparent);''',
    '''    box-shadow:
      0 1rem 2.1rem color-mix(in srgb, black 24%, transparent),
      0 0 0 0.32rem color-mix(in srgb, var(--color-surface-200) 55%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      inset 0 -0.22rem 0.5rem color-mix(in srgb, black 18%, transparent);''',
    "remove avatar white flare",
)
replace_once(
    menu,
    '''  .profile-card,
  .profile-state-card,
  .profile-loading-grid {''',
    '''  .profile-facts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
    gap: 0.75rem;
  }

  .profile-biography-shell {
    position: relative;
    min-width: 0;
  }

  .profile-biography-shell-collapsed {
    overflow: hidden;
    border-radius: 0.75rem;
  }

  .profile-biography-content-collapsed {
    max-height: clamp(18rem, 52dvh, 32rem);
    overflow: hidden;
  }

  .profile-biography-fade {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 6rem;
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--color-surface-100) 94%, transparent) 82%
    );
  }

  .profile-biography-toggle {
    display: inline-flex;
    min-height: 2.75rem;
    width: fit-content;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    justify-self: center;
    border: 1px solid color-mix(in srgb, var(--color-primary) 42%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-primary) 13%, var(--color-background));
    padding: 0.45rem 1rem;
    color: var(--color-text-top);
    font-size: 0.8125rem;
    font-weight: 750;
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      transform 140ms ease;
  }

  .profile-biography-toggle:hover {
    border-color: color-mix(in srgb, var(--color-primary) 68%, transparent);
    background: color-mix(in srgb, var(--color-primary) 20%, var(--color-background));
  }

  .profile-biography-toggle:active {
    transform: translateY(1px);
  }

  .profile-biography-toggle:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .profile-card,
  .profile-state-card,
  .profile-loading-grid {''',
    "insert compact biography and facts styles",
)
replace_once(menu, "@container (max-width: 27rem)", "@container (max-width: 22rem)", "delay narrow hero stacking")
replace_once(
    menu,
    '''    .profile-hero {
      border-radius: 1.25rem;
    }

    .profile-actions {''',
    '''    .profile-hero {
      border-radius: 1.25rem;
      padding: 1rem;
    }

    .profile-avatar-shell {
      width: 5.75rem;
      height: 5.75rem;
      padding: 0.45rem;
    }

    .profile-biography-content-collapsed {
      max-height: min(24rem, 48dvh);
    }

    .profile-actions {''',
    "mobile profile proportions",
)
replace_once(
    menu,
    '''    .profile-skeleton::after,
    .profile-role-skeleton {
      animation: none;
    }''',
    '''    .profile-skeleton::after,
    .profile-role-skeleton {
      animation: none;
    }

    .profile-biography-toggle {
      transition: none;
    }''',
    "reduced motion biography toggle",
)

write(
    "apps/frontend/src/lib/profileBiography.ts",
    '''export const MAX_PROFILE_BIOGRAPHY_CHARACTERS = 1024;
export const MAX_PROFILE_BIOGRAPHY_BYTES = 4 * 1024;

const encoder = new TextEncoder();

export function profileBiographyCharacterLength(value: string): number {
  return Array.from(value).length;
}

export function profileBiographyByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isProfileBiographyWithinLimit(value: string): boolean {
  return (
    profileBiographyCharacterLength(value) <= MAX_PROFILE_BIOGRAPHY_CHARACTERS &&
    profileBiographyByteLength(value) <= MAX_PROFILE_BIOGRAPHY_BYTES
  );
}
''',
)
write(
    "apps/frontend/src/lib/profileBiography.spec.ts",
    '''import { describe, expect, it } from 'vitest';
import {
  isProfileBiographyWithinLimit,
  MAX_PROFILE_BIOGRAPHY_BYTES,
  MAX_PROFILE_BIOGRAPHY_CHARACTERS,
  profileBiographyByteLength,
  profileBiographyCharacterLength
} from './profileBiography';

describe('profile biography limits', () => {
  it('counts Unicode code points and UTF-8 bytes independently', () => {
    expect(profileBiographyCharacterLength('é')).toBe(1);
    expect(profileBiographyCharacterLength('🙂')).toBe(1);
    expect(profileBiographyByteLength('é')).toBe(2);
    expect(profileBiographyByteLength('🙂')).toBe(4);
  });

  it('accepts the exact character and byte boundary', () => {
    const value = '🙂'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS);
    expect(profileBiographyCharacterLength(value)).toBe(MAX_PROFILE_BIOGRAPHY_CHARACTERS);
    expect(profileBiographyByteLength(value)).toBe(MAX_PROFILE_BIOGRAPHY_BYTES);
    expect(isProfileBiographyWithinLimit(value)).toBe(true);
  });

  it('rejects the first Unicode code point past the profile boundary', () => {
    expect(
      isProfileBiographyWithinLimit('a'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1))
    ).toBe(false);
    expect(
      isProfileBiographyWithinLimit('🙂'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1))
    ).toBe(false);
  });
});
''',
)

settings_component = "apps/frontend/src/lib/components/settings/ProfileDetailsSettings.svelte"
replace_once(
    settings_component,
    '''  import {
    isProfileBiographyWithinLimit,
    MAX_PROFILE_BIOGRAPHY_BYTES,
    profileBiographyByteLength
  } from '$lib/profileBiography';''',
    '''  import {
    isProfileBiographyWithinLimit,
    MAX_PROFILE_BIOGRAPHY_BYTES,
    MAX_PROFILE_BIOGRAPHY_CHARACTERS,
    profileBiographyByteLength,
    profileBiographyCharacterLength
  } from '$lib/profileBiography';''',
    "settings biography imports",
)
replace_once(
    settings_component,
    '''  const biographyBytes = $derived(profileBiographyByteLength(biography));
  const biographyValid = $derived(isProfileBiographyWithinLimit(biography));''',
    '''  const biographyCharacters = $derived(profileBiographyCharacterLength(biography));
  const biographyBytes = $derived(profileBiographyByteLength(biography));
  const biographyValid = $derived(isProfileBiographyWithinLimit(biography));''',
    "settings biography character count",
)
regex_once(
    settings_component,
    r'''        <p
          class:text-danger=\{!biographyValid\}
          class="text-right text-xs text-muted"
          aria-live="polite"
        >
          \{m\['settings\.profile\.details\.byte_count'\]\(\{
            used: biographyBytes,
            limit: MAX_PROFILE_BIOGRAPHY_BYTES
          \}\)\}
        </p>''',
    '''        <div
          id="profile-biography-counter"
          class="flex flex-wrap justify-end gap-x-2 gap-y-1 text-right text-xs text-muted"
          aria-live="polite"
          data-testid="profile-biography-counter"
        >
          <span class:text-danger={biographyCharacters > MAX_PROFILE_BIOGRAPHY_CHARACTERS}>
            {m['settings.profile.details.character_count']({
              used: biographyCharacters,
              limit: MAX_PROFILE_BIOGRAPHY_CHARACTERS
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span class:text-danger={biographyBytes > MAX_PROFILE_BIOGRAPHY_BYTES}>
            {m['settings.profile.details.byte_count']({
              used: biographyBytes,
              limit: MAX_PROFILE_BIOGRAPHY_BYTES
            })}
          </span>
        </div>''',
    "settings biography dual counter",
)
replace_once(
    settings_component,
    "          aria-invalid={!biographyValid}\n          placeholder=",
    "          aria-invalid={!biographyValid}\n          aria-describedby=\"profile-biography-counter\"\n          placeholder=",
    "settings biography counter description",
)

profile_settings_spec = "apps/frontend/src/lib/components/settings/ProfileDetailsSettings.svelte.spec.ts"
replace_once(
    profile_settings_spec,
    "import { PresenceStatus } from '$lib/render/types';",
    "import { PresenceStatus } from '$lib/render/types';\nimport { MAX_PROFILE_BIOGRAPHY_CHARACTERS } from '$lib/profileBiography';",
    "settings spec biography constant",
)
replace_once(
    profile_settings_spec,
    "  it('saves the last-activity opt-out and updates the current viewer state', async () => {",
    '''  it('blocks a biography that exceeds the Unicode character limit', async () => {
    const { container } = render(ProfileDetailsSettings);
    const textarea = await vi.waitFor(() => {
      const node = container.querySelector<HTMLTextAreaElement>('textarea');
      expect(node?.value).toBe('Hello profile');
      return node!;
    });

    textarea.value = 'a'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="profile-biography-counter"]')?.textContent).toContain(
        `${MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1} of ${MAX_PROFILE_BIOGRAPHY_CHARACTERS} characters`
      );
      expect(buttonByText(container, 'Save biography').disabled).toBe(true);
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('saves the last-activity opt-out and updates the current viewer state', async () => {''',
    "settings spec over-limit coverage",
)

menu_spec = "apps/frontend/src/lib/components/menus/UserContextMenu.svelte.spec.ts"
replace_once(
    menu_spec,
    "  it('does not expose message or call actions for deleted users', async () => {",
    '''  it('keeps a long biography compact until the viewer expands it', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      biographyMarkdown: Array.from(
        { length: 24 },
        (_, index) => `## Section ${index + 1}\\n\\nA useful profile paragraph with **Markdown** content.`
      ).join('\\n\\n')
    });
    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Show full biography'));
    const content = q(container, '[data-testid="profile-biography-content"]');
    expect(content.classList.contains('profile-biography-content-collapsed')).toBe(true);

    buttonByText(container, 'Show full biography').click();
    await vi.waitFor(() =>
      expect(content.classList.contains('profile-biography-content-collapsed')).toBe(false)
    );
    expect(container.textContent).toContain('Collapse biography');
  });

  it('does not expose message or call actions for deleted users', async () => {''',
    "profile long biography coverage",
)

core_profile = "cli/internal/core/user_profile.go"
replace_once(
    core_profile,
    "const MaxUserBiographyBytes = 16 * 1024",
    "const (\n\tMaxUserBiographyCharacters = 1024\n\tMaxUserBiographyBytes      = 4 * 1024\n)",
    "backend biography limits",
)
replace_once(
    core_profile,
    '''\tif len([]byte(value)) > MaxUserBiographyBytes {
\t\treturn "", fmt.Errorf("%w: biography exceeds %d bytes", ErrInvalidArgument, MaxUserBiographyBytes)
\t}''',
    '''\tif utf8.RuneCountInString(value) > MaxUserBiographyCharacters {
\t\treturn "", fmt.Errorf("%w: biography exceeds %d Unicode characters", ErrInvalidArgument, MaxUserBiographyCharacters)
\t}
\tif len([]byte(value)) > MaxUserBiographyBytes {
\t\treturn "", fmt.Errorf("%w: biography exceeds %d bytes", ErrInvalidArgument, MaxUserBiographyBytes)
\t}''',
    "backend biography character validation",
)

core_test = "cli/internal/core/user_profile_test.go"
normalize_test = '''func TestNormalizeAndValidateUserBiography(t *testing.T) {
\tt.Run("normalizes line endings", func(t *testing.T) {
\t\tgot, err := NormalizeAndValidateUserBiography("line one\\r\\nline two\\rline three")
\t\tif err != nil {
\t\t\tt.Fatalf("NormalizeAndValidateUserBiography: %v", err)
\t\t}
\t\tif got != "line one\\nline two\\nline three" {
\t\t\tt.Fatalf("normalized biography = %q", got)
\t\t}
\t})

\tt.Run("accepts exact Unicode and UTF-8 limits", func(t *testing.T) {
\t\tvalue := strings.Repeat("🙂", MaxUserBiographyCharacters)
\t\tif utf8.RuneCountInString(value) != MaxUserBiographyCharacters {
\t\t\tt.Fatalf("fixture characters = %d", utf8.RuneCountInString(value))
\t\t}
\t\tif len([]byte(value)) != MaxUserBiographyBytes {
\t\t\tt.Fatalf("fixture bytes = %d", len([]byte(value)))
\t\t}
\t\tif _, err := NormalizeAndValidateUserBiography(value); err != nil {
\t\t\tt.Fatalf("exact limit rejected: %v", err)
\t\t}
\t})

\tt.Run("rejects value over Unicode character limit", func(t *testing.T) {
\t\tvalue := strings.Repeat("a", MaxUserBiographyCharacters+1)
\t\tif _, err := NormalizeAndValidateUserBiography(value); !errors.Is(err, ErrInvalidArgument) {
\t\t\tt.Fatalf("error = %v, want ErrInvalidArgument", err)
\t\t}
\t})

\tt.Run("rejects value over UTF-8 byte limit", func(t *testing.T) {
\t\tvalue := strings.Repeat("🙂", MaxUserBiographyCharacters+1)
\t\tif _, err := NormalizeAndValidateUserBiography(value); !errors.Is(err, ErrInvalidArgument) {
\t\t\tt.Fatalf("error = %v, want ErrInvalidArgument", err)
\t\t}
\t})

\tt.Run("rejects invalid UTF-8", func(t *testing.T) {
\t\tif _, err := NormalizeAndValidateUserBiography(string([]byte{0xff})); !errors.Is(err, ErrInvalidArgument) {
\t\t\tt.Fatalf("error = %v, want ErrInvalidArgument", err)
\t\t}
\t})

\tt.Run("rejects null character", func(t *testing.T) {
\t\tif _, err := NormalizeAndValidateUserBiography("hello\\x00world"); !errors.Is(err, ErrInvalidArgument) {
\t\t\tt.Fatalf("error = %v, want ErrInvalidArgument", err)
\t\t}
\t})
}

func TestChattoCoreUpdateUserBiographyEncryptsAndClears'''
regex_once(
    core_test,
    r'''func TestNormalizeAndValidateUserBiography\(t \*testing\.T\) \{.*?\n\}\n\nfunc TestChattoCoreUpdateUserBiographyEncryptsAndClears''',
    normalize_test,
    "backend biography boundary tests",
)
replace_once(
    core_test,
    '"strings"\n\t"testing"',
    '"strings"\n\t"testing"\n\t"unicode/utf8"',
    "backend test rune import",
)

proto = "proto/chatto/api/v1/account.proto"
replace_once(
    proto,
    '''  // Markdown biography. Empty clears the biography. Raw HTML and remote
  // images are not rendered by supported clients.
  optional string biography_markdown = 3 [(buf.validate.field).string.max_bytes = 16384];''',
    '''  // Markdown biography. Empty clears the biography. Supported clients and
  // the core enforce at most 1,024 Unicode code points and 4 KiB of UTF-8.
  // Raw HTML and remote images are not rendered by supported clients.
  optional string biography_markdown = 3 [(buf.validate.field).string.max_bytes = 4096];''',
    "protobuf biography byte boundary",
)

translations = {
    "en": {
        "description": "Write a concise Markdown biography shown on your server profile (up to 1,024 characters). Raw HTML and remote images are not rendered.",
        "characters": "{used} of {limit} characters",
        "too_large": "The biography is limited to 1,024 characters and 4 KiB of UTF-8.",
        "expand": "Show full biography",
        "collapse": "Collapse biography",
    },
    "fr": {
        "description": "Rédigez une biographie Markdown concise affichée sur votre profil serveur (1 024 caractères maximum). Le HTML brut et les images distantes ne sont pas rendus.",
        "characters": "{used} sur {limit} caractères",
        "too_large": "La biographie est limitée à 1 024 caractères et 4 Kio en UTF-8.",
        "expand": "Afficher la biographie complète",
        "collapse": "Réduire la biographie",
    },
    "de": {
        "description": "Verfasse eine kurze Markdown-Biografie für dein Serverprofil (höchstens 1.024 Zeichen). Rohes HTML und entfernte Bilder werden nicht dargestellt.",
        "characters": "{used} von {limit} Zeichen",
        "too_large": "Die Biografie ist auf 1.024 Zeichen und 4 KiB UTF-8 begrenzt.",
        "expand": "Vollständige Biografie anzeigen",
        "collapse": "Biografie einklappen",
    },
    "es": {
        "description": "Escribe una biografía breve en Markdown para tu perfil del servidor (hasta 1024 caracteres). No se muestran HTML sin procesar ni imágenes remotas.",
        "characters": "{used} de {limit} caracteres",
        "too_large": "La biografía está limitada a 1024 caracteres y 4 KiB en UTF-8.",
        "expand": "Mostrar la biografía completa",
        "collapse": "Contraer la biografía",
    },
    "pt": {
        "description": "Escreva uma biografia curta em Markdown para o seu perfil no servidor (até 1.024 caracteres). HTML bruto e imagens remotas não são apresentados.",
        "characters": "{used} de {limit} caracteres",
        "too_large": "A biografia está limitada a 1.024 caracteres e 4 KiB em UTF-8.",
        "expand": "Mostrar biografia completa",
        "collapse": "Recolher biografia",
    },
}
for locale, values in translations.items():
    settings_path = Path(f"apps/frontend/messages/{locale}/settings.json")
    settings_data = json.loads(settings_path.read_text(encoding="utf-8"))
    details = settings_data["settings"]["profile"]["details"]
    details["biography_description"] = values["description"]
    details["character_count"] = values["characters"]
    details["biography_too_large"] = values["too_large"]
    settings_path.write_text(json.dumps(settings_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    chat_path = Path(f"apps/frontend/messages/{locale}/chat.json")
    chat_data = json.loads(chat_path.read_text(encoding="utf-8"))
    chat_data["profile"]["biography_expand"] = values["expand"]
    chat_data["profile"]["biography_collapse"] = values["collapse"]
    chat_path.write_text(json.dumps(chat_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

fdr = "docs/fdr/FDR-022-user-profile.md"
text = read(fdr)
text = text.replace(
    "**Biography** — users can store up to 16 KiB of valid UTF-8 Markdown inside the existing user-PII encryption boundary. Supported clients render it through the same sanitized Markdown path used for message content; raw HTML is not trusted.",
    "**Biography** — users can store up to 1,024 Unicode code points and 4 KiB of valid UTF-8 Markdown inside the existing user-PII encryption boundary. Supported clients render it through the same sanitized Markdown path used for message content; raw HTML is not trusted. Long biographies open as a bounded preview and can be expanded without truncating the stored Markdown.",
)
text = text.replace(
    "**Decision:** Biography Markdown is normalized, validated before any multi-field profile mutation, limited to 16 KiB of UTF-8, and encrypted with the user's PII DEK. Clearing it appends an explicit clear event.",
    "**Decision:** Biography Markdown is normalized, validated before any multi-field profile mutation, limited to 1,024 Unicode code points and 4 KiB of UTF-8, and encrypted with the user's PII DEK. Clearing it appends an explicit clear event.",
)
text = text.replace(
    "**Tradeoff:** The limit is byte-based rather than character-based, so multi-byte scripts reach the bound with fewer visible characters. The editor reports UTF-8 bytes to make that boundary explicit.",
    "**Tradeoff:** Existing biographies above the new product boundary remain readable and are never truncated automatically, but their owners must shorten them before a later save. The editor reports both Unicode characters and UTF-8 bytes so the boundary is explicit.",
)
write(fdr, text)
