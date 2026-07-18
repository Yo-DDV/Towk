# FDR-029: Voice Messages

**Status:** Active
**Last reviewed:** 2026-07-16

## Overview

Room members can record, review, send, and play first-class voice messages in channels and direct messages. Voice messages use Towk's existing room-scoped asset storage and message timeline, but carry validated duration and waveform metadata so clients can provide a purpose-built recorder and player instead of presenting them as generic audio files.

## Behavior

- A permitted member can start a voice recording from the message composer with one click or tap, see a live amplitude waveform and monotonic elapsed time, then stop, review, re-record, cancel, or send it.
- Recording stops automatically at 20 minutes. The composer warns before the limit and never infers duration from `MediaRecorder` chunk counts.
- The review step remains local until the user sends. Cancellation, navigation, errors, and component destruction stop every media track and release audio graphs, animation frames, timers, and object URLs.
- Sent voice messages render as a compact, keyboard-accessible waveform player with play/pause, seek, elapsed/remaining time, and playback-speed controls. Ordinary uploaded audio files keep the generic audio-file treatment.
- The same flow is available in channels, threads, and direct messages. Touch targets remain at least 44 by 44 CSS pixels and the layout fits supported phone, tablet, and desktop widths.
- If recording APIs, microphone access, or a compatible recording format are unavailable, Towk explains the limitation without disrupting text and file messaging.

## Design Decisions

### 1. Voice messages are typed assets, not filename conventions

**Decision:** A voice upload carries `VoiceMessageMetadata` containing measured duration and a bounded normalized amplitude envelope. That metadata is stored in the durable `AssetRecord`, propagated through asset and timeline APIs, and is absent for ordinary audio attachments.
**Why:** MIME type alone cannot distinguish a recording from a music or audio file. Durable typed metadata makes rendering deterministic across live delivery, reloads, direct messages, threads, and future clients.
**Tradeoff:** The public asset contract grows by one optional field and historical audio files remain generic unless deliberately migrated.

### 2. Existing chunked asset storage remains the byte transport

**Decision:** Voice recordings use `AssetUploadService` and the existing signed room-scoped asset pipeline. The browser records locally, computes SHA-256, uploads bounded chunks, completes the asset, then posts its asset ID through the normal message API.
**Why:** The existing path already provides resumable chunks, configured size limits, ownership, pending-asset expiry, NATS/S3 storage, signed reads, and message lifecycle cleanup. A parallel voice storage system would duplicate security and retention behavior.
**Tradeoff:** The review blob remains browser-local until send. The 20-minute cap, a 32 MiB voice-specific ceiling, and the deployment upload limit bound memory and network use.

### 3. Recording format is capability-negotiated, verified, and normalized

**Decision:** Clients choose a supported recorder format with `MediaRecorder.isTypeSupported`, preferring MP4/AAC when the browser can record it and falling back to WebM/Opus or Ogg/Opus where needed. The server accepts first-class voice metadata only for `audio/webm`, `audio/mp4`, or `audio/ogg`, validates duration and 24–96 finite waveform peaks, verifies the corresponding WebM, ISO-BMFF, or Ogg container signature, and normalizes non-MP4 voice uploads into an `audio/mp4` M4A/AAC asset before making the attachment durable. Process-local admission bounds concurrent normalization, and a completion waiting for capacity remains cancellable without starting `ffmpeg`.
**Why:** Browser recording formats differ, and playback support differs too. A Chrome or Android client may record WebM/Opus that an iPhone PWA cannot reliably play. Capability negotiation preserves recording reach, while server-side normalization gives all clients one playback-oriented asset format and server validation preserves the semantic contract.
**Tradeoff:** Browsers with `MediaRecorder` but none of the accepted formats cannot record a first-class voice message. Non-MP4 voice uploads require `ffmpeg` during upload completion; MP4 voice uploads remain accepted without transcoding. Generic audio upload remains available when `message.attach` allows it.

The browser lifecycle and format boundary follows [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [MDN `dataavailable`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event), [WebKit's MediaRecorder guidance](https://webkit.org/blog/11353/mediarecorder-api/), and the [MediaStream Recording specification](https://www.w3.org/TR/mediastream-recording/). These are volatile browser capabilities and must be rechecked before changing the support matrix.

### 4. Voice authorization is independent and rechecked

**Decision:** `message.voice` is configurable at server, room-group, and room scope. It gates typed voice upload creation, is rechecked at completion, and is rechecked again when the completed asset ID is posted. `message.attach` independently gates ordinary attachments; a mixed message requires both permissions. Deny-wins resolution and owner overrides remain unchanged.
**Why:** Operators need to allow voice messages without enabling arbitrary file uploads, or disable recordings in a sensitive room without disabling useful files. Rechecking closes permission-revocation windows between recording, upload, and send.
**Tradeoff:** A recording can become unsendable if an administrator revokes permission while it is being recorded or uploaded. The client preserves the local review state long enough to explain the failure and let the user cancel.

### 5. Waveform data is a compact envelope

**Decision:** The client stores 64 normalized amplitude peaks by default, within a server-enforced range of 24–96. Live recording animation may use a denser transient analyser buffer, but only the compact envelope is persisted.
**Why:** A small envelope is sufficient for recognition and seeking without storing raw analysis data or requiring server-side audio decoding.
**Tradeoff:** The persisted waveform is a visual summary rather than a sample-accurate representation.

## Permissions

- `message.voice` — record and send first-class voice messages. It applies at server, room-group, and room scope and is granted to `everyone` by default unless an explicit deny overrides it.
- `message.post` or `message.post-in-thread` — still required for the containing message.
- `message.attach` — not required for a voice-only message, but required when the same message also contains ordinary attachments.
- Room membership — still required for upload, post, and playback access.

## Related

- **ADRs:** ADR-004 (authorization at API boundary), ADR-040 (permission-only RBAC with owner override)
- **FDRs:** FDR-001 (Roles & Permissions), FDR-002 (Replies & Threads), FDR-007 (Direct Messages), FDR-008 (File Attachments & Video Processing)
