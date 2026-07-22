<script lang="ts">
  import { onMount } from 'svelte';
  import { createMessageAPI } from '$lib/api-client/messages';
  import * as m from '$lib/i18n/messages';
  import { notifyOutboxMessageSent } from '$lib/pwa/outboxEvents';
  import { OUTBOX_SYNC_TAG, pwaOutbox, type OutboxSentDetail } from '$lib/pwa/outbox.svelte';
  import { privateDataScopeForServer } from '$lib/pwa/scope';
  import { supportsMessageCreateIdempotency } from '$lib/pwa/outboxPolicy';
  import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import OutboxManagerDialog from './OutboxManagerDialog.svelte';

  const scopes = $derived(
    serverRegistry.servers.map(privateDataScopeForServer).filter((scope) => scope !== null)
  );
  const summary = $derived(pwaOutbox.summary);
  let forcing = $state(false);
  let showManager = $state(false);

  async function flushAll(force = false): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const work = scopes.map(async (scope) => {
      const store = serverRegistry.tryGetStore(scope.serverId);
      if (!store) return;
      if (store.serverInfo.loading) return;
      await store.serverInfo.refreshProfile();
      if (store.serverInfo.error !== null) return;
      if (!supportsMessageCreateIdempotency(store.serverInfo)) {
        await pwaOutbox.markUnsupported(scope, m['ui.outbox.unsupported_server']());
        return;
      }
      const connection = serverConnectionManager.getClient(scope.serverId);
      const api = createMessageAPI({
        serverId: connection.serverId,
        baseUrl: connection.connectBaseUrl,
        bearerToken: connection.bearerToken
      });
      await pwaOutbox.flush(scope, api.createPreparedMessage, { force });
    });
    await Promise.allSettled(work);
    await pwaOutbox.refresh(scopes);
  }

  async function retryNow(): Promise<void> {
    if (forcing) return;
    forcing = true;
    try {
      await flushAll(true);
    } finally {
      forcing = false;
    }
  }

  $effect(() => {
    const currentScopes = scopes;
    void pwaOutbox.refresh(currentScopes);
    if (typeof navigator === 'undefined' || navigator.onLine) void flushAll();
  });

  onMount(() => {
    const handleOnline = () => void flushAll(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void flushAll();
    };
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === OUTBOX_SYNC_TAG) void flushAll();
    };
    const handleSent = (event: Event) => {
      const detail = (event as CustomEvent<OutboxSentDetail>).detail;
      notifyOutboxMessageSent(detail);
    };
    const interval = window.setInterval(() => {
      if (pwaOutbox.summary.queued > 0) void flushAll();
    }, 30_000);

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    navigator.serviceWorker?.addEventListener('message', handleWorkerMessage);
    pwaOutbox.addEventListener('sent', handleSent);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      navigator.serviceWorker?.removeEventListener('message', handleWorkerMessage);
      pwaOutbox.removeEventListener('sent', handleSent);
    };
  });
</script>

{#if summary.queued > 0 || summary.needsAttention > 0}
  <section
    class="pointer-events-auto fixed right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-[55] flex max-w-[min(26rem,calc(100vw-1.5rem))] items-center gap-3 rounded-xl border border-border bg-surface-200/95 px-3 py-2 shadow-xl backdrop-blur surface-pop"
    role="status"
    aria-live="polite"
    data-testid="pwa-outbox-status"
  >
    <span
      class={[
        'iconify shrink-0 text-lg',
        summary.needsAttention > 0
          ? 'text-warning uil--exclamation-triangle'
          : 'text-accent uil--cloud-upload'
      ]}
      aria-hidden="true"
    ></span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-text">
        {summary.needsAttention > 0
          ? m['ui.outbox.attention_title']({ count: summary.needsAttention })
          : m['ui.outbox.pending_title']({ count: summary.queued })}
      </p>
      <p class="truncate text-xs text-muted">
        {summary.needsAttention > 0
          ? m['ui.outbox.attention_message']()
          : m['ui.outbox.pending_message']()}
      </p>
    </div>
    <button
      type="button"
      class="btn-secondary shrink-0 btn-sm soft-press"
      onclick={() => (showManager = true)}
    >
      {m['ui.outbox.manage']()}
    </button>
    <button
      type="button"
      class="btn-secondary shrink-0 btn-sm soft-press"
      disabled={forcing || summary.syncing}
      onclick={retryNow}
    >
      {m['ui.outbox.retry']()}
    </button>
  </section>
{/if}

{#if showManager}
  <OutboxManagerDialog {scopes} onclose={() => (showManager = false)} onretry={() => retryNow()} />
{/if}
