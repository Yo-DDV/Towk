# FDR-012: Notifications

**Status:** Active
**Last reviewed:** 2026-07-13

## Overview

Towk has a persistent notification system surfaced through a bell icon and notification center. Notifications represent things the user should pay attention to: DMs, @mentions of users/roles/virtual groups, and every root or thread message in rooms using the default ALL_MESSAGES level. Notification levels are configurable per server and per room.

## Behavior

- A bell icon shows an unread count and opens the notification center listing recent notifications.
- A notification appears for every non-muted DM, for a mention that resolves to the user in a NORMAL or ALL_MESSAGES channel room, or for every root and thread message in a channel room set to ALL_MESSAGES. Replies and followed threads do not bypass an explicit NORMAL opt-down unless the reply also mentions the recipient.
- Mention notifications may come from direct `@username`, role `@role`, `@all`, or `@here` mentions. The bundled composer asks for confirmation before sending role, `@all`, or `@here` mentions, while API callers can post authorized messages directly.
- Notifications auto-expire after 90 days.
- Dismissing a notification removes it everywhere — across all the user's open tabs and devices.
- A notification sound plays and the in-app and installed PWA notification badges update in real time as new notifications arrive.
- The installed PWA dock badge reflects pending notifications only; ordinary unread rooms stay in the in-app sidebar unless the user has configured them to create notifications.
- Users can choose and locally shape the notification sound on each browser with volume, tone, and effect controls.
- Sidebar orange dots for mentions, replies, DMs, and all-message subscriptions derive from pending notification records.
- A recipient's Do Not Disturb presence still stores new notifications and updates counts, but those creation events are silent: no notification sound and no web push while DND is active.

## Notification Levels

Per space and per room, the user picks one of four levels:

- **DEFAULT** — inherit from the parent (room → server → system default of ALL_MESSAGES).
- **MUTED** — suppress everything for this scope, including @mentions. The room doesn't even show as unread in the sidebar.
- **NORMAL** — unread markers remain visible, but channel-room notifications are limited to mentions. Direct messages still notify unless their room is explicitly muted.
- **ALL_MESSAGES** — a notification for every root and thread message in the room, with richer mention or reply notification types used where applicable.

An absent stored preference resolves to ALL_MESSAGES at read and delivery time. This semantic default applies equally to existing and newly created accounts without rewriting event history. Explicit NORMAL, MUTED, and room overrides remain authoritative user choices.

## Thread Follow

- Posting a reply in a thread automatically subscribes the user to that thread's reply notifications.
- A direct `@username` mention in a thread subscribes the mentioned user if they have never followed or explicitly unfollowed that thread before. Role mentions, `@all`, and `@here` notify according to mention rules but do not subscribe recipients.
- Thread followers can manually unfollow, and non-posters can manually follow.
- Followers receive a notification for new replies only when their effective room level is ALL_MESSAGES (skipping their own). Following still keeps the thread in My Threads when the user has opted down to NORMAL.
- Thread notifications respect room mute: a muted room produces no thread notifications even for followed threads.

## Design Decisions

### 1. Persistent notification model with live-event sync

**Decision:** Notifications are persistent objects stored per user in `RUNTIME_STATE` (`notification.{userId}.{notificationId}`), with a 90-day per-key TTL. Live events fire on create and dismiss to keep all the user's connected sessions in sync.
**Why:** Notifications need to survive a tab close (so the badge count is right when you come back tomorrow), and they need to be the same across devices. They are pending user-runtime state, not reconstructable content history, so `RUNTIME_STATE` is the right home. See ADR-012, ADR-028, and ADR-036.
**Tradeoff:** A notification dismissal anywhere clears it everywhere, even if the user wanted to dismiss only locally. The simpler model wins here — "I've seen it" is not device-specific.

### 2. Mute suppresses notifications AND unread

**Decision:** MUTED is stronger than "no pings": a muted room doesn't appear unread in the sidebar either.
**Why:** "Quiet" in chat apps often means "ignore this room completely". A user who mutes a room wants it out of their face, not just out of their alerts.
**Tradeoff:** Users who want "quiet but I still want to see if there's new stuff" don't have a third state. The two main modes (engage / ignore) cover the dominant use cases.

### 3. Mute trumps mentions

**Decision:** Mentioning a user in a muted room produces no notification. The mention text still highlights in the body if the user opens the room.
**Why:** Mute is the strongest "I don't want pings" signal. Allowing mentions through would defeat the muscle-memory of "mute the room to stop the spam".
**Tradeoff:** Coordinators can't reliably ping someone in a muted room. The mention still renders, so eventual visibility is preserved.

### 4. Thread auto-follow on post and direct mention

**Decision:** Posting in a thread automatically follows it, even if the poster previously unfollowed. A delivered direct `@username` mention inside a thread also follows the thread for that recipient, unless they explicitly unfollowed it before. Follow and unfollow state is represented by durable room-aggregate `ThreadFollowedEvent` and `ThreadUnfollowedEvent` facts, with a projection used for notification fanout and My Threads.
**Why:** People who participate in a thread almost always want to see the replies, and a direct mention makes the thread relevant to the recipient. Manual unfollow handles both the "I posted once and don't care any more" case and the "do not put this mentioned thread back in My Threads" case.
**Tradeoff:** A user who posts in many threads or is directly mentioned in many threads accumulates followed-thread subscriptions over time. The 90-day TTL on notifications limits the blast radius; the thread follow state itself is cheap to store.

### 5. Broadcast mentions are sender-controlled with bundled-client friction

**Decision:** `@all`, `@here`, and role mentions are allowed. The bundled
composer asks for confirmation before sending them, and muted recipients still
do not receive notifications. The server does not require a confirmation token
from API callers.
**Why:** Towk needs explicit operational pings for small teams and rooms, but broad pings should be deliberate in the main client. Keeping the safeguard in the client avoids making the integration API carry a client-shaped confirmation token that does not provide meaningful abuse protection.
**Tradeoff:** Operators and integrations can force attention in a room unless recipients have muted it. This is acceptable because mute remains authoritative and integrations can add their own policy or UX friction where appropriate.

### 6. ALL_MESSAGES is the receiver-controlled system default

**Decision:** Users without an explicit preference receive notifications for every root and thread message in every joined room. They can reduce delivery at server or room scope with NORMAL or MUTED; message authors cannot change a recipient's ambient-notification choice.
**Why:** A real-time chat client should surface messages immediately unless the recipient deliberately chooses less attention. Resolving an absent preference dynamically also upgrades existing accounts without a destructive backfill or overwriting explicit choices.
**Tradeoff:** Fresh and previously unconfigured accounts receive more notifications. The settings page, per-room overrides, DND, and mute controls remain the user's escape hatches.

### 7. Push notifications piggyback on persistent notifications

**Decision:** A push notification fires when a persistent notification is created. If no persistent notification is created (because the room is muted, etc.), no push is sent either.
**Why:** Pushes and in-app notifications are the same logical event presented in two surfaces. Sharing the gating logic ensures they can't diverge. See FDR-013.
**Tradeoff:** No way to receive a push without also generating a persistent notification. Considered desirable: a push you can't find later in the app would be annoying.

### 8. No parallel mention-status flag

**Decision:** @mention orange dots are derived from pending mention notifications. Towk does not maintain a separate `room_mention_status.*` flag.
**Why:** The separate flag duplicated notification state and had to be cleared in lockstep with notification dismissals and room reads. A single pending-notification model gives one source of truth for mention, reply, DM, and all-message attention indicators.
**Tradeoff:** Pending mention dots now have the same retention and dismissal semantics as notifications. This is deliberate: a mention that is no longer a pending notification is no longer pending attention.

### 9. Notification sound choice and shaping are local

**Decision:** Notification sound selection and sound-shaping controls are stored in browser-local preferences.
**Why:** They are playback-device preferences, not server behavior. Keeping them local matches the existing sound picker and avoids adding durable compatibility surface for an annoyance/subtlety control.
**Tradeoff:** A user who signs in on a new browser reconfigures sound taste there. Server-synced display settings remain separate.

### 10. Do Not Disturb silences alert delivery

**Decision:** Do Not Disturb is checked at notification creation time. While the recipient has live DND presence, Towk still creates the persistent notification and publishes a silent live sync event, but it suppresses legacy attention live events, notification sounds, and web push delivery.
**Why:** DND means "do not interrupt me now", not "discard things I should review later". Storing the notification preserves missed activity in the notification center and sidebar counts, while the silent marker lets clients update state without making noise.
**Tradeoff:** A user may see badge/sidebar changes while actively viewing Towk in DND. That is less disruptive than sound or push, and it avoids losing important mentions or DMs.

## Permissions

Notification preferences are user-scoped and don't require special permissions to manage. There's no permission gating the ability to mute or change levels.

## Related

- **ADRs:** ADR-012 (two-tier real-time events), ADR-028 (event-ID-keyed read state), ADR-036 (runtime state in `RUNTIME_STATE`), ADR-038 (room-owned thread state)
- **FDRs:** FDR-006 (@Mentions), FDR-007 (Direct Messages), FDR-013 (Web Push Notifications)
