#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
image='livekit/livekit-server:v1.13.4@sha256:189f7c81b704a36642bc5c7e2d3e1ae83744627c11978a23a251bf19fbec64e0'
tmp=$(mktemp -d "${TMPDIR:-/tmp}/towk-livekit-turn-tls.XXXXXX")
name="towk-turn-tls-smoke-$$"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

for command in docker python3 openssl curl; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required" >&2; exit 1; }
done

free_port() {
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}
http_port=$(free_port)
tls_port=$(free_port)
while [[ "$tls_port" == "$http_port" ]]; do tls_port=$(free_port); done

openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj '/CN=turn.example.test' \
  -addext 'subjectAltName=DNS:turn.example.test' \
  -keyout "$tmp/turn.key" -out "$tmp/turn.crt" >/dev/null 2>&1
chmod 0640 "$tmp/turn.key"
chmod 0644 "$tmp/turn.crt"
key_gid=$(stat -c %g "$tmp/turn.key")
if [[ "$key_gid" == 0 ]]; then
  chgrp 1000 "$tmp/turn.key"
  key_gid=1000
fi

cat > "$tmp/source.yaml" <<'YAML'
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: false
  node_ip: 127.0.0.1
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400
  allow_restricted_peer_cidrs:
    - 127.0.0.1/32
keys:
  smoke-key: smoke-secret-that-is-at-least-thirty-two-characters
webhook:
  urls:
    - http://127.0.0.1:4000/webhooks/livekit
  api_key: smoke-key
logging:
  level: warn
YAML

python3 - "$repo_root" "$tmp/source.yaml" "$tmp/livekit.yaml" "$key_gid" <<'PY'
import importlib.util
import sys
from pathlib import Path
repo, source, target, gid = sys.argv[1:]
module_path = Path(repo) / "examples/dockercompose/turn_tls.py"
spec = importlib.util.spec_from_file_location("towk_turn_tls_smoke", module_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
rendered = module.render_livekit_config(Path(source).read_text(), "turn.example.test")
module.atomic_write_private(Path(target), rendered, int(gid))
PY

# The supplemental group makes the 0640 key/config readable without running
# LiveKit as root or making either file world-readable.
docker run --detach --name "$name" \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --cap-add NET_BIND_SERVICE \
  --group-add "$key_gid" \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  --mount "type=bind,src=$tmp/livekit.yaml,dst=/etc/livekit.yaml,readonly" \
  --mount "type=bind,src=$tmp/turn.crt,dst=/etc/livekit-certs/fullchain.pem,readonly" \
  --mount "type=bind,src=$tmp/turn.key,dst=/etc/livekit-certs/privkey.pem,readonly" \
  --publish "127.0.0.1:$http_port:7880/tcp" \
  --publish "127.0.0.1:$tls_port:443/tcp" \
  "$image" --config /etc/livekit.yaml >/dev/null

ready=false
for _ in $(seq 1 45); do
  if curl --fail --silent --show-error "http://127.0.0.1:$http_port/" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true; then
    docker logs "$name" >&2 || true
    exit 1
  fi
  sleep 1
done
[[ "$ready" == true ]] || { docker logs "$name" >&2 || true; echo 'LiveKit health endpoint did not become ready' >&2; exit 1; }

openssl s_client \
  -connect "127.0.0.1:$tls_port" \
  -servername turn.example.test \
  -verify_hostname turn.example.test \
  -verify_return_error \
  -CAfile "$tmp/turn.crt" \
  </dev/null >/dev/null

runtime=$(docker exec "$name" sh -c 'printf "uid=%s\n" "$(id -u)"; grep -E "^(NoNewPrivs|CapEff):" /proc/1/status')
grep -qx 'uid=1000' <<<"$runtime"
grep -Eq '^NoNewPrivs:[[:space:]]+1$' <<<"$runtime"
grep -Eq '^CapEff:[[:space:]]+0*400$' <<<"$runtime"
[[ $(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$name") == true ]]
[[ $(stat -c %a "$tmp/turn.key") == 640 ]]
[[ $(stat -c %a "$tmp/livekit.yaml") == 640 ]]

docker rm -f "$name" >/dev/null
for _ in $(seq 1 20); do
  if ! (echo >/dev/tcp/127.0.0.1/"$tls_port") >/dev/null 2>&1; then
    echo 'Pinned LiveKit image accepted the generated config, served TURN/TLS, and released the listener cleanly.'
    exit 0
  fi
  sleep 0.25
done
echo 'TURN/TLS listener remained reachable after container removal' >&2
exit 1
