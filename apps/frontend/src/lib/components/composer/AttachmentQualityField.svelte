<!--
@component

Sending quality for the staged images, shown above the attachment previews.

No canonical primitive covers this contract: `Select` hides the options behind
a native popup and `ToggleChip` gives four unlabelled pills with no indication
of what they change. This field keeps the choice visible, names it, and states
what it costs — the upload size it produces and the size it replaces.

The surface reuses the shared polished-glass tokens (`--liquid-glass-*`) so it
belongs to the composer it sits on. Only the container is blurred; the selected
segment is a compositor-friendly `transform`, so switching profiles never
repaints the group.
-->
<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import { IMAGE_QUALITY_PROFILES, type ImageQualityProfile } from '$lib/attachments/imageQuality';

  let {
    value,
    summary,
    busy = false,
    onselect
  }: {
    value: ImageQualityProfile;
    /** Sentence stating the resulting upload size. */
    summary: string;
    busy?: boolean;
    onselect: (profile: ImageQualityProfile) => void;
  } = $props();

  const labels: Record<ImageQualityProfile, () => string> = {
    auto: m['composer.attachment_quality.auto'],
    sd: m['composer.attachment_quality.sd'],
    hd: m['composer.attachment_quality.hd'],
    original: m['composer.attachment_quality.original']
  };
  const hints: Record<ImageQualityProfile, () => string> = {
    auto: m['composer.attachment_quality.auto_hint'],
    sd: m['composer.attachment_quality.sd_hint'],
    hd: m['composer.attachment_quality.hd_hint'],
    original: m['composer.attachment_quality.original_hint']
  };

  const selectedIndex = $derived(Math.max(0, IMAGE_QUALITY_PROFILES.indexOf(value)));
  const segments: HTMLButtonElement[] = [];

  function move(offset: number): void {
    const index =
      (selectedIndex + offset + IMAGE_QUALITY_PROFILES.length) % IMAGE_QUALITY_PROFILES.length;
    onselect(IMAGE_QUALITY_PROFILES[index]);
    // Roving focus follows the selection, as expected inside a radio group.
    segments[index]?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    }
  }
</script>

<div class="quality-field" data-testid="attachment-quality">
  <span class="quality-label" id="composer-image-quality-label">
    {m['composer.attachment_quality.label']()}
  </span>

  <div
    class="quality-segments"
    role="radiogroup"
    aria-labelledby="composer-image-quality-label"
    aria-busy={busy}
    style="--segment-count:{IMAGE_QUALITY_PROFILES.length}; --segment-index:{selectedIndex}"
  >
    <span class="quality-indicator" aria-hidden="true"></span>
    {#each IMAGE_QUALITY_PROFILES as profile, index (profile)}
      <button
        bind:this={segments[index]}
        type="button"
        role="radio"
        class="quality-segment"
        data-testid="attachment-quality-{profile}"
        aria-checked={value === profile}
        tabindex={value === profile ? 0 : -1}
        title={hints[profile]()}
        disabled={busy}
        onclick={() => onselect(profile)}
        {onkeydown}
      >
        {labels[profile]()}
      </button>
    {/each}
  </div>

  <p class="quality-summary" data-testid="attachment-quality-summary" aria-live="polite">
    <span class="quality-hint">{hints[value]()}</span>
    <span class="quality-size">{summary}</span>
  </p>
</div>

<style>
  .quality-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .quality-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--color-muted, currentColor);
  }

  .quality-segments {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: repeat(var(--segment-count), minmax(0, 1fr));
    gap: 0;
    width: 100%;
    max-width: 28rem;
    padding: 0.1875rem;
    border-radius: 0.75rem;
    background-color: var(--liquid-glass-solid);
    box-shadow:
      inset 0 0 0 1px var(--liquid-glass-border),
      inset 0 1px 0 var(--liquid-glass-edge-light),
      inset 0 -1px 0 var(--liquid-glass-edge-shadow),
      0 1px 2px var(--liquid-glass-key-shadow),
      0 10px 24px -20px var(--liquid-glass-ambient-shadow);
  }

  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .quality-segments {
      background-color: var(--liquid-glass-translucent);
      -webkit-backdrop-filter: blur(16px) saturate(100%);
      backdrop-filter: blur(16px) saturate(100%);
    }
  }

  /* One moving pane instead of four repainted buttons. */
  .quality-indicator {
    position: absolute;
    z-index: -1;
    top: 0.1875rem;
    bottom: 0.1875rem;
    left: 0.1875rem;
    width: calc((100% - 0.375rem) / var(--segment-count));
    border-radius: 0.5625rem;
    background-color: var(--liquid-glass-solid);
    box-shadow:
      inset 0 0 0 1px var(--liquid-glass-border-strong),
      inset 0 1px 0 var(--liquid-glass-edge-light),
      0 1px 2px var(--liquid-glass-key-shadow);
    transform: translateX(calc(var(--segment-index) * 100%));
    transition: transform 180ms cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
  }

  .quality-segment {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0.3125rem 0.5rem;
    border-radius: 0.5625rem;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--color-muted, currentColor);
    cursor: pointer;
    transition: color 150ms ease;
  }

  .quality-segment[aria-checked='true'] {
    color: var(--color-text, currentColor);
    font-weight: 600;
  }

  .quality-segment:disabled {
    cursor: progress;
    opacity: 0.7;
  }

  .quality-segment:focus-visible {
    outline: 2px solid rgba(232, 120, 59, 0.76);
    outline-offset: 1px;
  }

  .quality-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.125rem 0.5rem;
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.35;
    color: var(--color-muted, currentColor);
  }

  .quality-size {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  @media (prefers-reduced-transparency: reduce) {
    .quality-segments {
      background-color: var(--liquid-glass-solid);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .quality-indicator {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .quality-indicator {
      forced-color-adjust: none;
      background-color: Highlight;
    }

    .quality-segment[aria-checked='true'] {
      color: HighlightText;
    }
  }
</style>
