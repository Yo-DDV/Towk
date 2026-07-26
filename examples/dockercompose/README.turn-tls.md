# Optional self-hosted TURN/TLS profile

The full operator guide is also published at `/guides/infrastructure/turn-tls/`.

This profile adds LiveKit TURN/TLS on TCP 443 for clients behind networks that
block UDP and permit only outbound TLS-like TCP traffic. It is a compatibility
fallback, not a faster media path. Direct WebRTC UDP, TURN/UDP, the TURN relay
allocation range, and ICE/TCP remain enabled.

The standard deployment is unchanged:

```bash
docker compose up -d
```

Do not apply `compose.turn-tls.yml` directly to a live installation. The
supported path is `./turn-tls.sh`, which validates every prerequisite and moves
Caddy off the wildcard listener before LiveKit claims the dedicated TCP 443
address.

## Supported topology

The first supported topology is one Linux host with two distinct, globally
routable IPv4 addresses assigned directly to the host:

- `WEB_BIND_IP`: Caddy TCP 80, TCP 443, and UDP 443 (HTTP/3);
- `TURN_BIND_IP`: LiveKit TURN/TLS TCP 443;
- `TURN_DOMAIN`: an A record containing `TURN_BIND_IP` and covered by a publicly
  trusted certificate.

A provider-side one-to-one NAT address that is not present on a host interface is
not accepted. Single-IP L4/SNI multiplexing is outside this profile.

## Prerequisites

Install Docker, Docker Compose 2.24.4 or newer, Python 3.10 or newer, OpenSSL,
`ip`, `ss`, and `curl`. Keep the normal `.env` and LiveKit configuration from the
standard example.

Prepare a publicly trusted certificate and unencrypted private key for
`TURN_DOMAIN`. Use absolute host paths for both files. The helper never copies
either file into the image or repository. The key must not be readable by other
users. LiveKit remains UID/GID `1000:1000`; the helper derives the key's numeric
group and adds only that supplementary group to the opt-in container.

A typical permission boundary is:

```bash
sudo chgrp towk-turn /etc/towk/turn/privkey.pem
sudo chmod 0640 /etc/towk/turn/privkey.pem
sudo chmod 0644 /etc/towk/turn/fullchain.pem
```

Run the helper as an operator who can read the key, invoke Docker, and inspect
host listeners. Do not make the key world-readable and do not run LiveKit as
root.

## Configure and validate

Export values directly in the current shell. The helper deliberately does not
`source` or evaluate a configuration file.

```bash
export WEB_BIND_IP=203.0.113.10
export TURN_BIND_IP=203.0.113.11
export TURN_DOMAIN=turn.example.com
export TURN_CERT_FILE=/etc/towk/turn/fullchain.pem
export TURN_KEY_FILE=/etc/towk/turn/privkey.pem

./turn-tls.sh preflight
```

Replace the documentation addresses with addresses actually assigned to the
host. The preflight fails before any container change when it finds:

- missing, non-public, non-local, wildcard, or identical bind addresses;
- an invalid domain or an A record that does not include `TURN_BIND_IP`;
- unreadable, expired, near-expiry, hostname-invalid, or mismatched certificate
  material;
- a private key accessible by other users;
- Docker Compose older than 2.24.4 or a missing required host tool;
- TCP 443 owned by a process or container outside the current Towk stack;
- a rendered wildcard TCP 443 mapping or any loss of the existing WebRTC ports,
  read-only mounts, non-root user, or runtime hardening.

The default minimum remaining certificate validity is 14 days. Override it only
with a documented operator policy:

```bash
export TURN_CERT_MIN_VALIDITY_DAYS=30
```

`preflight` writes only the generated `.turn-tls/livekit.yaml` file, with mode
`0640`, and does not recreate or stop containers. A custom
`TURN_LIVEKIT_CONFIG_FILE` must remain below `.turn-tls/`; paths outside that
private deployment directory are rejected. To inspect a redacted binding and
hardening summary without mutation (Towk environment values, certificate paths,
and the private-key path are omitted):

```bash
./turn-tls.sh render > /tmp/towk-turn-tls-compose.json
```

## Firewall rules

Allow the following inbound traffic in both the host firewall and provider
firewall:

| Address | Protocol and port | Purpose |
| --- | --- | --- |
| `WEB_BIND_IP` | TCP 80 | HTTP redirect and ACME HTTP challenge |
| `WEB_BIND_IP` | TCP 443 | HTTPS, HTTP/2, HTTP/1.1, and secure WebSocket signaling |
| `WEB_BIND_IP` | UDP 443 | HTTP/3; TCP 443 remains the fallback |
| `TURN_BIND_IP` | TCP 443 | TURN/TLS fallback |
| LiveKit host | TCP 7881 | ICE/TCP media fallback |
| LiveKit host | UDP 3478 | Embedded TURN/UDP and STUN |
| LiveKit host | UDP 50000-50200 | Direct WebRTC media |
| LiveKit host | UDP 50201-50400 | TURN relay allocations |

Do not expose NATS port 4222 publicly.

## Activate

```bash
./turn-tls.sh up
```

For an existing stack, the helper performs this bounded transition:

1. validate certificate, DNS, host addresses, port ownership, generated LiveKit
   configuration, and both Compose renders;
2. recreate Caddy first with TCP/UDP 443 bound only to `WEB_BIND_IP`;
3. verify the existing HTTPS endpoint through `WEB_BIND_IP`;
4. recreate LiveKit with TCP 443 bound only to `TURN_BIND_IP`;
5. wait for LiveKit health and verify a TLS handshake using SNI and hostname
   validation;
6. converge the complete opt-in Compose stack.

If a mutating step fails, the helper recreates standard LiveKit first, then
standard Caddy, then converges the standard stack. This order frees the dedicated
TCP 443 listener before Caddy returns to its wildcard binding. Volumes, Towk
data, certificates, and generated secrets are never deleted.

Running `./turn-tls.sh up` again is the supported idempotent convergence and
certificate-renewal path. It revalidates the renewed certificate and safely
recreates the affected services.

## Verify runtime and media routing

A healthy container or successful TLS handshake proves only the server-side
listener. It does not prove that a browser selected TURN/TLS.

Server-side checks:

```bash
docker compose -f compose.yml -f compose.turn-tls.yml ps
openssl s_client \
  -connect "${TURN_BIND_IP}:443" \
  -servername "${TURN_DOMAIN}" \
  -verify_hostname "${TURN_DOMAIN}" \
  -verify_return_error </dev/null
```

For Chromium, Firefox, and Safari, run a two-participant call and collect the
selected ICE candidate pair from the browser's WebRTC statistics. Use the
`transport.selectedCandidatePairId` record to locate the local and remote
candidate records. Record at least `candidateType`, `protocol`, `relayProtocol`,
address, and port; do not rely on a browser-specific `selected` flag.

Repeat the call under each network policy and record the observed route rather
than assuming an ICE ordering:

| Network policy | Evidence expected |
| --- | --- |
| Normal UDP | A selected direct UDP pair when the network permits it |
| Direct UDP blocked, relay UDP allowed | A selected relay candidate with `relayProtocol=udp` |
| All UDP blocked, TCP 7881 allowed | An ICE/TCP-selected pair when supported by the client/network |
| Only outbound TCP 443 allowed | A selected relay candidate with `relayProtocol=tls` and the TURN URL/domain |

Capture the exact browser/OS version, whether the browser or PWA was installed,
the network enforcement method, and both endpoints. Desktop simulation does not
replace physical Safari/iOS, Android, 4G, or 5G validation; mark those scenarios
`UNVERIFIED` until run on the real platform.

## Disable and rollback

Restore the standard profile without certificate or DNS prerequisites:

```bash
./turn-tls.sh disable
```

The command recreates standard LiveKit before standard Caddy and leaves all
volumes, application data, and certificate files untouched. After disablement,
close dedicated TURN/TLS TCP 443 in the provider and host firewalls only after
confirming no clients still depend on it.

## Troubleshooting

- **Compose rejects `!override`**: upgrade Docker Compose to 2.24.4 or newer.
- **The key is not readable by LiveKit**: assign it to a dedicated group, use
  `0640`, and run the helper as an operator who can read that group. Never use
  `0644` for the private key.
- **DNS validation fails after an update**: wait for the authoritative A record
  and local resolver cache to converge, then rerun `preflight`.
- **Certificate renewal is not visible**: keep the same exported paths and rerun
  `./turn-tls.sh up`; the helper resolves and validates the current files before
  recreating LiveKit.
- **TCP 443 is reported occupied**: stop or reconfigure the external process or
  container. The helper permits only the current stack's Caddy/LiveKit listeners.
- **Handshake works but calls still fail**: inspect the selected ICE candidate
  pair, provider firewall, relay UDP range, and browser policy. A listener alone
  does not establish an end-to-end TURN allocation.
