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
    testId,
    onclick
  }: {
    icon: string;
    label: string;
    active?: boolean;
    disabled?: boolean;
    pending?: boolean;
    testId?: string;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class={[
    'pointer-events-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded text-muted transition-[background-color,color,scale] hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
    active && 'bg-surface-200 text-text'
  ]}
  title={label}
  aria-label={label}
  aria-busy={pending || undefined}
  {disabled}
  data-testid={testId}
  {onclick}
>
  <span
    class={['iconify text-base', pending ? 'animate-spin uil--spinner' : icon]}
    aria-hidden="true"
  ></span>
</button>
