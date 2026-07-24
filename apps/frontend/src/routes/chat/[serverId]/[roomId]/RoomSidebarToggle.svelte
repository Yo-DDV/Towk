<!--
@component

Room header affordance for opening or hiding room extras panels.

**Props:**
- `activePanel` - Currently visible room sidebar panel, or `null` when hidden.
- `panels` - Panel buttons to show. Defaults to every room sidebar panel.
- `onToggle` - Called with the panel requested by the user.
- `mode` - Responsive visibility for the toggle group.
- `canDeleteDirectMessage` - Shows the private DM deletion action.
- `onDeleteDirectMessage` - Opens the caller-owned confirmation flow.
-->
<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import type { RoomSidebarPanel } from './RoomSidebar.svelte';

  let {
    activePanel,
    panels,
    onToggle,
    mode = 'desktop',
    hasActiveCall = false,
    canDeleteDirectMessage = false,
    onDeleteDirectMessage
  }: {
    activePanel: RoomSidebarPanel | null;
    panels?: RoomSidebarPanel[];
    onToggle: (panel: RoomSidebarPanel) => void;
    mode?: 'desktop' | 'mobile' | 'always';
    hasActiveCall?: boolean;
    canDeleteDirectMessage?: boolean;
    onDeleteDirectMessage?: () => void;
  } = $props();

  const panelDefinitions: {
    id: RoomSidebarPanel;
    icon: string;
    showLabel: () => string;
    hideLabel: () => string;
  }[] = [
    {
      id: 'members',
      icon: 'uil--users-alt',
      showLabel: m['room.sidebar.show_members'],
      hideLabel: m['room.sidebar.hide_members']
    },
    {
      id: 'files',
      icon: 'uil--paperclip',
      showLabel: m['room.sidebar.show_files'],
      hideLabel: m['room.sidebar.hide_files']
    },
    {
      id: 'call',
      icon: 'uil--phone',
      showLabel: m['room.sidebar.show_call'],
      hideLabel: m['room.sidebar.hide_call']
    }
  ];

  const visiblePanels = $derived(
    panels ? panelDefinitions.filter((panel) => panels.includes(panel.id)) : panelDefinitions
  );

  let actionsMenuPosition = $state<{
    x: number;
    y: number;
    alignRight: boolean;
  } | null>(null);

  function openActionsMenu(event: MouseEvent) {
    if (actionsMenuPosition) {
      actionsMenuPosition = null;
      return;
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    actionsMenuPosition = {
      x: rect.right,
      y: rect.bottom + 4,
      alignRight: true
    };
  }

  function handleDeleteDirectMessage() {
    actionsMenuPosition = null;
    onDeleteDirectMessage?.();
  }

  const visibilityClass = $derived.by(() => {
    switch (mode) {
      case 'mobile':
        return 'inline-flex lg:hidden';
      case 'always':
        return 'inline-flex';
      case 'desktop':
        return 'hidden lg:inline-flex';
    }
  });
</script>

<span
  class={['group/badges items-center gap-1', visibilityClass]}
  data-testid="room-sidebar-toggle"
>
  {#each visiblePanels as panel (panel.id)}
    {@const isActive = activePanel === panel.id}
    {@const label = isActive ? panel.hideLabel() : panel.showLabel()}
    {@const isActiveCallPanel = panel.id === 'call' && hasActiveCall}
    {@const shouldPulseCallIcon = isActiveCallPanel && !isActive}
    <button
      type="button"
      class={[
        'group/pane-header-icon-button pane-header-icon-button',
        isActive && 'pane-header-icon-button-active',
        isActiveCallPanel && 'text-accent'
      ]}
      onclick={() => onToggle(panel.id)}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
    >
      <span class="relative inline-flex">
        {#if shouldPulseCallIcon}
          <span
            class={['absolute inset-0 pane-header-icon-glyph animate-ping opacity-45', panel.icon]}
            aria-hidden="true"
            data-testid="active-call-pulse-icon"
          ></span>
        {/if}
        <span
          class={[
            'relative pane-header-icon-glyph',
            panel.icon,
            isActiveCallPanel && 'text-accent'
          ]}
          aria-hidden="true"
        ></span>
      </span>
    </button>
  {/each}
  {#if canDeleteDirectMessage && onDeleteDirectMessage}
    <span class="ml-1 border-l border-border pl-1">
      <button
        type="button"
        class={[
          'group/pane-header-icon-button pane-header-icon-button',
          actionsMenuPosition && 'pane-header-icon-button-active'
        ]}
        onclick={openActionsMenu}
        title={m['room.direct_message_delete.more_actions']()}
        aria-label={m['room.direct_message_delete.more_actions']()}
        aria-haspopup="menu"
        aria-expanded={Boolean(actionsMenuPosition)}
        data-testid="direct-message-actions-button"
      >
        <span class="pane-header-icon-glyph uil--ellipsis-v" aria-hidden="true"></span>
      </button>
    </span>
  {/if}
</span>

{#if actionsMenuPosition}
  <ContextMenu
    position={actionsMenuPosition}
    ariaLabel={m['room.direct_message_delete.more_actions']()}
    class="w-72 max-w-[calc(100vw-1rem)]"
    onclose={() => (actionsMenuPosition = null)}
  >
    <div class="menu-section p-1.5">
      <div class="px-2.5 pt-1.5 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {m['room.direct_message_delete.more_actions']()}
      </div>
      <nav class="sidebar-nav">
        <button
          type="button"
          class="group/delete sidebar-item min-h-14 items-start gap-3 px-2.5 py-2.5 text-left text-danger hover:text-danger"
          onclick={handleDeleteDirectMessage}
          role="menuitem"
          data-testid="delete-direct-message-button"
        >
          <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/10 transition-colors group-hover/delete:bg-danger/15"
            aria-hidden="true"
          >
            <span class="iconify text-lg uil--trash-alt"></span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{m['room.direct_message_delete.action']()}</span>
            <span class="mt-0.5 block text-xs leading-4 text-muted">
              {m['room.direct_message_delete.menu_description']()}
            </span>
          </span>
        </button>
      </nav>
    </div>
  </ContextMenu>
{/if}
