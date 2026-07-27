# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .deployment import *


def choose_source_config(root: Path, env: Mapping[str, str]) -> Path:
    explicit = env.get("LIVEKIT_SOURCE_CONFIG", "").strip()
    candidates = [Path(explicit)] if explicit else [Path("livekit.generated.yaml"), Path("livekit.yaml")]
    for candidate in candidates:
        path = candidate if candidate.is_absolute() else root / candidate
        if path.exists():
            return path.resolve(strict=True)
    if explicit:
        raise ValidationError(f"LIVEKIT_SOURCE_CONFIG does not exist: {explicit}")
    raise ValidationError("Neither livekit.generated.yaml nor livekit.yaml exists")


def output_config_path(root: Path, env: Mapping[str, str]) -> Path:
    raw = env.get("TURN_LIVEKIT_CONFIG_FILE", DEFAULT_OUTPUT).strip()
    validate_plain_value("TURN_LIVEKIT_CONFIG_FILE", raw)
    if ":" in raw:
        raise ValidationError("TURN_LIVEKIT_CONFIG_FILE must not contain ':'")
    path = Path(raw).expanduser()
    candidate = (path if path.is_absolute() else root / path).resolve(strict=False)
    generated_root = (root / GENERATED_DIR).resolve(strict=False)
    try:
        relative = candidate.relative_to(generated_root)
    except ValueError as exc:
        raise ValidationError(
            f"TURN_LIVEKIT_CONFIG_FILE must stay inside {GENERATED_DIR}/"
        ) from exc
    if not relative.parts or candidate == generated_root:
        raise ValidationError("TURN_LIVEKIT_CONFIG_FILE must name a file inside .turn-tls/")
    if (root / GENERATED_DIR).is_symlink():
        raise ValidationError(f"{GENERATED_DIR} must not be a symlink")
    return candidate


def parse_positive_int(name: str, raw: str, *, minimum: int, maximum: int) -> int:
    try:
        value = int(raw, 10)
    except ValueError as exc:
        raise ValidationError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValidationError(f"{name} must be between {minimum} and {maximum}")
    return value


def load_settings(
    root: Path,
    env: Mapping[str, str],
    *,
    require_global_ips: bool = True,
) -> Settings:
    root = root.resolve(strict=True)
    web_ip = validate_ipv4("WEB_BIND_IP", env.get("WEB_BIND_IP", ""), require_global=require_global_ips)
    turn_ip = validate_ipv4("TURN_BIND_IP", env.get("TURN_BIND_IP", ""), require_global=require_global_ips)
    if web_ip == turn_ip:
        raise ValidationError("WEB_BIND_IP and TURN_BIND_IP must be different")
    domain = validate_domain(env.get("TURN_DOMAIN", ""))
    cert = validate_path_input("TURN_CERT_FILE", env.get("TURN_CERT_FILE", ""))
    key = validate_path_input("TURN_KEY_FILE", env.get("TURN_KEY_FILE", ""))
    key_gid = validate_key_permissions(key)
    validate_certificate_permissions(cert, key_gid)
    source = choose_source_config(root, env)
    output = output_config_path(root, env)
    if source == output:
        raise ValidationError("TURN_LIVEKIT_CONFIG_FILE must not overwrite LIVEKIT_SOURCE_CONFIG")
    min_days = parse_positive_int(
        "TURN_CERT_MIN_VALIDITY_DAYS",
        env.get("TURN_CERT_MIN_VALIDITY_DAYS", str(DEFAULT_CERT_VALIDITY_DAYS)),
        minimum=1,
        maximum=365,
    )
    for required in (root / BASE_COMPOSE_NAME, root / OVERLAY_NAME):
        if not required.is_file():
            raise ValidationError(f"Required deployment file is missing: {required.name}")
    return Settings(
        root=root,
        web_bind_ip=web_ip,
        turn_bind_ip=turn_ip,
        turn_domain=domain,
        cert_file=cert,
        key_file=key,
        source_config=source,
        output_config=output,
        key_gid=key_gid,
        min_validity_days=min_days,
    )


def static_preflight(
    runner: Runner,
    settings: Settings,
    *,
    validate_host: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    for command in ("docker", "openssl", "ip", "ss", "curl"):
        require_command(command)
    docker_compose_version(runner, settings.root)
    validate_certificate(
        runner,
        cwd=settings.root,
        cert_file=settings.cert_file,
        key_file=settings.key_file,
        domain=settings.turn_domain,
        min_validity_days=settings.min_validity_days,
    )
    prepare_livekit_config(settings)
    if validate_host:
        addresses = local_ipv4_addresses(runner, settings.root)
        validate_local_bind_addresses(settings, addresses)
        validate_dns(settings.turn_domain, settings.turn_bind_ip)
        validate_port_443_ownership(runner, settings)

    default_render = render_compose(runner, settings, overlay=False)
    assert_default_render(default_render)
    opt_in_render = render_compose(runner, settings, overlay=True)
    assert_opt_in_render(opt_in_render, settings)
    return default_render, opt_in_render
