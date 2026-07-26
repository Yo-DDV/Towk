# FDR-019: Room Lifecycle

**Status:** Active  
**Last reviewed:** 2026-07-26

## Overview

A channel room moves through create, edit, archive, unarchive, ordinary delete, and — for server owners only — permanent purge after archive. Each transition is permission-gated and, where appropriate, represented by durable events. This record covers channel rooms; direct-message lifecycle is defined by FDR-007.

## Behavior

- **Create** — `room.create` holders create a channel room with a unique URL-safe name, optional description, room group, and optional Universal setting.
- **Edit** — `room.manage` holders may change room metadata, group placement, Universal state, and explicit membership.
- **Archive** — `room.manage` sets the archived flag. The room disappears from normal sidebar, directory, and search surfaces while its membership and history remain intact.
- **Unarchive** — the same permission clears the archived flag and returns the room to discovery surfaces.
- **Ordinary delete** — `room.manage` appends `RoomDeletedEvent`, removes the room from its group and projections, and retains historical EVT facts for replay and audit.
- **Permanent purge** — a current server owner may permanently erase an archived channel room from the server-admin Rooms page. The owner must enter the room's current name exactly. The operation removes the room's messages and private body facts, threads and follows, reactions, calls and call keys, memberships and bans, room-scoped RBAC, room-level notification preferences and read state, room-owned attachments and derivatives, and exclusively referenced managed link-preview images. It retains only the minimum room and asset tombstones required to prevent replay resurrection.
- **PWA cleanup** — after a successful purge, and whenever `RoomDeletedEvent` is observed later, the client removes the exact room's encrypted drafts, draft files, cached timelines, and queued outbox messages from the authenticated server/account scope. Other rooms and accounts are untouched.
- Moving a room between groups still requires `room.manage` in both groups; see FDR-017.

## Permanent purge API

- `GET /api/admin/room-purge-capability` returns `{ "canPurgeArchivedRooms": boolean }` for an authenticated viewer. It reports `true` only for an effective server owner and only while the durable replica-cleanup projector is healthy.
- `POST /api/admin/rooms/{roomID}/purge` accepts the strict JSON body `{ "confirmation": "<exact room name>" }`.
- Cookie-authenticated origin requests use the normal CSRF header. Remote-server requests use bearer authentication.
- Unknown fields, trailing JSON, oversized bodies, forged identifiers, empty confirmation, non-owner callers, and active rooms are rejected server-side.
- Success returns aggregate deletion counts and `alreadyPurged`; it never returns message text, filenames, object keys, or other room content.
- Responses are `private, no-store` and `nosniff`. Retryable conflicts carry a bounded `Retry-After` value.
- Older servers that do not expose the capability endpoint simply do not show the destructive UI. There is no fallback to ordinary deletion.

## Design Decisions

### 1. Room names remain unique through EVT projection and OCC

**Decision:** Room names are unique server-wide, case-insensitively. Name-changing writes use a room-catalog snapshot and wildcard OCC against the room aggregate event set.

**Why:** Two operators must not be able to claim the same name concurrently, and EVT remains the source of truth without a second KV name index.

**Tradeoff:** Conflicts wait for projection catch-up and retry instead of performing a single KV claim.

### 2. Every channel room belongs to exactly one group

**Decision:** Channel rooms have a group. The public create API requires one; bootstrap paths may fall back to the seed group.

**Why:** Required grouping keeps sidebar order and permission resolution free of an "ungrouped" branch.

**Tradeoff:** Bulk creation tools must choose a destination group.

### 3. Archive is reversible state

**Decision:** Archive is a boolean. The room stays in the same aggregate and retains history and memberships.

**Why:** Archive means "hide without losing history" and must be reversible without reconstructing membership.

**Tradeoff:** Every discovery surface must consistently filter archived rooms.

### 4. Ordinary delete remains a durable tombstone

**Decision:** Ordinary deletion appends `RoomDeletedEvent`; historical room facts remain.

**Why:** Ordinary delete preserves the event-sourced forensic trail and replay semantics.

**Tradeoff:** Historical facts consume storage. Owners needing content erasure must stage the room through archive and permanent purge.

### 5. Permanent purge is owner-only

**Decision:** Permanent purge is not an editable RBAC permission. The caller must be a current effective server owner, and the room must already be archived.

**Why:** The operation is irreversible and destroys content that delegated room managers are normally expected to preserve. Archive provides a deliberate reversible staging step.

**Tradeoff:** Delegated administrators cannot perform the operation.

### 6. Exact confirmation identifies the destructive target

**Decision:** The request must contain the room's current name with exact case and character equality.

**Why:** A generic checkbox does not prove that the operator has identified the specific room.

**Tradeoff:** Renaming a room before purge changes the required confirmation. An interrupted post-tombstone purge resumes only with the original confirmed name, protected by a server-keyed HMAC marker that does not store it in clear text.

### 7. Destructive stream operations accept typed exact aggregates only

**Decision:** Secure deletion accepts only canonical exact room, scoped-RBAC, or asset aggregates. Raw subject filters and wildcard roots are rejected before a consumer is created.

**Why:** `evt.>`, `evt.room.>`, or a forged identifier must never widen one-room deletion to the instance.

**Tradeoff:** Related config facts that live outside the room aggregate require a narrow payload-and-subject verified scan.

### 8. Tombstone-first, OCC, lease, and bounded quiescence

**Decision:** A distributed per-room lease serializes purge attempts. The backend publishes an OCC-protected `RoomDeletedEvent` before physical erasure, records a resumable runtime marker, performs exact cleanup passes, and requires two stable observations separated by a quiet interval before completion.

**Why:** Crashes, retries, stale writers, and multiple replicas must not leave the room without an anti-resurrection marker or silently declare success while late data remains.

**Tradeoff:** A purge can return a retryable conflict while another attempt holds the lease or while late writes are being reconciled.

### 9. Projection cleanup is part of erasure correctness

**Decision:** Every replica runs a durable narrow projector for room-deletion tombstones. It waits for core projections to become current, then releases only the target room's timeline bodies, threads/follows, reactions, RBAC, preferences, and call state. A fatal cleanup-projector failure makes the serving replica unavailable.

**Why:** Removing shared JetStream facts is insufficient if a sibling process still retains decrypted room content in memory.

**Tradeoff:** Permanent-purge capability remains unavailable until the cleanup projector is healthy and current.

### 10. Asset ownership must be proven

**Decision:** Room-owned attachment aggregates are deleted only when projection evidence binds them to the target room. Managed link-preview images are deleted only when no other room references them and the dedicated preview object store proves the compatibility object. Ambiguous legacy or same-named generic server assets are retained.

**Why:** A corrupt message body or identifier collision must not erase another room's media, branding, avatar, or shared preview.

**Tradeoff:** Ambiguous legacy bytes may require operator review rather than unsafe automatic deletion.

### 11. Active calls are evicted and call keys are shredded

**Decision:** The purge enumerates LiveKit participants for the exact room, removes only those participants, validates canonical call-key references, and shreds the corresponding keys before completion.

**Why:** A deleted room must not remain live through the media plane, and key material must not survive the room's content.

**Tradeoff:** If LiveKit or the key store is unavailable, the purge stops safely and remains resumable.

### 12. Existing backups are not rewritten

**Decision:** Purge affects the active instance and its current object stores. Towk does not discover or mutate operator-controlled backups, snapshots, or exported archives.

**Why:** Backup media is outside the application's safe authority and may contain unrelated recovery data.

**Tradeoff:** Restoring a pre-purge backup may reintroduce the room. The owner must run purge again before returning that restored instance to service.

## Permissions

- `room.create` — create a channel room in a group.
- `room.manage` — edit, archive, unarchive, ordinary-delete, change Universal state, and manage explicit membership.
- `room.ban-member` — manage channel-room bans.
- `room.join` — controls explicit join and Universal effective membership.
- **Server owner** — permanently purge an archived channel room. This capability is deliberately not delegated through the editable permission matrix.

## UX, responsive, and accessibility

The destructive action appears only for archived rooms after the backend confirms owner capability. It uses a selected red trash action and a separate irreversible confirmation dialog. The dialog lists the deleted data categories, explains the backup boundary, requires exact confirmation, keeps errors visible for retry, and cannot be dismissed while the request is active. It becomes full-screen when width or height is constrained, respects safe areas, restores focus, supports keyboard and touch input, preserves real disabled states, supports forced colors, and reduces motion when requested. User-visible copy is provided in English, French, German, Spanish, and Portuguese.

## Rollback and recovery

- Source rollback removes the feature but cannot reconstruct content or binaries already erased.
- An interrupted purge is retried with the same room ID and exact original confirmation; the HMAC-protected marker resumes cleanup.
- Minimal room and asset tombstones remain so cold replay cannot resurrect the purged catalog entry or room-owned assets.
- Restoring an older backup creates newly active data; purge must be rerun on that restored instance before reopening it to users.

## Related

- **ADRs:** ADR-007, ADR-031, ADR-033, ADR-034, ADR-036
- **FDRs:** FDR-001, FDR-007, FDR-008, FDR-009, FDR-016, FDR-017, FDR-027
