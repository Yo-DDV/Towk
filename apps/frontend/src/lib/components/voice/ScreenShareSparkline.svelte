<!--
@component

Compact, accessible 60-second trend chart for opt-in screen-share diagnostics.
Null samples create visible gaps instead of being rendered as zeroes.
-->
<script lang="ts">
  let {
    label,
    value,
    values,
    color = 'accent'
  }: {
    label: string;
    value: string;
    values: Array<number | null>;
    color?: 'accent' | 'warning' | 'danger';
  } = $props();

  const width = 240;
  const height = 74;
  const horizontalPadding = 4;
  const verticalPadding = 7;

  let finiteValues = $derived(values.filter((item): item is number => item !== null));
  let minimum = $derived(finiteValues.length ? Math.min(...finiteValues) : 0);
  let maximum = $derived(finiteValues.length ? Math.max(...finiteValues) : 1);
  let spread = $derived(Math.max(maximum - minimum, maximum * 0.08, 1));
  let colorClass = $derived(
    color === 'danger' ? 'text-danger' : color === 'warning' ? 'text-warning' : 'text-accent'
  );

  function point(index: number, item: number): { x: number; y: number } {
    const x =
      horizontalPadding +
      (index / Math.max(values.length - 1, 1)) * (width - horizontalPadding * 2);
    const y =
      height - verticalPadding - ((item - minimum) / spread) * (height - verticalPadding * 2);
    return { x, y };
  }

  let linePath = $derived.by(() => {
    let path = '';
    let drawing = false;
    values.forEach((item, index) => {
      if (item === null) {
        drawing = false;
        return;
      }
      const { x, y } = point(index, item);
      path += `${drawing ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    });
    return path;
  });
  let lastPoint = $derived.by(() => {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const item = values[index];
      if (item !== null) return point(index, item);
    }
    return null;
  });
</script>

<figure class="min-w-0 rounded-md border border-text/10 bg-surface-100/80 p-2.5">
  <figcaption class="flex items-baseline justify-between gap-2">
    <span class="truncate text-[11px] font-medium text-muted">{label}</span>
    <strong class="shrink-0 text-sm font-semibold tabular-nums">{value}</strong>
  </figcaption>

  <svg
    class={['mt-1.5 h-[74px] w-full overflow-visible', colorClass]}
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={`${label}: ${value}`}
    preserveAspectRatio="none"
  >
    <path d={`M 0 ${height * 0.25} H ${width}`} stroke="currentColor" stroke-opacity="0.08" />
    <path d={`M 0 ${height * 0.5} H ${width}`} stroke="currentColor" stroke-opacity="0.08" />
    <path d={`M 0 ${height * 0.75} H ${width}`} stroke="currentColor" stroke-opacity="0.08" />

    {#if linePath}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    {/if}

    {#if lastPoint}
      <circle cx={lastPoint.x} cy={lastPoint.y} r="3.25" fill="currentColor" />
      <circle cx={lastPoint.x} cy={lastPoint.y} r="6" fill="currentColor" opacity="0.16" />
    {/if}
  </svg>
</figure>
