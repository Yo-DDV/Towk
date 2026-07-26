# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from .compose_contract import *


def replace_top_level_turn_section(source: str, replacement: str) -> str:
    lines = source.splitlines(keepends=True)
    start: int | None = None
    end: int | None = None
    for index, line in enumerate(lines):
        if re.fullmatch(r"turn:\s*(?:#.*)?\n?", line):
            start = index
            break
    if start is None:
        prefix = source
        if prefix and not prefix.endswith("\n"):
            prefix += "\n"
        if prefix and not prefix.endswith("\n\n"):
            prefix += "\n"
        return prefix + replacement.rstrip() + "\n"

    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        stripped = line.strip()
        if stripped == "":
            continue
        if line[0].isspace() or stripped.startswith("#"):
            continue
        if TOP_LEVEL_RE.fullmatch(line.rstrip("\n")):
            end = index
            break
        raise ValidationError(
            f"Cannot safely replace the top-level turn section near source line {index + 1}"
        )
    return "".join(lines[:start]) + replacement.rstrip() + "\n\n" + "".join(lines[end:]).lstrip("\n")


def validate_source_config(source: str) -> None:
    required_patterns = {
        "rtc.tcp_port": r"(?m)^\s{2}tcp_port:\s*7881\s*(?:#.*)?$",
        "rtc.port_range_start": r"(?m)^\s{2}port_range_start:\s*50000\s*(?:#.*)?$",
        "rtc.port_range_end": r"(?m)^\s{2}port_range_end:\s*50200\s*(?:#.*)?$",
        "keys": r"(?m)^keys:\s*(?:#.*)?$",
        "webhook": r"(?m)^webhook:\s*(?:#.*)?$",
    }
    missing = [name for name, pattern in required_patterns.items() if not re.search(pattern, source)]
    if missing:
        raise ValidationError(
            "LIVEKIT_SOURCE_CONFIG does not match the Towk single-node contract; missing "
            + ", ".join(missing)
        )


def preserved_turn_options(source: str) -> str:
    lines = source.splitlines(keepends=True)
    start: int | None = None
    end = len(lines)
    for index, line in enumerate(lines):
        if re.fullmatch(r"turn:\s*(?:#.*)?\n?", line):
            start = index
            break
    if start is None:
        return ""
    for index in range(start + 1, len(lines)):
        line = lines[index]
        stripped = line.strip()
        if stripped == "" or line[0].isspace() or stripped.startswith("#"):
            continue
        end = index
        break

    managed = {
        "enabled",
        "udp_port",
        "tls_port",
        "relay_range_start",
        "relay_range_end",
        "external_tls",
        "domain",
        "cert_file",
        "key_file",
    }
    preserved: list[str] = []
    skip = False
    for line in lines[start + 1 : end]:
        direct = re.match(r"^  ([A-Za-z0-9_-]+):", line)
        if direct:
            skip = direct.group(1) in managed
        if not skip:
            preserved.append(line)
    return "".join(preserved).strip("\n")


def render_livekit_config(source: str, domain: str) -> str:
    validate_source_config(source)
    preserved = preserved_turn_options(source)
    replacement = f"""turn:
  enabled: true
  udp_port: 3478
  tls_port: 443
  relay_range_start: 50201
  relay_range_end: 50400
  external_tls: false
  domain: {json.dumps(domain)}
  cert_file: /etc/livekit-certs/fullchain.pem
  key_file: /etc/livekit-certs/privkey.pem
"""
    if preserved:
        replacement = replacement.rstrip() + "\n" + preserved + "\n"
    rendered = replace_top_level_turn_section(source, replacement)
    for marker in (
        "tcp_port: 7881",
        "port_range_start: 50000",
        "port_range_end: 50200",
        "udp_port: 3478",
        "tls_port: 443",
        "relay_range_start: 50201",
        "relay_range_end: 50400",
        "external_tls: false",
        f"domain: {json.dumps(domain)}",
        "cert_file: /etc/livekit-certs/fullchain.pem",
        "key_file: /etc/livekit-certs/privkey.pem",
    ):
        if marker not in rendered:
            raise ValidationError(f"Generated LiveKit configuration is missing {marker}")
    return rendered


def atomic_write_private(path: Path, content: str, gid: int) -> None:
    if path.parent.is_symlink():
        raise ValidationError(f"Generated configuration directory must not be a symlink: {path.parent}")
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    if path.parent.is_symlink() or not path.parent.is_dir():
        raise ValidationError(f"Generated configuration directory is not a safe directory: {path.parent}")
    try:
        os.chown(path.parent, -1, gid)
    except PermissionError as exc:
        raise ValidationError(
            f"Cannot assign generated configuration directory to key group {gid}: {path.parent}"
        ) from exc
    os.chmod(path.parent, 0o750)
    fd, temp_name = tempfile.mkstemp(prefix=".livekit.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o640)
        os.fchown(fd, -1, gid)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        os.chown(path, -1, gid)
        os.chmod(path, 0o640)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def prepare_livekit_config(settings: Settings) -> None:
    source = settings.source_config.read_text(encoding="utf-8")
    rendered = render_livekit_config(source, settings.turn_domain)
    atomic_write_private(settings.output_config, rendered, settings.key_gid)
