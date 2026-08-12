<script lang="ts">
  let {
    icon,
    accent,
    size = 'md'
  }: {
    icon: string;
    accent: string;
    size?: 'xs' | 'sm' | 'md';
  } = $props();
</script>

<span
  class="grade-icon-badge"
  data-size={size}
  style={`--grade-accent: ${accent};`}
  aria-hidden="true"
>
  <span class={`iconify grade-icon-badge__glyph ${icon}`}></span>
</span>

<style>
  .grade-icon-badge {
    position: relative;
    isolation: isolate;
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--liquid-glass-border);
    border-radius: 0.95rem;
    background: var(--liquid-glass-solid);
    box-shadow:
      inset 0 1px 0 var(--liquid-glass-edge-light),
      inset 1px 0 0 var(--liquid-glass-edge-side),
      inset -1px 0 0 var(--liquid-glass-edge-side),
      inset 0 -1px 0 var(--liquid-glass-edge-shadow),
      0 1px 2px var(--liquid-glass-key-shadow),
      0 10px 22px -18px var(--liquid-glass-ambient-shadow);
  }

  .grade-icon-badge[data-size='xs'] {
    width: 2.125rem;
    height: 2.125rem;
    border-radius: 0.78rem;
  }

  .grade-icon-badge[data-size='sm'] {
    width: 2.5rem;
    height: 2.5rem;
  }

  .grade-icon-badge[data-size='md'] {
    width: 2.75rem;
    height: 2.75rem;
  }

  .grade-icon-badge::before {
    position: absolute;
    inset: 0.55rem;
    z-index: 0;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--grade-accent) 24%, transparent);
    content: '';
    filter: blur(8px);
    opacity: 0.9;
  }

  .grade-icon-badge[data-size='xs'] .grade-icon-badge__glyph {
    font-size: 1rem;
  }

  .grade-icon-badge__glyph {
    position: relative;
    z-index: 1;
    font-size: 1.22rem;
    color: color-mix(in srgb, var(--grade-accent) 70%, var(--color-text-top) 30%);
    filter: drop-shadow(0 1px 4px color-mix(in srgb, var(--grade-accent) 20%, transparent));
  }

  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .grade-icon-badge {
      background: var(--liquid-glass-translucent);
      -webkit-backdrop-filter: blur(12px) saturate(105%);
      backdrop-filter: blur(12px) saturate(105%);
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    .grade-icon-badge {
      background: var(--liquid-glass-solid);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }

  @media (forced-colors: active) {
    .grade-icon-badge {
      border-color: CanvasText;
      background: Canvas;
      box-shadow: none;
    }

    .grade-icon-badge::before {
      display: none;
    }

    .grade-icon-badge__glyph {
      color: CanvasText;
      filter: none;
    }
  }
</style>
