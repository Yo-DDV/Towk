<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import RoomPrimarySurfaceTabsStoryHarness from './RoomPrimarySurfaceTabsStoryHarness.svelte';

  const { Story } = defineMeta({
    title: 'Chat/Room primary surface tabs',
    component: RoomPrimarySurfaceTabsStoryHarness,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Container-responsive room view switcher with compact touch controls and expanded desktop labels.'
        }
      }
    }
  });
</script>

<Story name="Phone pane" asChild>
  <RoomPrimarySurfaceTabsStoryHarness width={390} />
</Story>

<Story name="Constrained Fold pane" asChild>
  <RoomPrimarySurfaceTabsStoryHarness width={620} hasActiveCall={true} />
</Story>

<Story name="Wide desktop pane" asChild>
  <RoomPrimarySurfaceTabsStoryHarness width={800} hasActiveCall={true} />
</Story>
