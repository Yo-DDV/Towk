# Upstream integration

Towk follows Chatto development selectively. Upstream changes are inputs to a
review, not an automatic release channel.

## Prepare a sync

```sh
git fetch --tags --prune origin
git fetch --tags --prune upstream
git switch main
git pull --ff-only origin main
git switch -c chore/upstream-sync-YYYY-MM-DD
git merge --no-ff upstream/main
```

Use a dedicated pull request. Preserve upstream commits and authorship, explain
conflict resolutions, and keep Towk-specific adaptations in separate commits
where practical. Never rewrite `main` to make a sync look simpler.

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

Run the license check, targeted tests, full required CI matrix, builds, and an
independent post-merge check. Green pull-request checks do not prove that
push-only or scheduled workflows are safe.
