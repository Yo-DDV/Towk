#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
example="$repo_root/examples/dockercompose"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/towk-turn-tls-render.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

for command in docker python3 openssl; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required" >&2; exit 1; }
done

compose_version=$(docker compose version --short)
python3 - "$compose_version" <<'PY'
import re
import sys
value = sys.argv[1]
match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
if not match or tuple(map(int, match.groups())) < (2, 24, 4):
    raise SystemExit(f"Docker Compose 2.24.4 or newer is required; found {value}")
PY

cp "$example/compose.yml" "$example/compose.turn-tls.yml" "$example/livekit.yaml" "$example/Caddyfile" "$tmp/"
cat > "$tmp/.env" <<'ENV'
COMPOSE_PROJECT_NAME=towk-turn-tls-render
TOWK_IMAGE=ghcr.io/yo-ddv/towk:test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
NATS_TOKEN=synthetic-render-token
LIVEKIT_CONFIG_FILE=./livekit.yaml
ENV

openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
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

python3 - "$repo_root" "$tmp/livekit.yaml" "$tmp/livekit.turn-tls.yaml" "$key_gid" <<'PY'
import importlib.util
import sys
from pathlib import Path
repo, source, target, gid = sys.argv[1:]
module_path = Path(repo) / "examples/dockercompose/turn_tls.py"
spec = importlib.util.spec_from_file_location("towk_turn_tls_verify", module_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
rendered = module.render_livekit_config(Path(source).read_text(encoding="utf-8"), "turn.example.test")
module.atomic_write_private(Path(target), rendered, int(gid))
PY

(
  cd "$tmp"
  docker compose -f compose.yml config --format json > standard.json
  WEB_BIND_IP=198.51.100.10 \
  TURN_BIND_IP=198.51.100.11 \
  TURN_DOMAIN=turn.example.test \
  TURN_CERT_FILE="$tmp/turn.crt" \
  TURN_KEY_FILE="$tmp/turn.key" \
  TURN_KEY_GID="$key_gid" \
  TURN_LIVEKIT_CONFIG_FILE="$tmp/livekit.turn-tls.yaml" \
    docker compose -f compose.yml -f compose.turn-tls.yml config --format json > turn-tls.json
)

python3 - "$repo_root" "$tmp" "$key_gid" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path
repo, temp, gid = sys.argv[1:]
module_path = Path(repo) / "examples/dockercompose/turn_tls.py"
spec = importlib.util.spec_from_file_location("towk_turn_tls_contract", module_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
temp = Path(temp)
settings = module.Settings(
    root=temp,
    web_bind_ip="198.51.100.10",
    turn_bind_ip="198.51.100.11",
    turn_domain="turn.example.test",
    cert_file=(temp / "turn.crt").resolve(),
    key_file=(temp / "turn.key").resolve(),
    source_config=(temp / "livekit.yaml").resolve(),
    output_config=(temp / "livekit.turn-tls.yaml").resolve(),
    key_gid=int(gid),
    min_validity_days=14,
)
standard = json.loads((temp / "standard.json").read_text())
opt_in = json.loads((temp / "turn-tls.json").read_text())
module.assert_default_render(standard)
module.assert_opt_in_render(opt_in, settings)
rendered_config = settings.output_config.read_text()
for marker in (
    "tls_port: 443",
    "external_tls: false",
    'domain: "turn.example.test"',
    "cert_file: /etc/livekit-certs/fullchain.pem",
    "key_file: /etc/livekit-certs/privkey.pem",
):
    if marker not in rendered_config:
        raise SystemExit(f"generated LiveKit config missing {marker}")
print("Standard and TURN/TLS Compose renders satisfy the deployment contract.")
PY
