<script lang="ts">
  /* eslint-disable svelte/no-navigation-without-resolve -- external image URLs */
  import * as m from '$lib/i18n/messages';

  export type ImageItem = {
    id?: string;
    src: string;
    originalSrc?: string;
    alt?: string;
    filename?: string;
  };

  let {
    items,
    index = $bindable(0),
    onclose
  }: {
    items: ImageItem[];
    index?: number;
    onclose: () => void;
  } = $props();

  let current = $derived(items[index]);
  let hasMultiple = $derived(items.length > 1);

  function showDialog(node: HTMLDialogElement) {
    node.showModal();
  }

  function close() {
    onclose();
  }

  function navigate(direction: -1 | 1) {
    index = (index + direction + items.length) % items.length;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowLeft' && hasMultiple) {
      e.preventDefault();
      navigate(-1);
    } else if (e.key === 'ArrowRight' && hasMultiple) {
      e.preventDefault();
      navigate(1);
    }
  }
</script>

<dialog
  {@attach showDialog}
  onclose={close}
  onkeydown={handleKeydown}
  onclick={(e) => {
    if (e.target === e.currentTarget) close();
  }}
  class="image-modal-dialog fixed inset-0 m-0 flex items-center justify-center overflow-hidden border-none bg-black/90 p-0 backdrop:bg-transparent"
>
  {#if current}
    <button
      type="button"
      onclick={close}
      class="image-modal-close absolute z-20 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/18 backdrop-blur-md transition-colors hover:bg-white/18"
      aria-label={m['ui.close']()}
    >
      <span class="iconify text-2xl uil--times"></span>
    </button>

    <div class="image-modal-content flex min-h-0 min-w-0 flex-col items-center gap-3">
      <div class="relative flex items-center gap-2">
        {#if hasMultiple}
          <button
            type="button"
            onclick={() => navigate(-1)}
            class="nav-button"
            aria-label={m['ui.image_modal.previous']()}
          >
            <span class="iconify text-2xl uil--angle-left-b"></span>
          </button>
        {/if}

        <img
          src={current.src}
          alt={current.alt ?? current.filename ?? m['ui.image_modal.fallback_alt']()}
          class="image-modal-image object-contain"
        />

        {#if hasMultiple}
          <button
            type="button"
            onclick={() => navigate(1)}
            class="nav-button"
            aria-label={m['ui.image_modal.next']()}
          >
            <span class="iconify text-2xl uil--angle-right-b"></span>
          </button>
        {/if}
      </div>

      <div
        class="flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 text-white/80"
      >
        {#if current.filename}
          <span class="text-sm">{current.filename}</span>
        {/if}

        {#if hasMultiple}
          <span class="text-sm text-white/50">{index + 1} / {items.length}</span>
        {/if}

        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external image URL -->
        <a
          href={current.originalSrc ?? current.src}
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <span class="iconify uil--external-link-alt"></span>
          {m['ui.image_modal.open_original']()}
        </a>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog[open] {
    animation: fade-in 150ms ease-out;
  }

  .image-modal-dialog {
    color-scheme: dark;
    width: 100dvw;
    height: 100dvh;
    max-width: 100dvw;
    max-height: 100dvh;
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
  }

  @supports (height: 100svh) {
    .image-modal-dialog {
      height: 100svh;
      max-height: 100svh;
    }
  }

  .image-modal-close {
    top: max(0.75rem, env(safe-area-inset-top, 0px));
    right: max(0.75rem, env(safe-area-inset-right, 0px));
  }

  .image-modal-content {
    max-width: calc(100dvw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
  }

  @supports (height: 100svh) {
    .image-modal-content {
      max-height: calc(
        100svh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
      );
    }
  }

  .image-modal-image {
    max-width: min(
      85vw,
      calc(100dvw - 2rem - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))
    );
    max-height: min(
      85vh,
      calc(100dvh - 5.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
    );
    background: #000;
  }

  @supports (height: 100svh) {
    .image-modal-image {
      max-height: min(
        85svh,
        calc(100svh - 5.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))
      );
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .nav-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: 9999px;
    color: white;
    opacity: 0.6;
    cursor: pointer;
    transition: opacity 150ms;

    &:hover {
      opacity: 1;
    }
  }
</style>
