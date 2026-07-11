# Towk rebranding audit

Towk is an independent product based on Chatto. Rebranding changes the product-facing identity while preserving the legal attribution, history, and compatibility surfaces required to keep the fork maintainable.

## Classification rules

| Class | Treatment | Examples |
| --- | --- | --- |
| Towk-owned product surface | Uses Towk | UI, PWA manifest, screenshots, documentation title, OCI image, deployment service names |
| Required attribution or upstream history | Preserved and contextualized | `LICENSE`, `NOTICE`, README attribution, changelog, historical releases, ADR/FDR history, upstream issue links |
| Compatibility identifier | Preserved until an intentional migration exists | Go module and protobuf paths, `/chatto` binary, `chatto.toml`, `CHATTO_*` environment variables, `ChattoCore`, container UID/user |
| Pilot persistence identity | Preserved to protect existing state | Docker Compose project name and existing volume/network names |

Compatibility identifiers are implementation contracts, not Towk branding. Renaming them in place could break configuration, APIs, data paths, imports, or upgrades from upstream.

## Asset cleanup

The obsolete `chatto_light.png`, `chatto_dark.png`, `chatto-icon.png`, and `chatto-icon-maskable.png` assets were removed after a repository-wide reference check returned no remaining consumers. The documentation screenshots and Open Graph image are generated from the Towk identity; the frontend manifest icons already use the Towk mark.

## Release boundary

Towk publishes development images only under `ghcr.io/yo-ddv/towk`. Historical Chatto release pages are explicitly labelled as preserved upstream history. Towk does not claim ChattoCorp support, endorsement, cloud services, release channels, packages, or community infrastructure.

This audit must be updated whenever a compatibility identifier is migrated or a new product-facing surface is introduced.
