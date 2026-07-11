# Towk brand migration

Towk is an independent product based on Chatto. This plan applies ADR-049: it
removes upstream branding from fork-controlled product surfaces while retaining
license attribution and compatibility identifiers that cannot be renamed safely
without a migration.

## Classification rule

Every `Chatto`, `chatto`, `chattocorp`, or `chatto.run` occurrence belongs to one
of three classes. A rebranding pull request must classify new or changed matches.

| Class | Treatment | Examples |
|---|---|---|
| Towk-owned surface | Replace with Towk | README, repository metadata, PWA, icons, defaults, documentation prose, support links, images and releases |
| Required attribution | Preserve and contextualize | `NOTICE`, copyright, license text, upstream URL, changelog history, “based on Chatto” statement |
| Compatibility contract | Preserve until a versioned migration exists | `chatto.*` protobuf packages, Go imports, NATS subjects/buckets, browser storage keys, `CHATTO_*`, `chatto.toml` |

## Phase 1 — Public foundation

- Rename and describe the GitHub repository as Towk.
- Replace the README with a Towk product and contributor overview.
- Publish governance, support, security, code of conduct, issue forms, pull
  request template, ownership, and mandatory human/agent contribution rules.
- Disable or replace workflows that target ChattoCorp repositories, packages,
  release tokens, domains, or taps.
- Keep an immutable upstream remote and document selective synchronization.

## Phase 2 — Product shell

- Replace the default server identity, CLI copy, PWA manifest, favicon, install
  icons, Open Graph branding, and visible fallback labels.
- Update English and German strings together.
- Preserve operator-provided server branding: Towk is the fallback product name,
  not a prefix forced onto community names.
- Verify installed PWA upgrade behavior and old browser storage compatibility.

## Phase 3 — Distribution and documentation

- Publish fork-owned images and attestations only under the Towk namespace.
- Point documentation, source links, issue links, release metadata and examples
  to the Towk repository.
- Label inherited release notes as upstream history rather than Towk releases.
- Keep exact source-to-image traceability through tag, SHA, OCI labels, SBOM and
  provenance.

## Phase 4 — Compatibility migrations

Technical identifiers are renamed only when a dedicated ADR defines:

1. old and new identifier precedence;
2. mixed-version and second-run behavior;
3. data/config migration and rollback;
4. tests at the compatibility boundary;
5. the earliest release where the alias can be removed.

Until then, retained names are documented as compatibility identifiers and must
not be reused as Towk marketing or visual identity.

## Required verification

- `mise license-check`
- brand-policy scan with every remaining match classified
- frontend typecheck, lint, unit tests and build
- CLI tests and version/help smoke test
- documentation build and link checks
- workflow lint plus repository/package destination audit
- desktop and mobile PWA rendering, manifest and install-icon inspection
