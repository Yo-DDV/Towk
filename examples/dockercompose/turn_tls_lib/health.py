# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import os
import time
from typing import Any, Mapping

from .containers import *


def is_container_running(container: Mapping[str, Any]) -> bool:
    state = container.get("State")
    return bool(isinstance(state, Mapping) and state.get("Running"))


def service_running(runner: Runner, settings: Settings, service: str, *, overlay: bool) -> bool:
    ids = compose_service_ids(runner, settings, [service], overlay=overlay)
    containers = inspect_containers(runner, settings.root, ids)
    return bool(containers) and all(is_container_running(item) for item in containers)


def wait_service(
    runner: Runner,
    settings: Settings,
    service: str,
    *,
    overlay: bool,
    timeout_seconds: int = 90,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_state = "not created"
    while time.monotonic() < deadline:
        ids = compose_service_ids(runner, settings, [service], overlay=overlay)
        containers = inspect_containers(runner, settings.root, ids)
        if containers:
            states: list[str] = []
            ready = True
            for container in containers:
                state = container.get("State") if isinstance(container.get("State"), Mapping) else {}
                running = bool(state.get("Running"))
                health = state.get("Health") if isinstance(state.get("Health"), Mapping) else None
                health_status = health.get("Status") if health else None
                if not running or (health_status is not None and health_status != "healthy"):
                    ready = False
                states.append(f"running={running}, health={health_status or 'none'}")
            last_state = "; ".join(states)
            if ready:
                return
        time.sleep(2)
    raise ValidationError(f"Service {service} did not become ready ({last_state})")


def public_url_from_render(config: Mapping[str, Any]) -> str:
    services = config.get("services")
    if not isinstance(services, Mapping):
        raise ValidationError("Compose render does not expose the caddy environment")
    caddy = services.get("caddy")
    if not isinstance(caddy, Mapping):
        raise ValidationError("Compose render does not expose the caddy service")
    environment = caddy.get("environment")
    if not isinstance(environment, Mapping):
        raise ValidationError("Caddy PUBLIC_URL is missing from the Compose render")
    value = str(environment.get("PUBLIC_URL") or "").strip()
    value = value.removeprefix("https://").removeprefix("http://").rstrip("/")
    return validate_domain(value)


def verify_https(runner: Runner, settings: Settings, config: Mapping[str, Any]) -> None:
    domain = public_url_from_render(config)
    runner.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "5",
            "--max-time",
            "20",
            "--resolve",
            f"{domain}:443:{settings.web_bind_ip}",
            f"https://{domain}/",
            "--output",
            os.devnull,
        ],
        cwd=settings.root,
        timeout=30,
    )


def verify_turn_tls(runner: Runner, settings: Settings) -> None:
    result = runner.run(
        [
            "openssl",
            "s_client",
            "-connect",
            f"{settings.turn_bind_ip}:443",
            "-servername",
            settings.turn_domain,
            "-verify_hostname",
            settings.turn_domain,
            "-verify_return_error",
        ],
        cwd=settings.root,
        input_bytes=b"",
        check=False,
        timeout=25,
    )
    if result.returncode != 0:
        detail = safe_error_detail(result.stderr or result.stdout)
        raise ValidationError(f"TURN/TLS handshake failed for {settings.turn_domain}: {detail}")
