<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect } from 'storybook/test';
  import { Button } from '$lib/ui/form';
  import BottomSheet from './BottomSheet.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import Combobox from './form/Combobox.svelte';

  type Channel = { value: string; label: string };

  const channels: Channel[] = [
    { value: 'general', label: 'General' },
    { value: 'engineering', label: 'Engineering' },
    { value: 'release', label: 'Release coordination' }
  ];

  const getValue = (channel: Channel) => channel.value;
  const getLabel = (channel: Channel) => channel.label;

  const { Story } = defineMeta({
    title: 'Foundations/Design system qualification',
    tags: ['autodocs', 'design-system-test'],
    parameters: {
      layout: 'fullscreen',
      a11y: { test: 'error' },
      docs: {
        description: {
          component:
            'Deterministic open-state fixtures used by the Storybook Vitest projects in both Towk themes.'
        }
      }
    }
  });
</script>

<script lang="ts">
  let sheetVisible = $state(true);
  let comboboxValue = $state('');
  let comboboxText = $state('');
</script>

{#snippet menuItems()}
  <button type="button" role="menuitem" class="menu-item">
    <span class="iconify uil--reply" aria-hidden="true"></span>
    <span>Reply</span>
  </button>
  <button type="button" role="menuitem" class="menu-item">
    <span class="iconify uil--envelope-alt" aria-hidden="true"></span>
    <span>Mark unread</span>
  </button>
  <button type="button" role="menuitem" class="menu-item text-danger">
    <span class="iconify uil--trash-alt" aria-hidden="true"></span>
    <span>Delete</span>
  </button>
{/snippet}

<Story name="Open bottom sheet" asChild>
  <main class="min-h-screen bg-background p-6 text-text">
    <BottomSheet
      bind:visible={sheetVisible}
      ariaLabel="Notification settings"
      onclose={() => (sheetVisible = true)}
    >
      <div class="mx-auto flex max-w-lg flex-col gap-4">
        <div>
          <h1 class="text-xl font-semibold text-text-top">Notification settings</h1>
          <p class="mt-1 text-sm text-muted">
            The modal surface is open so its complete DOM, focus path, and contrast are audited.
          </p>
        </div>
        <Button fullWidth>Apply settings</Button>
      </div>
    </BottomSheet>
  </main>
</Story>

<Story name="Floating action menu" asChild>
  <main class="min-h-72 bg-background p-6 text-text">
    <ContextMenu
      presentation="floating"
      position={{ x: 64, y: 64 }}
      ariaLabel="Message actions"
      onclose={() => void 0}
    >
      {@render menuItems()}
    </ContextMenu>
  </main>
</Story>

<Story name="Touch action menu" asChild>
  <main class="min-h-screen bg-background p-6 text-text">
    <ContextMenu presentation="sheet" ariaLabel="Message actions" onclose={() => void 0}>
      {@render menuItems()}
    </ContextMenu>
  </main>
</Story>

<Story
  name="Open combobox"
  asChild
  play={async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: 'Default channel' }));
    await expect(canvas.getByRole('combobox', { name: 'Default channel' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(canvas.getByRole('listbox')).toBeVisible();
  }}
>
  <main class="min-h-96 bg-background p-6 text-text">
    <div class="max-w-md">
      <Combobox
        id="qualification-channel"
        label="Default channel"
        bind:value={comboboxValue}
        bind:text={comboboxText}
        items={channels}
        {getValue}
        {getLabel}
        allowFreeform={false}
        placeholder="Search channels"
        description="Choose one channel from the server-provided options."
      />
    </div>
  </main>
</Story>

<Story name="Empty result" asChild>
  <main class="flex min-h-96 flex-col bg-background p-6 text-text">
    <EmptyState icon="uil--search" title="No matching channels">
      Try a shorter query or clear the active filters.
    </EmptyState>
  </main>
</Story>
