<script lang="ts">
  import { on } from 'svelte/events';
  import {
    createReadStateAPI,
    type ReadReceiptReader,
    type ReadReceiptSummary
  } from '$lib/api-client/readState';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import FloatingPopover from '$lib/ui/FloatingPopover.svelte';
  import * as m from '$lib/i18n/messages';

  const PAGE_SIZE = 20;

  let {
    roomId,
    messageEventId,
    threadRootEventId = null,
    summary,
    class: className = ''
  }: {
    roomId: string;
    messageEventId: string;
    threadRootEventId?: string | null;
    summary: ReadReceiptSummary;
    class?: string;
  } = $props();

  const connection = useConnection();

  let open = $state(false);
  let anchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let readers = $state<ReadReceiptReader[]>([]);
  let loading = $state(false);
  let error = $state(false);
  let hasMore = $state(false);
  let totalCount = $state(0);

  function api() {
    const conn = connection();
    return createReadStateAPI({
      serverId: conn.serverId ?? getActiveServer(),
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  }

  function anchorFromEvent(event: MouseEvent | FocusEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    anchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  async function loadReaders(offset = 0): Promise<void> {
    loading = true;
    error = false;
    try {
      const page = await api().listReadReceiptReaders({
        roomId,
        threadRootEventId,
        messageEventId,
        limit: PAGE_SIZE,
        offset
      });
      if (!page.enabled) {
        readers = [];
        totalCount = 0;
        hasMore = false;
        return;
      }
      readers = offset === 0 ? page.readers : [...readers, ...page.readers];
      totalCount = page.totalCount;
      hasMore = page.hasMore;
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  async function toggle(event: MouseEvent): Promise<void> {
    anchorFromEvent(event);
    open = !open;
    if (open && readers.length === 0 && !loading) {
      await loadReaders();
    }
  }

  function close() {
    open = false;
  }

  function popoverGestureBoundary(el: HTMLElement) {
    const stop = (event: Event) => event.stopPropagation();
    const removeTouchStart = on(el, 'touchstart', stop, { capture: true });
    const removeMouseDown = on(el, 'mousedown', stop, { capture: true });
    return () => {
      removeTouchStart();
      removeMouseDown();
    };
  }
</script>

<button
  type="button"
  data-testid="read-receipt-indicator"
  class="{className} gap-1 border-transparent px-1.5 text-[11px] opacity-70 transition-opacity duration-150 hover:opacity-90 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:outline-none motion-reduce:transition-none"
  aria-label={m['room.message.read_receipts.open_label']({ count: summary.readerCount })}
  aria-expanded={open}
  onclick={toggle}
  onfocus={anchorFromEvent}
>
  <span class="iconify text-xs uil--check-circle" aria-hidden="true"></span>
  <span aria-hidden="true">{summary.readerCount}</span>
</button>

<FloatingPopover {open} {anchor} role="dialog" class="w-[min(22rem,calc(100vw-2rem))] menu">
  <div class="flex flex-col gap-2 menu-section p-3 text-sm" {@attach popoverGestureBoundary}>
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-semibold text-text">{m['room.message.read_receipts.title']()}</h3>
      <button type="button" class="icon-action" onclick={close} aria-label={m['ui.close']()}>
        <span class="iconify uil--times"></span>
      </button>
    </div>

    {#if loading && readers.length === 0}
      <p class="text-xs text-muted">{m['room.message.read_receipts.loading']()}</p>
    {:else if error}
      <p class="text-xs text-error">{m['room.message.read_receipts.load_failed']()}</p>
    {:else if readers.length === 0}
      <p class="text-xs text-muted">{m['room.message.read_receipts.empty']()}</p>
    {:else}
      <ul class="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {#each readers as reader (reader.id)}
          <li
            class="flex min-w-0 items-center justify-between gap-3 rounded-md bg-surface/45 px-2 py-1.5"
          >
            <span class="min-w-0">
              <span class="block truncate font-medium text-text">
                {reader.displayName || reader.login}
              </span>
              <span class="block truncate text-xs text-muted">@{reader.login}</span>
            </span>
            {#if reader.readAt}
              <time class="shrink-0 text-xs text-muted" datetime={reader.readAt}>
                {new Date(reader.readAt).toLocaleTimeString()}
              </time>
            {/if}
          </li>
        {/each}
      </ul>
      {#if hasMore}
        <button
          type="button"
          class="meta-badge h-8 justify-center border-transparent px-3 text-xs text-muted"
          onclick={() => loadReaders(readers.length)}
          disabled={loading}
        >
          {loading
            ? m['room.message.read_receipts.loading']()
            : m['room.message.read_receipts.load_more']({
                remaining: Math.max(0, totalCount - readers.length)
              })}
        </button>
      {/if}
    {/if}
  </div>
</FloatingPopover>
