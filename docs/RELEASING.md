# Releasing Towk

Towk prepares releases from protected `main`. The release workflow publishes
signed source-built CLI archives, checksums, and a matching scanned,
multi-platform container image for an existing `vMAJOR.MINOR.PATCH` tag. The
separate manual image workflow remains available for commit-derived development
packages. Towk does not publish a floating `latest` tag.

## Prepare the release pull request

1. Confirm `main` is clean, protected checks are green, and the candidate has no
   unresolved security alerts.
2. Run the **prepare release** workflow manually. Release Please creates or
   updates a draft pull request against `main` using
   `.release-please-config.json` and `.release-please-manifest.json`.
3. Review the generated changelog, version files, API compatibility, migration
   notes, and the release notes that will be extracted from the matching
   changelog section.
4. Merge only after the normal protected checks pass.

Do not reset or force-push release branches. Release preparation follows the
same pull-request and branch-protection path as other Towk changes.
Release Please rebuilds its managed branch from protected `main`; rerunning the
workflow can replace follow-up commits added directly to the draft. Put durable
corrections on `main` first when possible, or reapply them to the refreshed
candidate and rerun every affected check before merging.

## Publish an existing tag

The manually dispatched release workflow accepts only a `v`-prefixed semantic
version tag whose commit is an ancestor of current `main`. Creating or pushing
a tag does not publish anything by itself; an operator must deliberately start
the workflow with the exact existing tag.

The workflow then:

1. checks out the tag and verifies that it belongs to `main`;
2. builds the embedded frontend and synchronizes legal files;
3. creates or reuses a draft GitHub release, refuses an already-public release,
   and updates the draft notes from the matching changelog section;
4. builds archives containing only the canonical `towk` executable, checksums,
   notices, source information, and both applicable license texts;
5. publishes GitHub build-provenance attestations for the archives;
6. builds, scans, attests, and publishes the matching immutable container tag;
7. makes the verified release public only after both distribution paths succeed.

Before publishing, run the release checklist and verify the effective Git
identity, tag target, changelog, licenses, archive contents, checksums, and
attestations. Never reuse or move a published tag.

## Container images

`.github/workflows/build-image.yml` builds amd64 and arm64 images from an exact
commit SHA. A manual run creates one immutable development tag. A release call
also requires a tag that resolves to the same SHA and creates the matching
immutable semantic-version tag. Both paths scan the architecture images before
pushing them and publish SBOM and provenance attestations. Stable image tags are
available only to the release workflow; every path fails instead of replacing
an existing architecture or multi-platform tag.

Documentation and deployments must pin the exact tag and digest. A stable tag
is never moved to a different commit, and no floating `latest` alias is created.

Merging a pull request into `main` does not publish a new container image by
itself. Run the image workflow only when the project intentionally wants to
refresh the public package.

Towk `v0.5.0` predates the canonical Towk executable in release archives. Do
not use that historical archive as proof of the current distribution contract;
verify the selected archive with `tools/verify-release-archives.sh` or build the
reviewed source revision.
