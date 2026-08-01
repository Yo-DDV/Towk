<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Button } from '$lib/ui/form';
  import ContextMenu from './ContextMenu.svelte';

  const { Story } = defineMeta({
    title: 'UI/ContextMenu',
    component: ContextMenu,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Adaptive action menu. Auto presentation uses a floating top-layer popover for hover-capable input and a bottom sheet for touch-primary input.'
        }
      }
    }
  });
</script>

<script lang="ts">
  let floatingOpen = $state(false);
  let floatingAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let sheetOpen = $state(false);
  let persistentSheetOpen = $state(false);
  let lastAction = $state('No action selected');

  function openFloating(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    floatingAnchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
    floatingOpen = true;
  }

  function choose(action: string, close: () => void) {
    lastAction = action;
    close();
  }
</script>

{#snippet actionItems(close: () => void)}
  <button
    type="button"
    role="menuitem"
    class="menu-item"
    onclick={() => choose('Reply', close)}
  >
    <span class="iconify uil--reply" aria-hidden="true"></span>
    <span>Reply</span>
  </button>
  <button
    type="button"
    role="menuitem"
    class="menu-item"
    onclick={() => choose('Mark unread', close)}
  >
    <span class="iconify uil--envelope-alt" aria-hidden="true"></span>
    <span>Mark unread</span>
  </button>
  <button
    type="button"
    role="menuitem"
    class="menu-item text-danger"
    onclick={() => choose('Delete', close)}
  >
    <span class="iconify uil--trash-alt" aria-hidden="true"></span>
    <span>Delete</span>
  </button>
{/snippet}

<Story
  name="Floating pointer menu"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Forced floating presentation documents desktop geometry independently of the current Storybook device input.'
      }
    }
  }}
>
  <div class="flex min-h-64 flex-col items-start gap-4 rounded-xl border border-border bg-background p-6 text-text">
    <Button onclick={openFloating}>Open message actions</Button>
    <p class="text-sm text-muted" aria-live="polite">{lastAction}</p>

    {#if floatingOpen}
      <ContextMenu
        presentation="floating"
        anchor={floatingAnchor}
        ariaLabel="Message actions"
        onclose={() => (floatingOpen = false)}
      >
        {@render actionItems(() => (floatingOpen = false))}
      </ContextMenu>
    {/if}
  </div>
</Story>

<Story
  name="Touch sheet"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Forced sheet presentation documents the same action set with touch-sized rows and visual-viewport ownership.'
      }
    }
  }}
>
  <div class="flex min-h-64 flex-col items-start gap-4 rounded-xl border border-border bg-background p-6 text-text">
    <Button onclick={() => (sheetOpen = true)}>Open touch actions</Button>
    <p class="text-sm text-muted" aria-live="polite">{lastAction}</p>

    {#if sheetOpen}
      <ContextMenu
        presentation="sheet"
        ariaLabel="Message actions"
        onclose={() => (sheetOpen = false)}
      >
        {@render actionItems(() => (sheetOpen = false))}
      </ContextMenu>
    {/if}
  </div>
</Story>

<Story
  name="Persistent touch task"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Persistent mode prevents accidental backdrop or native cancellation while a nested picker or focused input owns the task.'
      }
    }
  }}
>
  <div class="flex min-h-64 flex-col items-start gap-4 rounded-xl border border-border bg-background p-6 text-text">
    <Button onclick={() => (persistentSheetOpen = true)}>Open persistent actions</Button>

    {#if persistentSheetOpen}
      <ContextMenu
        presentation="sheet"
        ariaLabel="Persistent message actions"
        dismissOnExternalInteraction={false}
        onclose={() => (persistentSheetOpen = false)}
      >
        <div class="space-y-3">
          <p class="px-3 text-sm text-muted">
            Choose an action or use the explicit sheet handle to dismiss.
          </p>
          {@render actionItems(() => (persistentSheetOpen = false))}
        </div>
      </ContextMenu>
    {/if}
  </div>
</Story>
