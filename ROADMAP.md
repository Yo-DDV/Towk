# Towk roadmap

This roadmap describes product direction, not a promise of delivery dates.
Completed items are backed by repository history and project documentation;
planned items still require issue-level design and acceptance criteria.

## Foundation — completed

- standalone public repository with protected `main`, private vulnerability
  reporting, required CI/security checks, and Towk-owned release workflows;
- preserved Chatto provenance, SPDX/REUSE boundaries, notices, corresponding
  source, and a read-only upstream integration path;
- Towk product identity across the PWA, documentation, CLI presentation,
  containers, package namespaces, and public project metadata;
- traceable multi-architecture OCI images with SBOMs, vulnerability scans,
  provenance attestations, immutable commit tags, and digest-based deployment;
- tested deployment, backup/restore procedure, rollback procedure, and
  external LiveKit integration.

## Independent release baseline — completed

- published `v0.5.0` from the independent repository with checksums, build
  provenance, and release notes;
- established commit-derived development images tied to exact source commits;
- documented that the `v0.5.0` archive predates the canonical Towk executable
  and is not the fully rebranded distribution target.

## First fully Towk-branded release — in progress

- make `towk` the canonical executable and configuration filename while
  preserving explicit compatibility fallbacks;
- publish the first archive whose sole application executable is `towk` and
  whose legal bundle is verified before attachment;
- publish a matching immutable container image for each future semantic-version
  release without introducing a floating `latest` tag;
- validate a clean installation and an upgrade from the Chatto `v0.4.7`
  compatibility baseline;
- verify the public source link and deployed-version traceability end to end.

## PWA everywhere — next

- keep one responsive client for current Chrome, Edge, Firefox, and Safari on
  Windows, macOS, Linux, Android, iOS, and iPadOS;
- expand automated viewport and interaction coverage for phone, tablet, desktop,
  keyboard, touch, reduced-motion, and accessibility modes;
- harden installation, offline shell, service-worker updates, badge state, Web
  Push, notification routing, and background limitations per platform;
- measure startup, navigation, timeline rendering, media loading, and reconnect
  behavior on constrained devices and networks;
- publish a maintained platform-support matrix based on repeatable evidence.

## Communication quality — planned

- validate audio, video, screen sharing, direct UDP, TCP fallback, and TURN
  behavior across representative networks and browsers;
- design and implement incoming-call system notifications and reliable background
  invitations after a dedicated FDR, platform-capability study, and privacy review;
- continue mobile and tablet interaction polish without creating a separate,
  divergent client.

## Native packaging — exploratory

The PWA remains the primary client. Native wrappers or store packages may be
evaluated only where they add measurable platform value such as deeper
notifications, share targets, managed deployment, or device integration. Any
native path must reuse the web product where practical, preserve feature parity,
and avoid fragmenting security updates or the user experience.

## Continuous upstream evaluation

Towk periodically reviews Chatto changes but never imports them automatically.
Security, correctness, performance, compatibility, responsive UX, and licensing
are evaluated against Towk's current implementation before a dedicated pull
request is accepted. See [UPSTREAM.md](UPSTREAM.md) and
[ADR-050](docs/adr/ADR-050-standalone-repository-with-selective-upstream-integration.md).
