<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Button } from '$lib/ui/form';
  import BottomSheet from './BottomSheet.svelte';

  const { Story } = defineMeta({
    title: 'UI/BottomSheet',
    component: BottomSheet,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Touch-first modal surface bound to the visual viewport. Use ContextMenu when the same actions should stay anchored on pointer/hover devices.'
        }
      }
    }
  });
</script>

<script lang="ts">
  let defaultVisible = $state(false);
  let persistentVisible = $state(false);
  let longContentVisible = $state(false);

  const settings = [
    'Respect the software keyboard and visual viewport',
    'Keep the explicit close handle reachable',
    'Contain scrolling inside the sheet',
    'Preserve safe-area padding in installed PWAs'
  ];
</script>

<Story
  name="Default"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Backdrop, Escape, close-handle tap, and downward swipe can dismiss the default sheet.'
      }
    }
  }}
>
  <Button onclick={() => (defaultVisible = true)}>Open bottom sheet</Button>

  <BottomSheet
    bind:visible={defaultVisible}
    ariaLabel="Notification settings"
    onclose={() => (defaultVisible = false)}
  >
    <div class="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h2 class="text-xl font-semibold text-text-top">Notification settings</h2>
        <p class="mt-1 text-sm text-muted">
          The content remains readable and actionable on short touch viewports.
        </p>
      </div>

      <div class="surface-box space-y-2 p-3 text-sm">
        {#each settings as setting (setting)}
          <p class="flex items-start gap-2">
            <span class="iconify mt-0.5 shrink-0 text-success uil--check" aria-hidden="true"></span>
            <span>{setting}</span>
          </p>
        {/each}
      </div>

      <Button fullWidth onclick={() => (defaultVisible = false)}>Apply settings</Button>
    </div>
  </BottomSheet>
</Story>

<Story
  name="Persistent task"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Persistent sheets ignore backdrop and native close requests. The user must choose an explicit task action, the handle, swipe, or an application-owned close path.'
      }
    }
  }}
>
  <Button onclick={() => (persistentVisible = true)}>Open persistent sheet</Button>

  <BottomSheet
    bind:visible={persistentVisible}
    ariaLabel="Choose a reaction"
    dismissOnExternalInteraction={false}
    onclose={() => (persistentVisible = false)}
  >
    <div class="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h2 class="text-xl font-semibold text-text-top">Choose a reaction</h2>
        <p class="mt-1 text-sm text-muted">
          Backdrop interaction does not interrupt a focused picker or keyboard workflow.
        </p>
      </div>

      <div class="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {#each ['👍', '❤️', '😂', '🎉', '👀', '🚀', '✅', '🤔', '👏', '🔥'] as emoji (emoji)}
          <button
            type="button"
            class="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border bg-background text-2xl transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label={`React with ${emoji}`}
            onclick={() => (persistentVisible = false)}
          >
            {emoji}
          </button>
        {/each}
      </div>
    </div>
  </BottomSheet>
</Story>

<Story
  name="Short viewport and long content"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The sheet owns its scroll region when the visual viewport is shorter than the content. Validate this story with a short landscape viewport and an open software keyboard.'
      }
    }
  }}
>
  <Button onclick={() => (longContentVisible = true)}>Open long sheet</Button>

  <BottomSheet
    bind:visible={longContentVisible}
    ariaLabel="Review channel changes"
    onclose={() => (longContentVisible = false)}
  >
    <div class="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h2 class="text-xl font-semibold text-text-top">Review channel changes</h2>
        <p class="mt-1 text-sm text-muted">
          Content scrolls inside the bounded sheet instead of pushing actions beyond the viewport.
        </p>
      </div>

      <div class="space-y-2">
        {#each Array.from({ length: 10 }, (_, index) => index + 1) as item (item)}
          <div class="surface-box p-3">
            <p class="font-medium text-text-top">Change {item}</p>
            <p class="text-sm text-muted">
              A representative row with enough copy to exercise wrapping and internal scrolling.
            </p>
          </div>
        {/each}
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" fullWidth onclick={() => (longContentVisible = false)}>
          Cancel
        </Button>
        <Button fullWidth onclick={() => (longContentVisible = false)}>Confirm</Button>
      </div>
    </div>
  </BottomSheet>
</Story>
