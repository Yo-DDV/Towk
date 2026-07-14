<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { registerPwaLaunchHandler } from '$lib/pwa/launchHandler';

  onMount(() => {
    registerPwaLaunchHandler((path) => goto(resolve(path as '/')));
  });
</script>
