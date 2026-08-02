# FDR-033: Composer Upload Progress

**Status:** Active
**Last reviewed:** 2026-08-02

## Overview

Towk surfaces the complete client-side lifecycle of message attachments in a compact status island positioned immediately above the composer that initiated the send. The same lifecycle covers images, videos, generic files, ordinary audio attachments, and recorded voice messages.

This record complements [FDR-008](FDR-008-file-attachments-and-video.md) and [FDR-029](FDR-029-voice-messages.md). It does not change the upload protocol, attachment policy, message schema, or server-side processing model.

## Behavior

- The island appears as soon as the client starts hashing the first attachment.
- Preparation and server finalization are explicit indeterminate phases; Towk does not invent byte progress for work the server has not committed.
- During transfer, the progress bar uses the sum of `AssetUpload.committed_offset` values across every attachment in the message.
- Multi-file sends identify the file currently reporting progress and show its position in the batch.
- Elapsed time is always available. Remaining time appears only after a bounded sample window has enough committed-byte movement to calculate a meaningful rate.
- The lifecycle continues through message creation and local conversation confirmation. A completed file upload is never presented as a confirmed message.
- A successful confirmation remains visible briefly, then dismisses automatically.
- An upload failure remains visible and offers a retry through the originating composer after its draft has been restored. A failure after message creation started is labelled as unconfirmed and does not offer an unsafe duplicate-send shortcut.
- Status is keyed by server, room, thread root, and client request ID. Root-room and thread composers can therefore upload concurrently without overwriting each other.
- The island follows the matching composer through viewport resize, zoom, scrolling, software-keyboard changes, and installed-PWA visual viewport changes.
- Every visible string is localized in English, French, German, Spanish, and Portuguese.

## Design decisions

### 1. Progress is based on committed server offsets

**Decision:** Byte progress advances only from the offset returned by `UploadChunk` or recovered by `GetUpload`.

**Why:** Browser bytes read, encoded, or placed on the network are not proof that the server accepted them. Committed offsets remain monotonic across retries and resumptions.

**Tradeoff:** Hashing and finalization stay indeterminate even when they take noticeable time.

### 2. The status surface is global but composer-anchored

**Decision:** Upload state lives in a small client store keyed by the idempotent message request ID. A root overlay positions each island relative to the matching room or thread composer.

**Why:** The API client owns the real upload lifecycle, while the composer may be replaced during route or viewport changes. Keeping the state outside a particular component instance prevents stale callbacks from corrupting a new composer and supports simultaneous room and thread sends.

**Tradeoff:** Positioning depends on the stable composer test IDs already used by the frontend suite. Missing anchors hide the island rather than placing it over an unrelated control.

### 3. ETA is deliberately conservative

**Decision:** ETA requires at least one second and 64 KiB of committed movement inside a 15-second, 12-sample window. Estimates are smoothed and capped at 24 hours.

**Why:** Early samples on mobile networks are noisy. A delayed, bounded estimate is more useful than a constantly jumping number.

### 4. Accessibility does not announce every chunk

**Decision:** The native progress element exposes determinate values. A separate polite status region announces phase changes and progress in 10-percent buckets.

**Why:** Announcing every chunk overwhelms screen-reader users, while a progressbar alone does not communicate all lifecycle phases.

## Compatibility and rollback

The change is frontend-only. No protobuf, persisted event, storage, permission, upload limit, encryption boundary, or mixed-version contract changes. Older clients continue to upload normally without the island; newer clients work with the existing `AssetUploadService` responses.

Rollback consists of reverting the frontend commit. Open upload sessions continue to follow the server's existing cancellation and expiry behavior, and no data migration is required.
