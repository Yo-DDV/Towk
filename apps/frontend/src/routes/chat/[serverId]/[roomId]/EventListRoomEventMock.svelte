<script lang="ts">
  import type { ReadReceiptSummary } from '$lib/api-client/readState';
  import type { RoomEventView } from '$lib/render/types';

  let {
    event,
    readReceiptSummary
  }: {
    event: RoomEventView;
    readReceiptSummary?: ReadReceiptSummary;
  } = $props();
</script>

<div data-event-id={event.id}>
  {event.id}
  {#if event.id === 'msg-control'}
    <button type="button" data-testid="mock-timeline-control">Play</button>
  {/if}
  {#if readReceiptSummary}
    <span data-testid={`read-receipt-summary-${event.id}`}>{readReceiptSummary.readerCount}</span>
  {/if}
  {#if event.id === 'msg-with-pending-image'}
    <img
      data-testid="mock-timeline-image"
      class="skeleton"
      src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      alt=""
    />
  {/if}
</div>
