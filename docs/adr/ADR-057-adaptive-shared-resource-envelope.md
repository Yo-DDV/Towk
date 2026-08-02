# ADR-057: Adaptive Scheduling Shares the VPS Resource Envelope

**Date:** 2026-08-02

## Context

Towk's Compose example gave NATS, LiveKit, Towk, and Caddy independent CPU and
memory ceilings. The owner dashboard then applied Economy, Balanced,
Performance, or Custom worker presets inside the Towk process. A larger VPS
could therefore remain artificially limited even when every other service was
idle. Raising one container's ceiling also did not make the limits a shared
stack budget.

The intended single-VPS behavior is simpler: every service may burst across the
resources provided by the VPS, and the host scheduler shares those resources.
During contention, calls must take precedence over background uploads and media
processing. Small hosts still need bounded in-process admission so memory
pressure cannot create an unbounded queue.

## Decision

### Shared deployment envelope

The Compose example uses zero as the default `cpus` and `mem_limit` value. Docker
therefore omits the hard per-container limit and all four services share the VPS
resource pool. A non-zero `*_CPU_LIMIT` or `*_MEMORY_LIMIT` remains an optional
operator-owned ceiling for deployments that share a host with unrelated
workloads.

Compose assigns relative CPU shares of 2048 to LiveKit, 1024 to Towk, and 512
each to NATS and Caddy. CPU shares apply only while runnable services contend;
they neither reserve capacity nor stop an idle service's capacity from being
used elsewhere. This favors real-time media while allowing every service to
burst across all available cores when contention is absent.

### Adaptive Towk work pools

Towk derives targets from the process-visible envelope and refreshes that
envelope periodically:

| Work pool               | CPU-derived target |
| ----------------------- | -----------------: |
| Image transforms        |              `CPU` |
| Image admissions        |          `CPU × 8` |
| Upload chunk writes     |          `CPU × 2` |
| Link previews           |              `CPU` |
| Shared media transcodes |              `CPU` |

Memory-aware ceilings are then applied to image workers, image admissions,
uploads, link previews, and the shared ffmpeg pool. Optional
`CHATTO_PERFORMANCE_MAX_*` values remain final operator ceilings. An admission
ceiling also bounds image workers, so a stricter queue limit cannot be bypassed.
The historical `video.max_concurrent` field remains parseable for rollback to
older binaries but no longer caps the shared media-transcode pool.

The old owner profiles are retired. Persisted profile events remain readable for
backup, rollback, and older-binary compatibility, but current scheduling ignores
them. The diagnostics API reports `adaptive`, the detected envelope, the
CPU-derived targets, effective limits, and every memory or operator reduction.
The owner dashboard is read-only and does not imply that it can resize
containers.

### No privileged hot container control

Towk does not mount the Docker socket and does not expose container priorities
through the browser. A hot `docker update` controller would be root-equivalent,
would drift from the declarative Compose file, and would not be portable to
Kubernetes or non-Docker deployments. Container ceilings and CPU shares remain
operator-owned deployment configuration.

### Qualification

Capacity qualification uses measured adaptive envelopes instead of product
profile labels. The baseline matrix covers 1, 2, 4, and 8 logical CPUs with
matching memory evidence, plus explicit larger points with a separate load
generator. Requested worker targets must match the measured CPU envelope;
effective values may only be lower because of proven bounds.

## Consequences

- A 2-, 4-, 6-, or 16-core VPS no longer needs a matching dashboard profile or
  four coordinated per-service CPU edits.
- LiveKit receives preferential CPU time during contention, while unused CPU
  remains available to uploads, previews, transforms, and transcodes.
- CPU shares are a prioritization mechanism, not a call-capacity guarantee.
  Published participant counts still require distributed media generation and
  measured latency, loss, throttling, memory, and recovery evidence.
- Docker Compose has no portable aggregate memory limit spanning multiple
  services. Dedicated VPS deployments use the host as the shared boundary;
  operators of shared hosts should set explicit non-zero limits and qualify the
  complete stack.
- Existing `.env` files keep their explicit old limits until the operator sets
  them to zero. Upgrades never rewrite deployment configuration silently.

## References

- [Docker CPU constraints](https://docs.docker.com/engine/containers/resource_constraints/#cpu)
- [Docker Compose service resource attributes](https://docs.docker.com/reference/compose-file/services/)
- [LiveKit self-hosting overview](https://docs.livekit.io/transport/self-hosting/)
