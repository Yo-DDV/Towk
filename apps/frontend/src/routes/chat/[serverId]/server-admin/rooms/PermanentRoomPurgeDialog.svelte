<script lang="ts">
  import type { AdminRoomInfo } from '$lib/state/server/adminRoomLayout.svelte';
  import * as m from '$lib/i18n/messages';
  import { roomPurgeMessages as rp } from '$lib/i18n/roomPurgeMessages';
  import { Button, TextInput } from '$lib/ui/form';
  import { shouldAutoFocus } from '$lib/utils/shouldAutoFocus';

  let {
    room,
    visible = $bindable(false),
    loading = false,
    retryingLocalCleanup = false,
    error = null,
    onconfirm,
    onclose
  }: {
    room: AdminRoomInfo | null;
    visible?: boolean;
    loading?: boolean;
    retryingLocalCleanup?: boolean;
    error?: string | null;
    onconfirm: (confirmation: string) => void;
    onclose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement | undefined;
  let confirmation = $state('');
  let touched = $state(false);
  let pressStartedInside = true;
  let previouslyFocused: HTMLElement | null = null;
  let openKey = '';

  const confirmationMatches = $derived(Boolean(room && confirmation === room.name));
  const confirmationError = $derived(
    touched && room && !confirmationMatches ? rp.confirmationError(room.name) : null
  );
  const dialogId = $props.id();
  const dialogTitleId = `${dialogId}-title`;
  const dialogDescriptionId = `${dialogId}-description`;

  $effect(() => {
    const key = visible && room ? room.id : '';
    if (key && key !== openKey) {
      openKey = key;
      confirmation = '';
      touched = false;
    } else if (!key) {
      openKey = '';
    }
  });

  function syncDialogVisibility(node: HTMLDialogElement) {
    dialogEl = node;
    if (visible) {
      if (!node.open) {
        previouslyFocused =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        node.showModal();
      }
      if (shouldAutoFocus()) {
        queueMicrotask(() => node.querySelector<HTMLInputElement>('#room-purge-confirmation')?.focus());
      }
    } else if (node.open && !loading) {
      node.close();
    }
  }

  function requestClose() {
    if (loading) return;
    dialogEl?.close();
  }

  function handleNativeClose() {
    visible = false;
    confirmation = '';
    touched = false;
    const focusTarget = previouslyFocused;
    previouslyFocused = null;
    queueMicrotask(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    });
    onclose();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    touched = true;
    if (loading || !room || (!retryingLocalCleanup && !confirmationMatches)) return;
    onconfirm(confirmation);
  }
</script>

<dialog
  {@attach syncDialogVisibility}
  onclose={handleNativeClose}
  oncancel={(event) => {
    event.preventDefault();
    requestClose();
  }}
  onpointerdown={(event) => {
    pressStartedInside = event.target !== dialogEl;
  }}
  onclick={(event) => {
    if (loading || event.detail === 0 || pressStartedInside) return;
    if (event.target === dialogEl) requestClose();
  }}
  class="room-purge-dialog m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-xl overflow-visible bg-transparent p-0 backdrop:bg-black/60"
  aria-labelledby={dialogTitleId}
  aria-describedby={dialogDescriptionId}
  aria-busy={loading || undefined}
>
  {#if visible && room}
    <form
      class="room-purge-shell flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-xl border border-danger/25 bg-surface-100 shadow-2xl"
      onsubmit={submit}
    >
      <header class="flex items-start gap-3 border-b border-text/10 px-4 py-4 sm:px-5">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"
          aria-hidden="true"
        >
          <span class="iconify uil--trash-alt text-2xl"></span>
        </span>
        <div class="min-w-0 flex-1 pt-0.5">
          <h2 id={dialogTitleId} class="break-words text-xl font-semibold text-text">
            {rp.dialogTitle(room.name)}
          </h2>
          <p id={dialogDescriptionId} class="mt-1 text-sm leading-5 text-muted">
            {rp.irreversibleBody()}
          </p>
        </div>
        <button
          type="button"
          onclick={requestClose}
          disabled={loading}
          class="-m-1 grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md text-text/50 transition-colors hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={m['ui.close']()}
        >
          <span class="iconify uil--times text-xl" aria-hidden="true"></span>
        </button>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        <section class="rounded-lg border border-danger/25 bg-danger/10 p-4">
          <div class="flex gap-3">
            <span class="iconify uil--exclamation-octagon mt-0.5 shrink-0 text-xl text-danger" aria-hidden="true"></span>
            <div>
              <h3 class="font-semibold text-danger">{rp.irreversibleTitle()}</h3>
              <ul class="mt-2 space-y-1.5 text-sm leading-5 text-text/80">
                <li class="flex gap-2"><span aria-hidden="true">•</span><span>{rp.removesMessages()}</span></li>
                <li class="flex gap-2"><span aria-hidden="true">•</span><span>{rp.removesThreadsReactions()}</span></li>
                <li class="flex gap-2"><span aria-hidden="true">•</span><span>{rp.removesFilesCalls()}</span></li>
                <li class="flex gap-2"><span aria-hidden="true">•</span><span>{rp.removesAccess()}</span></li>
              </ul>
            </div>
          </div>
        </section>

        <div class="rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm leading-5 text-text/80">
          <span class="iconify uil--archive mr-2 align-[-0.15em] text-lg text-warning" aria-hidden="true"></span>
          {rp.backupNotice()}
        </div>

        <TextInput
          id="room-purge-confirmation"
          label={rp.confirmationLabel()}
          bind:value={confirmation}
          placeholder={rp.confirmationPlaceholder(room.name)}
          description={rp.confirmationDescription(room.name)}
          error={confirmationError ?? undefined}
          disabled={loading || retryingLocalCleanup}
          required={!retryingLocalCleanup}
          autocomplete="off"
          autofocus={shouldAutoFocus()}
          oninput={() => {
            if (confirmation.length > 0) touched = true;
          }}
        />

        {#if error}
          <div
            class="rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm leading-5 text-danger"
            role="alert"
            aria-live="assertive"
          >
            <span class="iconify uil--exclamation-triangle mr-2 align-[-0.15em] text-lg" aria-hidden="true"></span>
            {error}
          </div>
        {/if}
      </div>

      <footer
        class="flex flex-col-reverse gap-2 border-t border-text/10 bg-surface-100 px-4 py-4 sm:flex-row sm:justify-end sm:px-5"
      >
        <Button type="button" variant="secondary" disabled={loading} onclick={requestClose}>
          {m['common.cancel']()}
        </Button>
        <Button
          type="submit"
          variant="danger"
          loading={loading}
          disabled={loading || (!retryingLocalCleanup && !confirmationMatches)}
          loadingText={rp.submitting()}
        >
          <span class="inline-flex items-center gap-2">
            <span class="iconify uil--trash-alt" aria-hidden="true"></span>
            {retryingLocalCleanup ? rp.retryLocal() : rp.submit()}
          </span>
        </Button>
      </footer>
    </form>
  {/if}
</dialog>

<style>
  .room-purge-dialog[open] {
    animation: purge-dialog-in 140ms ease-out;
  }

  .room-purge-dialog[open]::backdrop {
    animation: purge-backdrop-in 140ms ease-out;
  }

  @media (max-width: 640px), (max-height: 620px) {
    .room-purge-dialog[open] {
      inset: 0;
      width: 100vw;
      max-width: none;
      height: 100dvh;
      max-height: none;
      margin: 0;
    }

    .room-purge-shell {
      min-height: 100dvh;
      max-height: 100dvh;
      border: 0;
      border-radius: 0;
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
  }

  @media (forced-colors: active) {
    .room-purge-shell {
      border: 1px solid CanvasText;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .room-purge-dialog[open],
    .room-purge-dialog[open]::backdrop {
      animation-duration: 1ms;
    }
  }

  @keyframes purge-dialog-in {
    from {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes purge-backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
