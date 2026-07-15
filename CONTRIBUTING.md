# Participating in Towk

Towk accepts public reports, proposals and questions through GitHub Issues. The
repository does not accept unsolicited external pull requests or direct code
submissions.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md) and the
project governance in [GOVERNANCE.md](GOVERNANCE.md).

## Choose the right channel

- Use the [bug report](https://github.com/Yo-DDV/Towk/issues/new?template=bug_report.yml)
  for reproducible defects.
- Use the [feature proposal](https://github.com/Yo-DDV/Towk/issues/new?template=feature_request.yml)
  for scoped product changes.
- Use the [question form](https://github.com/Yo-DDV/Towk/issues/new?template=question.yml)
  for usage, deployment and self-hosting questions.
- Use the private route in [SECURITY.md](SECURITY.md) for suspected
  vulnerabilities.

Search existing issues before submitting. Keep one issue focused on one outcome
and include the exact Towk version, commit or image digest when relevant.

Do not submit secrets, personal data, private messages, production databases,
raw production logs or unredacted screenshots. Use synthetic examples and redact
hostnames, addresses, tokens and user identifiers.

## How accepted work is implemented

Maintainers triage issues and decide whether they fit the product, security,
compatibility and maintenance boundaries. Accepted work is implemented by the
project owner or approved automation on a protected branch, then merged only
after the required checks pass.

GitHub does not provide a setting that removes pull-request creation for outside
users while keeping a public repository and public Issues. Unsolicited external
pull requests are therefore closed and locked automatically with a link back to
the issue forms. Opening an issue first does not grant permission to submit a
pull request.

## Maintainer development setup

Towk uses [mise](https://mise.jdx.dev/) to provision tools and run tasks:

```sh
mise trust
mise run setup
mise dev
```

Without a workspace-specific port, the web app is available at
<http://localhost:4000>. These local bootstrap accounts are for development only
and must never be reused in a public deployment.

| Login | Email | Password | Role |
|---|---|---|---|
| `alice` | `alice@example.com` | `foobar123` | owner |
| `bob` | `bob@example.com` | `foobar123` | user |

Useful repository tasks include:

```sh
mise license-check
mise test-cli
mise test-frontend
mise test-e2e
mise test
mise build
```

Maintainer changes must follow this guide, the pull-request template, the
applicable licensing rules in [LICENSING.md](LICENSING.md), and the design
records in [docs/adr/](docs/adr/) and [docs/fdr/](docs/fdr/) when they apply.
