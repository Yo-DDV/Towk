<!--
@component

Compact, accessible 60-second trend chart for opt-in screen-share diagnostics.
The x-axis is time-based so the chart updates in place instead of being rebuilt
against a moving array index.
-->
<script lang="ts">
  type ScreenShareSparklinePoint = {
    collectedAt: number;
    value: number | null;
  };

  let {
    label,
    value,
    points,
    color = 'accent',
    targetValue = null,
    zeroBaseline = true
  }: {
    label: string;
    value: string;
    points: ScreenShareSparklinePoint[];
    color?: 'accent' | 'warning' | 'danger';
    targetValue?: number | null;
    zeroBaseline?: boolean;
  } = $props();

  const width = 240;
  const height = 74;
  const horizontalPadding = 4;
  const verticalPadding = 7;
  const windowMs = 60_000;

  let latestTimestamp = $derived(points.at(-1)?.collectedAt ?? Date.now());
  let windowStart = $derived(latestTimestamp - windowMs);
  let visiblePoints = $derived(points.filter((item) => item.collectedAt >= windowStart));
  let finiteValues = $derived(
    visiblePoints.map((item) => item.value).filter((item): item is number => item !== null)
  );
  let domain = $derived.by(() => {
    const values = [...finiteValues];
    if (targetValue !== null && Number.isFinite(targetValue)) values.push(targetValue);
    const minimum = zeroBaseline ? 0 : values.length ? Math.min(...values) : 0;
    let maximum = values.length ? Math.max(...values) : 1;
    if (maximum <= minimum) {
      maximum = minimum + Math.max(Math.abs(minimum) * 0.15, 1);
    }
    return { minimum, maximum, spread: maximum - minimum };
  });
  let colorClass = $derived(
    color === 'danger' ? 'text-danger' : color === 'warning' ? 'text-warning' : 'text-accent'
  );

  function point(collectedAt: number, value: number): { x: number; y: number } {
    const x =
      horizontalPadding +
      Math.min(Math.max((collectedAt - windowStart) / windowMs, 0), 1) *
        (width - horizontalPadding * 2);
    const y =
      height -
      verticalPadding -
      ((value - domain.minimum) / domain.spread) * (height - verticalPadding * 2);
    return { x, y };
  }

  let linePath = $derived.by(() => {
    const drawablePoints = visiblePoints.filter(
      (item): item is ScreenShareSparklinePoint & { value: number } => item.value !== null
    );
    if (drawablePoints.length === 1) {
      const { y } = point(drawablePoints[0].collectedAt, drawablePoints[0].value);
      return `M ${horizontalPadding} ${y.toFixed(2)} H ${width - horizontalPadding}`;
    }

    let path = '';
    let drawing = false;
    visiblePoints.forEach((item) => {
      if (item.value === null) {
        drawing = false;
        return;
      }
      const { x, y } = point(item.collectedAt, item.value);
      path += `${drawing ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    });
    return path;
  });
  let areaPath = $derived.by(() => {
    if (!linePath) return '';
    const lastSegmentStart = linePath.lastIndexOf('M ');
    const visibleLine = lastSegmentStart > 0 ? linePath.slice(lastSegmentStart) : linePath;
    return `${visibleLine} L ${width - horizontalPadding} ${height - verticalPadding} L ${horizontalPadding} ${height - verticalPadding} Z`;
  });
  let lastPoint = $derived.by(() => {
    for (let index = visiblePoints.length - 1; index >= 0; index -= 1) {
      const item = visiblePoints[index];
      if (item.value !== null) return point(item.collectedAt, item.value);
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
      <path d={areaPath} fill="currentColor" opacity="0.08" />
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
