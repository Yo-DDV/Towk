<script lang="ts">
  import { page } from '$app/state';
  import { fade } from 'svelte/transition';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { messageUploadProgress } from '$lib/uploads/messageUploadProgress.svelte';
  import type { MessageUploadProgressEntry } from '$lib/uploads/messageUploadProgressModel';
  import PositionedUploadStatusIsland from './PositionedUploadStatusIsland.svelte';

  const activeEntries = $derived(
    messageUploadProgress.entries.filter(
      (entry) =>
        entry.roomId === page.params.roomId &&
        (!entry.serverId || entry.serverId === getActiveServer()) &&
        (!entry.threadRootEventId || entry.threadRootEventId === page.params.threadId)
    )
  );

  function retry(entry: MessageUploadProgressEntry) {
    const selector = entry.threadRootEventId
      ? '[data-testid="thread-reply-input"]'
      : '[data-testid="message-input"]';
    const editor = document.querySelector<HTMLElement>(selector);
    const shell = editor?.closest<HTMLElement>('[data-testid="message-composer-shell"]');
    const sendButton = shell?.querySelector<HTMLButtonElement>(
      '[data-testid="message-send-button"]'
    );
    if (!sendButton || sendButton.disabled) {
      editor?.focus();
      return;
    }
    messageUploadProgress.dismiss(entry.id);
    sendButton.click();
  }
</script>

{#each activeEntries as entry (entry.id)}
  <div transition:fade={{ duration: 160 }}>
    <PositionedUploadStatusIsland
      {entry}
      onRetry={() => retry(entry)}
      onDismiss={() => messageUploadProgress.dismiss(entry.id)}
    />
  </div>
{/each}
