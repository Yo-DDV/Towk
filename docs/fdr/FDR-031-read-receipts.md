# FDR-031: Read Receipts

**Status:** Active
**Last reviewed:** 2026-07-26

## Overview

Room members can publish and inspect reciprocal read receipts for direct messages, group conversations, channels, and threads. The feature is enabled by default, can be disabled by an operator for the whole server, and can be disabled by each user from their profile preferences.

Read receipts are separate from private unread markers and notifications. Opting out stops publication and inspection of receipts, but the user's private unread state continues to advance so notification dismissal, room unread markers, and thread unread markers keep their existing behavior.

## Behavior

- A client publishes a receipt only for messages that are actually visible in the active timeline, while the document is visible and focused.
- A receipt is never published for the viewer's own message.
- Room and thread receipts use separate cursors. Reading a thread does not mark the room timeline as read, and reading the room timeline does not publish thread receipts.
- The compact message footer shows only a subdued receipt icon and reader count. Within an uninterrupted run from one author, only the final message renders the indicator.
- Opening the footer detail requests a paginated reader list for the selected message. Reader identities and timestamps are not part of the compact summary or realtime invalidation.
- Realtime invalidation contains only the room and optional thread root. It carries no reader identity, read timestamp, target message ID, sequence, envelope actor, or envelope creation time.
- If the server-wide switch is disabled, users cannot publish or inspect receipts. Existing private unread state remains unchanged.
- If a user disables read receipts, future visible reads are not published and the user cannot inspect reader lists. Reads made while disabled are not backfilled if the user re-enables the setting later.
- Previously published receipts remain historical unless the account or room lifecycle removes the corresponding state.
- Administrators do not gain visibility into direct messages, private rooms, or threads they cannot access as a current member.

## Design Decisions

### 1. Read receipts are reciprocal

**Decision:** A user can inspect receipts only when they also publish receipts and the server-wide feature is enabled.
**Why:** This keeps the privacy contract understandable and avoids a surveillance mode where a user can read other receipts while hiding their own.
**Tradeoff:** Operators cannot use read receipts as an administrative audit trail. Operational audit remains a separate feature.

### 2. Private unread state remains independent

**Decision:** Private unread markers continue to advance even when read receipts are disabled.
**Why:** Notification state and personal unread tracking are local user experience features. Disabling read receipts must not break unread badges, thread notifications, or notification dismissal.
**Tradeoff:** The code maintains two related but separate read-state surfaces: private unread cursors and public receipt cursors.

### 3. Disabled intervals are not backfilled

**Decision:** The server tracks opt-in generations and stores published receipt intervals separately from disabled periods. A later opt-in can advance from the new generation only.
**Why:** A user who opted out expects reads made during that period not to become public later.
**Tradeoff:** Receipt intervals are more explicit than a single cursor, but the privacy boundary is durable and testable.

### 4. Summaries are count-only by default

**Decision:** Message footers use bounded batch summaries that expose enabled state and reader counts. Realtime signals are anonymous room/thread invalidations. Reader identities and read timestamps are fetched only from the explicit detail action for one message.
**Why:** Counts are enough for the timeline affordance and avoid putting a rolling list of identities into every rendered message.
**Tradeoff:** Opening details requires a second request.

### 5. The server remains the authority

**Decision:** Membership, profile opt-in, server opt-in, message ownership, room/thread scope, and pagination are enforced by ConnectRPC handlers and core state, not by the Svelte client.
**Why:** Older clients, forged clients, and mixed-version clients must not bypass the privacy or membership boundary.
**Tradeoff:** The client still performs visibility detection to reduce unnecessary writes, but the write is accepted only when the server rules allow it.

## Permissions and visibility

- Current room membership is required to publish and inspect room receipts.
- Current thread access follows the existing room/thread membership model.
- The sender of a message is excluded from the receipt set for that message.
- Deleted accounts and room deletion clean up receipt state through the same lifecycle boundary as other room-owned user state.
- The profile switch controls publication and inspection for the current user only.
- The server switch controls the feature for the whole deployment.

## Related

- **ADRs:** ADR-004 (Authorization at the API Boundary), ADR-028 (Event-ID-Keyed Read State), ADR-033 (Event-Sourced State with Derived Projections), ADR-055 (Read Receipt Publication Boundary)
- **FDRs:** FDR-002 (Replies & Threads), FDR-007 (Direct Messages), FDR-012 (Notifications), FDR-020 (Server Branding & Configuration), FDR-022 (User Profile)
