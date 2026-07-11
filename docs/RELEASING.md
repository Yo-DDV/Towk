# Releasing Towk

Towk prepares releases from protected `main`. The current release workflow
publishes signed source-built CLI archives and checksums for an existing
`vMAJOR.MINOR.PATCH` tag. The separate image workflow publishes scanned,
attested, commit-derived development image tags after successful `main` CI.
Stable container aliases are not currently published.

## Prepare the release pull request

1. Confirm `main` is clean, protected checks are green, and the candidate has no
   unresolved security alerts.
2. Run the **prepare release** workflow manually. Release Please creates or
   updates a draft pull request against `main` using
   `.release-please-config.json` and `.release-please-manifest.json`.
3. Review the generated changelog, version files, API compatibility, migration
   notes, and user-facing announcement.
4. Merge only after the normal protected checks pass.

Do not reset or force-push release branches. Release preparation follows the
same pull-request and branch-protection path as other Towk changes.

## Publish an existing tag

The release workflow accepts only a `v`-prefixed semantic version tag whose
commit is an ancestor of current `main`. A tag push triggers it automatically;
the manual dispatch requires the exact existing tag.

The workflow then:

1. checks out the tag and verifies that it belongs to `main`;
2. builds the embedded frontend and synchronizes legal files;
3. creates or reuses a draft GitHub release;
4. builds archives and checksums with GoReleaser;
5. publishes GitHub build-provenance attestations;
6. makes the verified release public.

Before publishing, run the release checklist and verify the effective Git
identity, tag target, changelog, licenses, archive contents, checksums, and
attestations. Never reuse or move a published tag.

## Container images

`.github/workflows/build-image.yml` builds amd64 and arm64 images from the exact
successful `main` revision. It scans both archives before pushing them, attaches
SBOM attestations, and creates one immutable multi-platform development tag.
Documentation and deployments must use that exact tag and digest until a
separate reviewed change introduces stable release aliases.
