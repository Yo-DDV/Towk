# Towk provenance

Towk is an independent product derived from the open-source
[Chatto](https://github.com/chattocorp/chatto) repository. The canonical Towk
repository is standalone and is not part of GitHub's Chatto fork network. It
preserves the inherited Git history, copyright notices, license texts, and
per-file SPDX boundaries.

## Repositories

- Canonical Towk repository: <https://github.com/Yo-DDV/Towk>
- Chatto upstream: <https://github.com/chattocorp/chatto>
- Initial product baseline: Chatto `v0.4.7`
- First integrated Towk foundation: `dd38e54604a5c086a21669e62d366b33a8f661f8`
- Standalone repository baseline: `762cdabe293705327970b49d77bc18c23d72243e`

The former fork's repository metadata and initial review record are retained in
a private, read-only compliance archive. The archive is not a release, support,
contribution, or public-history channel. The inherited source and commit history
needed to establish provenance remain in this canonical repository.

Towk is not endorsed, sponsored, operated, or supported by ChattoCorp GmbH.
References to Chatto remain where required for attribution, license compliance,
historical accuracy, or compatibility.

## Integration policy

Upstream commits are reviewed and selected; they are never deployed
automatically. Integration pull requests record exact upstream SHAs, preserve
authorship and applicable license metadata, explain conflicts, and rerun the
complete Towk verification matrix. See [UPSTREAM.md](UPSTREAM.md) for the public
procedure, [ADR-049](docs/adr/ADR-049-towk-product-identity-and-compatibility-boundary.md)
for the product/compatibility boundary, and
[ADR-050](docs/adr/ADR-050-standalone-repository-with-selective-upstream-integration.md)
for the standalone repository decision.
