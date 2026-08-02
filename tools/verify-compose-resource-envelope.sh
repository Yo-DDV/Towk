#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
example="$repo_root/examples/dockercompose"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
render_root="$tmp/render"
generated_root="$tmp/generated"
mkdir -p "$render_root" "$generated_root"
cp -a "$example/." "$render_root/"
cp "$render_root/env.example" "$render_root/.env"

(cd "$render_root" && docker compose --env-file env.example config --format json) >"$tmp/default.json"

node - "$tmp/default.json" <<'NODE'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedShares = { nats: 512, livekit: 2048, towk: 1024, caddy: 512 };

for (const [name, shares] of Object.entries(expectedShares)) {
  const service = config.services?.[name];
  if (!service) throw new Error(`missing ${name} service`);
  if ('cpus' in service) throw new Error(`${name} has a default hard CPU quota`);
  if ('mem_limit' in service) throw new Error(`${name} has a default hard memory limit`);
  if (service.cpu_shares !== shares) {
    throw new Error(`${name} cpu_shares=${service.cpu_shares}, want ${shares}`);
  }
}
NODE

(
  cd "$render_root"
  NATS_CPU_LIMIT=0.5 NATS_MEMORY_LIMIT=384m \
    LIVEKIT_CPU_LIMIT=2.5 LIVEKIT_MEMORY_LIMIT=3g \
    TOWK_CPU_LIMIT=1.5 TOWK_MEMORY_LIMIT=2g \
    CADDY_CPU_LIMIT=0.25 CADDY_MEMORY_LIMIT=256m \
    docker compose --env-file env.example config --format json
) >"$tmp/capped.json"

node - "$tmp/capped.json" <<'NODE'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = {
  nats: { cpus: 0.5, mem_limit: 384 * 1024 * 1024 },
  livekit: { cpus: 2.5, mem_limit: 3 * 1024 * 1024 * 1024 },
  towk: { cpus: 1.5, mem_limit: 2 * 1024 * 1024 * 1024 },
  caddy: { cpus: 0.25, mem_limit: 256 * 1024 * 1024 },
};

for (const [name, limits] of Object.entries(expected)) {
  const service = config.services?.[name];
  for (const [field, value] of Object.entries(limits)) {
    if (Number(service?.[field]) !== value) {
      throw new Error(`${name} ${field}=${service?.[field]}, want ${value}`);
    }
  }
}
NODE

cp "$example/init-env.sh" "$generated_root/init-env.sh"
(cd "$generated_root" && sh ./init-env.sh chat.example.test owner@example.test >/dev/null)

node - "$generated_root/.env" <<'NODE'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const values = Object.fromEntries(lines.filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => {
  const split = line.indexOf('=');
  return [line.slice(0, split), line.slice(split + 1)];
}));
const expected = {
  NATS_CPU_LIMIT: '0', NATS_MEMORY_LIMIT: '0', NATS_CPU_SHARES: '512',
  LIVEKIT_CPU_LIMIT: '0', LIVEKIT_MEMORY_LIMIT: '0', LIVEKIT_CPU_SHARES: '2048',
  TOWK_CPU_LIMIT: '0', TOWK_MEMORY_LIMIT: '0', TOWK_CPU_SHARES: '1024',
  CADDY_CPU_LIMIT: '0', CADDY_MEMORY_LIMIT: '0', CADDY_CPU_SHARES: '512',
};
for (const [name, value] of Object.entries(expected)) {
  if (values[name] !== value) throw new Error(`generated ${name}=${values[name]}, want ${value}`);
}
if ('CHATTO_PERFORMANCE_DEFAULT_PROFILE' in values) {
  throw new Error('generated environment still selects a runtime performance profile');
}
NODE

echo "Compose shared resource envelope verified"
