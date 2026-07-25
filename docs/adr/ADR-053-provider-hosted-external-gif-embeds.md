# ADR-053: Provider-Hosted External GIF Embeds Stay Outside Towk Storage

**Date:** 2026-07-24
**Last reviewed:** 2026-07-25

## Context

Users can paste GIF links produced by operating-system keyboards, browser searches,
or other applications. Building a GIF search catalogue inside Towk would require
provider accounts, API keys, usage limits, licensing decisions, and an additional
third-party service dependency.

Treating every URL that ends in `.gif` as trusted media would also be unsafe. It
would allow arbitrary tracking origins, widen the browser security policy without
a bound, and make a filename extension stand in for provider and path validation.
Server-side link previews are not an acceptable fallback for supported GIF links:
they would make the Towk server contact the provider and could persist a copied
preview asset.

The URL is still useful as durable, mixed-version message state, but showing it as a
large raw link next to a full media card is duplicate presentation. Compatible clients
therefore need a clean card while preserving the exact source URL for older clients,
auditability, and an explicit source action.

## Decision

Towk recognizes a versioned, conservative set of HTTPS URL shapes for provider-
hosted GIF media. The current version covers official GIPHY page/embed URLs, direct
GIPHY or Tenor image/video media URLs, and direct KLIPY media on the exact
`static.klipy.com` and `static.klipy.co` `/ii/<asset>/<shard>/<shard>/<media>` shape.
Recognition requires exact hosts, no URL credentials or explicit ports, ASCII input,
a bounded URL, bounded provider identifiers, and known path forms. Generic GIF URLs
and Tenor page URLs are not included.

The original URL remains the persisted message source of truth. No new message type,
attachment, provider metadata, or migration is introduced. When a compatible client
recognizes a standalone URL and the server advertises `external-gif-embeds-v1`, the
client presents the privacy card instead of duplicating the raw-link body. The source
remains available from the card. Servers advertise the capability when the operator
setting is enabled. Clients without the capability, clients with incomplete discovery
state, instances with the setting disabled, unsupported providers, and mixed-text
messages render the original link normally.

Recognized URLs bypass server-side OpenGraph fetching unconditionally. The reader's
browser loads the selected provider resource directly after an explicit click by
default. A local user preference can enable viewport-proximate automatic loading,
but only while the page is visible and proximity can be measured with
`IntersectionObserver`; `prefers-reduced-motion` keeps the explicit-load path. The
browser's ordinary HTTP cache follows provider response headers. A manual load stays
available when the platform reports an offline state so the browser can reuse a fresh
cache entry when present. Towk does not put external media bytes in CacheStorage,
IndexedDB, NATS, S3, attachment storage, or a server proxy.

GIPHY pages use a sandboxed official embed frame. Direct GIPHY, Tenor, and KLIPY
media uses native `img` or `video` elements. Towk does not execute provider HTML in
the application DOM and does not load a provider search SDK. Any persisted
link-preview card already attached to a historical message remains authoritative so
rolling upgrades do not render two competing previews.

Automatically loaded media is cancelled while still in flight if the page becomes
hidden or the network heuristic turns offline. A completed load stays mounted so the
browser can reuse the decoded resource. Manual loads are not cancelled by the network
heuristic. Load and error events are accepted only from the active media element and
attempt, preventing stale retry events from changing the current state.

Adding KLIPY direct-media recognition does not require a new capability version. The
operator switch, privacy gate, storage boundary, wire representation, and rollback
contract remain unchanged; older clients simply continue to display the same text URL.
A provider expansion that changes any of those contracts requires a capability review
and may require a new version.

## Consequences

- No API key, provider account, GIF catalogue, or provider search dependency is
  required.
- Loading a GIF discloses the reader's network address and browser request metadata
  to the selected provider. The default click gate and source label make that
  boundary visible.
- Provider removal, regional blocking, offline state, CSP changes, or network
  failure can make the media unavailable while the persisted source URL remains.
- An older web view without `IntersectionObserver` uses click-to-load even when the
  user enabled automatic loading.
- Historical messages with stored OpenGraph metadata can retain a different visual
  treatment from newly posted GIF links.
- Provider URL formats are compatibility code. New providers or path forms require
  explicit validation, positive and hostile tests, privacy review, and a new
  capability version when the contract changes materially.
- Existing and mixed-version clients continue to exchange ordinary text messages.

## Related

- [FDR-009: Link Previews](../fdr/FDR-009-link-previews.md)
- [FDR-027: PWA Shell & Service Worker](../fdr/FDR-027-pwa-shell-and-service-worker.md)
- [FDR-030: External GIF Embeds](../fdr/FDR-030-external-gif-embeds.md)
