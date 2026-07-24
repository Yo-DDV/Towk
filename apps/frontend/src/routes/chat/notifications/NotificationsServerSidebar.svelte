<script lang="ts">
  import { resolve } from '$app/paths';
  import { serverIdToSegment } from '$lib/navigation';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import RoomList from '$lib/RoomList.svelte';
  import ServerSidebar from '$lib/components/ServerSidebar.svelte';
  import MyThreadsNavItem from '$lib/components/chat/MyThreadsNavItem.svelte';
  import ServerBanner from '$lib/components/chat/ServerBanner.svelte';
  import ServerEventProvider from '$lib/components/chat/ServerEventProvider.svelte';
  import ServerHeader from '$lib/components/chat/ServerHeader.svelte';
  import ScrollFader from '$lib/ui/ScrollFader.svelte';
  import * as m from '$lib/i18n/messages';

  const serverId = $derived(getActiveServer());
  const serverSegment = $derived(serverIdToSegment(serverId));
  const serverInfo = $derived(serverRegistry.getStore(serverId).serverInfo);
</script>

<ServerEventProvider>
  <ServerSidebar synchronizedMobileLifecycle>
    <ServerHeader serverName={serverInfo.name} loading={serverInfo.loading} />

    <ScrollFader top bottom>
      {#if serverInfo.bannerUrl}
        <ServerBanner url={serverInfo.bannerUrl} />
      {/if}

      <nav class="sidebar-nav p-2">
        <a
          href={resolve('/chat/[serverId]/overview', { serverId: serverSegment })}
          class="sidebar-item"
        >
          <span class="sidebar-icon iconify uil--estate"></span>
          {m['chat.overview.title']()}
        </a>
        <MyThreadsNavItem active={false} />
      </nav>

      <hr class="border-border" />

      <RoomList />
    </ScrollFader>
  </ServerSidebar>
</ServerEventProvider>
