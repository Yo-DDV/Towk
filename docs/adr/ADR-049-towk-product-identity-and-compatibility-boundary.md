# ADR-049: Towk Product Identity with an Explicit Upstream Compatibility Boundary

**Date:** 2026-07-11

## Context

Towk is an independent product derived from Chatto. Its repository, interface,
documentation, images, releases, and community must present Towk as the product
without implying endorsement by ChattoCorp GmbH. At the same time, the codebase
contains inherited identifiers that are part of public protocols, persisted
data, deployment configuration, import paths, or upgrade compatibility.

A blind text replacement would make the product look renamed while breaking
existing installations, third-party clients, generated bindings, or future
upstream synchronization. Leaving every inherited label in place would create
the opposite problem: a fork that still presents itself as the upstream
product.

The repository uses a per-file license boundary. Server and CLI code are
AGPL-3.0-or-later by default; explicitly listed frontend, public API,
documentation, and example surfaces are Apache-2.0. Copyright and attribution
notices must survive the rebranding.

## Decision

Towk is the only product identity used on surfaces controlled by this project:

- repository name, description, topics, README, issue and pull request copy;
- default server name, PWA metadata, icons, page titles, user-facing errors,
  documentation site, container labels, package names, and release notes;
- Towk-owned images, deployment examples, support and contribution policy.

Chatto remains named only where one of these conditions applies:

1. truthful attribution, copyright, license, provenance, changelog, or upstream
   synchronization documentation;
2. a compatibility identifier whose immediate rename would break a stable or
   persisted contract;
3. historical release documentation that is clearly labelled as upstream
   history.

The initial compatibility boundary retains these inherited identifiers:

- protobuf package names and service paths under `chatto.*`;
- Go module/import paths and generated API namespaces;
- persisted NATS subjects, buckets, event types, browser storage keys, and
  operator socket paths;
- `CHATTO_*` environment variables and existing `chatto.toml` configuration;
- legacy command, image, or file aliases required to upgrade an existing
  installation without data migration.

New user-facing documentation calls these identifiers “legacy compatibility
names”. New product APIs and assets use Towk naming unless doing so would create
a second incompatible protocol for the same behavior.

Any future rename inside the compatibility boundary requires a separate ADR
with an additive transition, mixed-version behavior, migration test, rollback,
and a defined removal release. Removing a legacy identifier in the same release
that introduces its replacement is not allowed.

The application exposes a prominent source link for the exact deployed version.
`NOTICE`, upstream copyright statements, SPDX/REUSE metadata, and the statement
that Towk is based on Chatto are preserved.

## Consequences

Towk can develop a distinct identity immediately without misrepresenting the
origin of the software. Users see one coherent product name across the repository,
PWA, documentation, images, and support channels.

Some technical output continues to contain `chatto` until a safe migration is
worth its compatibility cost. This is intentional and testable, not unfinished
search-and-replace work. The rebranding audit must therefore classify remaining
matches instead of requiring a literal zero count.

Upstream synchronization stays practical because protocol and generated-code
paths do not churn solely for branding. Sync reviews must still inspect every
upstream workflow for hard-coded repository owners, package namespaces, domains,
or release destinations before merge.
