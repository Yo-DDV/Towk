<script lang="ts">
  import { fullscreenVideo } from '$lib/state/globals.svelte';
  import { callFullscreenMedia } from '$lib/state/callFullscreenMedia.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { UserSettingsState, setUserSettings } from '$lib/state/userSettings.svelte';

  let { data, children } = $props();
  let authenticatedRootModule: Promise<typeof import('./AuthenticatedRoot.svelte')> | null = null;
  let fullscreenVideoOverlayModule: Promise<
    typeof import('$lib/components/chat/FullscreenVideoOverlay.svelte')
  > | null = null;
  let callFullscreenMediaOverlayModule: Promise<
    typeof import('$lib/components/voice/CallFullscreenMediaOverlay.svelte')
  > | null = null;

  function loadAuthenticatedRoot() {
    authenticatedRootModule ??= import('./AuthenticatedRoot.svelte');
    return authenticatedRootModule;
  }

  function loadFullscreenVideoOverlay() {
    fullscreenVideoOverlayModule ??= import('$lib/components/chat/FullscreenVideoOverlay.svelte');
    return fullscreenVideoOverlayModule;
  }

  function loadCallFullscreenMediaOverlay() {
    callFullscreenMediaOverlayModule ??= import(
      '$lib/components/voice/CallFullscreenMediaOverlay.svelte'
    );
    return callFullscreenMediaOverlayModule;
  }

  const userSettings = new UserSettingsState();
  setUserSettings(userSettings);
</script>

{#if data.user && serverRegistry.originServer}
  {#key data.user.id}
    {#await loadAuthenticatedRoot() then { default: AuthenticatedRoot }}
      <AuthenticatedRoot user={data.user} {userSettings}>
        {@render children?.()}
      </AuthenticatedRoot>
    {/await}
  {/key}
{:else}
  {@render children?.()}
{/if}

{#if fullscreenVideo.isOpen}
  {#await loadFullscreenVideoOverlay() then { default: FullscreenVideoOverlay }}
    <FullscreenVideoOverlay />
  {/await}
{/if}

{#if callFullscreenMedia.isOpen}
  {#await loadCallFullscreenMediaOverlay() then { default: CallFullscreenMediaOverlay }}
    <CallFullscreenMediaOverlay />
  {/await}
{/if}
