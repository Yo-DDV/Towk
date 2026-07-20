# Towk Docker Compose Example

This example deploys a clustered Towk setup with:

- **NATS** - Message broker with JetStream persistence
- **LiveKit** - WebRTC media server for voice and video calls
- **Towk** - App server connecting to external NATS
- **Caddy** - Reverse proxy with automatic HTTPS and load balancing

## Quick Start

Point `chat.example.com` and `livekit.chat.example.com` at your server, open the
ports listed below, then run:

```bash
./init-env.sh chat.example.com admin@example.com
# Set TOWK_IMAGE and replace the CHATTO_SMTP_* placeholders in .env, then:
docker compose up -d
```

Visit `https://chat.example.com` and register with `admin@example.com`. Caddy
obtains the HTTPS certificates automatically. The rest of this README explains
the stack and the available customization options.

New environments set `COMPOSE_PROJECT_NAME=towk`, so Docker names the default
containers `towk-towk-1`, `towk-nats-1`, `towk-livekit-1`, and
`towk-caddy-1`. Keep this value stable after the first start because it also
selects the Compose network and named volumes. To choose another name for a new
installation, edit this value before the first `docker compose up`.

`livekit.chat.example.com` is only an example. You can use any hostname you
control, such as `calls.example.com`; update `CHATTO_LIVEKIT_URL` and the
matching proxy route when using a different name.

## Prerequisites

- Docker and Docker Compose (v2) installed
- A domain pointing to your server (for automatic HTTPS)
- A `livekit.` subdomain pointing to the same server (e.g., `livekit.chat.example.com`)
- Firewall allowing inbound TCP 80, 443, and 7881 plus UDP 3478 and 50000-50200

## Why This Example Runs NATS Separately

Towk can embed NATS in its own process, which is ideal for the smallest binary
setup. This Compose example runs NATS JetStream separately so you can restart or
replace Towk without restarting its data store, scale Towk to multiple
replicas, and move to a NATS cluster later.

The generated `.env` explicitly permits plaintext NATS only because traffic
stays inside this isolated Compose network. For multi-host or otherwise shared
networks, configure NATS TLS and replace the internal `nats://` URL with
`tls://`; do not carry `CHATTO_NATS_CLIENT_ALLOW_INSECURE=true` into that setup.

You are not locked into either model. Towk's backup command creates a portable
JetStream archive that can be restored into embedded or external NATS, making it
straightforward to move between binary, Compose, and clustered deployments. See
the [Backup & Restore guide](../../apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx) for
the migration workflow and encryption-key guidance.

## Using Your Existing Reverse Proxy

The included Caddy service is a convenient default, not a requirement. If you
already run Caddy, nginx, Apache, Traefik, or another public web server, keep it
and configure two routes:

| Public endpoint | Destination | Purpose |
| --- | --- | --- |
| Your Towk HTTPS hostname | `towk:4000` | Towk web app, ConnectRPC APIs, realtime connections, and the LiveKit webhook |
| Your LiveKit secure WebSocket hostname | `livekit:7880` | LiveKit API and WebSocket signaling |

The hostnames can be any names you control. Both need publicly trusted TLS
certificates. If your proxy is on the Compose network, use the service names
above. If it runs on the Docker host, publish both upstreams on loopback:

```yaml
services:
  towk:
    ports:
      - "127.0.0.1:4000:4000"
  livekit:
    ports:
      - "127.0.0.1:7880:7880"
```

Then remove the `caddy` service and its volumes from `compose.yml`. Keep the
LiveKit media `ports` mappings described below.

## What the Included Caddy Does

When you do not already have a proxy, the included Caddy service obtains the
certificates, configures both HTTP routes, and load-balances Towk replicas.
It does not carry WebRTC media. The standard Caddy image is an HTTP server and
does not include the optional Caddy L4 plugin.

Preserve these public ports when using Caddy or your own proxy:

| Public endpoint | Destination | Purpose |
| --- | --- | --- |
| Your Towk and LiveKit hostnames (TCP 443) | Your HTTP proxy | HTTPS and secure WebSocket traffic |
| TCP 7881 | `livekit:7881` | WebRTC media fallback when direct UDP is unavailable |
| UDP 3478 | `livekit:3478` | LiveKit's embedded TURN/STUN relay |
| UDP 50000-50200 | Same ports on `livekit` | Direct WebRTC media |

TCP 80 is also published in this example so Caddy can redirect HTTP and solve
the ACME HTTP challenge. Your replacement proxy may use a different certificate
flow. TLS for both HTTPS endpoints must use a publicly trusted certificate.

The Compose `ports` entries publish LiveKit media directly on the host, so no L4
Caddy configuration is needed. Do not expose NATS port 4222 publicly; Towk and
NATS communicate only over the private Compose network.

## Runtime hardening

The example drops all Linux capabilities, enables `no-new-privileges`, uses
read-only root filesystems and bounds processes, memory and CPU. Caddy retains
only `NET_BIND_SERVICE` so it can listen on ports 80 and 443. Named volumes and
size-limited `tmpfs` mounts provide the writable paths required by NATS, Caddy
and Towk's private operator socket.

Towk and LiveKit run directly as UID/GID `1000:1000` by default. Set `PUID` and
`PGID` before the first start if your environment requires different numeric
IDs. Existing named volumes may need their ownership adjusted before changing
those values.

## Configuration

1. Generate `.env` and the LiveKit config:

   ```bash
   ./init-env.sh chat.example.com admin@example.com
   ```

   Replace `chat.example.com` with your Towk domain and `admin@example.com`
   with the email address you will use for the first account.

   The script is the recommended setup path. It writes `.env` and
   `livekit.generated.yaml`, generates strong secrets, and keeps the shared
   values aligned:

   - `NATS_TOKEN` and `CHATTO_NATS_CLIENT_TOKEN`
   - Towk cookie, core, and asset signing secrets
   - `CHATTO_LIVEKIT_API_KEY` / `CHATTO_LIVEKIT_API_SECRET`
   - The matching LiveKit `keys:` and webhook URL

2. Edit `.env` and review the generated values.

   In most cases, you should only need to change:

   - `TOWK_IMAGE` - Immutable Towk tag and digest from the repository Packages page.
   - `PUBLIC_URL` - Your domain (e.g., `chat.example.com`)
   - `CHATTO_OWNERS_EMAILS` - Comma-separated verified email addresses that should become Towk owners. Include the email address you will use for the first account.
   - `CHATTO_SMTP_*` - Required for direct email/password registration, email verification, and password reset.
   - `PUID` and `PGID` - Optional host user/group IDs for files Towk writes to mounted volumes. Defaults to `1000:1000`.
   - `CHATTO_OPERATOR_API_*` - Enables the private in-container operator socket used by `towk operator ...`.
   - `CHATTO_VIDEO_ENABLED=true` - Enables ffmpeg-based MP4 variants and thumbnails so videos uploaded from iPhone or other OS/browser stacks remain playable across Linux, Android, iOS, Firefox, Safari, Chrome, and Chromium-based PWAs. The image also uses ffmpeg to normalize non-MP4 voice messages into M4A/AAC for the same playback compatibility.

   Leave `LIVEKIT_CONFIG_FILE=./livekit.generated.yaml` unless you deliberately
   want to maintain `livekit.yaml` by hand.

3. Configure SMTP settings if you use direct email/password registration.

### Prefer to configure it by hand?

You usually do not need to. If you manage secrets elsewhere, start with:

```bash
cp env.example .env
```

Fill in the placeholders and make sure the LiveKit key and secret are the same
in `.env` and `livekit.yaml`. LiveKit requires its API secret to be at least 32
characters.

## Performance envelopes and runtime profiles

Performance has two separate control layers:

1. The operator sets hard container ceilings with `TOWK_CPU_LIMIT`,
   `TOWK_MEMORY_LIMIT`, and the corresponding NATS, LiveKit, and Caddy
   variables in `.env`. Changing these values requires recreating the affected
   service.
2. A server owner selects **Economy**, **Balanced**, **Performance**, or a
   bounded **Custom** policy in **Server administration → System**. This
   changes media concurrency live for newly admitted work and never interrupts
   work already in progress.

Towk displays both the requested policy and the effective worker limits. The
effective values can be lower because the process applies the smallest of the
detected CPU/memory envelope, an optional operator cap, and the owner's request.
The browser cannot change container resources or override operator limits.

`env.example` and `init-env.sh` use `balanced` for new installations. Existing
installations that omit `CHATTO_PERFORMANCE_DEFAULT_PROFILE` retain the
historical preset for pools that were already bounded until an owner explicitly
saves a profile. Upload chunk writes gain a balanced process-local bound instead
of remaining unbounded. The optional `CHATTO_PERFORMANCE_MAX_*` variables are
hard per-process ceilings; leave them unset to derive bounded ceilings from the
process envelope.

The checked-in resource values are conservative starting points, not user-count
or latency guarantees. A small host can lower all four services and select the
economy policy. A larger host can raise the service ceilings and select the
performance policy, but should still monitor CPU, memory, storage latency and
call quality under its real workload. Do not raise only Towk while leaving NATS
storage or LiveKit constrained.

After changing a container ceiling, render and recreate the stack:

```bash
docker compose config
docker compose up -d --force-recreate
```

After changing only the owner profile in the UI, no container restart is
required. A rolling or multi-replica deployment may report different effective
limits per process when replicas have different resource envelopes.

The owner-selected profile is stored in Towk's event stream and is therefore
included in the normal Towk backup and restore workflow. Operator-owned `.env`,
Compose and Kubernetes resource settings remain outside that data archive and
must be backed up with the deployment configuration.

## Usage

```bash
# Start the stack
docker compose up -d

# View logs
docker compose logs -f

# View logs for a specific service
docker compose logs -f towk

# Restart a service
docker compose restart towk

# Stop the stack
docker compose down

# Stop and remove volumes (deletes all data)
docker compose down -v
```

## Scaling

```bash
# Scale to 5 replicas
docker compose up -d --scale towk=5
```

Caddy discovers the replicas through Docker's internal DNS and distributes new
requests across them. Existing realtime connections remain on the replica that
accepted them.

## Verify the Deployment

```bash
# Validate and render the Compose configuration
docker compose config

# Confirm all containers are running or healthy
docker compose ps

# Confirm the effective runtime restrictions
docker compose exec nats sh -c 'grep -E "^(NoNewPrivs|CapEff):" /proc/1/status'
docker compose exec towk sh -c 'grep -E "^(NoNewPrivs|CapEff):" /proc/1/status'

# Check both HTTPS endpoints
curl --fail --silent --show-error --output /dev/null https://chat.example.com
curl --fail --silent --show-error --output /dev/null https://livekit.chat.example.com
```

The HTTPS checks verify routing and LiveKit signaling, but not WebRTC media.
Join a call from two different networks or devices to exercise TCP 7881 and the
UDP media ports.

## Inspecting NATS

The Towk image includes the `nats` CLI. Its wrapper maps the runtime NATS
environment into the CLI without writing a persistent CLI context:

```bash
docker compose exec -u towk towk nats stream ls
```

## Operator Commands

The generated `.env` enables the local operator API socket inside the Towk
container. Run operator commands as the `towk` user and use `list --search`
to find a stable user ID before mutating an account:

```bash
docker compose exec -u towk towk /towk operator user list
docker compose exec -u towk towk /towk operator user list --search admin@example.com
docker compose exec -u towk towk /towk operator user set-password USER_ID
```

Do not mount or publish the operator socket unless the target container or host
is fully trusted; socket access is root-equivalent Towk authority.

## Updating

`COMPOSE_PROJECT_NAME` identifies the entire Compose deployment, not just its
display name. New installations use `towk`. If an older `.env` does not contain
this setting, leave it absent during a routine update so Compose keeps the
existing directory-derived namespace and reconnects the same containers,
network, and volumes. Do not replace an existing `.env` with `env.example` or
rerun `init-env.sh --force` as part of an application-only update.

### Changing the project name of an existing installation

This is an explicit migration, not a routine update. Back up Towk first, then
save the current rendered configuration and `.env`:

```bash
docker compose exec -u towk towk /towk backup --encrypt --include-keys -o /tmp/towk-before-project-rename.tar.gz.age
docker compose cp towk:/tmp/towk-before-project-rename.tar.gz.age ./towk-before-project-rename.tar.gz.age
cp .env .env.before-project-rename
docker compose config --format json > compose.before-project-rename.json
```

In `compose.before-project-rename.json`, record the `name` of `nats_data`,
`caddy_data`, and `caddy_config`. Add those exact names and the desired project
name to `.env`:

```dotenv
COMPOSE_PROJECT_NAME=my-towk
TOWK_EXISTING_NATS_VOLUME=dockercompose_nats_data
TOWK_EXISTING_CADDY_DATA_VOLUME=dockercompose_caddy_data
TOWK_EXISTING_CADDY_CONFIG_VOLUME=dockercompose_caddy_config
```

The `dockercompose_*` values above are examples. Use the names from your own
rendered configuration. Stop the old project before editing `.env`; this keeps
its containers available for rollback and prevents two NATS processes from
opening the same storage:

```bash
docker compose stop
# Edit .env only after the old project has stopped.
docker compose -f compose.yml -f compose.project-name.override.yml config
docker compose -f compose.yml -f compose.project-name.override.yml up -d
docker compose -f compose.yml -f compose.project-name.override.yml ps
```

The override declares the three existing volumes as external. Compose creates
the new container and network names but neither copies nor deletes the data
volumes. Keep the override file and its volume variables in every future
Compose command for this renamed installation.

To roll back before removing any old containers, stop the renamed project,
restore the saved `.env`, and start the original project again:

```bash
docker compose -f compose.yml -f compose.project-name.override.yml stop
cp .env.before-project-rename .env
docker compose start
```

Never use `docker compose down -v` during a project-name migration.

```bash
# Back up Towk data and keep the current deployment envelope
docker compose exec -u towk towk /towk backup --encrypt --include-keys -o /tmp/towk-before-update.tar.gz.age
docker compose cp towk:/tmp/towk-before-update.tar.gz.age ./towk-before-update.tar.gz.age
cp .env .env.before-update
docker compose config > compose.rendered.before-update.yaml
docker compose images

# Set TOWK_IMAGE in .env to the new immutable tag and digest, then update Towk
docker compose pull towk
docker compose up -d towk
docker compose ps
```

After the update, sign in, send a text message, verify an attachment or video
flow that matters to your server, and check **Server administration → System**
for the requested performance profile and effective limits.

To roll back application code, restore the previous `TOWK_IMAGE` value from
`.env.before-update`, re-render the Compose configuration, and recreate only
the Towk service:

```bash
cp .env.before-update .env
docker compose config
docker compose up -d towk
```

Only restore a data backup when you intentionally need to return data to an
older snapshot. The owner-selected performance profile is part of Towk data;
`.env`, Compose resource ceilings, certificates, and external object-storage
buckets are operator-managed and must be backed up separately.

## Volumes

Data is persisted in Docker volumes:

- `nats_data` - NATS/JetStream data (messages, KV stores)
- `caddy_data` - TLS certificates
- `caddy_config` - Caddy configuration cache

## Disabling Voice and Video Calls

If you don't need calls, remove the `livekit` service from `compose.yml`, delete the selected LiveKit config (`livekit.generated.yaml` or `livekit.yaml`), remove the `livekit.*` block from the `Caddyfile`, remove LiveKit from `towk.depends_on` and `caddy.depends_on`, and remove the LiveKit environment variables from `.env`. You can then close TCP 7881 and UDP 3478 and 50000-50200 and remove the `livekit.*` DNS record.

## Troubleshooting

**Towk can't connect to NATS**: Ensure `NATS_TOKEN` and `CHATTO_NATS_CLIENT_TOKEN` match in your `.env` file.

**Registration says email delivery is not configured**: Configure the `CHATTO_SMTP_*` settings in `.env`. Direct email/password registration sends a code by email.

**The first account is not an owner**: Ensure `CHATTO_OWNERS_EMAILS` contains that account's verified email address. Towk assigns matching owner roles when the email is verified and on server boot.

**Caddy not getting certificates**: Ensure your domain's DNS points to your server and ports 80/443 are open.

**Container startup order issues**: The `depends_on` with `condition: service_healthy` ensures NATS and LiveKit are ready before Towk starts.

**Calls not working**: Ensure the LiveKit API key/secret in `.env` matches the `keys:` section in the selected LiveKit config (`livekit.generated.yaml` or `livekit.yaml`). Also verify the webhook URL points to your Towk instance. Make sure `CHATTO_LIVEKIT_URL` uses the public `wss://livekit.` subdomain (not the internal Docker hostname), since browsers connect to it directly.

**LiveKit media ports**: The example exposes UDP 50000-50200 for direct WebRTC media, UDP 3478 for LiveKit's embedded TURN/STUN relay, and TCP 7881 as a media fallback. Ensure your firewall allows all three.

**Calls fail for some users**: The built-in TURN/UDP relay helps with symmetric NATs and some mobile, Firefox, and restrictive-network cases. Networks that block UDP entirely still need an advanced TURN/TLS setup, such as a dedicated TURN host or L4 TLS forwarding with matching certificates.
