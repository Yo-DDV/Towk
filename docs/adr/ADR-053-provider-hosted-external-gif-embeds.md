# ADR-053: Provider-Hosted External GIF Embeds Stay Outside Towk Storage

**Date:** 2026-07-24
**Last reviewed:** 2026-07-25

## Context

Users can paste GIF links produced by operating-system keyboards, browser searches,
or other applications. Some clipboard and share-sheet paths can provide more than one
URL for the same action, such as a provider page plus a direct media rendition.
Building a GIF search catalogue inside Towk would require provider accounts, API keys,
usage limits, licensing decisions, and an additional third-party service dependency.

Treating every URL that ends in `.gif` as trusted media would also be unsafe. It
would allow arbitrary tracking origins, widen the browser security policy without
a bound, and make a filename extension stand in for provider and path validation.
Server-side link previews are not an acceptable fallback for supported GIF links:
they would make the Towk server contact the provider and could persist a copied
preview asset.

The URLs are still useful as durable, mixed-version message state, but showing them as
large raw links next to full media cards is duplicate presentation. Compatible clients
therefore need clean, bounded cards while preserving the exact source URLs for older
clients, auditability, and explicit source actions.

## Decision

Towk recognizes a versioned, conservative set of HTTPS URL shapes for provider-
hosted GIF media. The current version covers official GIPHY page/embed URLs, direct
GIPHY or Tenor image/video media URLs, and direct KLIPY media on the exact
`static.klipy.com` and `static.klipy.co` `/ii/<asset>/<shard>/<shard>/<media>` shape.
Recognition requires exact hosts, no URL credentials or explicit ports, ASCII input,
a bounded URL, bounded provider identifiers, and known path forms. Generic GIF URLs
and Tenor page URLs are not included.

The original text body remains the persisted message source of truth. No new message
type, attachment, provider metadata, or migration is introduced. When every token in
a message is a recognized provider URL, the message contains no other text, there are
at most four URLs, and the server advertises `external-gif-embeds-v1`, a compatible
client presents one ordered privacy card per URL instead of duplicating the raw-link
body. Each source remains available from its card. Servers advertise the capability
when the operator setting is enabled. Clients without the capability, clients with
incomplete discovery state, instances with the setting disabled, unsupported or mixed
content, and messages above the bound render the original text normally.

The four-card maximum bounds DOM growth and automatic provider eligibility for one
message. Every candidate URL must independently pass the provider allowlist; a single
unsupported token keeps the entire body on the normal Markdown path so the client does
not silently discard content.

Recognized URLs bypass server-side OpenGraph fetching unconditionally. The reader's
browser loads each selected provider resource directly after an explicit click by
default. A local user preference can enable viewport-proximate automatic loading,
but only while the page is visible and proximity can be measured with
`IntersectionObserver`; `prefers-reduced-motion` keeps the explicit-load path. The
browser's ordinary HTTP cache follows provider response headers. A manual load stays
available when the platform reports an offline state so the browser can reuse a fresh
cache entry when present. Towk does not put external media bytes in CacheStorage,
IndexedDB, NATS, S3, attachment storage, or a server proxy.

GIPHY pages use a sandboxed official embed frame. Direct GIPHY, Tenor, and KLIPY
media use native `img` or `video` elements. Towk does not execute provider HTML in
the application DOM and does not load a provider search SDK. Any persisted
link-preview card already attached to a historical message remains authoritative so
rolling upgrades do not render competing previews.

Automatically loaded media is cancelled while still in flight if the page becomes
hidden or the network heuristic turns offline. A completed load stays mounted so the
browser can reuse the decoded resource. Manual loads are not cancelled by the network
heuristic. Load and error events are accepted only from the active media element and
attempt, preventing stale retry events from changing the current state.

Adding KLIPY direct-media recognition or deriving several cards from one bounded text
message does not require a new capability version. The operator switch, privacy gate,
storage boundary, wire representation, and rollback contract remain unchanged; older
clients simply continue to display the same text body. A provider expansion or message
rule that changes any of those contracts requires a capability review and may require
a new version.

## Consequences

- No API key, provider account, GIF catalogue, or provider search dependency is
  required.
- Loading a GIF discloses the reader's network address and browser request metadata
  to the selected provider. The default click gate and source label make that
  boundary visible.
- Provider removal, regional blocking, offline state, CSP changes, or network
  failure can make media unavailable while the persisted source URLs remain.
- A single GIF-only message can render no more than four ordered cards; a fifth URL or
  any unsupported token falls back to ordinary text.
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
