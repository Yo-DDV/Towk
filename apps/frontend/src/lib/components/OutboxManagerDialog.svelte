<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import {
    listQueuedMessages,
    type PrivateDataScope,
    type QueuedMessage
  } from '$lib/pwa/offlineData';
  import { pwaOutbox } from '$lib/pwa/outbox.svelte';
  import type { PrivateDataRecord } from '$lib/pwa/privateData';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Button } from '$lib/ui/form';

  let {
    scopes,
    onclose,
    onretry
  }: {
    scopes: PrivateDataScope[];
    onclose: () => void;
    onretry: () => Promise<void>;
  } = $props();

  type OutboxItem = {
    scope: PrivateDataScope;
    record: PrivateDataRecord<QueuedMessage>;
  };

  let items = $state<OutboxItem[]>([]);
  let loading = $state(true);
  let busyRequestId = $state<string | null>(null);

  async function load(): Promise<void> {
    loading = true;
    const records = await Promise.all(
      scopes.map(async (scope) =>
        (await listQueuedMessages(scope).catch(() => [])).map((record) => ({ scope, record }))
      )
    );
    items = records.flat().sort((a, b) => a.record.value.queuedAt - b.record.value.queuedAt);
    loading = false;
  }

  $effect(() => {
    void scopes;
    void load();
  });

  async function retry(item: OutboxItem): Promise<void> {
    busyRequestId = item.record.value.clientRequestId;
    try {
      await pwaOutbox.retry(item.scope, item.record.value.clientRequestId);
      await onretry();
      await load();
    } finally {
      busyRequestId = null;
    }
  }

  async function discard(item: OutboxItem): Promise<void> {
    busyRequestId = item.record.value.clientRequestId;
    try {
      await pwaOutbox.discard(item.scope, item.record.value.clientRequestId);
      await load();
    } finally {
      busyRequestId = null;
    }
  }

  function serverName(scope: PrivateDataScope): string {
    return serverRegistry.getServer(scope.serverId)?.name ?? scope.serverUrl;
  }
</script>

<Dialog visible title={m['ui.outbox.manager_title']()} size="lg" {onclose}>
  {#if loading}
    <p class="py-6 text-center text-sm text-muted">{m['common.loading']()}</p>
  {:else if items.length === 0}
    <p class="py-6 text-center text-sm text-muted">{m['ui.outbox.empty']()}</p>
  {:else}
    <div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
      {#each items as item (item.record.value.clientRequestId)}
        <article class="rounded-lg border border-border bg-surface-200 p-3">
          <div class="flex items-start gap-3">
            <span
              class={[
                'mt-0.5 iconify shrink-0 text-lg',
                item.record.value.state === 'needs_attention'
                  ? 'text-warning uil--exclamation-triangle'
                  : 'text-muted uil--clock'
              ]}
              aria-hidden="true"
            ></span>
            <div class="min-w-0 flex-1">
              <p class="text-xs text-muted">
                {serverName(item.scope)} · {m['ui.outbox.room_label']({
                  room: item.record.value.roomId
                })}
              </p>
              <p class="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-text">
                {item.record.value.body || m['ui.outbox.attachment_only']()}
              </p>
              {#if item.record.value.lastError}
                <p class="mt-1 line-clamp-2 text-xs text-warning">
                  {item.record.value.lastError}
                </p>
              {/if}
            </div>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busyRequestId !== null}
              onclick={() => discard(item)}
            >
              {m['ui.outbox.discard']()}
            </Button>
            <Button
              variant="accent"
              loading={busyRequestId === item.record.value.clientRequestId}
              disabled={busyRequestId !== null &&
                busyRequestId !== item.record.value.clientRequestId}
              onclick={() => retry(item)}
            >
              {m['ui.outbox.retry']()}
            </Button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</Dialog>
