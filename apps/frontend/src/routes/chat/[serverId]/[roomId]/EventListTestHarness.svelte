<script lang="ts">
  import { RoomEventKind } from '$lib/render/eventKinds';
  import type { RoomEventView } from '$lib/render/types';
  import type { RefreshCurrentWindowResult } from '$lib/state/room';
  import {
    createComposerContext,
    createRoomPermissions,
    DEFAULT_ROOM_PERMISSIONS
  } from '$lib/state/room';
  import { setUserSettings, UserSettingsState } from '$lib/state/userSettings.svelte';
  import EventList from './EventList.svelte';

  let {
    eventIds,
    roomId = 'room-1',
    renderedRoomId = roomId,
    scrollToEventId,
    onComplete,
    isLoading = false,
    isJumpedMode = false,
    onJumpToPresent,
    loadFailed = false,
    onRetryLoad,
    enablePagination = false,
    hasReachedStart = true,
    onLoadMore,
    updateCounter = 0,
    pendingHighlightId = null,
    isReconcilingCachedData = false,
    readReceiptsEnabled = true,
    attentionEnabled = true,
    eventActorId = 'test-user',
    refreshCurrentWindow = async () => ({
      hasOlder: false,
      hasNewer: false,
      refreshed: false,
      changed: false
    }),
    onSoftRefresh
  }: {
    eventIds: string[];
    roomId?: string;
    renderedRoomId?: string | null;
    scrollToEventId: string | null;
    onComplete?: () => void;
    isLoading?: boolean;
    isJumpedMode?: boolean;
    onJumpToPresent?: () => Promise<boolean>;
    loadFailed?: boolean;
    onRetryLoad?: () => Promise<unknown> | unknown;
    enablePagination?: boolean;
    hasReachedStart?: boolean;
    onLoadMore?: (options?: { silent?: boolean }) => Promise<void>;
    updateCounter?: number;
    pendingHighlightId?: string | null;
    isReconcilingCachedData?: boolean;
    readReceiptsEnabled?: boolean;
    attentionEnabled?: boolean;
    eventActorId?: string;
    refreshCurrentWindow?: (anchorEventId?: string | null) => Promise<RefreshCurrentWindowResult>;
    onSoftRefresh?: (result: RefreshCurrentWindowResult, anchored: boolean) => void;
  } = $props();

  createComposerContext({ scroll: true });
  createRoomPermissions(() => DEFAULT_ROOM_PERMISSIONS);
  const userSettings = new UserSettingsState();
  setUserSettings(userSettings);

  $effect(() => {
    userSettings.readReceiptsEnabled = readReceiptsEnabled;
  });

  const events = $derived(
    eventIds.map((id): RoomEventView => ({
      id,
      createdAt: '2026-06-17T10:47:00Z',
      actorId: eventActorId,
      actor: null,
      event: {
        kind: RoomEventKind.MessagePosted,
        roomId: renderedRoomId ?? roomId,
        body: id,
        attachments: [],
        linkPreview: null,
        reactions: [],
        updatedAt: null,
        inReplyTo: null,
        threadRootEventId: null,
        echoOfEventId: null,
        echoFromThreadRootEventId: null,
        channelEchoEventId: null,
        replyCount: 0,
        lastReplyAt: null,
        threadParticipants: [],
        viewerIsFollowingThread: true
      }
    }))
  );

  const messageStore = {
    refreshCurrentWindow: (anchorEventId?: string | null) => refreshCurrentWindow(anchorEventId)
  };
</script>

<EventList
  {roomId}
  {renderedRoomId}
  {isReconcilingCachedData}
  messageStore={messageStore as never}
  {events}
  {isLoading}
  {loadFailed}
  {onRetryLoad}
  {enablePagination}
  {hasReachedStart}
  {onLoadMore}
  {isJumpedMode}
  {onJumpToPresent}
  {updateCounter}
  {pendingHighlightId}
  {attentionEnabled}
  {onSoftRefresh}
  {scrollToEventId}
  onScrollToEventComplete={onComplete}
/>
