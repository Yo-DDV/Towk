<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Virtualizer, type VirtualizerHandle } from 'virtua/svelte';
  import * as m from '$lib/i18n/messages';
  import { getLocale } from '$lib/i18n/runtime';
  import type { RoomEventView } from '$lib/render/types';
  import { isMessagePostedEvent } from '$lib/render/eventKinds';
  import type { MessagesStore, RefreshCurrentWindowResult, RoomMember } from '$lib/state/room';
  import { getComposerContext, getRoomPermissions } from '$lib/state/room';
  import RoomEvent from './RoomEvent.svelte';
  import SystemEventGroup from './SystemEventGroup.svelte';
  import DaySeparator from './DaySeparator.svelte';
  import UnreadSeparator from './UnreadSeparator.svelte';
  import TypingIndicator from './TypingIndicator.svelte';
  import { computeEventMetadata } from './messageGrouping';
  import { buildVirtualItems, type VirtualItem } from './virtualItems';
  import { findLastEditableMessage } from './lastEditableMessage';
  import ScrollFader from '$lib/ui/ScrollFader.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { getUserSettings } from '$lib/state/userSettings.svelte';
  import { INITIAL_ROOM_MESSAGE_BACKFILL_TARGET } from '$lib/state/room/messages/queries';
  import { formatDayLabel } from '$lib/utils/formatTime';
  import { useTabResumeCallback } from '$lib/hooks/useTabResumeCallback.svelte';
  import { delayedLoadingVisible, MOTION_DURATION, motionDuration } from '$lib/ui/motion.svelte';
  import { useMayHaveMissedMessagesCallback } from '$lib/hooks/useMayHaveMissedMessagesCallback.svelte';
  import type { ResumeSignal } from '$lib/hooks/resumeCoordinator.svelte';
  import type { OpenThreadHandler, ThreadOpenOptions } from './threadOpenOptions';
  import { convergeAtBottom } from './bottomScrollConvergence';
  import {
    scheduleNextTombstoneExpiry,
    shouldHideTombstone,
    visibleTombstoneEvents,
    visibleUnreadMarkerEventId
  } from './tombstoneVisibility';

  let {
    roomId,
    renderedRoomId = roomId,
    messageStore,
    events,
    // Scroll behavior
    alwaysScrollToBottom = false,
    showNewMessagesIndicator = true,
    // Pagination
    enablePagination = false,
    isLoadingMore = false,
    hasReachedStart = false,
    showStartMarker = true,
    onLoadMore,
    // Event updates
    updateCounter = 0,
    // Threading - only root messages can open threads
    onOpenThread,
    // Filtering - whether to filter out thread replies (false for thread pane)
    filterThreadReplies = true,
    // Up-arrow-to-edit
    enableLastEditableFinder = false,
    // Loading states
    isLoading = false,
    loadFailed = false,
    onRetryLoad,
    emptyMessage = m['room.message.empty'](),
    // Event ID of the first unread message (for showing the unread separator)
    unreadAfterEventId = null,
    // Typing indicator
    typingUserIds = [],
    typingMembers = [],
    // Jump to message
    scrollToEventId = null,
    onScrollToEventComplete,
    isJumpedMode = false,
    isLoadingNewer = false,
    hasReachedEnd = false,
    onLoadNewer,
    onJumpToPresent,
    onReachedPresent,
    onReachedBottom,
    onSoftRefresh,
    pendingHighlightId = null
  }: {
    roomId: string;
    renderedRoomId?: string | null;
    messageStore: MessagesStore;
    events: RoomEventView[];
    // Scroll behavior
    alwaysScrollToBottom?: boolean;
    showNewMessagesIndicator?: boolean;
    // Pagination
    enablePagination?: boolean;
    isLoadingMore?: boolean;
    hasReachedStart?: boolean;
    showStartMarker?: boolean;
    onLoadMore?: (options?: { silent?: boolean }) => Promise<void>;
    // Event updates
    updateCounter?: number;
    // Threading
    onOpenThread?: OpenThreadHandler;
    // Filtering
    filterThreadReplies?: boolean;
    // Up-arrow-to-edit
    enableLastEditableFinder?: boolean;
    // Loading states
    isLoading?: boolean;
    loadFailed?: boolean;
    onRetryLoad?: () => Promise<unknown> | unknown;
    emptyMessage?: string;
    // Event ID of the first unread message (for showing the unread separator)
    unreadAfterEventId?: string | null;
    // Typing indicator
    typingUserIds?: string[];
    typingMembers?: RoomMember[];
    // Jump to message
    scrollToEventId?: string | null;
    onScrollToEventComplete?: (landed: boolean) => void;
    isJumpedMode?: boolean;
    isLoadingNewer?: boolean;
    hasReachedEnd?: boolean;
    onLoadNewer?: () => Promise<void>;
    onJumpToPresent?: () => Promise<boolean>;
    onReachedPresent?: () => void;
    onReachedBottom?: () => void;
    onSoftRefresh?: (result: RefreshCurrentWindowResult, anchored: boolean) => void;
    // Suppress auto-scroll while a highlight is pending (used by ThreadPane)
    pendingHighlightId?: string | null;
  } = $props();

  type RefreshAnchor = {
    eventId: string;
    top: number;
  };

  let initialScrollDone = $state(false);
  const showDelayedLoading = delayedLoadingVisible(() => isLoading && virtualItems.length === 0);
  const showRoomSwitchLoading = delayedLoadingVisible(
    () => renderedTimelineRoomId !== roomId,
    MOTION_DURATION.fast
  );
  let bottomScrollOperation = 0;
  let userScrollIntentAt = 0;
  const USER_SCROLL_INTENT_MS = 250;
  let settledRoomId = $state<string | null>(null);
  let roomRevealActive = $state(false);
  let roomRevealTimer: ReturnType<typeof setTimeout> | null = null;
  let roomTransitionMaskActive = $state(false);
  let roomTransitionMaskOperation = 0;
  const ROOM_SWITCH_STABLE_FRAMES = 6;
  const ROOM_SWITCH_MAX_SETTLE_FRAMES = 48;

  // State for smart scroll behavior (when not alwaysScrollToBottom)
  let shouldScrollToBottom = $state(true);
  let hasNewMessages = $state(false);
  let lastSeenNewestId = $state<string | null>(null);
  let firstVisibleAt = $state<string | null>(null);

  function setShouldScrollToBottom(value: boolean) {
    shouldScrollToBottom = value;
    if (value) {
      hasNewMessages = false;
      firstVisibleAt = null;
    }
  }

  // Track previous scroll offset for direction detection
  let previousOffset = $state<number | null>(null);

  // Get composer context (scrollState may be null - ThreadPane doesn't provide it)
  const composerContext = getComposerContext();
  const scrollState = composerContext.scrollState;
  const userSettings = getUserSettings();
  const activeLocale = $derived(getLocale());
  const firstVisibleDate = $derived(
    firstVisibleAt ? formatDayLabel(firstVisibleAt, userSettings, activeLocale) : null
  );

  // First apply structural timeline filtering. Tombstone expiry is a separate
  // stage so row removal cannot be mistaken for a newly arrived message.
  let timelineEvents = $derived(
    events.filter((e) => {
      if (!isMessagePostedEvent(e.event)) return true;

      const msg = e.event;

      // Filter out thread replies when enabled (main room view)
      // In thread pane, filterThreadReplies=false to show all messages
      if (filterThreadReplies && msg?.threadRootEventId != null) return false;

      return true;
    })
  );
  let tombstoneClockVersion = $state(0);
  let filteredEvents = $derived.by(() => {
    void tombstoneClockVersion;
    const nowMs = Date.now();
    return visibleTombstoneEvents(timelineEvents, nowMs);
  });
  let messageEventCount = $derived(
    filteredEvents.filter((event) => isMessagePostedEvent(event.event)).length
  );
  const renderedTimelineRoomId = $derived(renderedRoomId ?? roomId);
  const isCurrentRoomWindowRendered = $derived(renderedTimelineRoomId === roomId);
  const isRoomSwitching = $derived(!isCurrentRoomWindowRendered);
  const showTimelineTransitionMask = $derived(isRoomSwitching || roomTransitionMaskActive);

  function startRoomReveal() {
    if (roomRevealTimer) {
      clearTimeout(roomRevealTimer);
      roomRevealTimer = null;
    }
    roomRevealActive = false;
    if (motionDuration(MOTION_DURATION.expressive) === 0) return;

    requestAnimationFrame(() => {
      roomRevealActive = true;
      roomRevealTimer = setTimeout(() => {
        roomRevealActive = false;
        roomRevealTimer = null;
      }, motionDuration(MOTION_DURATION.expressive) + 40);
    });
  }

  async function waitForAnimationFrame() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function timelineVisualSignature() {
    if (!scrollContainer || !virtualizerHandle) return null;

    const renderedEventIds = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('[data-event-id]')
    ).map((node) => node.dataset.eventId ?? '');
    const skeletonCount = scrollContainer.querySelectorAll('.skeleton').length;

    return [
      renderedEventIds.join('|'),
      skeletonCount,
      virtualizerHandle.getScrollSize(),
      virtualizerHandle.getViewportSize(),
      virtualizerHandle.getScrollOffset()
    ].join(':');
  }

  function visibleTimelineMediaIsPending(): boolean {
    if (!scrollContainer) return false;

    const containerRect = scrollContainer.getBoundingClientRect();
    const isVisibleInsideTimeline = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > containerRect.top &&
        rect.top < containerRect.bottom
      );
    };

    for (const image of scrollContainer.querySelectorAll<HTMLImageElement>('img')) {
      if (!isVisibleInsideTimeline(image)) continue;
      if (!image.complete || image.naturalWidth <= 0 || image.classList.contains('skeleton')) {
        return true;
      }
    }

    for (const video of scrollContainer.querySelectorAll<HTMLVideoElement>('video')) {
      if (!isVisibleInsideTimeline(video)) continue;
      if (video.poster) continue;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return true;
    }

    return false;
  }

  async function waitForStableTimelineWindow(operation: number) {
    let previousSignature: string | null = null;
    let stableFrames = 0;

    for (
      let frame = 0;
      frame < ROOM_SWITCH_MAX_SETTLE_FRAMES &&
      (stableFrames < ROOM_SWITCH_STABLE_FRAMES || visibleTimelineMediaIsPending());
      frame++
    ) {
      await tick();
      await waitForAnimationFrame();

      if (operation !== roomTransitionMaskOperation || !isCurrentRoomWindowRendered) return false;

      const signature = timelineVisualSignature();
      if (signature === previousSignature && signature !== null) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        previousSignature = signature;
      }
    }

    return stableFrames >= ROOM_SWITCH_STABLE_FRAMES;
  }

  async function settleRoomTransitionMask(operation: number) {
    await tick();
    await waitForAnimationFrame();

    if (operation !== roomTransitionMaskOperation || !isCurrentRoomWindowRendered) return;

    if (!isJumpedMode && !pendingHighlightId && virtualItems.length > 0) {
      await requestBottomScroll()?.catch(() => undefined);
    }

    // Keep the mask up while Virtua publishes measurements and media previews
    // swap from placeholder to decoded content. Those changes are correct, but
    // exposing an intermediate visible window creates the perceived room-switch
    // flicker on media-heavy channels.
    await waitForStableTimelineWindow(operation);

    if (operation !== roomTransitionMaskOperation || !isCurrentRoomWindowRendered) return;
    roomTransitionMaskActive = false;
    startRoomReveal();
  }

  // Apply message grouping and day separators
  let eventsWithMeta = $derived(computeEventMetadata(filteredEvents, userSettings, activeLocale));

  // If the marker points at an expired tombstone, move it to the next visible
  // event instead of silently dropping the unread boundary.
  let effectiveUnreadAfterEventId = $derived.by(() => {
    return visibleUnreadMarkerEventId(timelineEvents, filteredEvents, unreadAfterEventId ?? null);
  });

  // Build flat array for the virtualizer (events + interleaved separators)
  let virtualItems = $derived(
    buildVirtualItems(eventsWithMeta, effectiveUnreadAfterEventId, hasReachedStart, showStartMarker)
  );
  const hasRoomSwitchCarryOver = $derived(isRoomSwitching && virtualItems.length > 0);

  async function expireTombstones(atMs: number) {
    const bottomDistance = distanceFromBottom();
    const wasAtBottom =
      alwaysScrollToBottom ||
      (bottomDistance === null ? shouldScrollToBottom : bottomDistance < 50);
    const anchor = wasAtBottom ? null : captureRefreshAnchor(atMs);

    tombstoneClockVersion += 1;
    await tick();

    if (wasAtBottom && scrollContainer) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      scrollFader?.refresh();
      return;
    }
    if (!anchor || !scrollContainer) return;

    // Virtua can measure and correct the keyed list over several frames. Keep
    // restoring the same event anchor while those measurements settle.
    for (let frame = 0; frame < 4; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const target = scrollContainer.querySelector<HTMLElement>(eventSelector(anchor.eventId));
      if (!target) return;
      scrollContainer.scrollTop += target.getBoundingClientRect().top - anchor.top;
    }
    scrollFader?.refresh();
  }

  $effect(() => {
    void tombstoneClockVersion;
    const nowMs = Date.now();
    return scheduleNextTombstoneExpiry(timelineEvents, nowMs, (expiresAt) => {
      void expireTombstones(expiresAt);
    });
  });

  // Register finder for up-arrow-to-edit (computed on-demand, not reactively)
  const lastEditableMessageCtx = composerContext.lastEditableMessage;
  const stores = serverRegistry.getStore(getActiveServer());
  const currentUser = $derived(stores.currentUser);
  const serverInfo = stores.serverInfo;
  const roomPermissions = $derived(getRoomPermissions());

  $effect(() => {
    if (!enableLastEditableFinder) return;

    lastEditableMessageCtx?.setFinder(() => {
      return findLastEditableMessage({
        events: filteredEvents,
        currentUserId: currentUser.user?.id,
        roomPermissions,
        messageEditWindowSeconds: serverInfo.messageEditWindowSeconds,
        nowMs: Date.now()
      });
    });
  });

  // Reset scroll state only when the rendered timeline window has actually
  // caught up to the route room. During fast room switches the store may keep
  // the previous room's window as carry-over until the target room is ready;
  // resetting the virtualizer against that carry-over creates the visible
  // empty/black flicker on media-heavy rooms.
  $effect(() => {
    if (!isCurrentRoomWindowRendered) {
      roomTransitionMaskOperation += 1;
      roomTransitionMaskActive = true;
      return;
    }
    if (settledRoomId === roomId) return;

    cancelBottomScroll();
    initialScrollDone = false;
    setShouldScrollToBottom(true);
    lastSeenNewestId = null;
    firstVisibleAt = null;
    previousOffset = null;
    const isFirstRoom = settledRoomId === null;
    settledRoomId = roomId;
    if (isFirstRoom) {
      roomTransitionMaskActive = false;
      return;
    }

    const operation = ++roomTransitionMaskOperation;
    roomTransitionMaskActive = true;
    void settleRoomTransitionMask(operation);
  });

  // When exiting jumped mode (returning to present), re-enable auto-scroll
  // so the latest messages are visible at the bottom.
  let prevJumpedMode: boolean | undefined;
  $effect(() => {
    if (prevJumpedMode && !isJumpedMode) {
      setShouldScrollToBottom(true);
    }
    prevJumpedMode = isJumpedMode;
  });

  // Track new messages arriving while scrolled up (only when indicator is enabled).
  // Compares the newest event's ID rather than the count, so that loading older
  // messages via pagination (which prepends to the array) doesn't falsely trigger.
  $effect(() => {
    if (!showNewMessagesIndicator || alwaysScrollToBottom) return;
    if (timelineEvents.length === 0) return;
    const newestId = timelineEvents[timelineEvents.length - 1].id;

    if (lastSeenNewestId !== null && newestId !== lastSeenNewestId && !shouldScrollToBottom) {
      hasNewMessages = true;
    }

    lastSeenNewestId = newestId;
  });

  // Watch for scroll-to-bottom requests from MessageComposer (after posting a message).
  // Clears scrollUpLock since posting a message is explicit user intent to see the bottom.
  // Uses scrollContainer.scrollTop instead of scrollToIndex because the user may have
  // been scrolled up — unmeasured items at the bottom have only estimated heights,
  // causing scrollToIndex to undershoot.
  $effect(() => {
    if (!scrollState || alwaysScrollToBottom) return;
    const counter = scrollState.scrollRequestCounter;
    if (counter > 0) {
      setShouldScrollToBottom(true);
      scrollUpLock = false;
      if (scrollUpLockTimer) {
        clearTimeout(scrollUpLockTimer);
        scrollUpLockTimer = null;
      }
      tick().then(() => {
        if (scrollContainer && shouldScrollToBottom) {
          void requestBottomScroll();
        }
      });
    }
  });

  // Scroll to a specific event by ID (for jump-to-message)
  let scrollAttemptId = 0;
  $effect(() => {
    const attemptId = ++scrollAttemptId;
    const targetId = scrollToEventId;
    if (!targetId || !virtualizerHandle || virtualItems.length === 0) return;
    const targetEventId = targetId;

    // Disable auto-scroll so it doesn't race with the jump scroll.
    setShouldScrollToBottom(false);
    // Mark initial scroll as done so pending initial loading state cannot obscure the jump.
    initialScrollDone = true;

    // After a cache replacement, virtua can need several frames before the
    // target item is indexed, measured, and mounted. Retry the full lookup +
    // scroll path instead of giving up before the target is renderable.
    tick().then(() => {
      let attempts = 0;
      const maxAttempts = 60;
      let completed = false;

      function complete(landed: boolean) {
        if (completed || scrollAttemptId !== attemptId) return;
        if (!landed) {
          completed = true;
          onScrollToEventComplete?.(false);
          return;
        }

        // Check after the successful target scroll has settled. Starting this
        // timer before the virtual row mounts can re-enable bottom scrolling
        // based on the previous window's offset.
        setTimeout(() => {
          if (completed || !virtualizerHandle || scrollAttemptId !== attemptId) return;
          const dist =
            virtualizerHandle.getScrollSize() -
            virtualizerHandle.getScrollOffset() -
            virtualizerHandle.getViewportSize();
          if (dist < 50) setShouldScrollToBottom(true);
          completed = true;
          onScrollToEventComplete?.(true);
        }, 200);
      }

      function tryScrollAndHighlight() {
        if (scrollAttemptId !== attemptId) return;

        const targetIdx = virtualItems.findIndex(
          (item) => item.type === 'event' && item.event.id === targetEventId
        );
        if (targetIdx !== -1) {
          safeScrollToIndex(targetIdx, { align: 'center' });
        }

        // Scope to this EventList's scroll container so the thread pane
        // highlights within the thread, not in the main room view.
        const scope = scrollContainer ?? document;
        const target = scope.querySelector(eventSelector(targetEventId));
        if (target instanceof HTMLElement) {
          target.classList.add('highlight-flash');
          const cleanupHighlight = () => target.classList.remove('highlight-flash');
          target.addEventListener('animationend', cleanupHighlight, { once: true });
          target.addEventListener('animationcancel', cleanupHighlight, { once: true });
          setTimeout(cleanupHighlight, motionDuration(1500) + 80);
          complete(true);
          return;
        }

        if (attempts >= maxAttempts) {
          complete(false);
          return;
        }
        attempts++;
        requestAnimationFrame(tryScrollAndHighlight);
      }

      requestAnimationFrame(tryScrollAndHighlight);
    });

    return () => {
      if (scrollAttemptId === attemptId) scrollAttemptId++;
    };
  });

  // Scroll container and virtualizer handle
  let scrollContainer = $state<HTMLDivElement>();
  let virtualizerHandle = $state<VirtualizerHandle>();
  let scrollFader = $state<{ refresh: () => void }>();

  // Safely call scrollToIndex on the virtualizer. After a {#key roomId} transition,
  // the new Virtualizer's bind:this fires immediately but its onMount → tick() →
  // assignRef hasn't run yet, so the scroller has no DOM reference. Calling
  // scrollToIndex in that window causes "Cannot read properties of null
  // (reading 'ownerDocument')". This wrapper catches that transient error.
  function safeScrollToIndex(...args: Parameters<VirtualizerHandle['scrollToIndex']>) {
    try {
      virtualizerHandle?.scrollToIndex(...args);
    } catch {
      // Virtualizer not yet initialized — scroll will self-correct on next render
    }
  }

  function cancelBottomScroll() {
    bottomScrollOperation += 1;
  }

  function requestBottomScroll(): Promise<boolean> | undefined {
    if (!isCurrentRoomWindowRendered) return undefined;
    if (!scrollContainer || !virtualizerHandle || virtualItems.length === 0) return undefined;

    const operation = ++bottomScrollOperation;
    const requestedRoomId = roomId;
    const intentAtStart = userScrollIntentAt;
    return convergeAtBottom({
      continueWhile: () =>
        operation === bottomScrollOperation &&
        roomId === requestedRoomId &&
        isCurrentRoomWindowRendered &&
        userScrollIntentAt === intentAtStart &&
        !isJumpedMode &&
        (alwaysScrollToBottom || shouldScrollToBottom) &&
        Boolean(scrollContainer && virtualizerHandle),
      waitForFrame: async () => {
        await tick();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      },
      scroll: () => {
        if (!scrollContainer) return;
        safeScrollToIndex(virtualItems.length - 1, { align: 'end' });
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        scrollFader?.refresh();
        // The initial bottom position has been applied. Record it here rather
        // than after convergence, because a viewport event can legitimately
        // supersede this request while its promise callback is still pending.
        initialScrollDone = true;
      },
      measure: () => {
        if (!virtualizerHandle) return null;
        return {
          distanceFromBottom:
            virtualizerHandle.getScrollSize() -
            virtualizerHandle.getScrollOffset() -
            virtualizerHandle.getViewportSize(),
          scrollSize: virtualizerHandle.getScrollSize(),
          viewportSize: virtualizerHandle.getViewportSize()
        };
      }
    });
  }

  // Register the scroll container with ScrollState so sibling components
  // (MessageComposer, TypingIndicator) can synchronously scroll without waiting
  // for ResizeObserver callbacks.
  $effect(() => {
    if (scrollState && scrollContainer) {
      scrollState.setContainer(scrollContainer);
      return () => scrollState.setContainer(null);
    }
  });

  // A software keyboard changes the available message viewport without
  // resizing the composer itself. Preserve the bottom anchor whenever that
  // viewport changes while the timeline is still sticky.
  $effect(() => {
    const container = scrollContainer;
    if (!container) return;

    function keepBottomAnchored() {
      if (!isCurrentRoomWindowRendered) return;
      if (!isJumpedMode && !pendingHighlightId && (alwaysScrollToBottom || shouldScrollToBottom)) {
        void requestBottomScroll();
      }
    }

    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    let initialized = false;
    const viewportObserver = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === container);
      const width = entry?.contentRect.width ?? container.clientWidth;
      const height = entry?.contentRect.height ?? container.clientHeight;
      if (!initialized) {
        initialized = true;
        lastWidth = width;
        lastHeight = height;
        return;
      }
      if (width === lastWidth && height === lastHeight) return;

      lastWidth = width;
      lastHeight = height;
      keepBottomAnchored();
    });
    viewportObserver.observe(container);

    const contentObserver = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target !== container)) keepBottomAnchored();
    });

    function observeContentChildren(target: HTMLElement) {
      contentObserver.disconnect();
      for (const child of target.children) {
        if (child instanceof HTMLElement) contentObserver.observe(child);
      }
    }

    observeContentChildren(container);
    const mutationObserver = new MutationObserver(() => {
      observeContentChildren(container);
      keepBottomAnchored();
    });
    mutationObserver.observe(container, { childList: true });

    // On mobile, the visual viewport can change before layout catches up, or
    // without changing this element's box at all. Start convergence from that
    // signal too; requestBottomScroll waits for layout frames before measuring.
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', keepBottomAnchored);
    visualViewport?.addEventListener('scroll', keepBottomAnchored);
    visualViewport?.addEventListener('scrollend', keepBottomAnchored);

    return () => {
      viewportObserver.disconnect();
      contentObserver.disconnect();
      mutationObserver.disconnect();
      visualViewport?.removeEventListener('resize', keepBottomAnchored);
      visualViewport?.removeEventListener('scroll', keepBottomAnchored);
      visualViewport?.removeEventListener('scrollend', keepBottomAnchored);
    };
  });

  // Keep ScrollState's shouldScroll flag in sync with our local state
  $effect(() => {
    scrollState?.setShouldScroll(alwaysScrollToBottom || shouldScrollToBottom);
  });

  // Auto-scroll to bottom when new events arrive or existing events update.
  // shouldScrollToBottom is read via untrack() so toggling it doesn't re-trigger
  // this effect — it only gates whether we scroll when new data arrives.
  // Suppressed in jumped mode — we don't want to auto-scroll when viewing history.
  // Suppressed when pendingHighlightId is set — a highlight scroll is pending and
  // auto-scroll would race with it, scrolling to bottom before the highlight can fire.
  $effect(() => {
    void updateCounter;

    if (isJumpedMode) return;
    if (pendingHighlightId) return;
    if (!isCurrentRoomWindowRendered) return;

    if (virtualItems.length > 0 && virtualizerHandle) {
      const shouldScroll = untrack(() => alwaysScrollToBottom || shouldScrollToBottom);
      if (shouldScroll) {
        void requestBottomScroll();
      }
    }
  });

  // Lock to prevent virtua's scroll corrections from immediately re-enabling
  // auto-scroll after we detect a user scroll-up. Without this, $fixScrollJump
  // can adjust the scroll position back near the bottom within the same frame,
  // causing handleVirtuaScroll to see distanceFromBottom < 50 and re-enable.
  let scrollUpLock = false;
  let scrollUpLockTimer: ReturnType<typeof setTimeout> | null = null;

  function prepareExplicitBottomScroll() {
    // A reply-link click or drag inside the timeline arms scroll intent. Once the
    // user explicitly asks to return to the present, that older gesture must not
    // cancel or relock the programmatic bottom convergence.
    userScrollIntentAt = 0;
    cancelBottomScroll();
    scrollUpLock = false;
    if (scrollUpLockTimer) {
      clearTimeout(scrollUpLockTimer);
      scrollUpLockTimer = null;
    }
    setShouldScrollToBottom(true);
  }

  // Scroll to bottom when clicking the new messages indicator
  function scrollToBottom() {
    prepareExplicitBottomScroll();
    onReachedBottom?.();
    void requestBottomScroll();
  }

  async function handleJumpToPresentClick() {
    // The replacement latest window must perform a fresh initial-style bottom
    // scroll. Virtua otherwise preserves the historical window's offset when
    // the keyed data is replaced and can leave the user stranded mid-window.
    prepareExplicitBottomScroll();
    initialScrollDone = false;
    onReachedBottom?.();
    const requestedRoomId = roomId;
    const intentAtStart = userScrollIntentAt;
    if (!(await onJumpToPresent?.())) return;
    await tick();
    if (roomId !== requestedRoomId || userScrollIntentAt !== intentAtStart) return;
    void requestBottomScroll();
  }

  // Timestamp of the most recent user-driven scroll signal (wheel or touchmove).
  // The scroll-up branch in handleVirtuaScroll only fires when this is recent,
  // so virtua's internal scroll adjustments (re-measurement, $fixScrollJump),
  // composer-resize-driven scrollTop writes, and browser scroll clamping during
  // layout shifts never get misread as the user scrolling up.
  function markUserScrollIntent() {
    userScrollIntentAt = Date.now();
    cancelBottomScroll();
  }

  function markKeyboardScrollIntent(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      markUserScrollIntent();
    }
  }

  function distanceFromBottom(): number | null {
    if (!virtualizerHandle) return null;
    return (
      virtualizerHandle.getScrollSize() -
      virtualizerHandle.getScrollOffset() -
      virtualizerHandle.getViewportSize()
    );
  }

  function eventIdForVirtualItem(item: VirtualItem): string | null {
    if (item.type === 'event') return item.event.id;
    if (item.type === 'system-group') return item.events[0]?.id ?? null;
    return null;
  }

  function eventSelector(eventId: string): string {
    return `[data-event-id="${CSS.escape(eventId)}"]`;
  }

  function captureRefreshAnchor(visibleAtMs?: number): RefreshAnchor | null {
    if (!scrollContainer || !virtualizerHandle || virtualItems.length === 0) return null;

    const viewportTop = scrollContainer.getBoundingClientRect().top;
    let partiallyVisibleAnchor: RefreshAnchor | null = null;
    const startIdx = Math.max(
      0,
      virtualizerHandle.findItemIndex(virtualizerHandle.getScrollOffset())
    );
    for (let i = startIdx; i < virtualItems.length; i++) {
      const item = virtualItems[i];
      if (
        visibleAtMs !== undefined &&
        item.type === 'event' &&
        shouldHideTombstone(item.event, visibleAtMs)
      ) {
        continue;
      }
      const eventId = eventIdForVirtualItem(item);
      if (!eventId) continue;

      const el = scrollContainer.querySelector<HTMLElement>(eventSelector(eventId));
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= viewportTop) continue;
      const candidate = {
        eventId,
        top: rect.top
      };
      if (rect.top >= viewportTop) return candidate;
      partiallyVisibleAnchor ??= candidate;
    }

    if (partiallyVisibleAnchor) return partiallyVisibleAnchor;
    console.debug('[room-refresh] no visible anchor found', { roomId });
    return null;
  }

  let softRefreshInFlight = false;
  const MIN_BROWSER_WAKE_REFRESH_HIDDEN_MS = 5_000;

  function isShortBrowserWake(signal: ResumeSignal): boolean {
    if (signal.source !== 'browser') return false;
    if (signal.reason !== 'visibility' && signal.reason !== 'pageshow') return false;
    return (
      signal.hiddenDurationMs !== null &&
      signal.hiddenDurationMs < MIN_BROWSER_WAKE_REFRESH_HIDDEN_MS
    );
  }

  async function refreshAfterPossibleMiss(signal: ResumeSignal): Promise<boolean> {
    if (softRefreshInFlight) return false;
    if (isLoading && virtualItems.length === 0) return false;
    if (isShortBrowserWake(signal)) {
      console.debug('[room-refresh] skipped short browser wake refresh', {
        roomId,
        reason: signal.reason,
        hiddenDurationMs: signal.hiddenDurationMs,
        epoch: signal.epoch
      });
      return false;
    }

    const bottomDistance = distanceFromBottom();
    const wasAtBottom =
      alwaysScrollToBottom ||
      (bottomDistance === null ? shouldScrollToBottom : bottomDistance < 50);
    const anchor = wasAtBottom ? null : captureRefreshAnchor();

    softRefreshInFlight = true;
    try {
      console.debug('[room-refresh] event list refresh started', {
        roomId,
        reason: signal.reason,
        source: signal.source,
        phase: signal.phase,
        hiddenDurationMs: signal.hiddenDurationMs,
        epoch: signal.epoch,
        mode: wasAtBottom ? 'latest' : 'anchored',
        wasAtBottom,
        bottomDistance,
        anchorEventId: anchor?.eventId ?? null,
        itemCount: virtualItems.length
      });
      const result = await messageStore.refreshCurrentWindow(
        wasAtBottom ? null : (anchor?.eventId ?? null)
      );
      if (!result.refreshed) {
        console.debug('[room-refresh] event list refresh skipped after store refresh failed', {
          roomId,
          reason: signal.reason,
          source: signal.source,
          phase: signal.phase,
          wasAtBottom,
          result
        });
        return false;
      }
      onSoftRefresh?.(result, anchor !== null);
      if (!result.changed) {
        console.debug('[room-refresh] event list refresh completed unchanged', {
          roomId,
          result,
          itemCount: virtualItems.length
        });
        return true;
      }
      await tick();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (wasAtBottom) {
        setShouldScrollToBottom(true);
        await requestBottomScroll();
        console.debug('[room-refresh] event list refresh completed at bottom', {
          roomId,
          result,
          itemCount: virtualItems.length
        });
        return true;
      }

      if (anchor && scrollContainer) {
        const target = scrollContainer.querySelector<HTMLElement>(eventSelector(anchor.eventId));
        if (target) {
          const nextTop = target.getBoundingClientRect().top;
          scrollContainer.scrollTop += nextTop - anchor.top;
          scrollFader?.refresh();
          console.debug('[room-refresh] anchor restored', {
            roomId,
            anchorEventId: anchor.eventId,
            deltaPx: nextTop - anchor.top,
            result,
            itemCount: virtualItems.length
          });
        } else {
          console.debug('[room-refresh] anchor disappeared after refresh', {
            roomId,
            anchorEventId: anchor.eventId,
            result,
            itemCount: virtualItems.length
          });
        }
      }
      return true;
    } finally {
      softRefreshInFlight = false;
    }
  }

  useMayHaveMissedMessagesCallback((signal) => refreshAfterPossibleMiss(signal));

  // Re-evaluate "are we at the bottom?" when the tab regains visibility — the
  // browser may have throttled virtua's measurements or our auto-scroll effect
  // while hidden, leaving shouldScrollToBottom=true even though the scroll has
  // drifted off the bottom (which would suppress the Jump to Present button).
  useTabResumeCallback(() => {
    tombstoneClockVersion += 1;
    if (alwaysScrollToBottom || !shouldScrollToBottom || !initialScrollDone) return;
    if (!virtualizerHandle) return;
    const dist =
      virtualizerHandle.getScrollSize() -
      virtualizerHandle.getScrollOffset() -
      virtualizerHandle.getViewportSize();
    if (dist > 50) setShouldScrollToBottom(false);
  });

  let forwardLoadInFlight = false;
  let underfilledBackfillInFlight = false;

  function exitJumpedModeAtPresent(bottomDistance: number): boolean {
    if (!isJumpedMode || !hasReachedEnd || bottomDistance >= 50 || !onReachedPresent) return false;

    setShouldScrollToBottom(true);
    onReachedBottom?.();
    console.debug('[room-refresh] reached present after forward pagination', {
      roomId,
      bottomDistance,
      itemCount: virtualItems.length
    });
    onReachedPresent();
    return true;
  }

  async function loadNewerAndMaybeExitAtPresent(): Promise<void> {
    if (!onLoadNewer || forwardLoadInFlight) return;

    forwardLoadInFlight = true;
    try {
      await onLoadNewer();
      await tick();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const nextBottomDistance = distanceFromBottom();
      if (nextBottomDistance !== null) {
        exitJumpedModeAtPresent(nextBottomDistance);
      }
    } finally {
      forwardLoadInFlight = false;
    }
  }

  async function loadOlderIfTimelineNeedsBackfill(): Promise<void> {
    if (
      !enablePagination ||
      !onLoadMore ||
      isLoading ||
      isLoadingMore ||
      hasReachedStart ||
      isJumpedMode ||
      !isCurrentRoomWindowRendered ||
      underfilledBackfillInFlight
    ) {
      return;
    }

    underfilledBackfillInFlight = true;
    try {
      // A fetched page can consist entirely of expired tombstones. There is no
      // Virtualizer in that state, but pagination still needs to walk backward
      // until it finds visible history or reaches the beginning.
      if (timelineEvents.length > 0 && filteredEvents.length === 0) {
        await onLoadMore({ silent: true });
        return;
      }

      await tick();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (
        !virtualizerHandle ||
        isLoading ||
        isLoadingMore ||
        hasReachedStart ||
        isJumpedMode ||
        virtualItems.length === 0
      ) {
        return;
      }

      const scrollSize = virtualizerHandle.getScrollSize();
      const viewportSize = virtualizerHandle.getViewportSize();
      const lacksInitialRoomMessages =
        filterThreadReplies &&
        timelineEvents.length > 0 &&
        messageEventCount < INITIAL_ROOM_MESSAGE_BACKFILL_TARGET;
      if (scrollSize <= viewportSize + 50 || lacksInitialRoomMessages) {
        await onLoadMore({ silent: true });
      }
    } finally {
      underfilledBackfillInFlight = false;
    }
  }

  $effect(() => {
    void virtualItems.length;
    void timelineEvents.length;
    void filteredEvents.length;
    void messageEventCount;
    void enablePagination;
    void isLoading;
    void isLoadingMore;
    void hasReachedStart;
    void isJumpedMode;
    void virtualizerHandle;

    void loadOlderIfTimelineNeedsBackfill();
  });

  // Handle scroll events from virtua to detect user intent and trigger pagination.
  // virtua's shift=true handles scroll restoration during pagination automatically,
  // eliminating the need for manual scrollHeight capture/restore and overflow-anchor toggling.
  function handleVirtuaScroll(offset: number) {
    if (!virtualizerHandle) return;

    const scrollSize = virtualizerHandle.getScrollSize();
    const viewportSize = virtualizerHandle.getViewportSize();
    const distanceFromBottom = scrollSize - offset - viewportSize;

    // Smart scroll: detect user scroll direction
    if (!alwaysScrollToBottom) {
      // Re-enable auto-scroll if we're at the bottom (and not locked)
      if (distanceFromBottom < 10 && !scrollUpLock) {
        const wasScrolledUp = !shouldScrollToBottom;
        setShouldScrollToBottom(true);
        if (wasScrolledUp && Date.now() - userScrollIntentAt < USER_SCROLL_INTENT_MS) {
          onReachedBottom?.();
        }
      }
      // Disable auto-scroll if user scrolled up (and clearly not near the bottom).
      // Gated on a recent wheel/touchmove signal so virtua's internal scroll
      // corrections ($fixScrollJump after re-measuring items), composer-resize
      // scrollTop writes, and browser scroll-clamping during layout shifts can't
      // be misread as the user scrolling up. The distanceFromBottom guard is
      // kept as a second line of defense for the brief window where intent is
      // still armed from a fling that already settled near the bottom.
      else if (
        Date.now() - userScrollIntentAt < USER_SCROLL_INTENT_MS &&
        previousOffset !== null &&
        offset < previousOffset - 10 &&
        distanceFromBottom > 20
      ) {
        setShouldScrollToBottom(false);
        cancelBottomScroll();
        scrollUpLock = true;
        if (scrollUpLockTimer) clearTimeout(scrollUpLockTimer);
        scrollUpLockTimer = setTimeout(() => {
          scrollUpLock = false;
        }, 150);
      }
    }

    previousOffset = offset;

    // Track the date of the first visible event for the "Jump to Present" button
    if (!shouldScrollToBottom && virtualizerHandle) {
      const idx = virtualizerHandle.findItemIndex(offset);
      // Walk forward from the found index to find the first event-type item
      for (let i = idx; i < virtualItems.length; i++) {
        const item = virtualItems[i];
        if (item.type === 'event') {
          firstVisibleAt = item.event.createdAt;
          break;
        }
      }
    }

    // Trigger pagination when scrolled near the top.
    // Guard: only when content actually overflows the viewport (avoids firing in short rooms).
    if (
      enablePagination &&
      onLoadMore &&
      offset < viewportSize * 3 &&
      scrollSize > viewportSize + 50 &&
      !isLoadingMore &&
      !hasReachedStart
    ) {
      // No manual scroll restoration needed — virtua's shift=true handles it
      onLoadMore();
    }

    // Forward pagination when near bottom in jumped mode
    if (
      isJumpedMode &&
      onLoadNewer &&
      distanceFromBottom < viewportSize * 3 &&
      !isLoadingNewer &&
      !forwardLoadInFlight &&
      !hasReachedEnd
    ) {
      void loadNewerAndMaybeExitAtPresent();
    }

    // Exit jumped mode when user has scrolled to bottom and all content is loaded
    if (hasReachedEnd && exitJumpedModeAtPresent(distanceFromBottom)) {
      return;
    }
  }

  // Determine if a message can open a thread
  // Root messages open their own thread; echoes open the original thread
  function getOpenThreadHandler(event: RoomEventView) {
    if (!onOpenThread) return undefined;

    const eventData = event.event;
    if (!eventData) return undefined;
    if (isMessagePostedEvent(eventData)) {
      // Echoes open the original thread
      if (eventData.echoOfEventId != null) {
        return (_threadRootEventId: string, options: ThreadOpenOptions = {}) =>
          onOpenThread(eventData.echoFromThreadRootEventId!, options);
      }
      // Thread replies don't open threads from the main channel
      if (eventData.threadRootEventId !== null) return undefined;
      // Root messages open their own thread
      return (_threadRootEventId?: string, options: ThreadOpenOptions = {}) =>
        onOpenThread(event.id, options);
    }

    return undefined;
  }
</script>

<svelte:window onkeydown={markKeyboardScrollIntent} />

<div class="relative flex min-h-0 min-w-0 flex-1 flex-col pb-2">
  <!-- Gradient fade overlay at top -->
  <div
    class="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-background/60 to-transparent"
  ></div>

  <ScrollFader
    top
    bottom
    bind:this={scrollFader}
    bind:scrollEl={scrollContainer}
    scrollClass="overscroll-y-contain"
    data-testid="messages-container"
    onwheel={markUserScrollIntent}
    ontouchmove={markUserScrollIntent}
    onpointerdown={markUserScrollIntent}
  >
    <div
      class={roomRevealActive
        ? 'mt-auto timeline-room-reveal'
        : isRoomSwitching
          ? 'timeline-room-carryover'
          : 'mt-auto'}
      aria-busy={isRoomSwitching ? 'true' : undefined}
      aria-hidden={showTimelineTransitionMask ? 'true' : undefined}
      data-testid={isRoomSwitching ? 'timeline-room-carryover' : undefined}
    >
      {#if loadFailed && !isLoading && virtualItems.length === 0 && !hasRoomSwitchCarryOver}
        <div class="flex flex-1 items-center justify-center px-4">
          <div
            class="max-w-sm surface-pop rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-text"
            role="alert"
          >
            <div class="mb-1 font-medium">{m['room.message.load_failed']()}</div>
            <p class="mb-3 text-muted">{m['room.message.load_failed_hint']()}</p>
            {#if onRetryLoad}
              <button
                type="button"
                class="rounded-sm border border-warning/40 px-3 py-1.5 text-warning transition-[background-color,scale] hover:bg-warning/10 active:scale-[0.98]"
                onclick={() => onRetryLoad?.()}
              >
                {m['room.message.retry_load']()}
              </button>
            {/if}
          </div>
        </div>
      {:else if showDelayedLoading.current && !hasRoomSwitchCarryOver}
        <div class="flex flex-1 items-end px-4 pb-6">
          <div
            class="flex w-full flex-col gap-3"
            aria-busy="true"
            aria-label={m['room.message.loading']()}
          >
            <div class="skeleton h-4 w-1/3 rounded"></div>
            <div class="skeleton h-12 w-3/4 rounded-md"></div>
            <div class="skeleton ml-10 h-4 w-1/2 rounded"></div>
            <div class="skeleton ml-10 h-14 w-2/3 rounded-md"></div>
          </div>
        </div>
      {:else if !isLoading && virtualItems.length === 0 && !hasRoomSwitchCarryOver}
        <div class="timeline-room-empty-state flex flex-1 items-center justify-center px-4">
          <div
            class="surface-pop rounded-xl border border-surface-200/55 bg-surface/42 px-4 py-3 text-center text-sm text-muted/60 shadow-sm"
          >
            {emptyMessage}
          </div>
        </div>
      {:else if !isLoading || virtualItems.length > 0 || hasRoomSwitchCarryOver}
        <Virtualizer
          bind:this={virtualizerHandle}
          data={virtualItems}
          getKey={(item, index) => item?.key ?? `__ix_${index}`}
          scrollRef={scrollContainer}
          bufferSize={640}
          shift={isLoadingMore}
          onscroll={handleVirtuaScroll}
        >
          {#snippet children(item: VirtualItem)}
            {#if !item}
              <!-- Stale virtualizer index during data transition, skip -->
            {:else if item.type === 'start-marker'}
              <div class="pt-10 pb-2 text-center text-sm text-muted/40">
                {m['room.message.start_marker']()}
              </div>
            {:else if item.type === 'day-separator'}
              <DaySeparator label={item.label} />
            {:else if item.type === 'unread-separator'}
              <UnreadSeparator />
            {:else if item.type === 'system-group'}
              <!-- Same guard pattern as the event branch below — virtua may re-invoke
                   the snippet with a stale item reference during data transitions
                   (e.g. switching rooms or servers). -->
              {@const groupEvents = item?.events}
              {@const groupKind = item?.kind}
              {#if groupEvents && groupKind && groupEvents.length > 0}
                <SystemEventGroup events={groupEvents} kind={groupKind} />
              {/if}
            {:else}
              <!--
                Use {@const} with optional chaining to snapshot the event and guard
                against the virtualizer's item getter returning undefined during data
                transitions. Svelte 5's reactive prop getters can re-evaluate before
                the outer {#if !item} branch switches, so we need this inner guard.
              -->
              {@const eventData = item?.event}
              {#if eventData}
                <RoomEvent
                  event={eventData}
                  compact={!item.isFirstInGroup}
                  roomId={renderedTimelineRoomId}
                  {messageStore}
                  onOpenThread={getOpenThreadHandler(eventData)}
                />
              {/if}
            {/if}
          {/snippet}
        </Virtualizer>
      {/if}
    </div>
  </ScrollFader>

  {#if showTimelineTransitionMask}
    <div
      class="timeline-room-switch-mask pointer-events-none absolute inset-x-0 top-0 bottom-2 z-20 overflow-hidden bg-background"
      aria-busy="true"
      aria-label={m['room.message.loading']()}
      data-testid="timeline-room-switch-mask"
    >
      <div
        class="timeline-room-switch-placeholder flex min-h-full flex-col gap-4 px-4 pt-7 pb-6"
      >
        <div class="flex gap-3">
          <div
            class="timeline-room-switch-block timeline-room-switch-avatar mt-1 size-9 shrink-0 rounded-full"
          ></div>
          <div class="min-w-0 flex-1 space-y-3">
            <div class="flex items-center gap-2">
              <div class="timeline-room-switch-block h-4 w-28 rounded"></div>
              <div class="timeline-room-switch-block h-3 w-10 rounded"></div>
            </div>
            <div class="timeline-room-switch-block timeline-room-switch-media rounded-xl"></div>
            <div class="timeline-room-switch-block h-3.5 w-4/5 rounded"></div>
            <div class="timeline-room-switch-block h-3.5 w-2/5 rounded"></div>
          </div>
        </div>
        <div class="ml-12 space-y-3">
          <div class="timeline-room-switch-block h-4 w-1/3 rounded"></div>
          <div class="timeline-room-switch-block h-12 w-3/4 rounded-lg"></div>
        </div>
        <div class="ml-8 flex gap-3">
          <div
            class="timeline-room-switch-block timeline-room-switch-avatar mt-1 size-8 shrink-0 rounded-full"
          ></div>
          <div class="min-w-0 flex-1 space-y-3">
            <div class="timeline-room-switch-block h-4 w-32 rounded"></div>
            <div class="timeline-room-switch-block h-10 w-2/3 rounded-lg"></div>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <TypingIndicator {typingUserIds} members={typingMembers} />

  {#if showRoomSwitchLoading.current}
    <div
      class="pointer-events-none absolute inset-x-4 top-4 z-20 h-px overflow-hidden rounded-full bg-surface-200/40"
      aria-hidden="true"
    >
      <span class="timeline-room-switch-progress block h-full w-1/3 rounded-full bg-primary/80"></span>
    </div>
  {/if}

  {#if isJumpedMode && !shouldScrollToBottom && onJumpToPresent}
    <button
      transition:fade={{ duration: motionDuration(MOTION_DURATION.base) }}
      onclick={handleJumpToPresentClick}
      data-testid="jump-to-present"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 cursor-pointer menu whitespace-nowrap"
    >
      <div class="flex items-center gap-2 menu-section px-3 py-1">
        {#if firstVisibleDate}
          <span class="text-muted">{firstVisibleDate}</span>
          <span class="text-muted/40">|</span>
        {/if}
        <span>{m['room.jump_to_present']()}</span>
        <span class="iconify uil--arrow-down"></span>
      </div>
    </button>
  {:else if !alwaysScrollToBottom && !shouldScrollToBottom}
    <button
      transition:fade={{ duration: motionDuration(MOTION_DURATION.base) }}
      onclick={scrollToBottom}
      data-testid="jump-to-present"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 cursor-pointer menu whitespace-nowrap"
    >
      <div class="flex items-center gap-2 menu-section px-3 py-1">
        {#if firstVisibleDate}
          <span class="text-muted">{firstVisibleDate}</span>
          <span class="text-muted/40">|</span>
        {/if}
        <span>{hasNewMessages ? m['room.unread_separator']() : m['room.jump_to_present']()}</span>
        <span class="iconify uil--arrow-down"></span>
      </div>
    </button>
  {/if}
</div>

<style>
  .timeline-room-carryover {
    opacity: 0.72;
    transform: translate3d(0, 2px, 0);
    transition:
      opacity 100ms ease-out,
      transform 100ms ease-out;
    will-change: opacity, transform;
  }

  .timeline-room-reveal {
    animation: timeline-room-reveal 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: opacity, transform;
  }

  .timeline-room-switch-progress {
    animation: timeline-room-switch-progress 850ms ease-in-out infinite;
    box-shadow: 0 0 12px color-mix(in srgb, var(--color-primary) 35%, transparent);
  }

  .timeline-room-switch-placeholder {
    animation: timeline-room-switch-placeholder 180ms ease-out both;
    will-change: opacity, transform;
  }

  .timeline-room-switch-block {
    opacity: 0.58;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--color-surface-200) 74%, transparent), transparent 120%),
      color-mix(in srgb, var(--color-surface-100) 82%, var(--color-primary) 6%);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--color-text) 4%, transparent),
      0 0 18px color-mix(in srgb, var(--color-primary) 4%, transparent);
  }

  .timeline-room-switch-avatar {
    opacity: 0.48;
  }

  .timeline-room-switch-media {
    height: clamp(7rem, 28vh, 18rem);
    max-width: min(34rem, 86%);
  }

  @media (max-width: 767px) {
    .timeline-room-switch-media {
      height: clamp(6rem, 24vh, 14rem);
      max-width: 92%;
    }
  }

  .timeline-room-empty-state {
    animation: timeline-room-empty-state 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    will-change: opacity, transform;
  }

  @keyframes timeline-room-reveal {
    from {
      opacity: 0.78;
      transform: translate3d(0, 4px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes timeline-room-switch-progress {
    0% {
      transform: translateX(-110%);
      opacity: 0.3;
    }
    45% {
      opacity: 0.9;
    }
    100% {
      transform: translateX(330%);
      opacity: 0.3;
    }
  }

  @keyframes timeline-room-switch-placeholder {
    from {
      opacity: 0.72;
      transform: translate3d(0, 3px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes timeline-room-empty-state {
    from {
      opacity: 0;
      transform: translate3d(0, 4px, 0) scale(0.992);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .timeline-room-carryover,
    .timeline-room-reveal,
    .timeline-room-switch-placeholder,
    .timeline-room-switch-block,
    .timeline-room-empty-state {
      animation: none;
      opacity: 1;
      transform: none;
      transition: none;
      will-change: auto;
    }

    .timeline-room-switch-progress {
      animation: none;
      transform: none;
      opacity: 0.8;
    }
  }
</style>
