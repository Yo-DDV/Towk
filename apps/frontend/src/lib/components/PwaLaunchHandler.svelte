<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { registerPwaLaunchHandler } from '$lib/pwa/launchHandler';
  import { storeIncomingShare } from '$lib/pwa/shareInbox';

  onMount(() => {
    registerPwaLaunchHandler((path) => goto(resolve(path as '/')), {
      importFiles: async (files) => {
        try {
          const shareId = await storeIncomingShare({ title: '', text: '', url: '', files });
          return `/chat/share-target?shareId=${encodeURIComponent(shareId)}`;
        } catch {
          return '/chat/share-target?error=invalid';
        }
      }
    });
  });
</script>
