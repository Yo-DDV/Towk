<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MediaCaptureDialog from './MediaCaptureDialog.svelte';

  const { Story } = defineMeta({
    title: 'Composer/Media Capture Dialog',
    component: MediaCaptureDialog
  });
</script>

<Story
  name="Immersive glass capture"
  args={{
    onCaptured: async () => undefined,
    onClose: () => undefined
  }}
/>
