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
  GIF, WebP, MP4, or WebM media URLs.
- Loading requires a click by default. The placeholder states that the browser will
  contact the provider.
- A local preference can auto-load supported media when it approaches the visible
  timeline. Reduced-motion preferences keep click-to-load behavior.
- Loaded media can be hidden. The source link remains available before and after
  loading.
- Offline and failed loads show distinct retryable states. Cached availability
  remains browser-dependent and is not promised.
- Operators can disable the presentation capability with
  `CHATTO_WEBSERVER_EXTERNAL_GIF_EMBEDS=false`.
- Unsupported providers and disabled or older servers render the original link only.

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

**Decision:** Hosts, schemes, identifiers, paths, and media filenames are validated.
Every explicit port is rejected. Filename-only or suffix-host matching is not used.
**Why:** Generic hotlinking creates tracking, resource, CSP, and spoofing risks.
**Tradeoff:** New provider URL variants remain plain links until Towk explicitly
supports them.

### 5. Browser HTTP caching remains authoritative

**Decision:** Towk does not maintain a separate cache for external media.
**Why:** Provider response headers should control freshness, revalidation, and
removal. An application-managed cache would create a separate retained copy.
**Tradeoff:** Towk cannot promise that returning to a room causes zero network
revalidation.

## Security and Privacy

- Only HTTPS URLs on exact provider hosts are eligible.
- URL credentials, explicit ports, encoded path forms, control characters,
  unbounded identifiers, arbitrary HTML, and provider scripts in the application
  DOM are rejected.
- GIPHY frames use a restricted sandbox and no referrer. Direct images also
  request no referrer. Video elements follow Towk’s document-wide
  `strict-origin-when-cross-origin` policy because browsers do not expose a
  per-video referrer policy.
- Recognized URLs never enter the server-side link-preview fetch/cache path.
- The service worker continues to leave cross-origin media outside Towk-managed
  CacheStorage.

## Compatibility

The feature is advertised with `external-gif-embeds-v1`. Old clients and servers
continue to display the original text link. No protobuf, persisted event, database,
or storage migration is required.

## Related

- **ADR:** [ADR-053](../adr/ADR-053-provider-hosted-external-gif-embeds.md)
- **FDRs:** FDR-009 (Link Previews), FDR-027 (PWA Shell & Service Worker)
