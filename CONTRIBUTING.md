# Contributing to Towk

Towk welcomes bug reports, design discussions, documentation, translations,
tests, and code. Contributions may be prepared manually or with coding agents;
the same quality, security, licensing, and review requirements apply.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md) and the
project governance in [GOVERNANCE.md](GOVERNANCE.md).

## Before you start

1. Search existing issues, pull requests, ADRs, and FDRs.
2. Open an issue before large features, protocol changes, migrations, or new
   dependencies. Small, well-scoped fixes may go directly to a pull request.
3. Read [AGENTS.md](AGENTS.md) and any path-specific `AGENTS.md` files.
4. Keep one pull request focused on one coherent outcome.

Do not submit secrets, personal data, private messages, production databases,
raw production logs, or unredacted screenshots. Report vulnerabilities through
the private route in [SECURITY.md](SECURITY.md), never through a public issue.

## Development setup

Towk uses [mise](https://mise.jdx.dev/) to provision tools and run tasks:

```sh
mise trust
mise run setup
mise dev
```

Without a workspace-specific port, the web app is available at
<http://localhost:4000>. The local bootstrap users below are for development
only and must never be reused in a public deployment.

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

Run the narrowest test that can fail while iterating. Before submission, run
the complete matrix required for the surfaces changed and report exactly what
was and was not run.

## Contribution requirements

- Use a short-lived branch and Conventional Commits.
- Add or update tests for behavior changes and regression fixes.
- Update public docs, FDRs, ADRs, glossary, migration notes, and notices when
  the change affects them.
- Preserve compatibility contracts unless a reviewed, versioned migration with
  rollback is part of the change.
- Keep generated files synchronized with their source and name the generator.
- Use only code, assets, and data you have the right to contribute under the
  applicable license in [LICENSING.md](LICENSING.md).
- Do not weaken a test, scanner, branch rule, permission, or audit trail merely
  to make a check pass.

Pull request titles use Conventional Commit syntax, such as `fix(api): reject
expired sessions` or `feat(frontend): add room shortcuts`. The pull request body
must describe the outcome, risks, compatibility impact, test evidence, and any
residual gap. Link the relevant issue and decision records.

## Contributions prepared with coding agents

The contributor opening the pull request remains accountable for every line,
dependency, asset, claim, and test result, regardless of the tools used.
Agent-assisted contributions must also meet these rules:

1. Give the tool the tracked repository guidance before it changes files.
2. Constrain the task and review the complete diff, including generated files.
3. Verify facts against current code and primary documentation; generated text
   and previous session notes are not evidence.
4. Reproduce the reported tests in the submitted checkout. Never claim a check
   ran when it did not, and never hide a failing or skipped check.
5. Inspect for fabricated APIs, dependencies, licenses, citations, security
   properties, migration guarantees, and performance claims.
6. Keep prompts, transcripts, credentials, private context, tool caches, and
   machine-specific configuration out of the repository.
7. Do not let multiple tools write overlapping files concurrently.
8. Stop and request human review for destructive migrations, secret handling,
   release publication, production access, or ambiguous legal provenance.

The project does not require disclosure of a particular editor or assistant.
It does require truthful provenance, human review, and reproducible evidence.
Submissions that bypass this policy may be closed until they are independently
reviewed and corrected.

## Review and acceptance

Maintainers review correctness, product fit, security, accessibility,
compatibility, operational safety, documentation, and license provenance. A
green CI run is necessary but not sufficient. Maintainers may request a smaller
change, an ADR/FDR, migration proof, or an independent test.

Submitting a contribution licenses it under the license applicable to the file
or path and certifies that you have the right to do so. Towk uses an inbound
equals outbound model and does not require a separate contributor license
agreement at this time.
