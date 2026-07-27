<script lang="ts">
  let {
    user,
    canBanFromRoom = false,
    onBanFromRoom,
    onClose
  }: {
    user: {
      displayName: string;
    };
    canBanFromRoom?: boolean;
    onBanFromRoom?: () => void | Promise<void>;
    onClose?: () => void;
  } = $props();
</script>

<div role="dialog" aria-label="User profile" data-testid="room-sidebar-user-context-menu-mock">
  <span>{user.displayName}</span>
  {#if canBanFromRoom}
    <button type="button" onclick={onBanFromRoom}>Ban from room</button>
  {/if}
  <button type="button" onclick={onClose}>Close</button>
</div>
