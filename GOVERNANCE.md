# Towk governance

Towk is an independent, community-visible project maintained in the open. The
project optimizes for self-hosters, safe evolution, clear ownership, and an
auditable relationship with its upstream foundation.

## Roles

- **Contributors** report issues, participate in design, and submit changes.
- **Reviewers** provide evidence-based technical review but cannot merge solely
  on their own review when a separate maintainer review is required.
- **Maintainers** triage work, protect compatibility and security boundaries,
  manage releases, and merge accepted changes.
- **Project owner** appoints maintainers, resolves governance deadlocks, and is
  accountable for repository administration and trademark decisions.

Roles are earned through sustained, constructive contributions. Access follows
least privilege and may be removed when inactive or when project security
requires it.

## Decision process

Routine fixes are decided through pull request review. User-visible behavior is
recorded in an FDR; cross-cutting architecture, compatibility, storage,
security, or deployment choices are recorded in an ADR. Significant proposals
should start as an issue so affected users can comment before implementation.

The project seeks rough consensus, but consensus does not mean unanimity. The
responsible maintainer records the decision and rationale. The project owner is
the final escalation point when maintainers cannot resolve a decision or when
legal, safety, or trademark risk is involved.

## Repository controls

- `main` is protected and accepts changes through pull requests.
- Required checks, resolved review conversations, and a current branch are
  mandatory before merge.
- Releases are created only from reviewed commits by Towk-owned workflows.
- Force pushes and branch deletion are disabled on protected release branches.
- Security-sensitive access and automation permissions are reviewed regularly.

The owner may apply an emergency security fix with an auditable follow-up when
normal review would materially increase harm. Emergency access is not a shortcut
for routine work.

## Upstream relationship

Towk selects changes from Chatto through the process in [UPSTREAM.md](UPSTREAM.md).
Upstream authorship and license notices are preserved. Towk makes its own product,
release, support, and compatibility decisions and does not imply upstream
endorsement.

## Changes to governance

Governance changes use a public pull request with a rationale and an explicit
review period appropriate to their impact. Changes to licensing, ownership,
trademark policy, or maintainer authority require approval from the project
owner.
