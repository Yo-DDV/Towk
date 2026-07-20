# ADR-052: Protected Media Revalidates After Authorization

**Date:** 2026-07-17

## Context

Protected attachment responses previously used `Cache-Control: private,
no-store`. That prevented a browser from reusing an already downloaded body,
even when the asset was unchanged, and made repeated image, GIF, audio, video,
and room-file rendering pay the full transfer cost.

Changing the response to a normal cacheable policy without preserving current
authorization would be unsafe. An expired access ticket, deleted asset, or
revoked room membership must take effect before Towk accepts a conditional
request. Partial media reads also need validators that cannot combine bytes
from different asset versions.

## Decision

Stable protected originals and derivatives use `Cache-Control: private,
no-cache` with a strong `ETag`. `private` prevents shared caches from retaining
the response, while `no-cache` permits a browser's private cache to store the
body only if it revalidates before reuse.

Towk validates the ticket or authenticated request, resolves current asset
state, and checks current room membership before evaluating `If-None-Match` or
returning `304 Not Modified`. Authorization failures therefore remain `401` or
`403`; they can never be converted into metadata-only cache hits.

Streamed originals support one HTTP byte range, `If-Range`, and
`416 Range Not Satisfiable`. The response validator is stable for the original
asset. Derivative validators include the versioned transform encoding namespace
so bytes produced by a changed encoder cannot reuse an older validator.

The Service Worker does not persist protected response bodies. Heavy passive
S3-backed originals may still redirect after authorization to a short-lived
presigned object URL whose object response remains `private, no-store`.

## Consequences

- Repeated protected media renders can receive a small authorized `304`
  response instead of downloading an unchanged body again.
- Range-capable media players can seek without downloading the whole streamed
  original.
- Every reuse still reaches Towk, so membership revocation, ticket expiry,
  deletion, and replacement remain authoritative.
- A valid access ticket remains a bearer capability until expiry or access
  revocation. Operators must keep HTTPS enabled and must not log ticket query
  values.
- Server-side derivative caching remains independent. A full derivative cache
  falls back to uncached generation and delivery; it does not bypass
  authorization or fail the user request solely because the cache is full.

## References

- [RFC 9111: private response directive](https://www.rfc-editor.org/rfc/rfc9111.html#name-private)
- [RFC 9111: no-cache response directive](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2)
- [RFC 9110: conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests)
- [RFC 9110: Range requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
