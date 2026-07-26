# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import fcntl
import os
from pathlib import Path
from typing import Any, Mapping

from .settings import *


def deployment_lock(root: Path):
    lock_dir = root / GENERATED_DIR
    if lock_dir.is_symlink():
        raise ValidationError(f"{GENERATED_DIR} must not be a symlink")
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    if lock_dir.is_symlink() or not lock_dir.is_dir():
        raise ValidationError(f"{GENERATED_DIR} is not a safe directory")
    os.chmod(lock_dir, 0o700)
    lock_path = lock_dir / "deploy.lock"
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        handle.close()
        raise ValidationError("Another TURN/TLS profile operation is already running") from exc
    return handle


def safe_render_summary(config: Mapping[str, Any], settings: Settings) -> dict[str, Any]:
    services = config.get("services")
    if not isinstance(services, Mapping):
        raise ValidationError("Compose render has no services")

    def service(name: str) -> Mapping[str, Any]:
        value = services.get(name)
        if not isinstance(value, Mapping):
            raise ValidationError(f"Compose render is missing service {name}")
        return value

    def ports(value: Mapping[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for entry in value.get("ports", []) or []:
            if not isinstance(entry, Mapping):
                continue
            result.append(
                {
                    "host_ip": str(entry.get("host_ip") or "0.0.0.0"),
                    "published": str(entry.get("published")),
                    "target": str(entry.get("target")),
                    "protocol": str(entry.get("protocol") or "tcp"),
                }
            )
        return sorted(
            result,
            key=lambda item: (item["host_ip"], item["protocol"], item["published"], item["target"]),
        )

    livekit = service("livekit")
    caddy = service("caddy")
    mounts: list[dict[str, Any]] = []
    labels = {
        "/etc/livekit.yaml": "generated LiveKit configuration",
        "/etc/livekit-certs/fullchain.pem": "operator certificate",
        "/etc/livekit-certs/privkey.pem": "operator private key (path redacted)",
    }
    for entry in volume_entries(livekit):
        target = str(entry.get("target") or "")
        if target not in labels:
            continue
        mounts.append(
            {
                "target": target,
                "source": labels[target],
                "read_only": bool(entry.get("read_only")),
            }
        )
    return {
        "profile": "optional self-hosted TURN/TLS",
        "web_bind_ip": settings.web_bind_ip,
        "turn_bind_ip": settings.turn_bind_ip,
        "turn_domain": settings.turn_domain,
        "caddy": {"ports": ports(caddy)},
        "livekit": {
            "image": str(livekit.get("image") or ""),
            "user": str(livekit.get("user") or ""),
            "read_only": bool(livekit.get("read_only")),
            "cap_drop": list(livekit.get("cap_drop", []) or []),
            "cap_add": list(livekit.get("cap_add", []) or []),
            "security_opt": list(livekit.get("security_opt", []) or []),
            "supplementary_key_group": str(settings.key_gid),
            "ports": ports(livekit),
            "mounts": mounts,
            "turn": {
                "enabled": True,
                "udp_port": 3478,
                "tls_port": 443,
                "relay_range": "50201-50400/udp",
                "external_tls": False,
                "domain": settings.turn_domain,
            },
        },
        "note": "Towk service environment and all secret values are intentionally omitted.",
    }


def redact_settings(settings: Settings) -> dict[str, Any]:
    return {
        "web_bind_ip": settings.web_bind_ip,
        "turn_bind_ip": settings.turn_bind_ip,
        "turn_domain": settings.turn_domain,
        "source_config": settings.source_config.name,
        "output_config": str(settings.output_config.relative_to(settings.root)),
        "certificate": "configured, publicly trusted, and validated",
        "private_key": "configured (contents never printed)",
        "private_key_gid": settings.key_gid,
        "minimum_certificate_validity_days": settings.min_validity_days,
    }


def load_disable_settings(root: Path) -> Settings:
    root = root.resolve(strict=True)
    placeholder = root / "livekit.yaml"
    return Settings(
        root=root,
        web_bind_ip="127.0.0.1",
        turn_bind_ip="127.0.0.2",
        turn_domain="disabled.invalid",
        cert_file=placeholder,
        key_file=placeholder,
        source_config=placeholder,
        output_config=root / DEFAULT_OUTPUT,
        key_gid=os.getgid(),
        min_validity_days=DEFAULT_CERT_VALIDITY_DAYS,
    )
