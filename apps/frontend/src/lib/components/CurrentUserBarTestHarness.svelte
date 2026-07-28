<!--
@component

Test-only wrapper for `CurrentUserBar`. Creates the presence-cache context
before the bar mounts so specs can exercise first-login presence fallbacks.
-->
<script lang="ts">
  import { PresenceStatus } from '$lib/render/types';
  import { createPresenceCache } from '$lib/state/presenceCache.svelte';
  import { provideAppUiState } from '$lib/state/appUi.svelte';
  import { provideCallJoinController } from '$lib/state/callJoinController.svelte';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import GlobalCallDock from './voice/GlobalCallDock.svelte';
  import CurrentUserBar from './CurrentUserBar.svelte';

  let { cachedPresence = PresenceStatus.Online }: { cachedPresence?: PresenceStatus } = $props();

  const presenceCache = createPresenceCache();
  const appUi = provideAppUiState();
  provideCallJoinController(appUi);
  // svelte-ignore state_referenced_locally
  presenceCache.update({ serverId: 'origin', userId: 'user-1' }, cachedPresence);
</script>

{#if !sidebarNav.isOpen}
  <div class="mobile-navigation-swipe-region">
    <GlobalCallDock variant="floating" />
  </div>
{/if}
<CurrentUserBar />
