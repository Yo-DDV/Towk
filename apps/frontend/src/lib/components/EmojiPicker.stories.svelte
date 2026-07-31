<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EmojiPicker from './EmojiPicker.svelte';

  const { Story } = defineMeta({
    title: 'Components/EmojiPicker',
    component: EmojiPicker,
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component: 'Responsive emoji browser used by message reactions and compact popovers.'
        }
      }
    }
  });

  const props = {
    serverId: 'storybook',
    onSelect: () => {},
    onClose: () => {}
  };
</script>

<Story name="Floating" asChild>
  <div class="min-h-screen bg-background p-4 text-text">
    <div class="menu w-fit">
      <EmojiPicker {...props} />
    </div>
  </div>
</Story>

<Story name="Sheet" asChild>
  <div class="bottom-sheet min-h-screen bg-background p-4 text-text">
    <EmojiPicker {...props} />
  </div>
</Story>
