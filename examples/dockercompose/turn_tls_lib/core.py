#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0
"""Safe activation helper for Towk's optional dedicated-address TURN/TLS profile."""

from __future__ import annotations

import dataclasses
import os
import re
import shlex
import subprocess
from pathlib import Path
from typing import Mapping, Sequence


MIN_COMPOSE_VERSION = (2, 24, 4)
LIVEKIT_UID = 1000
LIVEKIT_GID = 1000
DEFAULT_CERT_VALIDITY_DAYS = 14
DEFAULT_OUTPUT = ".turn-tls/livekit.yaml"
GENERATED_DIR = ".turn-tls"
OVERLAY_NAME = "compose.turn-tls.yml"
BASE_COMPOSE_NAME = "compose.yml"
PINNED_LIVEKIT_IMAGE = (
    "livekit/livekit-server:v1.13.4@"
    "sha256:189f7c81b704a36642bc5c7e2d3e1ae83744627c11978a23a251bf19fbec64e0"
)

DOMAIN_RE = re.compile(
    r"(?=^.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z"
)
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
TOP_LEVEL_RE = re.compile(r"^[A-Za-z0-9_-]+:\s*(?:#.*)?$")
PEM_CERT_RE = re.compile(
    br"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.DOTALL
)


class TurnTLSException(RuntimeError):
    """Base error with a public, actionable message."""


class ValidationError(TurnTLSException):
    """A preflight prerequisite failed."""


class RollbackError(TurnTLSException):
    """The standard profile could not be fully restored."""


def safe_error_detail(raw: bytes | str | None, limit: int = 400) -> str:
    if raw is None:
        return ""
    text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    text = CONTROL_RE.sub(" ", text)
    text = " ".join(text.split())
    return text[:limit]


def format_command(args: Sequence[str]) -> str:
    return " ".join(shlex.quote(str(item)) for item in args)


@dataclasses.dataclass(frozen=True)
class Settings:
    root: Path
    web_bind_ip: str
    turn_bind_ip: str
    turn_domain: str
    cert_file: Path
    key_file: Path
    source_config: Path
    output_config: Path
    key_gid: int
    min_validity_days: int

    @property
    def base_compose(self) -> Path:
        return self.root / BASE_COMPOSE_NAME

    @property
    def overlay_compose(self) -> Path:
        return self.root / OVERLAY_NAME

    @property
    def compose_files(self) -> tuple[Path, Path]:
        return self.base_compose, self.overlay_compose

    def compose_environment(self) -> dict[str, str]:
        env = dict(os.environ)
        env.update(
            {
                "WEB_BIND_IP": self.web_bind_ip,
                "TURN_BIND_IP": self.turn_bind_ip,
                "TURN_DOMAIN": self.turn_domain,
                "TURN_CERT_FILE": str(self.cert_file),
                "TURN_KEY_FILE": str(self.key_file),
                "TURN_KEY_GID": str(self.key_gid),
                "TURN_LIVEKIT_CONFIG_FILE": str(self.output_config),
            }
        )
        return env


class Runner:
    """Subprocess boundary; output is captured unless explicitly requested."""

    def run(
        self,
        args: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None = None,
        input_bytes: bytes | None = None,
        check: bool = True,
        timeout: float | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        try:
            return subprocess.run(
                list(args),
                cwd=cwd,
                env=dict(env) if env is not None else None,
                input=input_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=check,
                timeout=timeout,
            )
        except FileNotFoundError as exc:
            raise ValidationError(f"Required command is not installed: {args[0]}") from exc
        except subprocess.TimeoutExpired as exc:
            raise ValidationError(f"Command timed out: {format_command(args)}") from exc
        except subprocess.CalledProcessError as exc:
            detail = safe_error_detail(exc.stderr or exc.stdout)
            suffix = f": {detail}" if detail else ""
            raise ValidationError(f"Command failed: {format_command(args)}{suffix}") from exc
