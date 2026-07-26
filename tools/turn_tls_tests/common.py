#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
TEST_GID = os.getgid() if os.getgid() != 0 else 1000
MODULE_PATH = ROOT / "examples" / "dockercompose" / "turn_tls.py"
SPEC = importlib.util.spec_from_file_location("towk_turn_tls", MODULE_PATH)
assert SPEC and SPEC.loader
turn_tls = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = turn_tls
SPEC.loader.exec_module(turn_tls)

from turn_tls_lib import containers as containers_impl
from turn_tls_lib import deployment as deployment_impl


BASE_LIVEKIT = """port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50200
  use_external_ip: true

turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 50201
  relay_range_end: 50400

keys:
  test-key: test-secret-that-is-at-least-thirty-two-characters

webhook:
  urls:
    - https://chat.example.test/webhooks/livekit
  api_key: test-key

logging:
  level: warn
"""


def port(host_ip: str, target: int | str, published: int | str, protocol: str = "tcp") -> dict[str, object]:
    return {
        "host_ip": host_ip,
        "target": target,
        "published": str(published),
        "protocol": protocol,
    }


def fixture_settings(root: Path, cert: Path, key: Path) -> object:
    source = root / "livekit.yaml"
    output = root / ".turn-tls" / "livekit.yaml"
    source.write_text(BASE_LIVEKIT, encoding="utf-8")
    return turn_tls.Settings(
        root=root,
        web_bind_ip="198.51.100.10",
        turn_bind_ip="198.51.100.11",
        turn_domain="turn.example.test",
        cert_file=cert,
        key_file=key,
        source_config=source,
        output_config=output,
        key_gid=TEST_GID,
        min_validity_days=14,
    )


def opt_in_render(settings: object) -> dict[str, object]:
    livekit_ports: list[dict[str, object]] = [
        port("0.0.0.0", 50000, "50000-50200", "udp"),
        port("0.0.0.0", 50201, "50201-50400", "udp"),
        port("0.0.0.0", 7881, 7881, "tcp"),
        port("0.0.0.0", 3478, 3478, "udp"),
        port(settings.turn_bind_ip, 443, 443, "tcp"),
    ]
    return {
        "services": {
            "caddy": {
                "ports": [
                    port(settings.web_bind_ip, 80, 80, "tcp"),
                    port(settings.web_bind_ip, 443, 443, "tcp"),
                    port(settings.web_bind_ip, 443, 443, "udp"),
                ],
                "environment": {"PUBLIC_URL": "chat.example.test"},
            },
            "livekit": {
                "image": turn_tls.PINNED_LIVEKIT_IMAGE,
                "user": "1000:1000",
                "read_only": True,
                "cap_add": ["NET_BIND_SERVICE"],
                "cap_drop": ["ALL"],
                "group_add": [str(settings.key_gid)],
                "security_opt": ["no-new-privileges:true"],
                "pids_limit": 512,
                "tmpfs": ["/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777"],
                "ports": livekit_ports,
                "volumes": [
                    {
                        "type": "bind",
                        "source": str(settings.output_config),
                        "target": "/etc/livekit.yaml",
                        "read_only": True,
                    },
                    {
                        "type": "bind",
                        "source": str(settings.cert_file),
                        "target": "/etc/livekit-certs/fullchain.pem",
                        "read_only": True,
                    },
                    {
                        "type": "bind",
                        "source": str(settings.key_file),
                        "target": "/etc/livekit-certs/privkey.pem",
                        "read_only": True,
                    },
                ],
            },
        }
    }



def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)
