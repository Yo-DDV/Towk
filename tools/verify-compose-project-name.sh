#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
example="$repo_root/examples/dockercompose"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/towk-compose-project.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT

command -v docker >/dev/null
docker compose version >/dev/null

image='ghcr.io/yo-ddv/towk:0.0.0@sha256:1111111111111111111111111111111111111111111111111111111111111111'

copy_example() {
	local destination=$1
	mkdir -p "$destination"
	cp "$example/compose.yml" "$example/env.example" "$example/init-env.sh" \
		"$example/livekit.yaml" "$example/Caddyfile" \
		"$example/compose.project-name.override.yml" "$destination/"
}

set_test_image() {
	local environment_file=$1
	sed -i "s#^TOWK_IMAGE=.*#TOWK_IMAGE=$image#" "$environment_file"
}

assert_rendered_project() {
	local directory=$1
	local expected_project=$2
	local rendered

	rendered="$(cd "$directory" && docker compose config --format json)"
	# The JavaScript template literals are intentionally protected from the shell.
	# shellcheck disable=SC2016
	printf '%s' "$rendered" | node -e '
		const assert = require("node:assert/strict");
		const fs = require("node:fs");
		const project = process.argv[1];
		const config = JSON.parse(fs.readFileSync(0, "utf8"));
		const services = ["caddy", "livekit", "nats", "towk"];

		assert.equal(config.name, project);
		assert.deepEqual(Object.keys(config.services).sort(), services);
		assert.equal(config.networks.default.name, `${project}_default`);
		for (const volume of ["caddy_config", "caddy_data", "nats_data"]) {
			assert.equal(config.volumes[volume].name, `${project}_${volume}`);
		}
		for (const service of services) {
			assert.equal(config.services[service].container_name, undefined);
			const defaultContainerName = `${project}-${service}-1`;
			assert.ok(defaultContainerName.startsWith(`${project}-`));
			assert.doesNotMatch(defaultContainerName, /chatto/i);
		}
	' "$expected_project"
}

assert_safe_rename() {
	local directory=$1
	local rendered

	rendered="$(cd "$directory" && docker compose \
		-f compose.yml -f compose.project-name.override.yml config --format json)"
	# The JavaScript template literals are intentionally protected from the shell.
	# shellcheck disable=SC2016
	printf '%s' "$rendered" | node -e '
		const assert = require("node:assert/strict");
		const fs = require("node:fs");
		const config = JSON.parse(fs.readFileSync(0, "utf8"));

		assert.equal(config.name, "renamed-towk");
		assert.equal(config.networks.default.name, "renamed-towk_default");
		for (const volume of ["caddy_config", "caddy_data", "nats_data"]) {
			assert.equal(config.volumes[volume].name, `dockercompose_${volume}`);
			assert.equal(config.volumes[volume].external, true);
		}
	'
}

template="$tmp/template"
copy_example "$template"
cp "$template/env.example" "$template/.env"
set_test_image "$template/.env"
assert_rendered_project "$template" towk

generated="$tmp/generated"
copy_example "$generated"
(cd "$generated" && ./init-env.sh chat.example.test admin@example.test >/dev/null)
set_test_image "$generated/.env"
assert_rendered_project "$generated" towk

custom="$tmp/custom"
copy_example "$custom"
cp "$custom/env.example" "$custom/.env"
set_test_image "$custom/.env"
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=my-towk/' "$custom/.env"
assert_rendered_project "$custom" my-towk

existing="$tmp/existing/dockercompose"
copy_example "$existing"
grep -v '^COMPOSE_PROJECT_NAME=' "$existing/env.example" > "$existing/.env"
set_test_image "$existing/.env"
assert_rendered_project "$existing" dockercompose

rename="$tmp/rename"
copy_example "$rename"
cp "$rename/env.example" "$rename/.env"
set_test_image "$rename/.env"
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=renamed-towk/' "$rename/.env"
cat >> "$rename/.env" <<'EOF'
TOWK_EXISTING_NATS_VOLUME=dockercompose_nats_data
TOWK_EXISTING_CADDY_DATA_VOLUME=dockercompose_caddy_data
TOWK_EXISTING_CADDY_CONFIG_VOLUME=dockercompose_caddy_config
EOF
assert_safe_rename "$rename"

unsafe_rename="$tmp/unsafe-rename"
copy_example "$unsafe_rename"
cp "$unsafe_rename/env.example" "$unsafe_rename/.env"
set_test_image "$unsafe_rename/.env"
sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=renamed-towk/' "$unsafe_rename/.env"
if (cd "$unsafe_rename" && docker compose \
	-f compose.yml -f compose.project-name.override.yml config >/dev/null 2>&1); then
	printf '%s\n' 'Rename override accepted missing existing-volume names.' >&2
	exit 1
fi

printf '%s\n' 'Verified Towk Compose project naming and non-destructive rename configuration.'
