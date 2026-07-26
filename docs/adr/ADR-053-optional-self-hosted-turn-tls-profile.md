# ADR-053: Optional Self-Hosted TURN/TLS Profile

**Date:** 2026-07-26
**Status:** Proposed

## Context

Towk's standard Docker Compose deployment exposes several WebRTC connectivity
paths: direct UDP media, embedded TURN/UDP, and ICE/TCP. Direct UDP is normally
the lowest-latency path, while the relay and TCP candidates cover many NAT,
mobile, and restricted-network conditions.

Some networks block UDP completely and permit outbound traffic only through TLS
on TCP 443. Those users need TURN/TLS on TCP 443 as a last-resort media path.
This fallback is not a speed optimization: relaying media adds server bandwidth
and usually adds latency. It exists to preserve call connectivity when the
faster candidates are unavailable.

LiveKit includes a TURN server with a TLS listener, so Towk does not need a
required managed TURN dependency or a second TURN implementation. The missing
piece is a safe public deployment contract. In the standard single-address
topology, Caddy already owns TCP 443. A second DNS name on the same address does
not let two processes bind the same address and port.

The optional path must remain straightforward for self-hosters without adding
privileges, certificate requirements, or failure modes to installations that do
not need it.

## Decision

Towk will provide a default-off, fully self-hosted TURN/TLS profile for the
Docker Compose example. The first supported topology uses two public IPv4
addresses on the same host:

1. `WEB_BIND_IP` is used by Caddy for Towk HTTPS and HTTP/3.
2. `TURN_BIND_IP` is a distinct address used by LiveKit for TURN/TLS on TCP 443.
3. `TURN_DOMAIN` resolves to `TURN_BIND_IP` and is covered by the configured
   publicly trusted certificate.

The standard Compose command and single-address topology remain unchanged. The
extra profile is activated explicitly with an overlay or an equivalent checked
deployment helper. Presence of the overlay, not an application setting, is the
operator's opt-in boundary.

The optional deployment surface will use explicit public inputs:

- `WEB_BIND_IP`;
- `TURN_BIND_IP`;
- `TURN_DOMAIN`;
- `TURN_CERT_FILE`;
- `TURN_KEY_FILE`.

Implementation may add derived container paths or a generated LiveKit
configuration, but it must not require a hosted control plane, managed relay,
private registry, or project-specific infrastructure.

### Transport behavior

Enabling the profile adds a candidate; it does not replace the existing
transport set:

- direct WebRTC UDP remains the preferred media path;
- embedded TURN/UDP remains available for NAT traversal;
- ICE/TCP remains available when direct UDP fails;
- TURN/TLS on TCP 443 is the final compatibility path for networks that reject
  the preceding candidates;
- web clients that cannot use HTTP/3 continue to use HTTP/2, HTTP/1.1, and
  WebSocket signaling on TCP 443.

No documentation or health check may claim that container startup proves a
browser used TURN/TLS. Candidate selection must be verified separately.

### Activation and validation

The standard deployment must render without any TURN/TLS variable, certificate
mount, listener, or additional LiveKit capability.

The opt-in path must run a preflight before changing containers. It rejects at
least:

- missing or non-IP bind values;
- identical web and TURN bind addresses;
- bind addresses that are not available on the host;
- a TURN domain that does not resolve to the dedicated address;
- unreadable, expired, mismatched, or hostname-invalid certificate material;
- an occupied TCP 443 socket on either selected address;
- an effective Compose render that restores wildcard TCP 443 and creates a
  collision.

If raw `docker compose` cannot provide every preflight guarantee before
recreating services, the public example will expose a small checked deployment
helper and document it as the supported activation path. A configuration-only
render remains available for inspection and CI.

Validation errors must identify the failed prerequisite without printing
private-key contents, environment secrets, or sensitive command output.

### Privilege and certificate boundary

Certificate and private-key files are supplied by the operator and mounted
read-only. They are never copied into the repository or image. Renewal remains
an operator action and the documentation must state which service needs a safe
reload or restart after renewal.

The default LiveKit service keeps its current capability set. The optional
profile may add only the bind capability required for its privileged listener,
and only to LiveKit. It must retain the existing read-only filesystem,
non-root user, dropped capabilities, and `no-new-privileges` posture wherever
the container runtime supports that combination.

### Verification contract

Automated coverage must include:

- the unchanged default Compose render;
- a valid dedicated-address overlay render;
- missing inputs and identical bind addresses;
- DNS, certificate/key, expiry, hostname, and port-conflict failures;
- exact LiveKit configuration fields and read-only mounts;
- preservation of direct UDP, TURN/UDP, relay-allocation, and ICE/TCP paths;
- startup of the pinned LiveKit image with the generated configuration;
- listener and health checks that distinguish process readiness from browser
  media routing.

The deployment guide must add a reproducible browser validation matrix for
Chromium, Firefox, and Safari. It must record which ICE candidate pair was
selected under normal UDP, blocked direct UDP, blocked all UDP, and TCP-443-only
conditions. Physical mobile-network validation is valuable deployment evidence
but is not replaced by a desktop browser simulation.

### Rollback

Rollback disables the optional overlay or checked helper inputs and restores the
standard profile. It must not require a data migration, certificate deletion, or
replacement of Towk application state.

## Consequences

- Self-hosters can cover TCP-443-only networks without buying a managed TURN
  service.
- Instances whose users do not need this fallback keep the simpler
  single-address deployment and its current privilege boundary.
- The dedicated-address topology consumes an additional public IPv4 address and
  requires a DNS name and certificate.
- TURN/TLS increases relay bandwidth and may increase call latency, so it is a
  compatibility fallback rather than the default route.
- A single-public-IP L4/SNI multiplexer remains possible but is not part of this
  decision. It requires a separate proposal because it introduces a critical
  TLS routing layer, raw stream forwarding, additional health checks, and a
  wider interoperability matrix.

## References

- [LiveKit 1.13.4 TURN configuration](https://github.com/livekit/livekit/blob/v1.13.4/config-sample.yaml#L283-L320)
- [LiveKit firewall and port guidance](https://docs.livekit.io/home/self-hosting/ports-firewall/)
- [Docker Compose merge rules](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
- [Issue #207](https://github.com/Yo-DDV/Towk/issues/207)
- [Issue #204](https://github.com/Yo-DDV/Towk/issues/204)
- [Pull request #205](https://github.com/Yo-DDV/Towk/pull/205)
