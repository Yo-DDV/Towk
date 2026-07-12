# Towk rebranding audit

Towk is an independent product based on Chatto. Rebranding changes the product-facing identity while preserving the legal attribution, history, and compatibility surfaces required to keep the fork maintainable.

## Classification rules

| Class | Treatment | Examples |
| --- | --- | --- |
| Towk-owned product surface | Uses Towk | UI, PWA manifest, screenshots, documentation title, OCI image, deployment service names |
| Required attribution or upstream history | Preserved and contextualized | `LICENSE`, `NOTICE`, README attribution, changelog, historical releases, upstream issue links |
| Compatibility identifier | Preserved until an intentional migration exists | Go module and protobuf paths, `/chatto` binary, `chatto.toml`, `CHATTO_*` environment variables, `ChattoCore`, `ChattoConfig`, `chatto_*` metric names, `X-Chatto-Asset-Proxy`, container UID/user |
| Legacy migration cleanup | Preserved only as cleanup input | Old service-worker cache names such as `chatto-shell-*` and `chatto-badge-state-v2` |

Compatibility identifiers are implementation contracts, not Towk branding. Renaming them in place could break configuration, APIs, data paths, imports, metrics, generated clients, persisted browser state, or upgrades from upstream.

## Code and documentation cleanup

Current product-facing package names, frontend helper names, default labels, CSP
policy names, documentation prose, ADRs, FDRs, workflow skills, and deployment
examples use Towk. Remaining `Chatto` matches are intentionally scoped to legal
attribution, upstream relationship text, historical release pages, or exact
compatibility identifiers listed above.

## Asset cleanup

The obsolete `chatto_light.png`, `chatto_dark.png`, `chatto-icon.png`, and
`chatto-icon-maskable.png` assets were removed after a repository-wide reference
check returned no remaining consumers. README artwork selects the exact v2
horizontal logo for the viewer's light or dark theme. The documentation header,
favicons, Apple touch icon, Open Graph cards, frontend manifest icons, maskable
icon, browser favicon, and notification icon fallback use the matching exact v2
symbol assets. Product screenshots continue to show each server's configurable
server logo rather than replacing it with the Towk product mark.

## Release boundary

Towk publishes development images only under `ghcr.io/yo-ddv/towk`. Historical Chatto release pages are explicitly labelled as preserved upstream history. Towk does not claim ChattoCorp support, endorsement, cloud services, release channels, packages, or community infrastructure.

This audit must be updated whenever a compatibility identifier is migrated, a
legacy cleanup alias is removed, or a new product-facing surface is introduced.
