<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <p><strong>Your conversations. Your infrastructure.</strong></p>

  <p>
    A self-hosted communication workspace for teams and communities.<br />
    Messaging, files, notifications, voice and video under your control.
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/ci.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
    <a href="https://github.com/Yo-DDV/Towk/security"><img src="https://img.shields.io/badge/security-policy-43d8b0" alt="Security policy" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2" alt="AGPL-3.0-or-later with Apache-2.0 surfaces" /></a>
    <a href="https://github.com/Yo-DDV/Towk/issues/new/choose"><img src="https://img.shields.io/badge/issue%20intake-open-4aa8ff" alt="Issue intake open" /></a>
  </p>

  <p>
    <a href="#why-towk">Why Towk</a> ·
    <a href="#what-ships-today">Features</a> ·
    <a href="#run-a-development-workspace">Quick start</a> ·
    <a href="#public-issue-intake">Issues</a> ·
    <a href="#security">Security</a>
  </p>
</div>

> [!IMPORTANT]
> Towk is under active development and has not reached 1.0. Pin deployments to
> immutable tags or digests, keep tested backups, and read the release notes
> before upgrading.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Towk room overview showing the workspace navigation and room directory" width="1440" />
</picture>

## Why Towk

| Your workspace | Complete communication | Built to operate |
|---|---|---|
| Run one independent server for your organization or community. | Keep rooms, direct messages, files, notifications, voice and video together. | Deploy as a single binary or container, with external NATS and S3-compatible storage when needed. |

Towk is designed for self-hosting, responsive browser use and installable PWA
workflows. It is not a federated protocol or a shared hosted service: each
deployment remains operationally and legally independent.

## What ships today

| Area | Capabilities |
|---|---|
| Conversations | Rooms, direct messages, replies, threads, reactions, mentions and presence |
| Content | File attachments, image handling, link previews and optional video processing |
| Administration | Granular roles, permissions, room groups and server administration |
| Notifications | Realtime delivery, Web Push, badges and configurable notification levels |
| Calls | LiveKit voice and video rooms, screen sharing and media E2EE |
| Installed PWA | Offline shell, encrypted drafts/history/outbox, OS sharing, install guidance and call integrations |
| Identity | OAuth/OIDC, password and email authentication flows |
| Data control | Per-user encryption keys for selected durable data and crypto-shredding support |
| Integration | Multi-server client foundations and a protobuf-first public API |

## Architecture at a glance

| Layer | Technology | Responsibility |
|---|---|---|
| Client | Svelte 5, SvelteKit, Tailwind CSS 4 | Responsive web app and installable PWA |
| API | ConnectRPC and Protocol Buffers | Public, admin, auth and discovery contracts |
| Realtime | Protobuf over WebSocket | Live messages, state and configuration updates |
| Domain | Go services and projections | Authorization, event-sourced behavior and APIs |
| Data | NATS JetStream and KV | Events, projections, runtime state and object storage |
| Calls | LiveKit | Voice, video, screen sharing and media transport |

See [the architecture reference](docs/ARCHITECTURE.md) for services, streams,
subjects, projections and public APIs.

## Run a development workspace

Towk uses [mise](https://mise.jdx.dev/) to provision the project toolchain.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

The default development entry point is <http://localhost:4000>. Development
bootstrap accounts are documented in [CONTRIBUTING.md](CONTRIBUTING.md) and must
never be reused in a public deployment.

Useful checks:

```sh
mise license-check
mise test
mise build
```

Media and capacity changes use the reproducible gates in the
[performance qualification protocol](docs/PERFORMANCE.md).

## Releases and deployment

Towk images are built from this repository, scanned before publication, and tied
to an exact commit through OCI metadata, SBOM and provenance attestations. See
[Corresponding source](SOURCE.md) for the source lookup contract.

Do not deploy floating images as a durable Towk release. Pin an immutable Towk
tag or digest, keep tested backups and review release notes before upgrading.

## Public issue intake

Public participation happens through GitHub Issues. Choose the form that matches
your request so it arrives with the evidence needed for triage:

- [Report a reproducible bug](https://github.com/Yo-DDV/Towk/issues/new?template=bug_report.yml)
- [Propose a scoped feature](https://github.com/Yo-DDV/Towk/issues/new?template=feature_request.yml)
- [Ask a usage or self-hosting question](https://github.com/Yo-DDV/Towk/issues/new?template=question.yml)

Search existing issues first and remove secrets, personal data, private messages,
raw production logs and unredacted screenshots. Towk does not accept unsolicited
external pull requests; maintainers implement accepted work through protected,
fully checked branches. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[SUPPORT.md](SUPPORT.md).

## Security

Do not disclose suspected vulnerabilities in a public issue. Follow
[SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting. Never
include tokens, private messages, personal data, raw production logs or
unredacted screenshots in reports.

## Governance and roadmap

`main` is protected by required checks, current-branch enforcement and resolved
review conversations. Releases are produced by Towk-owned workflows from
reviewed commits. Durable product and architecture choices are recorded in FDRs
and ADRs.

See [GOVERNANCE.md](GOVERNANCE.md), [ROADMAP.md](ROADMAP.md),
[PROVENANCE.md](PROVENANCE.md) and [UPSTREAM.md](UPSTREAM.md).

## License, origin and compatibility

Towk uses the repository's existing per-file licensing model:

- the server, CLI and bundled server artifacts are AGPL-3.0-or-later by default;
- explicitly listed frontend, public API, documentation and example surfaces are
  Apache-2.0;
- third-party notices remain in [NOTICE](NOTICE).

The exact machine-readable boundary is defined by [REUSE.toml](REUSE.toml).
When a modified AGPL server is available over a network, its users must receive a
prominent way to obtain the corresponding source for that deployed version.

The inherited `chatto.*` protocol namespaces, `CHATTO_*` environment variables
and several persisted identifiers remain compatibility contracts. They are not
Towk branding and will change only through versioned, rollback-safe migrations;
see [ADR-049](docs/adr/ADR-049-towk-product-identity-and-compatibility-boundary.md).

Towk is an independent project based on
[Chatto](https://github.com/chattocorp/chatto). Chatto and its logos are names and
marks of ChattoCorp GmbH. Towk is not endorsed, sponsored, operated or supported
by ChattoCorp GmbH.
