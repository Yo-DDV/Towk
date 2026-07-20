#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/runtime-image-process.sh"

image="${1:?usage: verify-runtime-image.sh IMAGE}"
work="$(mktemp -d "${TMPDIR:-/tmp}/towk-runtime-verify.XXXXXX")"
chmod 0700 "$work"
container="towk-runtime-verify-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run --rm --entrypoint rm -v "$work:/work" "$image" -rf /work/config /work/data >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

config="$work/config"
data="$work/data"
mkdir -p "$config" "$data"
chmod 0777 "$config" "$data"

docker run --rm -v "$config:/config" "$image" init >/dev/null
test -s "$config/towk.toml"
# The host runner rewrites this temporary file below and may not share its UID.
docker run --rm --entrypoint chmod -v "$config:/config" "$image" 0666 /config/towk.toml
test "$(docker inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -F 'TOWK_CONFIG_DIR=')" = "TOWK_CONFIG_DIR=/config"

for legal_file in LICENSE LICENSING.md NOTICE REUSE.toml SOURCE.md LICENSES/AGPL-3.0-or-later.txt LICENSES/Apache-2.0.txt; do
  docker run --rm --entrypoint test "$image" -f "/usr/share/doc/towk/$legal_file"
done

if docker run --rm -e PUID=0 "$image" version >"$work/puid-zero.out" 2>&1; then
  echo "PUID=0 must be rejected" >&2
  exit 1
fi
grep -Fq "PUID must be greater than zero" "$work/puid-zero.out"

if docker run --rm -e PGID=invalid "$image" version >"$work/pgid-invalid.out" 2>&1; then
  echo "non-numeric PGID must be rejected" >&2
  exit 1
fi
grep -Fq "PGID must be a numeric group ID" "$work/pgid-invalid.out"

assert_runtime_ids() {
  expected_uid="$1"
  expected_gid="$2"
  shift 2
  run_data="$(mktemp -d "$data/run.XXXXXX")"
  chmod 0777 "$run_data"
  docker run -d --name "$container" "$@" -v "$config:/config" -v "$run_data:/data" "$image" start >/dev/null
  wait_for_runtime_ids "$container" "$expected_uid" "$expected_gid"
  docker rm -f "$container" >/dev/null
}

assert_runtime_ids 1000 1000
assert_runtime_ids 1234 2345 -e PUID=1234 -e PGID=2345

cp "$config/towk.toml" "$config/chatto.toml"
printf '[\n' > "$config/towk.toml"
if timeout --signal=TERM --kill-after=2s 6s docker run --rm -v "$config:/config" "$image" start >"$work/canonical-invalid.out" 2>&1; then
  echo "invalid canonical configuration must fail" >&2
  exit 1
elif [ "$?" -eq 124 ]; then
  echo "canonical configuration was ignored" >&2
  exit 1
fi

mv "$config/chatto.toml" "$config/towk.toml"
cp "$config/towk.toml" "$config/explicit.toml"
printf '[\n' > "$config/chatto.toml"
assert_runtime_ids 1000 1000

rm "$config/towk.toml"
mv "$config/explicit.toml" "$config/chatto.toml"
assert_runtime_ids 1000 1000

cp "$config/chatto.toml" "$config/explicit.toml"
printf '[\n' > "$config/towk.toml"
printf '[\n' > "$config/chatto.toml"
run_data="$(mktemp -d "$data/run.XXXXXX")"
chmod 0777 "$run_data"
docker run -d --name "$container" -v "$config:/config" -v "$run_data:/data" "$image" start -c /config/explicit.toml >/dev/null
wait_for_runtime_ids "$container" 1000 1000
docker rm -f "$container" >/dev/null

echo "Verified Towk runtime identity, config priority, compatibility fallback, and legal bundle."
