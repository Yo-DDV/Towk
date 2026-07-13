# Corresponding source

The server and CLI are distributed under AGPL-3.0-or-later. Surfaces explicitly
listed in `REUSE.toml`, including the frontend, documentation, public API, and
examples, are distributed under Apache-2.0.

Towk source is published at:

<https://github.com/Yo-DDV/towk>

Every OCI image must expose its exact Git commit in
`org.opencontainers.image.revision` and this repository in
`org.opencontainers.image.source`. To identify and rebuild a deployed version:

1. record the immutable image digest;
2. read the `org.opencontainers.image.revision` annotation;
3. check out that exact commit from the public repository;
4. follow the build instructions stored at that revision.

`NOTICE`, `LICENSING.md`, `REUSE.toml`, `LICENSE`, and `LICENSES/` are part of
the distribution and must not be removed. A network deployment of a modified
AGPL-covered service must provide its users a prominent path to the
corresponding source for the version they are using.
