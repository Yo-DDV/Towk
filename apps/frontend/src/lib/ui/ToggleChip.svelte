<!--
@component

A small chip-shaped button. Works two ways:

- **Toggle**: caller drives a `pressed` prop and the chip renders an
  "active/selected" state when pressed. Use for Allow / Deny pairs in
  permission editors, on/off filter chips, etc.
- **Action**: leave `pressed` at its default (`false`) and the chip acts
  as a tinted icon/text button. Hover still tints toward `tone` so the
  intent is legible.

The chip deliberately exposes semantic state through `data-tone` and
`aria-pressed`; the shared Towk material layer supplies the solid fill,
edge lighting, and pressed depth without decorative gradients.

```svelte
<ToggleChip
  pressed={state === 'allow'}
  tone="success"
  onclick={() => onSetState(perm, state === 'allow' ? 'neutral' : 'allow')}
>
  Allow
</ToggleChip>
```

For an action-style chip (no toggle), leave `pressed` unset and put an
iconify icon in the slot:

```svelte
<ToggleChip tone="danger" title="Delete" onclick={onDelete}>
  <span class="iconify uil--trash-alt"></span>
</ToggleChip>
```
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Tone = 'success' | 'danger' | 'warning' | 'primary' | 'neutral';

  let {
    children,
    pressed = false,
    tone = 'primary',
    square = false,
    disabled = false,
    onclick,
    title
  }: {
    children: Snippet;
    /** Whether the chip is in its active/selected state. */
    pressed?: boolean;
    /** Semantic tint used for the selected state and hover preview. */
    tone?: Tone;
    /**
     * Render as a square icon-only chip (no horizontal padding, fixed
     * 40×40). Use for icon-only affordances so they don't gain bonus
     * width from `px-2.5`.
     */
    square?: boolean;
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    /** Native title attribute for hover hints. */
    title?: string;
  } = $props();
</script>

<button
  type="button"
  data-ui="toggle-chip"
  data-tone={tone}
  class={[
    'toggle-chip inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-[background-color,color,border-color,box-shadow,scale] duration-150 active:scale-[0.96]',
    square ? 'w-10' : 'min-w-10 px-2.5',
    disabled ? 'cursor-not-allowed opacity-60' : ''
  ]}
  {disabled}
  {title}
  aria-pressed={pressed}
  {onclick}
>
  {@render children()}
</button>
