<script lang="ts">
  import { useUnreadMarker, type UnreadMarkerWindow } from './useUnreadMarker.svelte';

  type ReadResult = {
    lastReadAt: string | null;
    previousLastReadAt: string | null;
  };

  type UnreadMarkerHarnessAPI = ReturnType<typeof useUnreadMarker<ReadResult>>;

  let {
    targetId,
    attentionEnabled = true,
    markAsRead,
    onReady
  }: {
    targetId: string;
    attentionEnabled?: boolean;
    markAsRead: (targetId: string, upToEventId?: string) => Promise<ReadResult | null>;
    onReady: (api: UnreadMarkerHarnessAPI) => void;
  } = $props();

  const unread = useUnreadMarker(() => targetId, {
    attentionEnabled: () => attentionEnabled,
    markAsRead: (target, upToEventId) => markAsRead(target, upToEventId),
    markerWindowFromReadResult: (result, markedAtMs): UnreadMarkerWindow | null => {
      if (!result.previousLastReadAt || !result.lastReadAt) return null;
      if (result.previousLastReadAt === result.lastReadAt) return null;
      return {
        afterTime: result.previousLastReadAt,
        beforeTime: markedAtMs
      };
    }
  });

  $effect(() => {
    onReady(unread);
  });
</script>
