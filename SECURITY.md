# Security policy

Towk is pre-1.0 software. It is available for inspection and self-hosting, but
the project does not currently promise long-term security support or response
SLAs.

## Supported versions

Security fixes target the active `main` release line and the most recent Towk
release when one exists. Deployments should pin an immutable release or image
digest, maintain tested backups, and evaluate security notices before upgrades.

## Report a vulnerability

Do not open a public issue, discussion, or pull request for a suspected
vulnerability. Use GitHub's **Report a vulnerability** private reporting flow in
the repository Security tab.

Include only the minimum information needed to investigate:

- affected version, commit SHA, or image digest;
- component and deployment model;
- impact and realistic attack prerequisites;
- reproduction steps or a minimal proof of concept;
- suggested mitigation, if known.

Do not send real credentials, private messages, personal data, production
databases, raw production logs, or unredacted screenshots. Use synthetic data
and redact tokens, hostnames, addresses, and user identifiers.

Maintainers will assess reports privately, coordinate a fix when warranted, and
publish an advisory after affected users have a reasonable mitigation path.
Duplicate, non-actionable, or third-party-only reports may be closed.

## Scope

The Towk server, bundled frontend, public API, official container images,
release workflows, and maintained deployment examples are in scope. Third-party
services and user-managed infrastructure are in scope only when Towk's
maintained code or documentation creates the vulnerability.

Security research must avoid privacy violations, data destruction, denial of
service, persistence, social engineering, and access beyond the minimum needed
to demonstrate the issue. This policy does not create authorization to test
deployments you do not own or have explicit permission to assess.
