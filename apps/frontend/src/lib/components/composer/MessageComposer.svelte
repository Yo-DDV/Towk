<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { RoomEventView } from '$lib/render/types';
  import { createMessageAPI, type PreparedMessageInput } from '$lib/api-client/messages';
  import { createLinkPreviewAPI } from '$lib/api-client/linkPreviews';
  import { createRoleAPI } from '$lib/api-client/roles';
  import * as m from '$lib/i18n/messages';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { parseMessageLink } from '$lib/messageLinks';
  import LinkPreviewCard from '$lib/components/LinkPreviewCard.svelte';
  import LinkPreviewSkeleton from '$lib/components/LinkPreviewSkeleton.svelte';
  import MessagePreviewCard from '$lib/components/MessagePreviewCard.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import { toast } from '$lib/ui/toast';
  import {
    getRoomMembers,
    getRoomMembersStore,
    getComposerContext,
    type QuoteInsertionContent,
    type RoomMember
  } from '$lib/state/room';
  import { shouldAutoFocus } from '$lib/utils/shouldAutoFocus';
  import { prefersTouchActions, supportsHoverActions } from '$lib/utils/inputCapabilities';
  import { readClipboardFiles } from '$lib/attachments/clipboardFiles';
  import { isVideoAttachmentFileCandidate } from '$lib/attachments/filePolicy';
  import { hasVisibleContent } from '$lib/validation';
  import { extractMentions, hasRoleOrVirtualMention } from '$lib/mentions';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import EmojiAutocomplete from '$lib/components/composer/EmojiAutocomplete.svelte';
  import ComposerEmojiPicker from '$lib/components/composer/ComposerEmojiPicker.svelte';
  import MentionAutocomplete from '$lib/components/composer/MentionAutocomplete.svelte';
  import type { TipTapEditorApi } from './TipTapEditor.svelte';
  import { DraftState, draftKey } from './draft.svelte';
  import { AttachmentsState } from './attachments.svelte';
  import { LinkPreviewState } from './linkPreviews.svelte';
  import { AutocompleteState, type MentionRole } from './autocomplete.svelte';
  import { classifyOutboxFailure, pwaOutbox } from '$lib/pwa/outbox.svelte';
  import { supportsMessageCreateIdempotency } from '$lib/pwa/outboxPolicy';
  import { privateDataScopeForServer } from '$lib/pwa/scope';
  import { deleteIncomingShare, getIncomingShare } from '$lib/pwa/shareInbox';
  import VoiceMessageRecorder from './VoiceMessageRecorder.svelte';
  import type { VoiceMessageDraft } from '$lib/voiceMessages/policy';

  const tipTapEditorModule = import('./TipTapEditor.svelte');
  const DESKTOP_EMOJI_PICKER_WIDTH_REM = 22;
  const FLOATING_VIEWPORT_PADDING_PX = 8;

  type ShortcutHints = {
    submit: string;
    enterAgain: string;
  };

  function getShortcutHints(): ShortcutHints | null {
    if (typeof navigator === 'undefined' || prefersTouchActions()) return null;

    const userAgentDataPlatform =
      'userAgentData' in navigator
        ? (navigator.userAgentData as { platform?: string } | undefined)?.platform
        : undefined;
    const platform = userAgentDataPlatform ?? navigator.platform ?? '';
    const usesReturn = /Mac|iPhone|iPad|iPod/i.test(platform);
    return usesReturn
      ? { submit: 'Cmd+Return to Send', enterAgain: 'Return again to Send' }
      : { submit: 'Ctrl+Return to Send', enterAgain: 'Enter again to Send' };
  }

  const stores = serverRegistry.getStore(getActiveServer());
  const serverInfo = stores.serverInfo;
  const roomUnreadStore = stores.roomUnread;

  export type MessageComposerApi = {
    addFiles: (files: File[]) => void;
    focus: () => void;
    insertQuote: (text: QuoteInsertionContent) => void;
  };

  let {
    roomId,
    roomName,
    inThread,
    inReplyTo,
    replyDisplayName,
    replyExcerpt,
    placeholder: customPlaceholder,
    canPost = true,
    canAttach = true,
    canVoice = false,
    autoFocus = true,
    onReady,
    onTyping,
    onMessageSent,
    onCancelReply,
    onEscape,
    showAlsoSendToChannel = false
  }: {
    roomId: string;
    roomName?: string;
    inThread?: string;
    inReplyTo?: string;
    replyDisplayName?: string;
    replyExcerpt?: string;
    placeholder?: string;
    canPost?: boolean;
    canAttach?: boolean;
    canVoice?: boolean;
    autoFocus?: boolean;
    onReady?: (api: MessageComposerApi) => void;
    onTyping?: () => void;
    onMessageSent?: (event: RoomEventView | null) => void;
    onCancelReply?: () => void;
    onEscape?: () => void;
    showAlsoSendToChannel?: boolean;
  } = $props();

  const connection = useConnection();

  let alsoSendToChannel = $state(false);

  // Get room members from context (provided by Room.svelte)
  const members = $derived(getRoomMembers());
  const membersStore = getRoomMembersStore();
  let mentionSearchMembers = $state.raw<RoomMember[]>([]);
  let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let mentionSearchRequestId = 0;
  const mentionCandidateMembers = $derived(
    mentionSearchMembers.length > 0 ? mentionSearchMembers : members
  );

  onDestroy(() => {
    if (mentionSearchTimer) clearTimeout(mentionSearchTimer);
    draftState.dispose();
  });

  const composerContext = getComposerContext();
  const editState = composerContext.editState;
  const quoteInsertionState = composerContext.quoteInsertionState;
  const lastEditableMessageCtx = composerContext.lastEditableMessage;
  const scrollState = composerContext.scrollState;
  const isEditing = $derived(editState.eventId !== null);
  const showEditEchoCheckbox = $derived(
    isEditing &&
      editState.threadRootEventId !== null &&
      (editState.channelEchoEventId !== null || editState.canAddChannelEcho)
  );

  // When the composer resizes (editor grows/shrinks, attachments added/removed),
  // scroll to bottom if sticky. This replaces the synchronous scrollToBottomIfSticky()
  // that was lost when the old textarea's autoResize() was removed during TipTap migration.
  function observeComposerResize(node: HTMLDivElement) {
    if (!scrollState) return;
    const observer = new ResizeObserver(() => {
      scrollState.scrollToBottomIfSticky();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }

  const DRAFT_KEY = $derived(draftKey(roomId, inThread));
  let message = $state('');

  // TipTap editor API (received via onReady callback)
  let editorApi = $state<TipTapEditorApi | null>(null);
  // Touch-primary devices already expose their native emoji keyboard. Even on
  // hybrid phones/tablets advertising an auxiliary fine pointer, keep the
  // desktop picker hidden and reserve it for a true desktop input context.
  const canUseDesktopEmojiPicker = !prefersTouchActions() && supportsHoverActions();
  let emojiPickerTriggerElement = $state<HTMLButtonElement>();
  let emojiPickerAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let emojiPickerOpen = $state(false);
  const draftState = new DraftState();
  const attachments = new AttachmentsState(() => serverInfo);
  const linkPreviews = new LinkPreviewState(() => {
    const conn = connection();
    return createLinkPreviewAPI({
      serverId: conn.serverId,
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  });
  const autocomplete = new AutocompleteState(
    () => editorApi,
    () => mentionCandidateMembers,
    () => mentionRoles
  );
  let mentionRoles = $state<MentionRole[]>([]);
  let mentionRolesLoadComplete = $state(false);
  let mentionRolesLoadFailed = $state(false);
  let mentionRolesLoadPromise: Promise<boolean> | null = null;

  $effect(() => {
    const query = autocomplete.mention?.query ?? null;
    const requestId = ++mentionSearchRequestId;

    if (mentionSearchTimer) {
      clearTimeout(mentionSearchTimer);
      mentionSearchTimer = null;
    }

    if (!query) {
      mentionSearchMembers = [];
      return;
    }

    mentionSearchTimer = setTimeout(() => {
      void membersStore.searchMembers(query).then((results) => {
        if (requestId !== mentionSearchRequestId) return;
        mentionSearchMembers = results;
      });
    }, 150);
  });

  // Dynamic placeholder changes between normal and edit mode
  let currentPlaceholder = $derived(
    isEditing
      ? m['composer.editing_placeholder']()
      : (customPlaceholder ??
          (roomName?.trim()
            ? sidebarNav.isMobile
              ? m['composer.room_placeholder_compact']({ room: roomName.trim() })
              : m['composer.room_placeholder']({ room: roomName.trim() })
            : m['composer.placeholder']()))
  );

  // Testid for E2E tests - distinguishes main input from thread reply input
  let testid = $derived(inThread ? 'thread-reply-input' : 'message-input');
  const shortcutHints = getShortcutHints();

  // Track editing transitions by event identity so editor setContent() doesn't
  // run repeatedly while TipTap echoes updates back through onUpdate.
  let editSeededForEvent = '';

  // When entering edit mode, pre-fill with original message body and clear any pending attachments.
  // When exiting edit mode (cancelled or message deleted), clear the input.
  $effect(() => {
    const eventId = editState.eventId;
    const originalBody = editState.originalBody;
    const api = editorApi;

    if (eventId && originalBody && editSeededForEvent !== eventId) {
      editSeededForEvent = eventId;
      autocomplete.reset();
      void draftState.clearText().catch(() => undefined);
      message = originalBody;
      manualRichMode = false;
      alsoSendToChannel = editState.channelEchoEventId !== null;
      api?.setContent(originalBody);
      tick().then(() => api?.focus('end'));
      void draftState.discardFiles().catch(() => undefined);
      attachments.clear();
      linkPreviews.clear();
    } else if (editSeededForEvent && !eventId) {
      // Exiting edit mode - clear the input
      autocomplete.reset();
      message = '';
      manualRichMode = false;
      alsoSendToChannel = false;
      editSeededForEvent = '';
      api?.setContent('');
    }
  });

  // Drafts are encrypted per server account in IndexedDB. The legacy
  // sessionStorage entry is migrated once and then removed.
  let autocompleteResetRoomId = '';
  let loadedDraftKey = $state('');
  let draftLoadVersion = 0;
  let consumedIncomingShareId = '';

  async function consumeIncomingShare(loadVersion: number, draftText: string) {
    if (inThread) return;
    const shareId = page.url.searchParams.get('shareId') ?? '';
    if (!shareId || consumedIncomingShareId === shareId) return;
    consumedIncomingShareId = shareId;

    const incoming = await getIncomingShare(shareId);
    if (loadVersion !== draftLoadVersion) {
      consumedIncomingShareId = '';
      return;
    }
    if (!incoming) {
      toast.error(m['ui.share_target.expired']());
    } else {
      const sharedText = [incoming.title, incoming.text, incoming.url].filter(Boolean).join('\n\n');
      message = [draftText, sharedText].filter(Boolean).join('\n\n');
      editorApi?.setContent(message);
      if (incoming.files.length > 0) {
        if (canAttach) {
          await attachments.stageFiles(incoming.files);
        } else {
          toast.error(m['room.attachment.not_permitted']());
        }
      }
      await deleteIncomingShare(shareId).catch(() => undefined);
    }

    const cleanUrl = new URL(page.url);
    cleanUrl.searchParams.delete('shareId');
    // The URL is derived from the current same-origin SvelteKit route.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    replaceState(`${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`, page.state);
  }

  $effect(() => {
    const activeDraftKey = DRAFT_KEY;
    if (autocompleteResetRoomId !== roomId) {
      autocompleteResetRoomId = roomId;
      autocomplete.resetForRoom();
      closeDesktopEmojiPicker();
    }

    const scope = privateDataScopeForServer(serverRegistry.getServer(getActiveServer()));
    const legacyDraft = draftState.switchKey(DRAFT_KEY, scope, roomId, inThread ?? null);
    const loadVersion = ++draftLoadVersion;
    loadedDraftKey = '';

    if (isEditing) {
      attachments.restore([]);
      return;
    }

    message = legacyDraft;
    manualRichMode = false;
    // Editor readiness is not part of the draft identity. Tracking it here
    // would restart the async load and could overwrite a quote or text entered
    // while IndexedDB is still resolving.
    untrack(() => editorApi)?.setContent(legacyDraft);
    attachments.restore([]);
    void Promise.all([draftState.load(legacyDraft), draftState.loadFiles()])
      .then(([draft, draftFiles]) => {
        if (loadVersion !== draftLoadVersion || isEditing) {
          for (const { url } of draftFiles) URL.revokeObjectURL(url);
          return;
        }
        const currentMessage = untrack(() => message);
        const currentFiles = untrack(() => attachments.filesWithUrls);
        const userChangedText = currentMessage !== legacyDraft;

        // Never replace live composer input with a late IndexedDB read. If a
        // persisted draft and new input both exist, preserve both instead of
        // silently discarding either one.
        const persistedText = draft?.text ?? '';
        message = userChangedText
          ? persistedText && persistedText !== currentMessage
            ? `${persistedText}\n\n${currentMessage}`
            : currentMessage
          : persistedText;
        manualRichMode =
          (draft?.richMode ?? false) || (userChangedText && untrack(() => manualRichMode));
        untrack(() => editorApi)?.setContent(message);
        attachments.restore(
          currentFiles.length > 0 ? [...draftFiles, ...currentFiles] : draftFiles
        );
        loadedDraftKey = DRAFT_KEY;
        void consumeIncomingShare(loadVersion, message);
      })
      .catch((error) => {
        if (loadVersion !== draftLoadVersion) return;
        console.error('Failed to load encrypted draft:', error);
        loadedDraftKey = DRAFT_KEY;
        void consumeIncomingShare(loadVersion, message);
      });

    return () => {
      attachments.invalidatePending();
      const files = untrack(() => attachments.filesWithUrls);
      if (untrack(() => loadedDraftKey === activeDraftKey) || files.length > 0) {
        draftState.stashFiles(files);
      }
      void draftState.flush().catch(() => undefined);
    };
  });

  // Debounced encrypted draft persistence starts only after the matching
  // account/room record has loaded, so a slow read cannot overwrite typing.
  $effect(() => {
    if (isEditing || loading || loadedDraftKey !== DRAFT_KEY) return;
    draftState.persistText(message, manualRichMode);
  });

  $effect(() => {
    if (isEditing || loading || loadedDraftKey !== DRAFT_KEY) return;
    draftState.persistFiles(attachments.filesWithUrls);
  });

  $effect(() => {
    return linkPreviews.scheduleDetection(message, isEditing);
  });

  $effect(() => {
    const conn = connection();
    const api = createRoleAPI({
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
    let cancelled = false;
    mentionRoles = [];
    mentionRolesLoadComplete = false;
    mentionRolesLoadFailed = false;

    async function loadMentionRoles() {
      let roles;
      try {
        roles = (await api.listRoles()).roles;
      } catch {
        if (!cancelled) {
          mentionRoles = [];
          mentionRolesLoadFailed = true;
          mentionRolesLoadComplete = true;
        }
        return false;
      }
      if (cancelled) return false;
      mentionRoles =
        roles.map((role) => ({
          name: role.name,
          isSystem: role.isSystem,
          position: role.position,
          pingable: role.pingable
        })) ?? [];
      mentionRolesLoadFailed = false;
      mentionRolesLoadComplete = true;
      return true;
    }

    mentionRolesLoadPromise = loadMentionRoles();
    return () => {
      cancelled = true;
    };
  });

  let loading = $state(false);
  let roleMentionCheckLoading = $state(false);
  let fileInputElement = $state<HTMLInputElement>();
  let voiceRecorderActive = $state(false);

  // Keep voice capture mutually exclusive with any editor content, including
  // whitespace or draft text that is not yet sendable. The send affordance is
  // promoted only for text that passes the existing visible-content policy.
  let hasComposerText = $derived(message.length > 0);
  let hasSendableText = $derived(hasVisibleContent(message));

  // A realtime disconnect does not prevent composing or queueing a message.
  // Note: loading is intentionally excluded — the editor stays editable during sends
  // so users can type the next message while the current one is in flight.
  let inputDisabled = $derived(!canPost);

  let hasSendableAttachments = $derived(canAttach && attachments.selectedFiles.length > 0);

  // Can submit when there's content, not currently sending, and input is enabled.
  // hasVisibleContent rejects messages with only invisible Unicode characters.
  let canSubmit = $derived(
    !loading &&
      !roleMentionCheckLoading &&
      !inputDisabled &&
      attachments.pendingCount === 0 &&
      (hasSendableText || hasSendableAttachments || isEditing)
  );
  let editorNextEnterWillSend = $state(false);
  let manualRichMode = $state(false);
  let editorHasRichStructure = $state(false);
  let isRichComposer = $derived(manualRichMode || editorHasRichStructure);
  let nextEnterWillSend = $derived(canSubmit && isRichComposer && editorNextEnterWillSend);
  let submitHint = $derived(
    shortcutHints && isRichComposer
      ? nextEnterWillSend
        ? shortcutHints.enterAgain
        : shortcutHints.submit
      : null
  );

  $effect(() => {
    if (!canAttach && attachments.filesWithUrls.length > 0) {
      attachments.clear();
    }
  });

  $effect(() => {
    if ((inputDisabled || voiceRecorderActive) && emojiPickerOpen) {
      closeDesktopEmojiPicker();
    }
  });

  $effect(() => {
    const trigger = emojiPickerTriggerElement;
    if (!emojiPickerOpen || !trigger) return;

    const syncAnchor = () => {
      emojiPickerAnchor = getDesktopEmojiPickerAnchor(trigger);
    };
    const observer = new ResizeObserver(syncAnchor);
    observer.observe(trigger);
    window.addEventListener('resize', syncAnchor);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncAnchor);
    };
  });

  // Auto-focus the input when the component mounts, room changes, a reply
  // starts, or the editor becomes editable (canPost loads async after a
  // navigation, so on sidebar/quick-switcher room changes the editor is
  // briefly contenteditable=false — calling focus() then is a no-op).
  // Skip on touch devices where the keyboard popup would be jarring.
  $effect(() => {
    if (!autoFocus || !shouldAutoFocus()) return;

    // Tracked as dependencies so the effect re-fires on each of these.
    void roomId;
    void inReplyTo;

    if (editorApi && !inputDisabled) {
      tick().then(() => editorApi?.focus());
    }
  });

  // Handle emoji selection from autocomplete
  function handleEmojiSelect(emoji: string, _name: string) {
    autocomplete.selectEmoji(emoji);
  }

  function closeEmojiAutocomplete() {
    autocomplete.closeEmoji();
  }

  function getDesktopEmojiPickerAnchor(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    const rootFontSize =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const availableWidth = Math.max(
      0,
      window.innerWidth - FLOATING_VIEWPORT_PADDING_PX * 2
    );
    const pickerWidth = Math.min(
      DESKTOP_EMOJI_PICKER_WIDTH_REM * rootFontSize,
      availableWidth
    );

    return {
      top: rect.top,
      bottom: rect.bottom,
      left: Math.max(FLOATING_VIEWPORT_PADDING_PX, rect.right - pickerWidth)
    };
  }

  function closeDesktopEmojiPicker() {
    emojiPickerOpen = false;
    emojiPickerAnchor = null;
  }

  function closeDesktopEmojiPickerAndFocus() {
    closeDesktopEmojiPicker();
    tick().then(() => editorApi?.focus());
  }

  function toggleDesktopEmojiPicker() {
    if (emojiPickerOpen) {
      closeDesktopEmojiPickerAndFocus();
      return;
    }
    if (!emojiPickerTriggerElement || inputDisabled || !editorApi) return;

    autocomplete.reset();
    emojiPickerAnchor = getDesktopEmojiPickerAnchor(emojiPickerTriggerElement);
    emojiPickerOpen = true;
  }

  function handleDesktopEmojiSelect(emoji: string) {
    closeDesktopEmojiPicker();
    editorApi?.replaceTextBeforeCursor(0, emoji);
  }

  // Handle mention selection from autocomplete
  function handleMentionSelect(login: string, viaTab: boolean) {
    autocomplete.selectMention(login, viaTab);
  }

  function closeMentionAutocomplete() {
    autocomplete.closeMention();
  }

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!canAttach) {
      target.value = '';
      return;
    }
    if (target.files) {
      void attachments.stageFiles(Array.from(target.files));
    }
    // Reset input so same file can be selected again
    target.value = '';
  }

  function removeFile(index: number) {
    attachments.removeFile(index);
  }

  /**
   * Add files from an external source (e.g., drag-and-drop).
   * Creates object URLs for preview and adds to the attachment list.
   */
  async function addFiles(files: File[]) {
    if (!canAttach) return;
    await attachments.stageFiles(files);
  }

  // Focus the input programmatically (e.g., when opening thread from mobile action sheet)
  function focus() {
    tick().then(() => editorApi?.focus());
  }

  function insertQuote(text: QuoteInsertionContent) {
    tick().then(() => editorApi?.insertQuote(text));
  }

  let insertedQuoteRequestId = 0;
  $effect(() => {
    const request = quoteInsertionState.request;
    const api = editorApi;
    if (!request || !api || request.id === insertedQuoteRequestId) return;

    insertedQuoteRequestId = request.id;
    api.insertQuote(request.text);
  });

  // Expose API to parent via onReady callback
  $effect(() => {
    onReady?.({ addFiles, focus, insertQuote });
  });

  // Intercept file references before TipTap processes the paste. Text-only
  // clipboard payloads remain under TipTap's normal paste handling.
  function handlePaste(event: ClipboardEvent): boolean {
    const clipboard = readClipboardFiles(event.clipboardData);
    if (clipboard.files.length === 0 && !clipboard.hasLocalFileReference) return false;

    if (isEditing) {
      toast.error(m['room.attachment.edit_not_supported']());
      return true;
    }
    if (!canAttach) {
      toast.error(m['room.attachment.not_permitted']());
      return true;
    }
    if (clipboard.files.length > 0) {
      void attachments.stageFiles(clipboard.files);
      return true;
    }

    toast.error(m['room.attachment.clipboard_unavailable']());
    return true;
  }

  // Collapse runs of 3+ newlines down to 2 (one blank line max).
  // Applied symmetrically on post and edit so blank-line runs don't
  // accumulate over time and pasted blank-line runs stay reasonable.
  function normalizeMessageBody(text: string): string {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  function hasStructuralMarkdownBody(text: string): boolean {
    return text
      .split('\n')
      .some((line) => /^ {0,3}(?:#{1,6}|[-+*]|\d{1,9}[.)]|>)[ \t]$/.test(line));
  }

  function bodyForSend(text: string): string {
    const normalized = normalizeMessageBody(text);
    if (hasStructuralMarkdownBody(normalized)) return normalized;
    return normalizeMessageBody(text.trim());
  }

  type PreparedPost = {
    roomId: string;
    bodyToSend: string;
    filesToSend: File[] | null;
    attachmentAssetIds?: string[];
    threadRootEventId: string | null;
    inReplyTo: string | null;
    linkPreviewInput: ReturnType<typeof linkPreviews.buildInput>;
    alsoSendToChannel: boolean;
    wasRichComposer: boolean;
    clientRequestId: string;
    voiceMessage?: VoiceMessageDraft;
    preserveComposerDraft?: boolean;
  };

  type SendPreparedPostResponse = {
    event: RoomEventView | null;
    error: unknown | null;
    prepared: PreparedMessageInput | null;
  };

  let pendingRoleMentionConfirmation = $state<PreparedPost | null>(null);
  let roleMentionConfirmationLoading = $state(false);

  async function ensureMentionRolesLoadedForConfirmation(): Promise<boolean> {
    if (mentionRolesLoadComplete) return !mentionRolesLoadFailed;
    return (await mentionRolesLoadPromise) ?? false;
  }

  function postMentionsRoleOrVirtualTarget(post: PreparedPost, rolesAvailable: boolean): boolean {
    const hasKnownRoleOrVirtualMention = hasRoleOrVirtualMention(
      post.bodyToSend,
      mentionRoles.filter((role) => role.name !== 'everyone').map((role) => role.name)
    );
    if (hasKnownRoleOrVirtualMention) return true;
    if (rolesAvailable) return false;

    return extractMentions(post.bodyToSend).length > 0;
  }

  async function sendPreparedPost(post: PreparedPost): Promise<SendPreparedPostResponse> {
    let prepared: PreparedMessageInput | null = null;
    try {
      const conn = connection();
      const api = createMessageAPI({
        serverId: conn.serverId,
        baseUrl: conn.connectBaseUrl,
        bearerToken: conn.bearerToken
      });
      prepared = await api.prepareMessage({
        roomId: post.roomId,
        body: post.bodyToSend,
        attachmentAssetIds: post.attachmentAssetIds,
        attachments: post.attachmentAssetIds?.length ? null : post.filesToSend,
        voiceMessage: post.voiceMessage,
        threadRootEventId: post.threadRootEventId,
        inReplyTo: post.inReplyTo,
        linkPreview: post.linkPreviewInput,
        alsoSendToChannel: post.alsoSendToChannel,
        clientRequestId: post.clientRequestId
      });
      const result = await api.createPreparedMessage(prepared);

      return { event: result.event, error: null, prepared };
    } catch (error) {
      return { event: null, error, prepared };
    }
  }

  function restorePreparedPost(post: PreparedPost) {
    autocomplete.reset();
    message = post.bodyToSend;
    manualRichMode = post.wasRichComposer;
    editorApi?.setContent(post.bodyToSend);
    if (post.filesToSend) {
      attachments.restore(attachments.filesToPreviewItems(post.filesToSend));
    }
  }

  async function handlePostFailure(
    error: unknown,
    post: PreparedPost,
    prepared: PreparedMessageInput | null
  ): Promise<boolean> {
    const scope = privateDataScopeForServer(serverRegistry.getServer(getActiveServer()));
    if (
      scope &&
      prepared &&
      classifyOutboxFailure(error) === 'retryable' &&
      supportsMessageCreateIdempotency(serverInfo)
    ) {
      try {
        // Preview tokens are short-lived server capabilities. The message is
        // durable; an expired optional preview must never block its replay.
        await pwaOutbox.queue(scope, { ...prepared, linkPreviewToken: '' });
        if (!post.preserveComposerDraft) await clearAcceptedDraft();
        toast.success(m['composer.queued_offline']());
        onCancelReply?.();
        alsoSendToChannel = false;
        return true;
      } catch (queueError) {
        console.error('Failed to queue message:', queueError);
      }
    }
    toast.error(m['composer.send_failed']());
    console.error('Error creating message:', error);
    if (!post.preserveComposerDraft) restorePreparedPost(post);
    return false;
  }

  async function clearAcceptedDraft() {
    try {
      await Promise.all([draftState.clearText(), draftState.discardFiles()]);
    } catch (error) {
      console.error('Failed to clear accepted message draft:', error);
    }
  }

  async function handlePostSuccess(response: SendPreparedPostResponse, post: PreparedPost) {
    // Complete the serialized local delete before exposing the accepted event.
    // A caller may reload as soon as the message appears in the timeline.
    if (!post.preserveComposerDraft) await clearAcceptedDraft();

    // Notify parent before scrolling so it can synchronously ingest the
    // returned event and make the target row available.
    onMessageSent?.(response.event);

    // Scroll the enclosing pane to the user's new message. The composer
    // reads `scrollState` from its surrounding ComposerContext, so this
    // targets the main room's EventList in a room composer and the
    // thread's EventList in a thread composer.
    scrollState?.requestScrollToBottom();

    // Clear reply-in-room state after sending
    onCancelReply?.();

    // Mark this room as read (we just posted, so we've seen all messages)
    roomUnreadStore.setRoomUnread(post.roomId, false);

    // Reset "also send to channel" checkbox after successful send
    alsoSendToChannel = false;
    if (!post.preserveComposerDraft) manualRichMode = false;
  }

  async function submitPreparedPost(preparedPost: PreparedPost): Promise<boolean> {
    if (
      typeof navigator !== 'undefined' &&
      !navigator.onLine &&
      (preparedPost.filesToSend?.length || preparedPost.voiceMessage)
    ) {
      toast.warning(
        preparedPost.voiceMessage
          ? m['composer.voice.connection_required']()
          : m['composer.attachments_need_connection']()
      );
      return false;
    }
    // Optimistically clear the editor so the user can start typing the next
    // message immediately (matches Slack/Discord behavior).
    if (!preparedPost.preserveComposerDraft) {
      autocomplete.reset();
      message = '';
      manualRichMode = false;
      editorApi?.setContent('');
      attachments.clear();
      linkPreviews.clear();
    }

    loading = true;

    try {
      const response = await sendPreparedPost(preparedPost);

      if (response.error) {
        return await handlePostFailure(response.error, preparedPost, response.prepared);
      } else {
        await handlePostSuccess(response, preparedPost);
        return true;
      }
    } finally {
      loading = false;
    }
  }

  function cancelRoleMentionConfirmation() {
    pendingRoleMentionConfirmation = null;
  }

  async function confirmRoleMentionSend() {
    const pendingPost = pendingRoleMentionConfirmation;
    if (!pendingPost || roleMentionConfirmationLoading) return;

    roleMentionConfirmationLoading = true;
    try {
      await submitPreparedPost(pendingPost);
      pendingRoleMentionConfirmation = null;
    } finally {
      roleMentionConfirmationLoading = false;
    }
  }

  async function createMessage() {
    // Require either non-empty message body or attachments.
    // hasVisibleContent rejects messages with only invisible Unicode characters.
    const bodyToSend = bodyForSend(message);
    const hasBody = hasVisibleContent(bodyToSend);
    const filesToSend = hasSendableAttachments ? [...attachments.selectedFiles] : null;
    if (!hasBody && !filesToSend) return;

    const preparedPost: PreparedPost = {
      roomId,
      bodyToSend,
      filesToSend,
      threadRootEventId: inThread ?? null,
      inReplyTo: inReplyTo ?? null,
      linkPreviewInput: linkPreviews.buildInput(),
      alsoSendToChannel,
      wasRichComposer: isRichComposer,
      clientRequestId: crypto.randomUUID()
    };

    let rolesAvailable = mentionRolesLoadComplete && !mentionRolesLoadFailed;
    if (hasBody && bodyToSend.includes('@') && !mentionRolesLoadComplete) {
      roleMentionCheckLoading = true;
      try {
        rolesAvailable = await ensureMentionRolesLoadedForConfirmation();
      } finally {
        roleMentionCheckLoading = false;
      }
    }

    if (hasBody && postMentionsRoleOrVirtualTarget(preparedPost, rolesAvailable)) {
      pendingRoleMentionConfirmation = preparedPost;
      return;
    }

    await submitPreparedPost(preparedPost);
  }

  async function sendVoiceMessage(draft: VoiceMessageDraft): Promise<boolean> {
    const preparedPost: PreparedPost = {
      roomId,
      bodyToSend: '',
      filesToSend: null,
      threadRootEventId: inThread ?? null,
      inReplyTo: inReplyTo ?? null,
      linkPreviewInput: null,
      alsoSendToChannel,
      wasRichComposer: false,
      clientRequestId: crypto.randomUUID(),
      voiceMessage: draft,
      preserveComposerDraft: true
    };
    return submitPreparedPost(preparedPost);
  }

  async function editMessage() {
    const trimmedBody = bodyForSend(message);
    if (!trimmedBody) {
      toast.error(m['room.message.empty_edit']());
      return;
    }

    const eventId = editState.eventId;
    if (!eventId) return;

    loading = true;

    const input: {
      roomId: string;
      eventId: string;
      body: string;
      alsoSendToChannel?: boolean;
    } = { roomId, eventId, body: trimmedBody };
    if (showEditEchoCheckbox) {
      input.alsoSendToChannel = alsoSendToChannel;
    }

    try {
      const conn = connection();
      await createMessageAPI({
        serverId: conn.serverId,
        baseUrl: conn.connectBaseUrl,
        bearerToken: conn.bearerToken
      }).updateMessage(input);
      autocomplete.reset();
      message = '';
      editorApi?.setContent('');
      editState.cancelEdit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['composer.edit_failed']());
    }

    loading = false;
  }

  async function handleSubmit() {
    // Guard against double-sends while editor stays editable, and against
    // submitting before pasted/dropped/selected files have finished staging.
    if (
      loading ||
      roleMentionCheckLoading ||
      roleMentionConfirmationLoading ||
      pendingRoleMentionConfirmation ||
      inputDisabled ||
      attachments.pendingCount > 0
    )
      return;
    if (isEditing) {
      await editMessage();
    } else {
      await createMessage();
    }
  }

  function cancelEdit() {
    autocomplete.reset();
    editState.cancelEdit();
    message = '';
    manualRichMode = false;
    editorApi?.setContent('');
  }

  // Handle keyboard events from TipTap editor.
  // Return true to prevent TipTap's default handling.
  function handleEditorKeyDown(event: KeyboardEvent): boolean {
    // Handle emoji autocomplete keyboard events first
    if (autocomplete.emoji && autocomplete.emojiRef) {
      if (autocomplete.emojiRef.handleKeyDown(event)) {
        return true;
      }
    }

    // Handle mention autocomplete keyboard events
    if (autocomplete.mention && autocomplete.mentionRef) {
      if (autocomplete.mentionRef.handleKeyDown(event)) {
        return true;
      }
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && prefersTouchActions()) {
      return false;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.metaKey || event.ctrlKey) {
        if (isRichComposer) {
          handleSubmit(); // Fire-and-forget (async, but keydown must return sync)
        } else {
          manualRichMode = true;
          editorApi?.insertBlockBreak();
        }
        return true;
      }

      if (!isRichComposer) {
        if (canSubmit) {
          handleSubmit(); // Fire-and-forget (async, but keydown must return sync)
          return true;
        }
      } else if (nextEnterWillSend) {
        handleSubmit(); // Fire-and-forget (async, but keydown must return sync)
        return true;
      }
    }

    // Handle Tab for @mention autocomplete
    if (event.key === 'Tab') {
      if (autocomplete.handleTabCompletion(event)) {
        return true;
      }
      // If no completion happened, let default Tab behavior occur
    }

    // Reset tab-completion state on any other key
    if (event.key !== 'Tab') {
      autocomplete.resetTabCompletion();
    }

    if (event.key === 'Escape') {
      if (isEditing) {
        cancelEdit();
        return true;
      }
      if (inReplyTo && onCancelReply) {
        onCancelReply();
        return true;
      }
      if (onEscape) {
        onEscape();
        return true;
      }
    }

    // Up arrow on empty input: edit last message
    if (event.key === 'ArrowUp' && !isEditing && (editorApi?.getText() ?? '').trim() === '') {
      const lastMsg = lastEditableMessageCtx?.getLastEditableMessage();
      if (lastMsg) {
        editState.startEdit(lastMsg.eventId, lastMsg.body, {
          threadRootEventId: lastMsg.threadRootEventId,
          channelEchoEventId: lastMsg.channelEchoEventId,
          canAddChannelEcho: lastMsg.canAddChannelEcho
        });
        return true;
      }
    }

    return false; // Let TipTap handle it (e.g., Shift+Enter for hard break)
  }

  // Handle content updates from TipTap editor
  function handleEditorUpdate(text: string) {
    const previousMessage = message;
    message = text;
    if (!text) {
      manualRichMode = false;
    }
    // Only trigger typing indicator for actual user input.
    // Programmatic setContent calls suppress TipTap update events, but this
    // guard still protects any same-value editor update from emitting typing.
    if (text !== previousMessage) {
      onTyping?.();
    }
    autocomplete.update();
  }

  function handleRichStructureChange(value: boolean) {
    editorHasRichStructure = value;
  }

  // Called when TipTap editor is ready - sync any pending state
  function handleEditorReady(api: TipTapEditorApi) {
    editorApi = api;
    // Sync current message state (may have draft loaded before editor was ready)
    if (message) {
      api.setContent(message);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  {@attach observeComposerResize}
  class="flex flex-col gap-2 p-2"
  onclick={(e) => {
    if (!(e.target as HTMLElement).closest('button, a, input, label, select, .tiptap')) {
      editorApi?.focus();
    }
  }}
>
  <!-- Link / message preview -->
  {#if linkPreviews.activeURL}
    {@const url = linkPreviews.activeURL}
    {@const messageLink = parseMessageLink(url)}
    {#if messageLink}
      <MessagePreviewCard link={messageLink} onDismiss={() => linkPreviews.dismissPreview(url)} />
    {:else if linkPreviews.fetchingURLs.has(url)}
      <LinkPreviewSkeleton />
    {:else if linkPreviews.previews.get(url)}
      <LinkPreviewCard
        preview={linkPreviews.previews.get(url)!}
        onDismiss={() => linkPreviews.dismissPreview(url)}
      />
    {/if}
  {/if}

  <!-- Selected files preview -->
  {#if attachments.filesWithUrls.length > 0}
    <div class="flex flex-wrap gap-2 rounded-lg bg-surface-300 p-2">
      {#each attachments.filesWithUrls as { file, url }, index (url)}
        <div class="relative">
          {#if file.type.startsWith('image/')}
            <img src={url} alt={file.name} class="h-16 w-16 rounded-md object-cover" />
          {:else if isVideoAttachmentFileCandidate(file)}
            <!-- Browser renders the first frame as a thumbnail from the object URL -->
            <video
              data-testid="video-attachment-preview"
              src="{url}#t=0.1"
              preload="metadata"
              muted
              class="h-16 w-16 rounded-md object-cover"
            ></video>
          {:else if file.type.startsWith('audio/')}
            <div
              data-testid="audio-attachment-preview"
              class="flex h-16 w-16 items-center justify-center rounded-md bg-surface-200"
            >
              <span class="iconify text-lg text-muted uil--music"></span>
            </div>
          {:else}
            <div
              data-testid="file-attachment-preview"
              class="flex h-16 w-16 items-center justify-center rounded-md bg-surface-200"
            >
              <span class="text-xs text-muted">{file.name.split('.').pop()}</span>
            </div>
          {/if}
          <button
            type="button"
            onclick={() => removeFile(index)}
            class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Hidden file input -->
  {#if canAttach && !isEditing}
    <input
      bind:this={fileInputElement}
      type="file"
      multiple
      onchange={handleFileSelect}
      class="hidden"
    />
  {/if}

  <!-- Unified input container -->
  <div
    data-testid="message-composer-shell"
    class={[
      'composer-focus-shell relative flex min-h-15 items-center gap-3 rounded-xl bg-surface py-2 pr-2',
      isEditing ? 'pl-3' : 'pl-2'
    ]}
    class:opacity-50={inputDisabled}
    class:sending={loading}
  >
    <!-- Emoji autocomplete popup -->
    {#if autocomplete.emoji}
      <EmojiAutocomplete
        bind:this={autocomplete.emojiRef}
        query={autocomplete.emoji.query}
        onSelect={handleEmojiSelect}
        onClose={closeEmojiAutocomplete}
      />
    {/if}

    <!-- Mention autocomplete popup -->
    {#if autocomplete.mention}
      <MentionAutocomplete
        bind:this={autocomplete.mentionRef}
        query={autocomplete.mention.query}
        members={mentionCandidateMembers}
        roles={mentionRoles}
        onSelect={handleMentionSelect}
        onClose={closeMentionAutocomplete}
      />
    {/if}

    {#if emojiPickerOpen && emojiPickerAnchor}
      <ContextMenu
        anchor={emojiPickerAnchor}
        presentation="floating"
        role="dialog"
        ariaLabel={m['emoji.open_picker']()}
        class="w-[min(22rem,calc(100vw-1rem))] overflow-hidden"
        onclose={closeDesktopEmojiPicker}
      >
        <ComposerEmojiPicker
          serverId={getActiveServer()}
          onSelect={handleDesktopEmojiSelect}
          onClose={closeDesktopEmojiPickerAndFocus}
        />
      </ContextMenu>
    {/if}

    <!-- Attachment button - hidden in edit mode (editMessage only supports text) -->
    {#if !isEditing && canAttach && !voiceRecorderActive}
      <button
        type="button"
        onclick={() => fileInputElement?.click()}
        disabled={inputDisabled}
        class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-[color,background-color,scale] duration-100 active:scale-[0.96] enabled:hover:bg-surface-highlighted enabled:hover:text-text disabled:cursor-not-allowed"
        title={m['composer.attach_file']()}
        aria-label={m['composer.attach_file']()}
      >
        <span class="iconify text-xl uil--file-upload"></span>
      </button>
    {/if}

    <!-- Text input (TipTap editor) -->
    {#await tipTapEditorModule}
      <div class="min-h-11 min-w-0 flex-1 py-1" aria-hidden="true"></div>
    {:then { default: TipTapEditor }}
      <TipTapEditor
        placeholder={currentPlaceholder}
        editable={!inputDisabled}
        autofocus={autoFocus && shouldAutoFocus()}
        {testid}
        onUpdate={handleEditorUpdate}
        onKeyDown={handleEditorKeyDown}
        onPaste={handlePaste}
        onNextEnterWillSendChange={(value) => (editorNextEnterWillSend = value)}
        onRichStructureChange={handleRichStructureChange}
        onReady={handleEditorReady}
      />
    {/await}

    <div class="flex h-11 shrink-0 items-center gap-1">
      {#if !voiceRecorderActive}
        {#if submitHint && canSubmit}
          <span
            aria-hidden="true"
            title={submitHint}
            class="px-0.5 text-xs leading-none font-medium whitespace-nowrap text-muted/75"
          >
            {submitHint}
          </span>
        {/if}
      {/if}

      {#if canUseDesktopEmojiPicker && !voiceRecorderActive}
        <button
          bind:this={emojiPickerTriggerElement}
          data-testid="composer-emoji-button"
          type="button"
          onpointerdown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onclick={toggleDesktopEmojiPicker}
          disabled={inputDisabled || !editorApi}
          class={[
            'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-[color,background-color,scale] duration-100 active:scale-[0.96] enabled:hover:bg-surface-highlighted enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-50',
            emojiPickerOpen && 'bg-surface-highlighted text-text'
          ]}
          aria-label={m['emoji.open_picker']()}
          aria-haspopup="dialog"
          aria-expanded={emojiPickerOpen}
          title={m['emoji.open_picker']()}
        >
          <span class="iconify text-xl uil--smile" aria-hidden="true"></span>
        </button>
      {/if}

      {#if !isEditing && canVoice}
        <VoiceMessageRecorder
          disabled={inputDisabled || loading || roleMentionCheckLoading || hasComposerText}
          maxUploadSize={serverInfo.maxVoiceMessageUploadSize}
          onSend={sendVoiceMessage}
          onActiveChange={(active) => (voiceRecorderActive = active)}
        />
      {/if}

      {#if !voiceRecorderActive}
        <!-- Send button -->
        <button
          type="button"
          data-testid="message-send-button"
          data-ready={hasSendableText && canSubmit ? 'true' : 'false'}
          onpointerdown={(e) => e.preventDefault()}
          onclick={handleSubmit}
          disabled={!canSubmit}
          class={[
            'composer-send-button flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted active:scale-[0.96] enabled:hover:bg-surface-highlighted disabled:cursor-not-allowed disabled:opacity-50',
            hasSendableText && canSubmit && 'composer-send-button--ready'
          ]}
          aria-label={m['composer.send']()}
          title={isRichComposer ? m['composer.send_ctrl_enter']() : m['composer.send_enter']()}
        >
          <span class="iconify text-xl uil--telegram-alt"></span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Also send to channel checkbox (thread replies only, when permitted) -->
  {#if (showAlsoSendToChannel && !isEditing) || showEditEchoCheckbox}
    <label class="flex cursor-pointer items-center gap-2 px-3 text-sm text-muted">
      <input
        type="checkbox"
        bind:checked={alsoSendToChannel}
        disabled={inputDisabled}
        class="cursor-pointer accent-primary"
      />
      {m['composer.also_send_to_channel']()}
    </label>
  {/if}

  <!-- Reply indicator -->
  {#if inReplyTo && replyDisplayName}
    <div
      data-testid="reply-indicator"
      class="flex items-center justify-between rounded-md bg-surface-200 px-3 py-2 text-sm"
    >
      <span class="min-w-0 truncate text-text">
        {m['composer.replying_to']()} <strong>{replyDisplayName}</strong>
        {#if replyExcerpt}
          <span class="text-muted"> &mdash; {replyExcerpt}</span>
        {/if}
      </span>
      <!-- Desktop: clickable "Esc to cancel" -->
      <button
        type="button"
        onclick={() => onCancelReply?.()}
        class="hidden shrink-0 cursor-pointer items-center gap-1 text-muted transition-colors hover:text-text sm:flex"
      >
        <kbd class="rounded bg-surface-300 px-1.5 py-0.5 text-xs">Esc</kbd>
        {m['composer.esc_to_cancel']()}
      </button>
      <!-- Mobile: visible "Cancel" button -->
      <button
        type="button"
        onclick={() => onCancelReply?.()}
        class="shrink-0 cursor-pointer rounded bg-surface-300 px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-highlighted sm:hidden"
      >
        {m['common.cancel']()}
      </button>
    </div>
  {/if}

  <!-- Edit mode indicator -->
  {#if isEditing}
    <div class="flex items-center justify-between rounded-md bg-surface-200 px-3 py-2 text-sm">
      <span class="text-text">{m['composer.editing']()}</span>
      <!-- Desktop: clickable "Esc to cancel" -->
      <button
        type="button"
        onclick={cancelEdit}
        class="hidden cursor-pointer items-center gap-1 text-muted transition-colors hover:text-text sm:flex"
      >
        <kbd class="rounded bg-surface-300 px-1.5 py-0.5 text-xs">Esc</kbd>
        {m['composer.esc_to_cancel']()}
      </button>
      <!-- Mobile: visible "Cancel" button -->
      <button
        type="button"
        onclick={cancelEdit}
        class="cursor-pointer rounded bg-surface-300 px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-highlighted sm:hidden"
      >
        {m['common.cancel']()}
      </button>
    </div>
  {/if}
</div>

{#if pendingRoleMentionConfirmation}
  <ConfirmDialog
    title={m['composer.role_mention_confirm_title']()}
    tone="warning"
    actionLabel={m['composer.send_anyway']()}
    actionIcon="iconify uil--telegram-alt"
    loading={roleMentionConfirmationLoading}
    onconfirm={confirmRoleMentionSend}
    onclose={cancelRoleMentionConfirmation}
  >
    {m['composer.role_mention_confirm_body']()}
  </ConfirmDialog>
{/if}

<style>
  @property --composer-orbit-angle {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }

  .composer-focus-shell {
    --composer-focus-orange: #e8783b;
    --composer-focus-highlight: #f9a763;
    isolation: isolate;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.24);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border) 72%, transparent);
    transition:
      background-color 160ms ease,
      box-shadow 180ms ease;
  }

  .composer-focus-shell:focus-within {
    box-shadow:
      inset 0 0 0 1px rgba(232, 120, 59, 0.78),
      0 0 0 1px rgba(232, 120, 59, 0.28),
      0 0 1.15rem rgba(232, 120, 59, 0.24);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--composer-focus-orange) 78%, transparent),
      0 0 0 1px color-mix(in srgb, var(--composer-focus-orange) 28%, transparent),
      0 0 1.15rem color-mix(in srgb, var(--composer-focus-orange) 24%, transparent);
  }

  .composer-focus-shell :global([data-testid='voice-message-record-button']) {
    transition:
      color 140ms ease,
      background-color 140ms ease,
      opacity 140ms ease,
      transform 100ms ease;
  }

  .composer-focus-shell :global([data-testid='voice-message-record-button']:disabled) {
    color: var(--color-muted);
    opacity: 0.38;
  }

  .composer-send-button {
    transition:
      color 150ms ease,
      background-color 150ms ease,
      opacity 150ms ease;
  }

  .composer-send-button--ready {
    color: #e8783b;
    color: var(--composer-focus-orange);
  }

  .composer-send-button--ready > span {
    animation: composer-send-float 2.2s ease-in-out infinite;
    will-change: transform;
  }

  .composer-send-button--ready:hover {
    color: #f9a763;
    color: var(--composer-focus-highlight);
    background-color: rgba(232, 120, 59, 0.1);
    background-color: color-mix(in srgb, var(--composer-focus-orange) 10%, transparent);
  }

  @supports ((mask-composite: exclude) or (-webkit-mask-composite: xor)) {
    .composer-focus-shell::before {
      position: absolute;
      z-index: 2;
      inset: 0;
      padding: 1px;
      border-radius: inherit;
      background: conic-gradient(
        from var(--composer-orbit-angle),
        transparent 0deg 270deg,
        color-mix(in srgb, var(--composer-focus-orange) 26%, transparent) 294deg,
        var(--composer-focus-highlight) 316deg,
        var(--composer-focus-orange) 334deg,
        transparent 360deg
      );
      content: '';
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease;
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
    }

    .composer-focus-shell:focus-within::before {
      animation: composer-focus-orbit 3.2s linear infinite;
      opacity: 0.92;
    }
  }

  .sending {
    position: relative;
    overflow: hidden;
    background: linear-gradient(
      90deg,
      var(--color-surface) 0%,
      var(--color-surface-highlighted) 50%,
      var(--color-surface) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes composer-focus-orbit {
    to {
      --composer-orbit-angle: 360deg;
    }
  }

  @keyframes composer-send-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-0.75px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-focus-shell,
    .composer-focus-shell::before,
    .composer-send-button,
    .composer-focus-shell :global([data-testid='voice-message-record-button']) {
      transition: none;
    }

    .composer-focus-shell:focus-within::before {
      animation: none;
      opacity: 0;
    }

    .composer-send-button--ready > span,
    .sending {
      animation: none;
    }

    .composer-send-button--ready > span {
      transform: none;
      will-change: auto;
    }
  }
</style>
