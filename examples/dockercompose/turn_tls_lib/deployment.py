# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .health import *


def compose_up(
    runner: Runner,
    settings: Settings,
    *,
    overlay: bool,
    services: Sequence[str] = (),
    no_deps: bool = False,
    force_recreate: bool = False,
) -> None:
    args = ["up", "-d"]
    if no_deps:
        args.append("--no-deps")
    if force_recreate:
        args.append("--force-recreate")
    args.extend(services)
    runner.run(
        compose_command(settings, overlay=overlay, args=args),
        cwd=settings.root,
        env=settings.compose_environment(),
        timeout=300,
    )


def restore_standard_profile(runner: Runner, settings: Settings) -> None:
    errors: list[str] = []
    steps = [
        ("LiveKit", lambda: compose_up(runner, settings, overlay=False, services=["livekit"], no_deps=True, force_recreate=True)),
        ("LiveKit health", lambda: wait_service(runner, settings, "livekit", overlay=False)),
        ("Caddy", lambda: compose_up(runner, settings, overlay=False, services=["caddy"], no_deps=True, force_recreate=True)),
        ("Caddy readiness", lambda: wait_service(runner, settings, "caddy", overlay=False)),
        ("stack convergence", lambda: compose_up(runner, settings, overlay=False)),
    ]
    for name, action in steps:
        try:
            action()
        except TurnTLSException as exc:
            errors.append(f"{name}: {exc}")
    if errors:
        raise RollbackError("Standard-profile rollback failed: " + " | ".join(errors))


def activate_profile(
    runner: Runner,
    settings: Settings,
    opt_in_render: Mapping[str, Any],
) -> None:
    existing_caddy = service_running(runner, settings, "caddy", overlay=False) or service_running(
        runner, settings, "caddy", overlay=True
    )
    mutation_started = False
    try:
        if existing_caddy:
            mutation_started = True
            compose_up(
                runner,
                settings,
                overlay=True,
                services=["caddy"],
                no_deps=True,
                force_recreate=True,
            )
            wait_service(runner, settings, "caddy", overlay=True)
            verify_https(runner, settings, opt_in_render)

            compose_up(
                runner,
                settings,
                overlay=True,
                services=["livekit"],
                no_deps=True,
                force_recreate=True,
            )
            wait_service(runner, settings, "livekit", overlay=True)
            verify_turn_tls(runner, settings)
            compose_up(runner, settings, overlay=True)
        else:
            mutation_started = True
            compose_up(runner, settings, overlay=True)
            wait_service(runner, settings, "caddy", overlay=True)
            wait_service(runner, settings, "livekit", overlay=True)
            verify_https(runner, settings, opt_in_render)
            verify_turn_tls(runner, settings)
    except (Exception, KeyboardInterrupt) as primary:
        if not mutation_started:
            raise
        try:
            restore_standard_profile(runner, settings)
        except RollbackError as rollback:
            raise RollbackError(f"Activation failed ({primary}); {rollback}") from primary
        if isinstance(primary, TurnTLSException):
            raise ValidationError(
                f"Activation failed and the standard profile was restored: {primary}"
            ) from primary
        raise
