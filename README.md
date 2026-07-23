<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <h3>Open-source communication that stays yours.</h3>

  <p>
    A focused, self-hosted workspace for teams and communities.<br />
    Rooms, direct messages, files, notifications, voice and video — on infrastructure you control.
  </p>

  <p>
    <strong>English</strong> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.pt.md">Português</a>
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/releases/latest"><img src="https://img.shields.io/github/v/release/Yo-DDV/Towk?style=flat-square&amp;sort=semver&amp;display_name=tag&amp;label=release" alt="Latest release" /></a>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml/badge.svg?branch=main" alt="Quick gate" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-43d8b0?style=flat-square" alt="Security policy" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/status-pre--1.0-f59e0b?style=flat-square" alt="Pre-1.0 status" />
  </p>

  <p>
    <a href="#why-towk"><strong>Why Towk</strong></a> ·
    <a href="#what-towk-delivers"><strong>Features</strong></a> ·
    <a href="#sovereignty-in-practice"><strong>Sovereignty</strong></a> ·
    <a href="#security-with-explicit-boundaries"><strong>Security</strong></a> ·
    <a href="#run-it-your-way"><strong>Deployment</strong></a> ·
    <a href="#try-it-locally"><strong>Quick start</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Towk is actively developed **pre-1.0 software**. Pin important deployments to an immutable release, image digest, or source commit; keep tested backups; and review release notes before upgrading.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Towk workspace showing room navigation, conversations and the member directory" width="1440" />
</picture>

## Why Towk

| 🧭 **Sovereignty by default** | 💬 **Focused communication** | 🔎 **Transparent engineering** |
|---|---|---|
| Operate the server, domain, identity, storage, backups and upgrade cadence. There is no central Towk account, mandatory hosted service or built-in product analytics. | Towk concentrates on the communication surfaces people use every day instead of growing into an all-purpose suite. | Source, API contracts, architecture decisions, security boundaries and release provenance are visible and auditable. |

Towk is built for organizations and communities that want modern collaboration **without handing the operational and data boundary to a third party**. Each server is independent; its accounts and community data stay within the infrastructure and policies chosen by its operator.

The installable PWA can connect directly to multiple independent Towk servers. That gives users one client without creating a central identity provider, shared data plane or federation layer.

## What Towk delivers

| | |
|---|---|
| **💬 Structured conversations**<br />Rooms, direct messages, replies, threads, reactions, mentions, search, presence and fast room switching. | **📎 Rich everyday content**<br />File attachments, voice messages, image and optional video handling, link previews and protected asset delivery. |
| **🔔 Attention without noise**<br />Realtime notifications, Web Push, badges, per-room notification levels and direct routing back to the relevant conversation. | **🎙 Voice, video and screen sharing**<br />Room-scoped LiveKit calls with camera, screen sharing, device controls, reconnection handling and media E2EE. |
| **🧭 One responsive PWA**<br />Desktop and mobile layouts, install guidance, an offline shell, encrypted local drafts and outbox state, OS sharing and progressive device integrations. | **🛡 Administration that remains understandable**<br />Built-in and custom roles, granular permissions, room overrides, member management, server branding, diagnostics and an administrative event log. |
| **🌍 Multilingual interface**<br />English, French, German, Spanish and Portuguese are maintained in the current client. | **🔌 Open integration surface**<br />ConnectRPC and Protocol Buffers for public APIs, plus a protobuf realtime WebSocket for live updates. |

## Focused by design

Towk is not trying to become a marketplace, a social network or a sprawling business suite. Its product direction is deliberately narrower:

- make conversations fast to enter, read and revisit;
- make notifications useful rather than overwhelming;
- keep files, calls and administration close to the room where work happens;
- improve the basics across desktop, tablet and mobile without splitting the product into divergent clients;
- expose limitations and security boundaries instead of hiding them behind marketing language.

That focus is part of the product, not a temporary lack of ambition.

## Sovereignty in practice

| You choose | Towk provides |
|---|---|
| **Identity** | Built-in email/password flows or external OAuth/OIDC providers. Accounts remain server-local. |
| **Data layer** | Embedded NATS for compact installs, or external NATS/JetStream for a more explicit topology. |
| **File storage** | NATS Object Store by default, with S3-compatible storage available for larger asset workloads. |
| **Calls** | Optional LiveKit integration. Call UI disappears when LiveKit is not configured. |
| **Client access** | A browser-delivered PWA that connects directly to the servers a user adds. |
| **Operations** | CLI tooling, backup and key-export paths, Prometheus-compatible metrics, immutable release artifacts and documented rollback expectations. |

Towk is **not federated**: servers do not exchange community data. Each deployment remains its own administrative and data-protection boundary.

Self-hosting does not create compliance by itself, but it gives operators the control needed to align hosting location, identity, storage, backups and access policy with their own requirements.

## Security with explicit boundaries

Towk aims to make security decisions inspectable rather than absolute.

| Boundary | Current approach |
|---|---|
| **Authorization** | API-first enforcement with built-in and custom RBAC roles, explicit grants and denies, room-specific overrides and owner recovery. |
| **Sessions** | Opaque server-side credentials, signed browser cookies, revocation through runtime-state deletion and authentication rate limits. |
| **Protected durable fields** | Message text and selected account fields are encrypted before durable storage with per-user key material. |
| **Transport and browser surface** | HTTPS support, restrictive response headers, origin checks, bounded request sizes and protected asset delivery. |
| **Backups and operations** | Optional age-encrypted archives, separate key handling, private operator automation over a Unix socket and Prometheus-compatible monitoring. |

> [!NOTE]
> Towk is not blanket end-to-end encryption for normal messaging. The running server must decrypt protected fields for authorized clients. Attachments, avatars and substantial metadata remain outside Towk's field-level encryption envelope and require infrastructure-level protection. Voice and video media can use LiveKit E2EE.

Read the exact model before evaluating Towk for sensitive workloads:

- [Security policy](SECURITY.md)
- [Security and privacy guide](apps/docs-website/src/content/docs/guides/operations/security.mdx)
- [Encryption at rest and data erasure](apps/docs-website/src/content/docs/guides/operations/privacy-erasure.mdx)
- [Backup and restore](apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)

## Run it your way

| Path | Best fit | Shape |
|---|---|---|
| **Single binary** | Evaluation, small teams and simple VMs | Embedded web client, APIs and NATS in one compact process. |
| **Docker Compose** | Most self-hosted servers | Towk with explicit NATS, Caddy and optional LiveKit on one host. |
| **Kubernetes / external services** | Operators with an existing platform | External NATS, S3-compatible storage, LiveKit and multiple Towk replicas where the surrounding infrastructure is qualified. |

Towk does not require MySQL or PostgreSQL. Durable application state is built on NATS JetStream and projections, while the web client is compiled into the Go server distribution.

## Try it locally

Towk uses [mise](https://mise.jdx.dev/) to provision its pinned development toolchain.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

Open <http://localhost:4000>.

This development path uses local bootstrap fixtures. Do not reuse development credentials or defaults in a public deployment.

For durable deployments, start with:

- [Introduction](apps/docs-website/src/content/docs/getting-started/introduction.mdx)
- [Quick start](apps/docs-website/src/content/docs/getting-started/quick-start.mdx)
- [Read this first](apps/docs-website/src/content/docs/guides/deployment/read-this-first.mdx)
- [Architecture](docs/ARCHITECTURE.md)

## Project status and expectations

Towk is maintained as an independent, public, pre-1.0 project.

- Public APIs and deployment contracts may still evolve during the `0.x` series.
- Important deployments should use immutable versions and tested restore procedures.
- The PWA is the current desktop and mobile client; app-store packages are not currently published.
- Towk does not currently offer a hosted edition or a commercial support plan.
- Bugs, focused feature proposals and self-hosting questions are handled through [GitHub Issues](https://github.com/Yo-DDV/Towk/issues/new/choose).
- Vulnerabilities must be reported privately through [SECURITY.md](SECURITY.md).

The roadmap is evidence-oriented: completed work must exist in the repository, while planned work remains subject to design and validation. See [ROADMAP.md](ROADMAP.md).

## Documentation and project records

| Need | Reference |
|---|---|
| Product introduction and deployment | [Documentation source](apps/docs-website/src/content/docs/) |
| Architecture and APIs | [Architecture inventory](docs/ARCHITECTURE.md) · [ADRs](docs/adr/INDEX.md) · [FDRs](docs/fdr/INDEX.md) |
| Operating and security | [Security](SECURITY.md) · [Support](SUPPORT.md) · [Performance qualification](docs/PERFORMANCE.md) |
| Project process | [Governance](GOVERNANCE.md) · [Contribution guide](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) |
| Origin and compatibility | [Provenance](PROVENANCE.md) · [Upstream policy](UPSTREAM.md) · [Corresponding source](SOURCE.md) |

## License and origin

Towk preserves the repository's per-file licensing model:

- the server, CLI and bundled server distribution are generally **AGPL-3.0-or-later**;
- explicitly identified frontend, public API, documentation and example surfaces are **Apache-2.0**;
- the exact machine-readable boundary is defined by [REUSE.toml](REUSE.toml), with third-party notices in [NOTICE](NOTICE).

Towk is an independent project based on [Chatto](https://github.com/chattocorp/chatto). It preserves upstream authorship, notices and compatibility contracts while making its own product, release and support decisions. Towk is not endorsed, sponsored, operated or supported by ChattoCorp GmbH.
