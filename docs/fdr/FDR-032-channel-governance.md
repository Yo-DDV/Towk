# FDR-032: Channel lock and message-history purge

**Status:** Active
**Last reviewed:** 2026-07-31

## Summary

Channel rooms expose two separate governance controls:

- **Lock / unlock** changes whether members may add content while preserving
  reading, calls, membership, layout, moderation, and subtractive cleanup.
- **Purge message history** advances a durable history epoch, immediately hides
  earlier message-owned facts, then securely removes their stored events and
  assets without deleting the room.

Direct-message rooms are outside this feature.

## Authorization

Three room-scoped permissions are independent from `room.manage`:

- `room.lock`
- `room.purge-messages`
- `room.bypass-lock`

The owner override still applies. Existing and fresh standard roles receive no
automatic grant; all three permissions must be delegated intentionally.

## Lock semantics

`RoomPostingPolicy` is `OPEN` or `LOCKED`; legacy `UNSPECIFIED` values are read
as `OPEN`. A locked channel rejects additive content, including root messages,
thread replies, new reactions, attachments, voice messages, typing signals,
and message edits. Retractions and reaction removals remain available.

Every durable room mutation shares the room aggregate wildcard OCC fence.
Lock, unlock, and purge commands therefore accept the last room revision the
client observed and return a conflict instead of silently crossing a concurrent
message or governance write.

## Purge semantics

Purge requires `room.purge-messages`, a fresh runtime credential (or a current
password proof), the exact current room name, and an exact room revision.

The command first appends `RoomHistoryPurgedEvent`. This event advances
`history_epoch` and is the logical barrier: timeline, thread, reaction, search,
notification, and offline readers must stop exposing earlier message-owned
facts immediately. Physical cleanup is idempotent and selective:

- delete message posts, bodies, edits, retractions, threads, reactions, and
  message-owned assets at or before the barrier;
- retain room lifecycle, membership, room RBAC, layout, bans, notification
  preferences, and voice-call lifecycle;
- retain the purge barrier and all events written after it.

An operation record reports running, completed, or a stable failure code. A
failed cleanup never reopens the old logical epoch and may be safely retried.

Chunked upload sessions capture the room history epoch at creation and cannot
complete across a purge barrier. Supported PWA clients use a history-reset path
separate from permanent room deletion: cached timelines and outbox entries are
removed for the exact account/room scope. Legacy drafts, which predate epoch
and provenance metadata, fail closed and are removed rather than restored.

## User interface and responsive behavior

The current room header exposes a compact options control. Lock state remains
visible in the header, sidebar, and composer. The options control reuses the
touch action sheet on mobile and foldable viewports; destructive confirmation
uses the bounded responsive form dialog. Controls keep a 44-pixel touch target,
keyboard focus management, descriptive labels, reduced-motion behavior, and no
horizontal overflow down to 320 CSS pixels.

The server administration Rooms page offers the same actions per row without
making the whole row draggable; only the drag handle initiates reordering.

## Verification

Required coverage includes:

- permission defaults, owner override, delegated grants, and DM rejection;
- wildcard-OCC lock/post and purge/post races;
- locked additive versus subtractive mutations, including bypass;
- logical barrier visibility before cleanup completion;
- selective cleanup survival across restart and idempotent retry;
- fresh-auth and exact-name confirmation;
- Connect API validation and stable error mapping;
- desktop, narrow mobile, foldable, keyboard, screen-reader, and reduced-motion
  component/browser checks;
- PWA cache invalidation by `history_epoch`.
