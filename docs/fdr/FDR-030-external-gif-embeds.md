# FDR-030: External GIF Embeds

**Status:** Active
**Last reviewed:** 2026-07-26

## Overview

Towk can render a message that contains only supported external GIF URLs. The
persisted message remains ordinary text; compatible clients present one media card per
recognized URL instead of duplicating the raw URLs in the message body. Supported GIFs
load automatically near the visible timeline by default, while a local preference lets
the reader require an explicit click. Towk does not provide GIF search or copy provider
media into server storage.

## Behavior

- A message may contain from one to four supported URL tokens separated only by
  whitespace. Every non-whitespace token must be a supported URL. Mixed text, Markdown
  with a custom label, quotes, code, unsupported URLs, and messages above the four-card
  bound remain normal message content.
- Exact Markdown autolinks and exact `[URL](URL)` or `[URL](<URL>)` self-links emitted
  by the rich composer are treated as their underlying URL. The visible label must
  equal the destination exactly so user-authored link text is never discarded.
- Supported URL shapes are official GIPHY page/embed URLs and direct GIPHY, Tenor,
  or KLIPY GIF, WebP, MP4, or WebM media URLs. Current `i.giphy.com/media/...` CDN
  forms, bounded historical Tenor media forms, exact KLIPY
  `/ii/<asset>/<shard>/<shard>/<media>` paths on `static.klipy.com` or
  `static.klipy.co`, and one trailing slash on a GIPHY page/embed URL are accepted.
- When the active server advertises `external-gif-embeds-v1`, a recognized GIF-only
  message is presented as one ordered media card per URL instead of a second large
  raw-link body. The original URLs remain the persisted message source and stay
  reachable through each card's source action.
- Supported media auto-loads by default only when it approaches the visible timeline.
  The preference is local to the browser and can be disabled to restore click-to-load.
- Background tabs, offline state, reduced-motion preferences, and browsers without
  `IntersectionObserver` keep the explicit-load fallback instead of loading eagerly.
- The four-card message bound also limits the number of concurrent provider resources
  that automatic loading can make eligible from one message.
- Direct image and video media preserve their intrinsic aspect ratio. On sufficiently
  wide displays, very small media is enlarged to a readable minimum, while a responsive
  maximum width and height prevent overflow. GIPHY page embeds use a bounded 16:9 frame
  because the page URL does not expose the media's intrinsic dimensions without a
  provider API.
- Provider controls are rendered in a compact footer below the media so the card width
  follows the actual content instead of leaving an empty panel beside narrow GIFs.
- An in-flight automatic request is cancelled if the page becomes hidden or the
  network heuristic turns offline. Successfully loaded media stays mounted so room
  changes and visibility transitions can reuse the browser-managed resource. Reduced
  motion still removes automatically loaded animation.
- A manual request remains mounted when the network heuristic changes. Media events
  are accepted only from the currently mounted attempt, so late load/error events
  from an earlier retry cannot change current state.
- Loaded media can be hidden. The source action remains available before and after
  loading.
- Offline and failed loads show distinct retryable states. An explicit load remains
  available when the browser reports an offline state so a fresh HTTP cache entry
  can still be reused; cached availability remains browser-dependent and is not
  promised.
- Operators can disable the presentation capability with
  `CHATTO_WEBSERVER_EXTERNAL_GIF_EMBEDS=false`.
- Unsupported providers, disabled or older servers, incomplete capability discovery,
  mixed-content messages, and messages above the card bound render the original text
  normally.
- A message that already contains any persisted link-preview card keeps that
  historical card and does not show a second GIF presentation.

## Design Decisions

### 1. GIF-only messages are the activation boundary

**Decision:** A message becomes external GIF presentation only when every token is a
supported URL and there are no more than four URLs. Exact composer-generated
self-links are accepted only when their visible text and destination are identical.
**Why:** This covers keyboard/share-sheet payloads and rich-composer serialization
without hiding user-authored labels, while avoiding unexpected third-party requests
from ordinary prose and keeping parsing deterministic and bounded.
**Tradeoff:** Commentary, custom labels, unsupported links, or a fifth URL keep the
complete message on the ordinary Markdown path.

### 2. The reader loads provider media directly

**Decision:** The browser contacts the provider; the Towk server does not proxy,
download, transform, or persist the media.
**Why:** This avoids API keys and durable third-party copies and keeps provider cache
and removal policy authoritative.
**Tradeoff:** The provider receives the reader's request metadata, and the media may
later disappear.

### 3. Automatic loading is the default, with a local opt-out

**Decision:** Supported media starts loading when it approaches the visible timeline.
The reader can disable automatic loading locally to require a click before a provider
request is made. Reduced motion, offline state, hidden pages, and environments without
`IntersectionObserver` remain click-to-load.
**Why:** GIFs are expected to behave like native chat media without requiring a manual
step for every message. A local opt-out preserves user control, while conservative
fallbacks avoid eager background loading and respect accessibility preferences.
**Tradeoff:** With the default enabled, viewing a timeline containing a supported GIF
can disclose the reader's network address and browser request metadata to that
provider without a per-message click.

### 4. Provider URL shapes are allow-listed

**Decision:** Hosts, schemes, identifiers, paths, media filenames, ASCII input, and
an overall URL length bound are validated. Every explicit port is rejected.
Filename-only or suffix-host matching is not used. GIPHY pages have an official
sandboxed frame path; Tenor and KLIPY support remains limited to direct media shapes.
**Why:** Generic hotlinking creates tracking, resource, CSP, and spoofing risks.
**Tradeoff:** New provider URL variants remain plain links until Towk explicitly
supports them.

### 5. Browser HTTP caching remains authoritative

**Decision:** Towk does not maintain a separate cache for external media.
**Why:** Provider response headers should control freshness, revalidation, and
removal. An application-managed cache would create a separate retained copy.
**Tradeoff:** Towk cannot promise that returning to a room causes zero network
revalidation. Browser connectivity detection is treated only as a hint, so a manual
load may still be attempted to reuse an available cache entry.

### 6. Automatic loading fails closed

**Decision:** Automatic loading requires a visible document and a working
`IntersectionObserver`. Towk does not substitute an eager fallback when proximity
cannot be measured.
**Why:** A compatibility fallback must not turn the default into an unbounded batch of
provider requests from a long or background timeline.
**Tradeoff:** Older web views require a click even while the automatic-loading
preference is enabled.

### 7. Historical previews win over the enhancement

**Decision:** Any existing persisted OpenGraph card suppresses the new client-side
GIF presentation for that message.
**Why:** Persisted preview metadata is server-issued historical state. Rendering a
second provider-backed card beside it would create duplicate presentation and could
contact a provider that the historical message never contacted directly.
**Tradeoff:** Older messages can look different from newly posted GIF links.

### 8. Raw URLs are source state, not duplicate presentation

**Decision:** Compatible clients replace the GIF-only raw-link body with ordered
cards, while preserving every exact text URL in the message event and exposing each
one through its source action. Fallback clients continue to render the text normally.
**Why:** Showing the same URLs as both large blue links and media cards is visual
duplication, while deleting or rewriting the stored body would break mixed-version
compatibility and auditability.
**Tradeoff:** Copying an original URL requires the corresponding card's source action
on compatible clients instead of selecting the body text directly.

### 9. Direct media follows intrinsic geometry

**Decision:** Direct images and videos use their intrinsic aspect ratio and natural
width within responsive minimum and maximum bounds. Provider-page iframes remain a
bounded 16:9 surface. Controls are placed below the media.
**Why:** A fixed full-width panel makes portrait or narrow GIFs look undersized and
leaves unused space beside them. Intrinsic sizing preserves the source composition
while still producing a readable chat presentation on desktop and a safe full-width
layout on mobile.
**Tradeoff:** Very small source assets may be upscaled to the readable minimum, and
very large assets are reduced to fit the conversation viewport.

## Security and Privacy

- Only HTTPS URLs on exact provider hosts are eligible.
- URL credentials, explicit ports, encoded path forms, non-ASCII/control characters,
  oversized URLs and identifiers, arbitrary HTML, and provider scripts in the
  application DOM are rejected.
- Every token in a GIF-only message must validate independently, and no more than four
  cards are rendered from one message.
- Exact Markdown self-links are unwrapped only when the visible label and destination
  are identical and the destination independently passes the provider allowlist.
- Automatic loading can disclose the reader's network address and browser request
  metadata when eligible media approaches the visible timeline. The local opt-out and
  conservative fallback conditions allow the reader to retain click-to-load behavior.
- GIPHY frames use a restricted sandbox and no referrer. Direct GIPHY, Tenor, and
  KLIPY images also request no referrer. Video elements follow Towk's document-wide
  `strict-origin-when-cross-origin` policy because browsers do not expose a
  per-video referrer policy.
- Recognized URLs never enter the server-side link-preview fetch/cache path, even
  when the presentation capability is disabled.
- The service worker continues to leave cross-origin media outside Towk-managed
  CacheStorage. No provider bytes are copied into IndexedDB, NATS, S3, attachment
  storage, or a Towk proxy.

## Compatibility

The feature is advertised with `external-gif-embeds-v1`. Supporting several already
recognized URLs in one bounded GIF-only message, exact self-links emitted by the
current composer, automatic loading before the first public merge, and intrinsic
responsive presentation do not change the wire contract: older clients still exchange
and render the ordinary text body, while newer clients derive ordered cards from it.
Incomplete server discovery falls back to the text instead of assuming support. No
protobuf, persisted event, database, or storage migration is required.

## Related

- **ADR:** [ADR-054](../adr/ADR-054-provider-hosted-external-gif-embeds.md)
- **FDRs:** FDR-009 (Link Previews), FDR-027 (PWA Shell & Service Worker)
