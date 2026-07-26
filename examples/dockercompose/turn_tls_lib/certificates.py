# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import hashlib
import json
import socket
import tempfile
from pathlib import Path
from typing import Sequence

from .validation import *


def openssl_bytes(
    runner: Runner,
    args: Sequence[str],
    *,
    cwd: Path,
    input_bytes: bytes | None = None,
) -> bytes:
    result = runner.run(
        ["openssl", *args],
        cwd=cwd,
        input_bytes=input_bytes,
        check=True,
        timeout=20,
    )
    return result.stdout


def validate_public_certificate_chain(
    runner: Runner,
    *,
    cwd: Path,
    cert_file: Path,
    domain: str,
    trust_ca_file: Path | None = None,
) -> None:
    blocks = PEM_CERT_RE.findall(cert_file.read_bytes())
    if not blocks:
        raise ValidationError("TURN_CERT_FILE does not contain a PEM certificate")
    with tempfile.TemporaryDirectory(prefix="towk-turn-cert-") as temp:
        temp_path = Path(temp)
        leaf = temp_path / "leaf.pem"
        leaf.write_bytes(blocks[0] + b"\n")
        command = [
            "openssl",
            "verify",
            "-purpose",
            "sslserver",
            "-verify_hostname",
            domain,
        ]
        if trust_ca_file is not None:
            command.extend(["-CAfile", str(trust_ca_file)])
        if len(blocks) > 1:
            chain = temp_path / "chain.pem"
            chain.write_bytes(b"\n".join(blocks[1:]) + b"\n")
            command.extend(["-untrusted", str(chain)])
        command.append(str(leaf))
        runner.run(command, cwd=cwd, timeout=20)


def validate_certificate(
    runner: Runner,
    *,
    cwd: Path,
    cert_file: Path,
    key_file: Path,
    domain: str,
    min_validity_days: int,
    trust_ca_file: Path | None = None,
) -> None:
    seconds = min_validity_days * 24 * 60 * 60
    runner.run(
        ["openssl", "x509", "-in", str(cert_file), "-noout", "-checkend", str(seconds)],
        cwd=cwd,
        timeout=20,
    )
    runner.run(
        ["openssl", "x509", "-in", str(cert_file), "-noout", "-checkhost", domain],
        cwd=cwd,
        timeout=20,
    )
    validate_public_certificate_chain(
        runner,
        cwd=cwd,
        cert_file=cert_file,
        domain=domain,
        trust_ca_file=trust_ca_file,
    )

    cert_pem = openssl_bytes(
        runner,
        ["x509", "-in", str(cert_file), "-pubkey", "-noout"],
        cwd=cwd,
    )
    cert_der = openssl_bytes(runner, ["pkey", "-pubin", "-outform", "DER"], cwd=cwd, input_bytes=cert_pem)
    key_der = openssl_bytes(
        runner,
        [
            "pkey",
            "-in",
            str(key_file),
            "-passin",
            "pass:",
            "-pubout",
            "-outform",
            "DER",
        ],
        cwd=cwd,
    )
    if hashlib.sha256(cert_der).digest() != hashlib.sha256(key_der).digest():
        raise ValidationError("TURN_KEY_FILE does not match TURN_CERT_FILE")


def local_ipv4_addresses(runner: Runner, root: Path) -> set[str]:
    result = runner.run(["ip", "-json", "-4", "address", "show"], cwd=root, timeout=15)
    try:
        interfaces = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValidationError("Could not parse local IPv4 addresses from iproute2") from exc
    addresses: set[str] = set()
    for interface in interfaces:
        for info in interface.get("addr_info", []):
            flags = set(info.get("flags", []) or [])
            if (
                info.get("family") == "inet"
                and info.get("scope") == "global"
                and "tentative" not in flags
                and isinstance(info.get("local"), str)
            ):
                addresses.add(info["local"])
    return addresses


def validate_local_bind_addresses(settings: Settings, addresses: set[str]) -> None:
    for name, value in (
        ("WEB_BIND_IP", settings.web_bind_ip),
        ("TURN_BIND_IP", settings.turn_bind_ip),
    ):
        if value not in addresses:
            raise ValidationError(f"{name} is not configured on this host: {value}")


def resolve_ipv4(domain: str) -> set[str]:
    try:
        answers = socket.getaddrinfo(domain, 443, socket.AF_INET, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValidationError(f"TURN_DOMAIN did not resolve through the host resolver: {domain}") from exc
    return {item[4][0] for item in answers}


def validate_dns(domain: str, expected_ip: str, resolver=resolve_ipv4) -> set[str]:
    answers = resolver(domain)
    if answers != {expected_ip}:
        rendered = ", ".join(sorted(answers)) if answers else "no IPv4 answers"
        raise ValidationError(
            f"TURN_DOMAIN must resolve only to TURN_BIND_IP {expected_ip}; resolver returned {rendered}"
        )
    return answers
