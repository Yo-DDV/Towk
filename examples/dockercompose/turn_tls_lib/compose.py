# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .certificates import *


def compose_command(settings: Settings, *, overlay: bool, args: Sequence[str]) -> list[str]:
    command = ["docker", "compose", "-f", str(settings.base_compose)]
    if overlay:
        command.extend(["-f", str(settings.overlay_compose)])
    command.extend(args)
    return command


def docker_compose_version(runner: Runner, root: Path) -> tuple[int, int, int]:
    result = runner.run(["docker", "compose", "version", "--short"], cwd=root, timeout=15)
    return validate_compose_version(result.stdout.decode("utf-8", "replace").strip())


def parse_json_output(result: subprocess.CompletedProcess[bytes], context: str) -> Any:
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Could not parse JSON returned by {context}") from exc


def render_compose(runner: Runner, settings: Settings, *, overlay: bool) -> dict[str, Any]:
    command = compose_command(settings, overlay=overlay, args=["config", "--format", "json"])
    result = runner.run(command, cwd=settings.root, env=settings.compose_environment(), timeout=60)
    parsed = parse_json_output(result, "docker compose config")
    if not isinstance(parsed, dict):
        raise ValidationError("Docker Compose returned an unexpected configuration shape")
    return parsed


def _port_range(value: Any) -> tuple[int, int]:
    text = str(value)
    if "-" in text:
        first, last = text.split("-", 1)
        start = int(first)
        end = int(last)
    else:
        start = end = int(text)
    if start > end:
        raise ValidationError(f"Compose returned an inverted port range: {text}")
    return start, end


def normalized_port_entries(service: Mapping[str, Any]) -> set[tuple[str, int, int, str]]:
    entries: set[tuple[str, int, int, str]] = set()
    for raw in service.get("ports", []) or []:
        if isinstance(raw, str):
            raise ValidationError("Compose did not normalize a published port as expected")
        if not isinstance(raw, Mapping):
            raise ValidationError("Compose returned a malformed published port")
        host_ip = str(raw.get("host_ip") or "0.0.0.0")
        target_start, target_end = _port_range(raw["target"])
        published_start, published_end = _port_range(raw["published"])
        if target_start == target_end and published_start != published_end:
            target_end = target_start + (published_end - published_start)
        if published_start == published_end and target_start != target_end:
            published_end = published_start + (target_end - target_start)
        if (target_end - target_start) != (published_end - published_start):
            raise ValidationError("Compose returned mismatched target and published port ranges")
        protocol = str(raw.get("protocol") or "tcp")
        for offset in range(target_end - target_start + 1):
            entries.add(
                (
                    host_ip,
                    target_start + offset,
                    published_start + offset,
                    protocol,
                )
            )
    return entries


def volume_entries(service: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    entries = service.get("volumes", []) or []
    return [entry for entry in entries if isinstance(entry, Mapping)]


def assert_default_render(config: Mapping[str, Any]) -> None:
    services = config.get("services")
    if not isinstance(services, Mapping) or "livekit" not in services:
        raise ValidationError("Default Compose render does not contain the livekit service")
    livekit = services["livekit"]
    if not isinstance(livekit, Mapping):
        raise ValidationError("Default LiveKit service is malformed")
    ports = normalized_port_entries(livekit)
    if any(target == 443 and protocol == "tcp" for _, target, _, protocol in ports):
        raise ValidationError("Default Compose render unexpectedly publishes LiveKit TCP 443")
    expected_ports = {
        *(("0.0.0.0", port, port, "udp") for port in range(50000, 50201)),
        *(("0.0.0.0", port, port, "udp") for port in range(50201, 50401)),
        ("0.0.0.0", 7881, 7881, "tcp"),
        ("0.0.0.0", 3478, 3478, "udp"),
    }
    if ports != expected_ports:
        missing = len(expected_ports - ports)
        unexpected = len(ports - expected_ports)
        raise ValidationError(
            "Default Compose render must preserve the exact direct UDP, TURN relay, TURN/UDP, "
            f"and ICE/TCP mappings (missing={missing}, unexpected={unexpected})"
        )
    if "NET_BIND_SERVICE" in set(livekit.get("cap_add", []) or []):
        raise ValidationError("Default Compose render unexpectedly grants LiveKit NET_BIND_SERVICE")
    for entry in volume_entries(livekit):
        target = str(entry.get("target") or "")
        if target.startswith("/etc/livekit-certs"):
            raise ValidationError("Default Compose render unexpectedly mounts TURN/TLS certificate material")


def require_bind_mount(
    volumes: Iterable[Mapping[str, Any]],
    *,
    source: Path,
    target: str,
) -> None:
    expected = str(source)
    for entry in volumes:
        if (
            entry.get("type") == "bind"
            and str(entry.get("source")) == expected
            and entry.get("target") == target
            and bool(entry.get("read_only"))
        ):
            return
    raise ValidationError(f"Opt-in Compose render is missing read-only bind mount {target}")
