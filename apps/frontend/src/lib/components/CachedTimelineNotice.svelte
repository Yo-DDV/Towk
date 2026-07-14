<script lang="ts">
  import * as m from '$lib/i18n/messages';
</script>

<div
  class="flex items-center justify-center gap-2 border-b border-border bg-surface-200 px-3 py-1.5 text-center text-xs text-muted"
  role="status"
  data-testid="cached-timeline-notice"
>
  <span class="iconify text-accent uil--shield-check" aria-hidden="true"></span>
  <span>{m['ui.cached_timeline']()}</span>
</div>
