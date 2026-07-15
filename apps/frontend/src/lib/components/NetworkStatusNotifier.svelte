<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { toast } from '$lib/ui/toast';

  onMount(() => {
    let offlineToastId: string | null = null;

    const handleOffline = () => {
      if (window.location.pathname === '/login') return;
      if (offlineToastId) return;
      offlineToastId = toast.warning(m['ui.network.offline'](), 0);
    };

    const handleOnline = () => {
      if (!offlineToastId) return;
      toast.remove(offlineToastId);
      offlineToastId = null;
      toast.success(m['ui.network.reconnecting']());
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (offlineToastId) toast.remove(offlineToastId);
    };
  });
</script>
