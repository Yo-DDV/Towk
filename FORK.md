# Towk fork provenance

Towk is an independent product derived from the open-source
[Chatto](https://github.com/chattocorp/chatto) repository. This repository keeps
the upstream history, copyright notices, license texts, and per-file SPDX
boundaries intact.

## Repositories

- Towk: <https://github.com/Yo-DDV/towk>
- Upstream: <https://github.com/chattocorp/chatto>
- Initial product baseline: Chatto `v0.4.7`
- First integrated Towk foundation: `dd38e54604a5c086a21669e62d366b33a8f661f8`

Towk is not endorsed, sponsored, operated, or supported by ChattoCorp GmbH.
References to Chatto remain where required for attribution, license compliance,
historical accuracy, or compatibility.

## Integration policy

Upstream commits are reviewed and selected; they are never deployed
automatically. Sync pull requests preserve upstream authorship and history,
separate local adaptations, and rerun the complete Towk verification matrix.
See [UPSTREAM.md](UPSTREAM.md) for the operational procedure and
[ADR-049](docs/adr/ADR-049-towk-product-identity-and-compatibility-boundary.md)
for the product/compatibility boundary.
