# ADR-050: Standalone Repository with Selective Upstream Integration

**Date:** 2026-07-12

## Context

Towk began as a GitHub fork of Chatto so the initial history and changes could
be reviewed quickly. The product now has its own identity, deployment pipeline,
governance, support boundary, security controls, release process, and roadmap.
Remaining inside GitHub's fork network incorrectly presents the canonical
repository as a subordinate copy and couples repository administration to the
upstream network.

Towk must still preserve the legal and technical provenance of inherited code.
It also benefits from reviewing later Chatto security fixes and features. GitHub's
direct “leave fork network” operation discards pull requests and other repository
metadata, while deleting and recreating the fork would erase the public review
record.

## Decision

`Yo-DDV/Towk` is the standalone canonical repository. It retains the complete
Git history needed to identify inherited and Towk-authored changes, but it has no
GitHub fork-network relationship or automatic synchronization with Chatto.

The former fork is retained as the archived, read-only
`Yo-DDV/Towk-legacy-fork` repository. Its purpose is limited to preserving the
initial pull-request and review record. New issues, pull requests, releases,
packages, support, and security reports belong to the canonical repository.

Chatto remains configured locally as a read-only `upstream` Git remote. Towk may
integrate upstream work only through a dedicated pull request that:

1. records the exact upstream commits or branch tip under review;
2. verifies copyright, authorship, per-file license metadata, and corresponding
   source obligations;
3. selects cherry-pick, merge, or reimplementation based on the smallest safe
   change rather than automatically preferring newer upstream code;
4. compares correctness, security, performance, responsive UX, accessibility,
   public API behavior, persistence, and deployment/release workflows with the
   current Towk implementation;
5. preserves Towk-owned repository, registry, domain, secret, deployment, and
   release destinations;
6. passes Towk's complete required checks and an independent post-merge review.

During a release freeze, normal upstream features are deferred. Only a proven
security, data-integrity, or release-blocking fix can enter the candidate, and it
must pass the same review process.

Detailed candidate scoring and review cadence are operational maintainer policy,
not a public product contract. The public guarantees remain provenance,
selective review, no automatic deployment, and Towk-owned release authority.

## Consequences

Towk can evolve its product, roadmap, release cadence, and community without a
platform-level fork label or automatic upstream coupling. The canonical
repository starts a new GitHub issue and pull-request sequence; the archived
repository remains available for the earlier review history.

GitHub stars, watchers, rules, package access, and security settings do not move
with Git history and must be recreated or reassigned during the transition. The
standalone migration therefore requires a verified mirror backup, restored
branch protection and security settings, and an end-to-end release pipeline
check.

Upstream synchronization becomes an explicit maintenance cost. This is
intentional: every imported change is treated as a third-party change that can
regress Towk-specific compatibility, security, deployment behavior, or user
experience.
