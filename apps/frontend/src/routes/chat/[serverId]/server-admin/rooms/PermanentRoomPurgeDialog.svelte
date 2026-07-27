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
        queueMicrotask(() =>
          node.querySelector<HTMLInputElement>('#room-purge-confirmation')?.focus()
        );
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
  class="room-purge-dialog m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[34rem] overflow-visible bg-transparent p-0 backdrop:bg-black/70"
  aria-labelledby={dialogTitleId}
  aria-describedby={dialogDescriptionId}
  aria-busy={loading || undefined}
>
  {#if visible && room}
    <form
      class="room-purge-shell flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-2xl border border-text/10 bg-surface-100 shadow-2xl"
      onsubmit={submit}
    >
      <header class="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div class="flex items-start gap-3.5">
          <span
            class="grid size-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger ring-1 ring-danger/15"
            aria-hidden="true"
          >
            <span class="iconify uil--trash-alt text-xl"></span>
          </span>

          <div class="min-w-0 flex-1 pt-0.5">
            <p class="text-xs font-semibold tracking-[0.08em] text-danger uppercase">
              {rp.irreversibleTitle()}
            </p>
            <h2 id={dialogTitleId} class="mt-1 break-words text-xl font-semibold text-text">
              {rp.dialogTitle(room.name)}
            </h2>
            <p id={dialogDescriptionId} class="mt-1.5 text-sm leading-5 text-muted">
              {rp.irreversibleBody()}
            </p>
          </div>

          <button
            type="button"
            onclick={requestClose}
            disabled={loading}
            class="-m-1 grid min-h-10 min-w-10 shrink-0 place-items-center rounded-lg text-text/45 transition-colors hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={m['ui.close']()}
          >
            <span class="iconify uil--times text-xl" aria-hidden="true"></span>
          </button>
        </div>
      </header>

      <div class="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
        <section
          class="rounded-xl border border-danger/15 bg-danger/5 px-4 py-3.5"
          aria-label={rp.irreversibleTitle()}
          data-testid="room-purge-impact"
        >
          <ul class="grid gap-x-5 gap-y-3 text-sm leading-5 text-text/80 sm:grid-cols-2">
            <li class="flex min-w-0 items-start gap-2.5">
              <span
                class="iconify uil--comment-alt-lines mt-0.5 shrink-0 text-base text-danger/80"
                aria-hidden="true"
              ></span>
              <span>{rp.removesMessages()}</span>
            </li>
            <li class="flex min-w-0 items-start gap-2.5">
              <span
                class="iconify uil--comments-alt mt-0.5 shrink-0 text-base text-danger/80"
                aria-hidden="true"
              ></span>
              <span>{rp.removesThreadsReactions()}</span>
            </li>
            <li class="flex min-w-0 items-start gap-2.5">
              <span
                class="iconify uil--paperclip mt-0.5 shrink-0 text-base text-danger/80"
                aria-hidden="true"
              ></span>
              <span>{rp.removesFilesCalls()}</span>
            </li>
            <li class="flex min-w-0 items-start gap-2.5">
              <span
                class="iconify uil--shield mt-0.5 shrink-0 text-base text-danger/80"
                aria-hidden="true"
              ></span>
              <span>{rp.removesAccess()}</span>
            </li>
          </ul>
        </section>

        <div class="mt-5">
          <TextInput
            id="room-purge-confirmation"
            label={rp.confirmationDescription(room.name)}
            bind:value={confirmation}
            placeholder={rp.confirmationPlaceholder(room.name)}
            error={confirmationError ?? undefined}
            disabled={loading || retryingLocalCleanup}
            required={!retryingLocalCleanup}
            autocomplete="off"
            autofocus={shouldAutoFocus()}
            oninput={() => {
              if (confirmation.length > 0) touched = true;
            }}
          />
        </div>

        {#if error}
          <div
            class="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/10 px-3.5 py-3 text-sm leading-5 text-danger"
            role="alert"
            aria-live="assertive"
          >
            <span
              class="iconify uil--exclamation-triangle mt-0.5 shrink-0 text-lg"
              aria-hidden="true"
            ></span>
            <span>{error}</span>
          </div>
        {/if}
      </div>

      <footer
        class="room-purge-actions grid grid-cols-1 gap-2 border-t border-text/10 bg-surface-100/95 px-5 py-4 min-[460px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.35fr)] sm:flex sm:justify-end sm:px-6"
      >
        <div class="min-w-0 sm:min-w-28">
          <Button
            type="button"
            variant="secondary"
            fullWidth
            disabled={loading}
            onclick={requestClose}
          >
            {m['common.cancel']()}
          </Button>
        </div>
        <div class="min-w-0 sm:min-w-56">
          <Button
            type="submit"
            variant="danger"
            fullWidth
            loading={loading}
            disabled={loading || (!retryingLocalCleanup && !confirmationMatches)}
            loadingText={rp.submitting()}
          >
            <span class="inline-flex items-center gap-2">
              <span class="iconify uil--trash-alt" aria-hidden="true"></span>
              {retryingLocalCleanup ? rp.retryLocal() : rp.submit()}
            </span>
          </Button>
        </div>
      </footer>
    </form>
  {/if}
</dialog>

<style>
  .room-purge-dialog[open] {
    animation: purge-dialog-in 150ms ease-out;
  }

  .room-purge-dialog[open]::backdrop {
    animation: purge-backdrop-in 150ms ease-out;
  }

  @media (max-width: 640px), (max-height: 620px) {
    .room-purge-dialog[open] {
      position: fixed;
      inset: auto 0 0;
      width: 100%;
      max-width: none;
      max-height: calc(100dvh - 0.5rem);
      margin: 0 auto;
      animation-name: purge-sheet-in;
    }

    .room-purge-shell {
      max-height: calc(100dvh - 0.5rem);
      border-right: 0;
      border-bottom: 0;
      border-left: 0;
      border-radius: 1rem 1rem 0 0;
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
      transform: translateY(0.4rem) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes purge-sheet-in {
    from {
      opacity: 0;
      transform: translateY(1.25rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
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
