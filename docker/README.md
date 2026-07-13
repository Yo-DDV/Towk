# Docker Assets

This directory contains Docker build assets used by development, CI, and release
automation.

## Files

- `Dockerfile.towk` is the Towk-owned, pinned image definition used by the
  scanned and attested `ghcr.io/yo-ddv/towk` publication workflow.
- `Dockerfile.goreleaser` keeps a compatible backend release-image context for
  local and CI validation. It uses
  `/config/towk.toml` as its primary config path and `/data` as the embedded
  NATS data directory through `TOWK_CONFIG_DIR=/config`, without changing the
  process working directory. It defaults the runtime user to `1000:1000` and
  supports non-zero `PUID`/`PGID` values for matching host volume ownership.
- `docker-entrypoint.sh` is copied into the backend release image. It applies
  the runtime user/group and drops privileges before starting the `/towk`
  binary. It does not recursively change ownership of mounted operator
  directories.
- `nats-wrapper.sh` makes the bundled NATS CLI use Towk's runtime NATS
  environment without writing a CLI context. Explicit `NATS_URL` or
  `NATS_CONTEXT` settings leave connection configuration under operator control.
  Derived non-loopback URLs must use TLS unless
  `CHATTO_NATS_CLIENT_ALLOW_INSECURE=true`; for a private CA, pass an explicit
  `NATS_URL=tls://...` and `NATS_CA=/path/to/ca.pem` to the CLI.
- `nats-wrapper_test.sh` verifies the wrapper's derived connection settings and
  explicit operator overrides.
- `Dockerfile.frontend.prebuilt` packages already-built frontend static files
  for operators who need a separate client image. Towk does not currently
  publish a public `towk-client` image.
- `Dockerfile.dev` is the backend development image for containerized local or
  cluster development.
- `Dockerfile.frontend.dev` is the frontend development image used by
  containerized local or cluster development.
- `*.dockerignore` files are scoped to individual root-context Dockerfiles.
  Keep them next to the Dockerfile they apply to instead of recreating a broad
  root `.dockerignore`.

Copyable deployment examples still live under `examples/`, for example
`examples/dockercompose/`.

## Roll back an image without renaming configuration

Record the current and previous immutable image digests before an upgrade, keep
the same `/config` and `/data` volumes, and keep their numeric ownership aligned
with the previous image. After stopping the new container, start the previous
digest with an explicit canonical configuration path:

```bash
docker run --rm \
  --user 1000:1000 \
  -v towk-config:/config:ro \
  -v towk-data:/data \
  ghcr.io/yo-ddv/towk@sha256:<previous-digest> \
  start -c /config/towk.toml
```

Use the real recorded digest, never a mutable label. Validate the restored
server before reopening traffic. This explicit path lets a compatible previous
image read the canonical file without copying secrets into another filename.
