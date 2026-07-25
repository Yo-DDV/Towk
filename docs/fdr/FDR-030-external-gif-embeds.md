# FDR-030: External GIF Embeds

**Status:** Active
**Last reviewed:** 2026-07-25

## Overview

Towk can render a message that consists only of a supported external GIF URL. The
persisted message remains ordinary text; compatible clients present one privacy-gated
media card instead of duplicating the raw URL in the message body. Towk does not
provide GIF search or copy provider media into server storage.

## Behavior

- A message must contain exactly one supported URL, apart from surrounding
  whitespace. Mixed text, Markdown links, quotes, and code remain normal message
  content.
- Supported URL shapes are official GIPHY page/embed URLs and direct GIPHY, Tenor,
  or KLIPY GIF, WebP, MP4, or WebM media URLs. Current `i.giphy.com/media/...` CDN
  forms, bounded historical Tenor media forms, exact KLIPY `/ii/<asset>/<shard>/<shard>/<media>`
  paths on `static.klipy.com` or `static.klipy.co`, and one trailing slash on a GIPHY
  page/embed URL are accepted.
- When the active server advertises `external-gif-embeds-v1`, a recognized standalone
  URL is presented as the external-media card instead of a second large raw-link body.
  The original URL remains the persisted message source and stays reachable through
  the card's source action.
- Loading requires a click by default. The placeholder states that the browser will
  contact the provider.
- A local preference can auto-load supported media only when it approaches the
  visible timeline. Background tabs, offline state, reduced-motion preferences, and
  browsers without `IntersectionObserver` keep click-to-load behavior.
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
  and mixed-text messages render the original link normally.
- A message that already contains any persisted link-preview card keeps that
  historical card and does not show a second GIF presentation.

## Design Decisions

### 1. URL-only messages are the activation boundary

**Decision:** Only a standalone provider URL becomes an external GIF embed.
**Why:** This avoids unexpected third-party requests from ordinary prose and keeps
message parsing deterministic.
**Tradeoff:** A GIF URL accompanied by commentary remains a normal link.

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

### 8. The raw URL is source state, not duplicate presentation

**Decision:** Compatible clients replace the standalone raw-link body with the card,
while preserving the exact text URL in the message event and exposing it through the
source action. Fallback clients continue to render the text normally.
**Why:** Showing the same URL as both a large blue link and a full media card is visual
duplication, while deleting or rewriting the stored body would break mixed-version
compatibility and auditability.
**Tradeoff:** Copying the original URL requires the card's source action on compatible
clients instead of selecting the body text directly.

## Security and Privacy

- Only HTTPS URLs on exact provider hosts are eligible.
- URL credentials, explicit ports, encoded path forms, non-ASCII/control characters,
  oversized URLs and identifiers, arbitrary HTML, and provider scripts in the
  application DOM are rejected.
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

The feature is advertised with `external-gif-embeds-v1`. Adding another strictly
validated direct-media provider does not change the privacy gate, storage boundary,
or wire contract: older clients still exchange and render the ordinary text URL,
while newer clients recognize the additional path. Old clients and servers continue
to display the original link. Incomplete server discovery also falls back to that
link instead of assuming support. No protobuf, persisted event, database, or storage
migration is required.

## Related

- **ADR:** [ADR-053](../adr/ADR-053-provider-hosted-external-gif-embeds.md)
- **FDRs:** FDR-009 (Link Previews), FDR-027 (PWA Shell & Service Worker)
