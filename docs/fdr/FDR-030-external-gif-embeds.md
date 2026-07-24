# FDR-030: External GIF Embeds

**Status:** Active
**Last reviewed:** 2026-07-24

## Overview

Towk can render a message that consists only of a supported external GIF URL. The
message remains ordinary text; the embed is a client-side presentation enhancement.
Towk does not provide GIF search or copy provider media into server storage.

## Behavior

- A message must contain exactly one supported URL, apart from surrounding
  whitespace. Mixed text, Markdown links, quotes, and code remain normal message
  content.
- Supported URL shapes are official GIPHY page/embed URLs and direct GIPHY or Tenor
  GIF, WebP, MP4, or WebM media URLs. Current `i.giphy.com/media/...` CDN forms and
  one trailing slash on a GIPHY page/embed URL are accepted.
- Loading requires a click by default. The placeholder states that the browser will
  contact the provider.
- A local preference can auto-load supported media only when it approaches the
  visible timeline. Background tabs, offline state, reduced-motion preferences, and
  browsers without `IntersectionObserver` keep click-to-load behavior.
- An in-flight automatic request is cancelled if the page becomes hidden or the
  network heuristic turns offline. Successfully loaded media stays mounted so room
  changes and visibility transitions can reuse the browser-managed resource. Reduced
  motion still removes automatically loaded animation.
- Loaded media can be hidden. The source link remains available before and after
  loading.
- Offline and failed loads show distinct retryable states. An explicit load remains
  available when the browser reports an offline state so a fresh HTTP cache entry
  can still be reused; cached availability remains browser-dependent and is not
  promised.
- Operators can disable the presentation capability with
  `CHATTO_WEBSERVER_EXTERNAL_GIF_EMBEDS=false`.
- Unsupported providers and disabled or older servers render the original link only.
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
Filename-only or suffix-host matching is not used.
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

## Security and Privacy

- Only HTTPS URLs on exact provider hosts are eligible.
- URL credentials, explicit ports, encoded path forms, non-ASCII/control characters,
  oversized URLs and identifiers, arbitrary HTML, and provider scripts in the
  application DOM are rejected.
- GIPHY frames use a restricted sandbox and no referrer. Direct images also request
  no referrer. Video elements follow Towk's document-wide
  `strict-origin-when-cross-origin` policy because browsers do not expose a
  per-video referrer policy.
- Recognized URLs never enter the server-side link-preview fetch/cache path, even
  when the presentation capability is disabled.
- The service worker continues to leave cross-origin media outside Towk-managed
  CacheStorage.

## Compatibility

The feature is advertised with `external-gif-embeds-v1`. Old clients and servers
continue to display the original text link. Incomplete server discovery also falls
back to that link instead of assuming support. No protobuf, persisted event,
database, or storage migration is required.

## Related

- **ADR:** [ADR-053](../adr/ADR-053-provider-hosted-external-gif-embeds.md)
- **FDRs:** FDR-009 (Link Previews), FDR-027 (PWA Shell & Service Worker)
