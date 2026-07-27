# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from typing import Any, Mapping

from .compose import *


def assert_opt_in_render(config: Mapping[str, Any], settings: Settings) -> None:
    services = config.get("services")
    if not isinstance(services, Mapping):
        raise ValidationError("Opt-in Compose render has no services")
    caddy = services.get("caddy")
    livekit = services.get("livekit")
    if not isinstance(caddy, Mapping) or not isinstance(livekit, Mapping):
        raise ValidationError("Opt-in Compose render must contain caddy and livekit")

    caddy_ports = normalized_port_entries(caddy)
    expected_caddy = {
        (settings.web_bind_ip, 80, 80, "tcp"),
        (settings.web_bind_ip, 443, 443, "tcp"),
        (settings.web_bind_ip, 443, 443, "udp"),
    }
    if caddy_ports != expected_caddy:
        raise ValidationError(
            "Caddy opt-in ports must be exactly WEB_BIND_IP TCP 80, TCP 443, and UDP 443"
        )

    livekit_ports = normalized_port_entries(livekit)
    expected_livekit = {
        *(("0.0.0.0", port, port, "udp") for port in range(50000, 50201)),
        *(("0.0.0.0", port, port, "udp") for port in range(50201, 50401)),
        ("0.0.0.0", 7881, 7881, "tcp"),
        ("0.0.0.0", 3478, 3478, "udp"),
        (settings.turn_bind_ip, 443, 443, "tcp"),
    }
    if livekit_ports != expected_livekit:
        missing = len(expected_livekit - livekit_ports)
        unexpected = len(livekit_ports - expected_livekit)
        raise ValidationError(
            "LiveKit opt-in ports must preserve the exact direct UDP, TURN relay, "
            f"TURN/UDP, ICE/TCP, and dedicated TURN/TLS mappings (missing={missing}, unexpected={unexpected})"
        )

    if str(livekit.get("image") or "") != PINNED_LIVEKIT_IMAGE:
        raise ValidationError("LiveKit opt-in profile must use the pinned v1.13.4 image and digest")
    if set(livekit.get("cap_add", []) or []) != {"NET_BIND_SERVICE"}:
        raise ValidationError("LiveKit opt-in profile must add only NET_BIND_SERVICE")
    if str(livekit.get("user")) != "1000:1000":
        raise ValidationError("LiveKit must remain non-root as UID/GID 1000:1000")
    if not bool(livekit.get("read_only")):
        raise ValidationError("LiveKit root filesystem must remain read-only")
    security_options = {
        str(item).lower().replace("=", ":")
        for item in (livekit.get("security_opt", []) or [])
    }
    if "no-new-privileges:true" not in security_options:
        raise ValidationError("LiveKit must retain no-new-privileges")
    if "ALL" not in set(livekit.get("cap_drop", []) or []):
        raise ValidationError("LiveKit must continue to drop all capabilities before the explicit add")
    if settings.key_gid == 0:
        raise ValidationError("LiveKit opt-in profile must not add supplementary root group 0")
    groups = {str(item) for item in (livekit.get("group_add", []) or [])}
    if groups != {str(settings.key_gid)}:
        raise ValidationError("LiveKit opt-in profile must add only the private-key group")
    if int(livekit.get("pids_limit") or 0) != 512:
        raise ValidationError("LiveKit opt-in profile must retain the 512-process limit")
    tmpfs = [str(item) for item in (livekit.get("tmpfs", []) or [])]
    if not any(item.startswith("/tmp:") and "noexec" in item and "nosuid" in item for item in tmpfs):
        raise ValidationError("LiveKit opt-in profile must retain the hardened /tmp tmpfs")

    volumes = volume_entries(livekit)
    require_bind_mount(volumes, source=settings.output_config, target="/etc/livekit.yaml")
    require_bind_mount(
        volumes,
        source=settings.cert_file,
        target="/etc/livekit-certs/fullchain.pem",
    )
    require_bind_mount(
        volumes,
        source=settings.key_file,
        target="/etc/livekit-certs/privkey.pem",
    )
