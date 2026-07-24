# ADR-053: Provider-Hosted External GIF Embeds Stay Outside Towk Storage

**Date:** 2026-07-24

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

## Decision

Towk recognizes a versioned, conservative set of HTTPS URL shapes for provider-
hosted GIF media. The first version covers official GIPHY page/embed URLs and
direct GIPHY or Tenor image/video media URLs. Recognition requires exact hosts,
no URL credentials, no explicit ports, bounded provider identifiers, and known
path forms. Generic GIF URLs and Tenor page URLs are not included.

The original URL remains the message source of truth. No new message type,
attachment, provider metadata, or migration is introduced. Servers advertise
`external-gif-embeds-v1` when the operator setting is enabled. Clients without the
capability render the original link normally.

Recognized URLs bypass server-side OpenGraph fetching unconditionally. The reader's
browser loads the selected provider resource directly after an explicit click by
default. A local user preference can enable viewport-proximate automatic loading;
`prefers-reduced-motion` keeps the explicit-load path. The browser's ordinary HTTP
cache follows provider response headers. Towk does not put external media bytes in
CacheStorage, IndexedDB, NATS, S3, attachment storage, or a server proxy.

GIPHY pages use a sandboxed official embed frame. Direct provider media uses native
`img` or `video` elements. Towk does not execute provider HTML in the application
DOM and does not load a provider search SDK.

## Consequences

- No API key, provider account, GIF catalogue, or provider search dependency is
  required.
- Loading a GIF discloses the reader's network address and browser request metadata
  to the selected provider. The default click gate and source label make that
  boundary visible.
- Provider removal, regional blocking, offline state, CSP changes, or network
  failure can make the media unavailable while the original message link remains.
- Provider URL formats are compatibility code. New providers or path forms require
  explicit validation, tests, privacy review, and a new capability version when the
  contract changes materially.
- Existing and mixed-version clients continue to exchange ordinary text messages.

## Related

- [FDR-009: Link Previews](../fdr/FDR-009-link-previews.md)
- [FDR-027: PWA Shell & Service Worker](../fdr/FDR-027-pwa-shell-and-service-worker.md)
- [FDR-030: External GIF Embeds](../fdr/FDR-030-external-gif-embeds.md)
