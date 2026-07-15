<script lang="ts">
  import { onMount } from 'svelte';
  import { registerTowkServiceWorker } from '$lib/pwa/serviceWorkerRegistration';

  onMount(() => {
    if (document.readyState === 'complete') {
      void registerTowkServiceWorker();
      return;
    }

    const register = () => void registerTowkServiceWorker();
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  });
</script>
