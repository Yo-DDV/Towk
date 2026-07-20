# ADR-047: Direct Ticketed Asset URLs for Browser Media

**Date:** 2026-07-05

## Context

Towk browser clients need to render room attachments from the origin server
and from remote registered servers. Native media elements cannot reliably attach
registered-server bearer tokens or cross-site cookies to those subresource
requests, so attachment URLs use per-user asset access tickets.

ADR-039 attempted to hide those tickets from normal page markup by routing
controlled browser sessions through Service Worker virtual URLs. That reduced
copy-URL leakage, but it added a second asset routing layer, worker/client
resynchronization, a private proxy header, and separate restart/error behavior.
The Service Worker did not renew expired tickets by itself; foreground
components still had to refresh asset URLs through `AssetService`.

## Decision

Render browser media with the direct ticketed asset URLs issued by Towk:
`/assets/files/{assetId}?access={ticket}` and derivative URLs under the same
stable path. Relative asset URLs are resolved against the server that owns the
message or room-file item, so remote-server images, audio, and video keep
working without cookies or bearer headers.

Clients use the `expires_at` field on each asset URL to refresh before expiry
through `AssetService.GetAsset` or `BatchGetAssets`, and refresh again after a
media load error. The Service Worker is no longer involved in protected asset
loading and does not proxy or cache protected asset bytes.

ADR-039 is superseded.

## Consequences

- **The Service Worker is simpler.** It owns app-shell caching, notification
  clicks, and badge reconciliation, not application-specific asset routing.
- **Ticketed URLs are visible in markup again.** A copied image or media URL is
  a bearer capability until it expires or the signed user loses room access.
  This is accepted because tickets are bounded, current room membership is
  checked on every fetch, and clients refresh URLs before lazy loads hit expiry.
- **Remote server media stays compatible.** Browser media elements can fetch
  remote attachments without relying on cross-site cookies or Authorization
  headers.
- **Protected asset bodies remain private and authorization stays live.** As
  refined by ADR-052, streamed originals and derivatives use `private,
  no-cache` with validators. The browser may retain a body, but Towk checks the
  current ticket and room membership before every conditional reuse. The
  Service Worker does not persist protected bodies.
- **Heavy passive S3-backed originals may redirect.** Towk authorizes the
  stable asset request first, then may return a short-lived presigned object URL
  for video, audio, or large passive files. Active document types still stream
  through Towk so sandbox headers are applied.
