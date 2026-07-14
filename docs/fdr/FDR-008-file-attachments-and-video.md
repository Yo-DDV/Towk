# FDR-008: File Attachments & Video Processing

**Status:** Active
**Last reviewed:** 2026-07-13

## Overview

Users can attach files to messages — images, videos, documents — via drag-and-drop, paste, or file picker. Images are dimensioned and resizable on the fly via signed URLs. When video processing is enabled, videos and animated GIFs are transcoded into web-friendly quality variants.

## Behavior

- The composer accepts files via drag-and-drop, paste, and a file picker button when the viewer has `message.attach`.
- Drag-and-drop and clipboard paste consume every browser-provided `File`, not only media MIME types. Text-only clipboard content still follows the normal editor paste path.
- Desktop clipboard paste consumes native file references before the editor sees them. If a browser exposes only a local `file:` reference and withholds the corresponding `File`, Towk shows an explicit compatibility error and never inserts or fetches the local path.
- Draft attachments persist across room switches inside the same session.
- Message attachments are uploaded through `chatto.api.v1.AssetUploadService` before message creation. The browser sends bounded unary chunks with SHA-256 checksums, then calls `MessageService.CreateMessage` with at most 10 unique completed attachment asset IDs.
- Default upload size limits: 25 MB for every file, including original videos when video processing is disabled; enabling video processing gives videos a separate 100 MB default limit.
- A message can contain at most 10 attachments. Direct executable, installer, command-script, WebAssembly, and macro-enabled Office payloads are rejected before staging when their metadata identifies them, then checked again from the uploaded bytes before an asset is created. Ordinary archives remain allowed as opaque files and are never extracted by the upload path.
- `SERVER_ASSETS` has a default hard JetStream quota of 10 GB. Operators can set `core.assets.max_store_bytes` or `CHATTO_CORE_ASSETS_MAX_STORE_BYTES`; S3 bucket quotas remain provider-managed.
- Videos are always accepted as original attachments under the active upload limit. When processing is disabled, Towk stores and renders the original without creating a processing manifest. When processing is enabled, videos use the video-specific limit and additionally receive thumbnails and web-friendly variants.
- Images are inspected for dimensions at upload time and can be resized at render time via URL parameters (width, height, fit mode). Public attachment and avatar APIs expose transform parameters; public server branding images expose canonical URLs only.
- The room timeline loads attachment images within 960×400 bounds, while the lightbox loads a separate derivative within 2048×2048 bounds. The untouched upload remains available through Open original and file-download actions.
- When enabled, videos and animated GIFs are processed by the current server process after asset creation and message submission scheduling. This is best-effort and intentionally simple until a real durable worker queue exists.
- Processing status: durable STARTED / COMPLETED / FAILED outcomes are stored as asset aggregate events (`evt.asset.{assetId}.*`) and delivered through the normal live EVT subscription path after room-membership authorization. There is no separate `video_processed` live event or new runtime KV state for video progress; failed videos still show the original message, and the UI falls back to the original upload when it is available.
- Processed video dimensions are display dimensions used for layout, not necessarily raw encoded storage pixels. Non-square-pixel and rotated sources should render in their intended orientation and aspect ratio. In the room timeline, ordinary posted landscape videos with near-square metadata are presented in a widescreen frame so common screen recordings do not appear as tall 4:3 embeds; converted animated GIF loops preserve their measured dimensions.
- A thumbnail is generated from an early video frame using the same display dimensions, so non-square-pixel sources do not persist squished or pillarboxed poster images.
- Opaque static attachment derivatives use JPEG quality 75. Derivatives that require transparency or animation use lossless WebP, and resized results can be held in the auto-expiring server cache.
- Browser media uses direct signed asset URLs. Relative attachment URLs are resolved against the server that owns the message or room-file item, so remote-server images, audio, and video can load without cross-site cookies or bearer headers.
- Clients refresh expiring attachment URL fields through room-scoped `AssetService.GetAsset` / `BatchGetAssets`, or by refetching the relevant timeline or room attachment-list page. The timeline, previews, lightbox, downloads, and room-files surfaces refresh before expiry and retry after media load errors.
- Active document attachment types such as HTML, XHTML, SVG, and XML can still be uploaded and viewed inline, but original-file responses are delivered in a browser sandbox so uploaded scripts do not run as trusted Towk application code.
- The room sidebar Files panel lists current accessible attachments from both root messages and thread replies, grouped by date as Today, Yesterday, This week, This month, then older calendar months. Rows show a thumbnail or file-type icon, filename, and upload time; selecting a root-message attachment jumps the room timeline to that message, while selecting a thread-reply attachment opens the thread pane and highlights the reply.
- Deleting a message-owned attachment durably revokes access first, then removes its source/derivative bytes and transform-cache entries. A single elected cleanup worker retries failed physical deletion after process restart or replica handover.

## Design Decisions

### 1. Attachment uploads use chunked ConnectRPC sessions

**Decision:** Public message attachment uploads use `AssetUploadService`: `CreateUpload`, `UploadChunk`, `GetUpload`, `CompleteUpload`, and `CancelUpload`. Chunks are bounded unary ConnectRPC requests instead of browser client-streaming RPCs. Each upload declares the final file size and lowercase SHA-256 digest, each chunk carries its offset and chunk SHA-256, and `CompleteUpload` verifies the assembled digest before creating the durable asset. `CreateMessage` accepts at most 10 unique completed, room-matching attachment asset IDs of at most 15 bytes. The core repeats the count, uniqueness, and ID-length checks for non-Connect callers, resolves the bounded set under one projection read lock, and emits at most one aggregate warning when invalid references are dropped.
**Why:** Attachments should remain inside the protobuf/ConnectRPC API surface instead of introducing a second REST upload endpoint. Unary chunks work with the current browser Connect stack and give resumable progress through the committed offset.
**Tradeoff:** Clients must hash the full file before completion and issue several RPCs for larger files. Temporary chunks and open sessions need cleanup if the browser disappears before completion.

### 2. Dual storage backends (NATS ObjectStore + S3)

**Decision:** Attachments can be stored in NATS ObjectStore (default, good for development and small deployments) or in an S3-compatible bucket (production-grade). Each asset records its storage backend and logical key at upload time; S3 deployments may add a configurable object-key prefix that is applied only at the S3 client boundary.
**Why:** Self-hosters running a single binary shouldn't have to spin up S3 just to send a screenshot. Larger operators need durable, replicated object storage. Supporting both lets us serve both ends of the spectrum. See ADR-021.
**Tradeoff:** Migration between backends or S3 prefixes is operator-managed. Stored asset keys remain prefix-free so moving objects between S3 base paths does not require rewriting Towk metadata.

### 3. Video processing is in-process and best-effort

**Decision:** The current implementation asks the process-local video service to spawn a goroutine from the message command path after `AssetCreatedEvent` has been appended and `AssetProcessingStartedEvent` has been recorded. It does not publish a NATS processing request and does not create runtime KV progress/claim records.
**Why:** The previous transient pub/sub worker path added queue semantics without giving us durable delivery or a clean multi-process claim model. A direct call is easier to reason about and easier to replace later with a real durable queue.
**Tradeoff:** This is intentionally best-effort. If the process crashes mid-transcode, boot recovery scans the EVT projection and retries unmanifested video assets. Multi-process duplicate work is possible until a future durable worker design adds explicit claims.

### 4. Animated GIFs go through the video pipeline

**Decision:** When video processing is enabled, animated GIFs are detected at upload and routed to the video transcoder rather than served as raw images. When video processing is disabled, GIFs remain allowed as image uploads.
**Why:** Animated GIF files are typically much larger than equivalent MP4s, and they're inefficient to decode in browsers. Transcoding to MP4 produces smaller, smoother playback.
**Tradeoff:** A static thumbnail is shown until processing finishes, even for GIFs that would have rendered immediately as-is. Worth it for the playback experience and bandwidth savings.

### 5. Quality variants are selected per source

**Decision:** Transcoding produces multiple H.264 MP4 variants whose target resolutions are derived from the source display resolution. A 1080p source might yield 720p and 480p; a 480p source skips the higher tiers. Processing metadata records display dimensions so clients can reserve the correct frame for sources with non-square pixels or rotation metadata. Generated thumbnails are rendered at display dimensions with square pixels. The chat timeline treats ambiguous near-square landscape video metadata as a widescreen presentation case for ordinary uploaded videos.
**Why:** Producing tiers higher than the source is pointless (upscaling is lossy without benefit). Producing tiers near the source is bandwidth waste for the common case.
**Tradeoff:** No HLS / adaptive bitrate streaming yet — the frontend picks a variant based on viewport and connection at the time of play. Historical processed-video manifests are not rewritten when display-dimension handling improves; clients can still correct the rendered frame after media metadata loads. The widescreen presentation heuristic can crop truly 4:3 uploaded videos in the timeline, but avoids the more common failure where screen recordings appear in a tall padded frame. Adaptive streaming is tracked separately in GitHub issue #668.

### 6. Attachments are declared content; derivative manifests are durable events

**Decision:** `AssetCreatedEvent` records each uploaded or generated binary as a first-class `Asset` on `evt.asset.{assetId}.asset_created`. `Asset` carries inline storage and flat media metadata such as dimensions, duration, and bitrate; room scope and ownership context (`message`, `derivative`, `user_avatar`) live on `AssetCreatedEvent`. Uploaded pending attachment assets also record SHA-256, uploader, pending-attachment expiry, and video-processing hints. Processing outcome events reference asset IDs instead of embedding derivative asset metadata, and are appended to the same asset aggregate. Message posting imperatively invokes process-local video processing for newly uploaded video/animated-GIF assets after their asset creation events are appended; boot recovery derives any missed work from the asset and room projections and uses the same local processor path. After transcoding succeeds, the original upload is retained as source content, and generated thumbnails/MP4 variants are appended as derivative `AssetCreatedEvent`s whose owner points at the original asset. Durable failed/unavailable outcomes are recorded with `AssetProcessingFailedEvent.failure_code` and are mapped to stable client-facing failure reasons. Beta 0.1.0 histories that already wrote asset lifecycle facts under `evt.room.{roomId}.asset_*` remain readable through the asset projection's legacy subscription lanes.
**Why:** Attachments and video derivatives are content metadata, not runtime state. Making assets their own aggregates gives projections a single asset graph (`message -> original asset -> derivative assets`), keeps binary lifecycle facts out of the room aggregate, and lets future uploads exist outside messages without a parallel asset model. Keeping the original allows future re-encoding, and storing processing outcomes in EVT lets processed playback survive projection rebuilds and storage-boundary cleanup.
**Tradeoff:** Retaining originals costs more storage than the old replace-after-transcode behavior. Processing execution is still operational, not durable; a crash between the durable asset event and a completed processing outcome is repaired by boot recovery rather than by treating `AssetCreatedEvent` as a live subscriber trigger. Moving new writes from room aggregates to asset aggregates means older beta binaries must not be rolled back after new asset-subject writes have occurred; compatibility is maintained by this and later versions reading both subject shapes, not by rewriting history.

### 7. Attachment URLs are per-user signed capabilities

**Decision:** Public attachment APIs expose attachment media as stable asset paths plus per-user access tickets: `/assets/files/{assetId}?access={ticket}` for originals and `/assets/files/{assetId}/image/{width}x{height}/{fit}?access={ticket}` for image derivatives. Attachment, thumbnail, video thumbnail, and variant URLs also expose the ticket expiry so the client can refresh before or after a lazy-load miss. Every fetch verifies the signed user is still a member of the asset's room.
**Why:** Cross-origin `<img>` tags (used when the SPA loads attachments from a _remote_ registered server) can't carry session cookies (SameSite) or Authorization headers. A signed per-user access ticket lets browsers load remote attachments directly, while the room-membership check still auto-revokes access on kick/leave.
**Tradeoff:** The access ticket is a bearer capability — anyone holding it can fetch until the expiry passes or the signed user loses room membership. `core.AssetAccessTicketTTL` is currently **24 hours** so normal rendering, lazy loading, deferred media startup, and lightbox use are reliable across long-lived room views; clients still refresh URL fields through projected timeline, message, or attachment-list reads when tickets approach expiry or a media load fails. Protected asset responses use `private, no-store`, so browser-visible protected bytes are not reused as authorization state. Towk streams protected bytes by default, with short-lived S3 redirects reserved for heavy passive originals such as video, audio, and large files. Rotating `[core.assets].signing_secret` invalidates all outstanding access tickets.

### 8. Active document attachments render in a browser sandbox

**Decision:** Original attachment responses for active document formats (HTML, XHTML, SVG, XML, and XML-derived media types) include a CSP sandbox and `nosniff`. S3-backed attachments of those types stream through Towk instead of redirecting directly to a presigned object URL, so the same response policy applies.
**Why:** Some teams need to share these file types inline, but uploaded active content must not become trusted Towk application code. A sandbox without same-origin privileges preserves the viewing use case while preventing the easiest same-origin stored-XSS path.
**Tradeoff:** Scripts, forms, top-level navigation, and same-origin APIs are restricted inside uploaded active documents. S3 deployments also lose the zero-copy redirect fast path for those active document types, while heavy passive originals can still use a short-lived S3 redirect after Towk authorizes the request.

### 9. Room Files panel is a read projection, not durable attachment state

**Decision:** `Room.attachments` exposes a paginated list of current message attachments for a room. The read walks the visible room timeline projection, folds current message bodies, includes thread replies, preserves attachment order within each message, and sorts by newest message first.
**Why:** Files should disappear from the sidebar when their message body is retracted or the attachment is removed. Deriving the list from the existing room/message projections keeps the panel consistent with the timeline without adding duplicate durable state.
**Tradeoff:** There is no search or media filtering in this iteration. Clients page through the current list and refresh it after attachment-affecting live events.

### 10. Displayed images use bounded derivatives

**Decision:** Timeline images fit within 960×400 bounds and lightbox images fit within 2048×2048 bounds. Opaque static derivatives use JPEG quality 75, while transparency and animation continue to use lossless WebP. Original uploads remain unchanged and available separately.
**Why:** Timeline frames are much smaller than typical camera and screenshot uploads, and even full-screen viewing rarely benefits from transferring the source resolution. Separate display sizes reduce bandwidth without sacrificing the original file-sharing behavior.
**Tradeoff:** Opaque displayed images are lossy and capped in resolution. Transparent and animated images may see smaller savings because preserving their behavior requires lossless encoding.

### 11. Message-owned asset deletion is replayable

**Decision:** Request paths still attempt immediate NATS/S3 and transform-cache deletion, while the holder of the `asset_cleanup` lease incrementally consumes canonical `AssetDeletedEvent` facts and retries each idempotent cleanup independently. The asset ID locates the same aggregate's durable `AssetCreatedEvent`, which supplies storage metadata even after the in-memory projection drops it. Beta room-scoped histories without a canonical asset creation aggregate are skipped rather than probing guessed object keys.
**Why:** A committed deletion must remain recoverable when immediate storage cleanup fails, the process exits, or another replica committed the event. Resolving the immutable creation fact preserves that guarantee without duplicating storage metadata in the deletion event or depending on a mutable projection.
**Tradeoff:** Each cleanup requires an aggregate-history lookup, and a fresh worker replays prior deletion facts idempotently. Beta room-scoped events cannot gain the same guarantee without a migration or unsafe backend-key inference, and server branding/avatar cleanup remains outside this message-owned worker.

### 12. Executable rejection is enforced at both trust boundaries

**Decision:** The browser rejects known executable extensions and MIME types for immediate feedback and inspects the first bytes before staging. `AssetUploadService` repeats bounded filename/content-type validation, rejects the same metadata before accepting chunks, and checks executable signatures after checksum-verified materialization. Rejected sessions and temporary chunks are removed best-effort. ZIP, 7z, RAR, tar, and compressed archives remain opaque allowed attachments; Towk does not unpack or execute them.
**Why:** Browser filenames and MIME types are caller-controlled and cannot be the server security boundary. Signature inspection catches common renamed PE, ELF, Mach-O, Java-class/fat-binary, WebAssembly, and shebang payloads while preserving ordinary document and archive sharing.
**Tradeoff:** This is a focused executable policy, not antivirus, content disarm, or proof that an allowed document is harmless. Operators with stronger content-governance requirements should scan uploads in a private integration rather than sending files to a public analysis service, and should retain upstream request-rate and storage controls.

### 13. Desktop file paste follows the browser's native clipboard bridge

**Decision:** The composer reads `ClipboardEvent.clipboardData.files` first, falls back to file-kind `DataTransferItem` entries, and stages every `File` the browser exposes. It recognizes native local-file clipboard markers such as `Files`, `application/x-moz-file`, `text/uri-list`, and GNOME's copied-files format only to fail closed when the browser withholds file access. Towk never turns a local path into a network request and never treats plain `file://` text as an attachment. Drag-and-drop uses the same staging and upload policy.

**Why:** Desktop file managers publish OS-specific clipboard formats, while the browser is the security boundary that turns those formats into web `File` objects. As revalidated on 2026-07-13, Chromium 150 maps Windows `CF_HDROP`, macOS file URLs, and Linux `text/uri-list` into Blink files; Firefox 152 has a native file-paste browser test and platform bridges for Windows, Cocoa, and GTK; current WebKit exposes file paste on Cocoa. The application therefore handles the stable web contract instead of attempting privileged filesystem access.

**Tradeoff:** A browser may expose fewer files than the operating system placed on the clipboard. Firefox's current Cocoa and GTK implementations expose the first native item/URI, while Windows and current Chromium paths can expose multiple files. Towk stages all browser-provided files but cannot bypass that browser-level limitation. WebKit's current non-Cocoa file-access path remains disabled, so Linux users should use Chromium or Firefox for native clipboard files. When no `File` is exposed, the user gets a deterministic error and can use drag-and-drop or the picker.

Primary compatibility evidence:

- [ClipboardEvent.clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData) and [DataTransfer.files](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files)
- Chromium 150 branch sources: [Blink file mapping](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7871/third_party/blink/renderer/core/clipboard/data_object.cc), [Windows clipboard](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7871/ui/base/clipboard/clipboard_win.cc), [macOS clipboard](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7871/ui/base/clipboard/clipboard_mac.mm), and [Linux/Ozone clipboard](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7871/ui/base/clipboard/clipboard_ozone.cc)
- Firefox 152.0.5 sources: [native file-paste browser test](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_152_0_5_RELEASE/browser/base/content/test/general/browser_clipboard_pastefile.js), [Windows clipboard](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_152_0_5_RELEASE/widget/windows/nsClipboard.cpp), [Cocoa clipboard](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_152_0_5_RELEASE/widget/cocoa/nsClipboard.mm), and [GTK clipboard](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_152_0_5_RELEASE/widget/gtk/nsClipboard.cpp)
- Current WebKit sources: [DataTransfer platform gate](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DataTransfer.cpp) and [Cocoa pasteboard file reader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PasteboardCocoa.mm)
- Native clipboard contracts: [Windows shell clipboard formats](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard), [macOS `NSPasteboard.PasteboardType.fileURL`](https://developer.apple.com/documentation/appkit/nspasteboard/pasteboardtype/fileurl), and [Qt URL-list mapping](https://doc.qt.io/qt-6/qmimedata.html)

### 14. The primary NATS asset store has a hard quota

**Decision:** Towk creates or updates `SERVER_ASSETS` with `MaxBytes`, defaulting to 10 GB. This quota covers NATS-backed persisted assets and temporary upload chunks. It still applies to temporary chunks when completed assets use S3, but it does not cap the external S3 bucket. `LINK_PREVIEW_ASSETS` keeps its independent 1 GB default quota. Existing objects are retained if an operator lowers the limit below current usage; JetStream rejects subsequent writes until usage falls below the configured bound.

**Why:** Per-file and per-message limits do not bound cumulative instance storage or abandoned in-progress chunks. A server-side object-store quota makes the failure authoritative even when a client bypasses the browser, and `CreateOrUpdateObjectStore` applies the configured limit to existing deployments.

**Tradeoff:** Exhausting the shared store blocks every new write that uses `SERVER_ASSETS`, including temporary S3 upload chunks, until space is reclaimed or the quota is raised. Operators must still provision disk alerts, retention, backups, and an independent bucket quota for S3. See the [NATS Go object-store configuration](https://github.com/nats-io/nats.go/blob/v1.52.0/jetstream/object.go) and [NATS server maximum-bytes enforcement](https://github.com/nats-io/nats-server/blob/v2.14.3/server/stream.go).

## Permissions

Posting an attachment requires room membership, the relevant message-posting permission (`message.post` or `message.post-in-thread`), and `message.attach`. The `message.attach` permission is configurable at server, group, and room scope and only gates message attachments; server branding uploads, user avatars, link previews, and attachment deletion use their existing checks.

Fresh servers seed `message.attach` for `everyone` so new deployments keep uploads enabled by default. Existing servers are not automatically backfilled after upgrade; operators should grant `message.attach` manually or through their chosen RBAC maintenance flow if existing rooms should keep allowing uploads.

## Related

- **ADRs:** ADR-021 (dual asset storage), ADR-023 (HMAC-signed image transform URLs), ADR-032 (self-describing signed attachment URLs), ADR-036 (runtime state in `RUNTIME_STATE`), ADR-041 (runtime units for optional processes), ADR-047 (direct ticketed asset URLs)
- **FDRs:** FDR-002 (Replies & Threads), FDR-004 (Message Editing & Deletion)
