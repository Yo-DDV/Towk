<!--
@component

Compact icon button for call participant tile overlays. Used for local-only
presentation controls such as fullscreening a feed or muting a participant
for the current viewer.
-->
<script lang="ts">
  let {
    icon,
    label,
    active = false,
    disabled = false,
    pending = false,
    size = 'default',
    testId,
    buttonId,
    ariaExpanded,
    ariaControls,
    onclick
  }: {
    icon: string;
    label: string;
    active?: boolean;
    disabled?: boolean;
    pending?: boolean;
    size?: 'default' | 'compact';
    testId?: string;
    buttonId?: string;
    ariaExpanded?: boolean;
    ariaControls?: string;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  id={buttonId}
  type="button"
  class={[
    'pointer-events-auto flex cursor-pointer items-center justify-center rounded text-muted transition-[background-color,color,scale] hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
    size === 'compact'
      ? 'h-10 w-10'
      : 'h-[44px] min-h-[44px] w-[44px] min-w-[44px]',
    active && 'bg-surface-200 text-text'
  ]}
  title={label}
  aria-label={label}
  aria-busy={pending || undefined}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}
  {disabled}
  data-testid={testId}
  {onclick}
>
  <span
    class={['iconify text-base', pending ? 'animate-spin uil--spinner' : icon]}
    aria-hidden="true"
  ></span>
</button>
