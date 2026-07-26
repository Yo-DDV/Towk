# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import ipaddress
import re
import shutil
import stat
from pathlib import Path

from .core import *


def require_command(name: str) -> None:
    if shutil.which(name) is None:
        raise ValidationError(f"Required command is not installed: {name}")


def parse_version(value: str) -> tuple[int, int, int]:
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise ValidationError(f"Could not parse Docker Compose version: {value!r}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def validate_compose_version(value: str) -> tuple[int, int, int]:
    version = parse_version(value)
    if version < MIN_COMPOSE_VERSION:
        required = ".".join(str(part) for part in MIN_COMPOSE_VERSION)
        found = ".".join(str(part) for part in version)
        raise ValidationError(
            f"Docker Compose {required} or newer is required for !override; found {found}"
        )
    return version


def validate_plain_value(name: str, value: str) -> str:
    if value == "":
        raise ValidationError(f"{name} is required")
    if CONTROL_RE.search(value):
        raise ValidationError(f"{name} contains a control character")
    return value


def validate_ipv4(name: str, value: str, *, require_global: bool = True) -> str:
    validate_plain_value(name, value)
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValidationError(f"{name} must be a literal IPv4 address") from exc
    if address.version != 4:
        raise ValidationError(f"{name} must be an IPv4 address")
    if address.is_unspecified:
        raise ValidationError(f"{name} must not be 0.0.0.0")
    if require_global and not address.is_global:
        raise ValidationError(f"{name} must be a globally routable public IPv4 address")
    return str(address)


def validate_domain(value: str) -> str:
    validate_plain_value("TURN_DOMAIN", value)
    normalized = value.rstrip(".").lower()
    if not DOMAIN_RE.fullmatch(normalized):
        raise ValidationError(
            "TURN_DOMAIN must be a fully qualified ASCII DNS name without wildcards"
        )
    return normalized


def validate_path_input(name: str, value: str) -> Path:
    validate_plain_value(name, value)
    if ":" in value:
        raise ValidationError(f"{name} must not contain ':' because it is used in a bind mount")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValidationError(f"{name} must be an absolute host path")
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValidationError(f"{name} does not exist: {path}") from exc
    if not resolved.is_file():
        raise ValidationError(f"{name} must reference a regular file: {resolved}")
    return resolved


def file_readable_by_container(path: Path, *, uid: int, supplementary_gid: int | None) -> bool:
    metadata = path.stat()
    mode = stat.S_IMODE(metadata.st_mode)
    if metadata.st_uid == uid and mode & stat.S_IRUSR:
        return True
    gids = {LIVEKIT_GID}
    if supplementary_gid is not None:
        gids.add(supplementary_gid)
    if metadata.st_gid in gids and mode & stat.S_IRGRP:
        return True
    return bool(mode & stat.S_IROTH)


def validate_key_permissions(path: Path) -> int:
    metadata = path.stat()
    mode = stat.S_IMODE(metadata.st_mode)
    if mode & ~0o640:
        raise ValidationError(
            f"TURN_KEY_FILE permissions are too broad ({mode:04o}); allow at most owner read/write "
            "and dedicated-group read, with no execute or special bits"
        )
    if metadata.st_uid == LIVEKIT_UID and mode & stat.S_IRUSR:
        return LIVEKIT_GID
    if mode & stat.S_IRGRP:
        if metadata.st_gid == 0:
            raise ValidationError(
                "TURN_KEY_FILE must use a dedicated non-root group; refusing supplementary root group 0"
            )
        return metadata.st_gid
    raise ValidationError(
        "TURN_KEY_FILE is not readable by LiveKit UID 1000; grant group-read to a dedicated non-root group "
        "and keep access for other users disabled"
    )


def validate_certificate_permissions(path: Path, key_gid: int) -> None:
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o022:
        raise ValidationError(
            f"TURN_CERT_FILE permissions are too broad ({mode:04o}); remove group and other write access"
        )
    if not file_readable_by_container(path, uid=LIVEKIT_UID, supplementary_gid=key_gid):
        raise ValidationError(
            f"TURN_CERT_FILE is not readable by LiveKit UID 1000 or key group {key_gid} ({mode:04o})"
        )
