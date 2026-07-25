# FDR-030: External GIF Embeds

**Status:** Active
**Last reviewed:** 2026-07-25

## Overview

Towk can render a message that contains only supported external GIF URLs. The
persisted message remains ordinary text; compatible clients present one privacy-gated
media card per recognized URL instead of duplicating the raw URLs in the message body.
Towk does not provide GIF search or copy provider media into server storage.

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
- Loading requires a click by default. The placeholder states that the browser will
  contact the provider.
- A local preference can auto-load supported media only when it approaches the
  visible timeline. Background tabs, offline state, reduced-motion preferences, and
  browsers without `IntersectionObserver` keep click-to-load behavior.
- The four-card message bound also limits the number of concurrent provider resources
  an auto-load preference can make eligible from one message.
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

### 3. Click-to-load is the default

**Decision:** External media is not requested until the reader activates it, unless
the reader enables the local auto-load preference.
**Why:** A message author should not silently cause every reader to contact a third
party.
**Tradeoff:** Loading requires one additional interaction by default.

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

### 6. Auto-load fails closed

**Decision:** Automatic loading requires a visible document and a working
`IntersectionObserver`. Towk does not substitute an eager fallback when proximity
cannot be measured.
**Why:** A compatibility fallback must not turn one opt-in setting into an unbounded
batch of provider requests from a long or background timeline.
**Tradeoff:** Older web views require a click even when the preference is enabled.

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

## Security and Privacy

- Only HTTPS URLs on exact provider hosts are eligible.
- URL credentials, explicit ports, encoded path forms, non-ASCII/control characters,
  oversized URLs and identifiers, arbitrary HTML, and provider scripts in the
  application DOM are rejected.
- Every token in a GIF-only message must validate independently, and no more than four
  cards are rendered from one message.
- Exact Markdown self-links are unwrapped only when the visible label and destination
  are identical and the destination independently passes the provider allowlist.
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
recognized URLs in one bounded GIF-only message, including exact self-links emitted by
the current composer, does not change the privacy gate, storage boundary, or wire
contract: older clients still exchange and render the ordinary text body, while newer
clients derive ordered cards from it. Adding another strictly validated direct-media
provider likewise leaves the wire representation unchanged. Incomplete server
discovery falls back to the text instead of assuming support. No protobuf, persisted
event, database, or storage migration is required.

## Related

- **ADR:** [ADR-053](../adr/ADR-053-provider-hosted-external-gif-embeds.md)
- **FDRs:** FDR-009 (Link Previews), FDR-027 (PWA Shell & Service Worker)
