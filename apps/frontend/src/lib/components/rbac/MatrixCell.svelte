<!--
@component

A single cell in the permission matrix. Combines two pieces of information:

  - **inherited**: the resolved baseline from tiers above (quiet color)
  - **override**: the explicit override at this tier (strong color)

Click cycles the override through `neutral → allow → deny → neutral`. The
inherited indicator persists behind the override so the effective state stays
visible without relying on a decorative color gradient.

When the permission is not applicable to the role at this scope (e.g. a
room-only permission queried at instance scope), pass `applicable={false}`
to render an inert "—" cell with an explanation tooltip.
-->
<script lang="ts">
  type State = 'allow' | 'deny' | 'neutral';

  let {
    override,
    inherited = 'neutral',
    applicable = true,
    disabled = false,
    updating = false,
    ariaLabel,
    title,
    onCycle
  }: {
    override: State;
    inherited?: State;
    applicable?: boolean;
    disabled?: boolean;
    updating?: boolean;
    ariaLabel: string;
    title?: string;
    onCycle: (next: State) => void;
  } = $props();

  function nextState(): State {
    if (override === 'neutral') return 'allow';
    if (override === 'allow') return 'deny';
    return 'neutral';
  }

  function handleClick() {
    if (disabled || !applicable) return;
    onCycle(nextState());
  }

  // The cell is colored by the override when present, otherwise by the
  // inherited baseline, so a row's effective state is visible at a glance.
  const visual = $derived(override !== 'neutral' ? override : inherited);
  const isOverride = $derived(override !== 'neutral');

  const icon = $derived.by(() => {
    if (visual === 'allow') return 'uil--check';
    if (visual === 'deny') return 'uil--times';
    return 'uil--minus';
  });
</script>

{#if !applicable}
  <span
    class="inline-flex h-10 w-10 items-center justify-center text-xs text-muted/30"
    {title}
    aria-label={ariaLabel}
  >
    —
  </span>
{:else}
  <button
    type="button"
    data-ui="permission-matrix-cell"
    class={[
      'inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md transition-[scale] active:scale-[0.96]',
      updating ? 'animate-pulse' : '',
      disabled ? 'cursor-not-allowed opacity-60' : ''
    ]}
    {disabled}
    {title}
    aria-label={ariaLabel}
    aria-pressed={isOverride}
    onclick={handleClick}
  >
    <span
      data-ui="permission-matrix-state"
      data-visual={visual}
      data-override={isOverride ? 'true' : 'false'}
      class="permission-matrix-state inline-flex h-5 w-5 items-center justify-center rounded-md transition-[background-color,color,border-color,box-shadow]"
    >
      <span class={['iconify h-3 w-3', icon]}></span>
    </span>
  </button>
{/if}
