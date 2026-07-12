# Upstream integration

Towk follows Chatto development selectively. Upstream changes are inputs to a
review, not an automatic release channel.

The canonical Towk repository is standalone. A local Git remote named `upstream`
is a read-only source of candidate commits; it does not create a GitHub
fork-network relationship and must never be used as a deployment or release
source.

## Configure the read-only remote

```sh
git remote add upstream https://github.com/chattocorp/chatto.git
git remote set-url --push upstream DISABLED
git fetch --tags --prune upstream
```

If `upstream` already exists, verify both URLs with `git remote -v` and keep its
push URL disabled. Contributions intended for Chatto use an explicit, separately
reviewed remote rather than weakening this guard.

## Prepare a sync

```sh
git fetch --tags --prune origin
git fetch --tags --prune upstream
git switch main
git pull --ff-only origin main
git switch -c chore/upstream-sync-YYYY-MM-DD
```

First inspect the range from the current merge base to the candidate upstream
ref. Choose the smallest legally and technically sound integration method:

- cherry-pick isolated fixes while preserving original authorship;
- merge a coherent upstream branch when its history and full behavior are wanted;
- reimplement only when Towk's architecture has diverged enough that importing
  the patch would be unsafe, and document the upstream inspiration and license.

Use a dedicated pull request. Record the exact upstream SHAs, preserve authorship
and license metadata, explain conflict resolutions, and keep Towk-specific
adaptations in separate commits where practical. Never rewrite `main` to make a
sync look simpler. Never import a patch only by copying a diff without preserving
its provenance.

## Mandatory review

Before publication, review every changed workflow and release script for:

- repository-owner and branch assumptions;
- registry, package, domain, and deployment destinations;
- token names, permissions, environments, and secret access;
- release, documentation, container, and scheduled triggers;
- compatibility migrations and rollback implications.

Any inherited publisher must be disabled or redirected to a Towk-owned
destination in the same pull request that introduces it. A later hardening pull
request is not an acceptable safety boundary.

Compare imported behavior with the current Towk implementation on correctness,
security, performance, responsive UX, accessibility, and compatibility. A newer
upstream implementation is not automatically the better one. During a release
freeze, accept only a security, data-integrity, or release-blocking upstream fix;
defer normal features to the next cycle.

Run the license check, targeted tests, full required CI matrix, builds, and an
independent post-merge check. Green pull-request checks do not prove that
push-only or scheduled workflows are safe.
