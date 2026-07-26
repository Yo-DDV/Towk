# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .livekit_config import *


def compose_service_ids(
    runner: Runner,
    settings: Settings,
    services: Sequence[str],
    *,
    overlay: bool,
) -> set[str]:
    ids: set[str] = set()
    for service in services:
        result = runner.run(
            compose_command(settings, overlay=overlay, args=["ps", "-q", service]),
            cwd=settings.root,
            env=settings.compose_environment(),
            timeout=30,
        )
        ids.update(line.strip() for line in result.stdout.decode().splitlines() if line.strip())
    return ids


def inspect_containers(runner: Runner, root: Path, ids: Iterable[str]) -> list[dict[str, Any]]:
    values = list(ids)
    if not values:
        return []
    result = runner.run(["docker", "inspect", *values], cwd=root, timeout=30)
    parsed = parse_json_output(result, "docker inspect")
    if not isinstance(parsed, list):
        raise ValidationError("docker inspect returned an unexpected shape")
    return [item for item in parsed if isinstance(item, dict)]


def published_tcp443_bindings(container: Mapping[str, Any]) -> set[str]:
    bindings = (
        container.get("HostConfig", {}).get("PortBindings", {}).get("443/tcp")
        if isinstance(container.get("HostConfig"), Mapping)
        else None
    )
    result: set[str] = set()
    for binding in bindings or []:
        if not isinstance(binding, Mapping):
            continue
        host_ip = str(binding.get("HostIp") or "0.0.0.0")
        result.add(host_ip)
    return result


def all_running_container_ids(runner: Runner, root: Path) -> set[str]:
    result = runner.run(["docker", "ps", "--no-trunc", "-q"], cwd=root, timeout=30)
    return {line.strip() for line in result.stdout.decode().splitlines() if line.strip()}


def listener_ip(local_endpoint: str) -> str:
    endpoint = local_endpoint.strip()
    if endpoint.startswith("["):
        return endpoint.split("]", 1)[0][1:]
    if endpoint.count(":") == 1:
        return endpoint.rsplit(":", 1)[0]
    if endpoint.endswith(":443"):
        return endpoint[:-4]
    return endpoint


def active_tcp443_listener_ips(runner: Runner, root: Path) -> set[str]:
    result = runner.run(["ss", "-H", "-ltn", "sport", "=", ":443"], cwd=root, timeout=15)
    addresses: set[str] = set()
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        fields = line.split()
        if len(fields) >= 4:
            addresses.add(listener_ip(fields[3]))
    return addresses


def binding_covers_listener(binding: str, listener: str) -> bool:
    if binding in {"", "0.0.0.0", "::"}:
        return True
    normalized_listener = listener.strip("[]")
    if normalized_listener in {"*", "0.0.0.0", "::"}:
        return False
    return binding == normalized_listener


def binding_conflicts_with_selected_addresses(binding: str, selected: set[str]) -> bool:
    normalized = binding.strip("[]")
    return normalized in {"", "*", "0.0.0.0", "::"} or normalized in selected


def validate_port_443_ownership(runner: Runner, settings: Settings) -> None:
    allowed_ids = compose_service_ids(runner, settings, ["caddy", "livekit"], overlay=False)
    # A second run may already use the overlay project configuration.
    allowed_ids.update(compose_service_ids(runner, settings, ["caddy", "livekit"], overlay=True))
    running_ids = all_running_container_ids(runner, settings.root)
    inspected = inspect_containers(runner, settings.root, running_ids)

    selected_addresses = {settings.web_bind_ip, settings.turn_bind_ip}
    allowed_bindings: set[str] = set()
    external: list[str] = []
    for container in inspected:
        container_id = str(container.get("Id") or "")
        bindings = published_tcp443_bindings(container)
        if not bindings:
            continue
        if container_id in allowed_ids:
            allowed_bindings.update(bindings)
        elif any(
            binding_conflicts_with_selected_addresses(binding, selected_addresses)
            for binding in bindings
        ):
            name = str(container.get("Name") or container_id[:12]).lstrip("/")
            external.append(name)
    if external:
        raise ValidationError(
            "TCP 443 is published by a container outside this Compose stack: "
            + ", ".join(sorted(external))
        )

    listeners = active_tcp443_listener_ips(runner, settings.root)
    conflicting_listeners = {
        address
        for address in listeners
        if binding_conflicts_with_selected_addresses(address, selected_addresses)
    }
    uncovered = {
        address
        for address in conflicting_listeners
        if not any(binding_covers_listener(binding, address) for binding in allowed_bindings)
    }
    if uncovered:
        raise ValidationError(
            "TCP 443 is already occupied outside the current Towk Caddy/LiveKit services on: "
            + ", ".join(sorted(uncovered))
        )
