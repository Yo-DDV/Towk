<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Button } from '$lib/ui/form';
  import EmptyState from './EmptyState.svelte';

  const componentDescription = `
    Use EmptyState when a panel or list has no actionable content yet, a search has no results, or
    one available action can resolve the absence. Loading and error states need dedicated feedback.
  `.trim();

  const { Story } = defineMeta({
    title: 'UI/EmptyState',
    component: EmptyState,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: { component: componentDescription }
      }
    }
  });
</script>

<Story name="Default" asChild>
  <div class="flex h-96 flex-col">
    <EmptyState icon="uil--bell-slash" title="No notifications">You're all caught up!</EmptyState>
  </div>
</Story>

<Story name="Icon only" asChild>
  <div class="flex h-96 flex-col">
    <EmptyState icon="uil--message">Select a room from the sidebar to start chatting.</EmptyState>
  </div>
</Story>

<Story name="Title only" asChild>
  <div class="flex h-96 flex-col">
    <EmptyState title="Nothing here yet">Create your first room to get started.</EmptyState>
  </div>
</Story>

<Story
  name="No search results"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'No-result copy explains the active filter and preserves a clear route back to the full collection.'
      }
    }
  }}
>
  <div class="flex min-h-80 flex-col rounded-xl border border-border bg-background text-text">
    <EmptyState icon="uil--search" title="No matching channels">
      Try a shorter query or clear the active filters.
    </EmptyState>
  </div>
</Story>

<Story
  name="With primary action"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Add one primary action only when the current user can immediately resolve the empty state.'
      }
    }
  }}
>
  <div class="flex min-h-80 flex-col rounded-xl border border-border bg-background text-text">
    <EmptyState icon="uil--users-alt" title="No members in this section">
      <div class="flex flex-col items-center gap-4">
        <p>Invite someone or adjust the role filter to continue.</p>
        <Button>Invite a member</Button>
      </div>
    </EmptyState>
  </div>
</Story>

<Story
  name="Long localized copy"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Long translated labels must wrap without clipping the icon, body, or available action.'
      }
    }
  }}
>
  <div class="flex min-h-80 max-w-sm flex-col rounded-xl border border-border bg-background text-text">
    <EmptyState icon="uil--folder-open" title="Keine freigegebenen Dateien in diesem Kanal">
      Sobald Mitglieder Dateien hochladen oder vorhandene Inhalte freigeben, werden sie in diesem
      Bereich angezeigt.
    </EmptyState>
  </div>
</Story>
