<script lang="ts">
  import type { RoomEventView } from '$lib/render/types';

  let { event }: { event: RoomEventView } = $props();
</script>

<div data-event-id={event.id}>
  {event.id}
  {#if event.id === 'msg-with-pending-image'}
    <img
      data-testid="mock-timeline-image"
      class="skeleton"
      src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      alt=""
    />
  {/if}
</div>
