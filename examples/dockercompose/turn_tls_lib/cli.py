# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Sequence

from .summary import *


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate, activate, or disable Towk's optional dedicated-address TURN/TLS profile."
    )
    parser.add_argument(
        "command",
        choices=("preflight", "render", "up", "disable"),
        help=(
            "preflight validates; render prints a redacted binding and hardening summary; "
            "up activates; disable restores the standard profile"
        ),
    )
    parser.add_argument(
        "--root",
        default=str(Path(__file__).resolve().parent.parent),
        help=argparse.SUPPRESS,
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = Path(args.root)
    runner = Runner()
    try:
        if args.command == "disable":
            # Disabling does not need DNS or certificate access, but Compose still
            # needs its ordinary .env values. Build only the paths and synthetic
            # overlay variables required to resolve the command shape.
            lock = deployment_lock(root)
            try:
                env = dict(os.environ)
                # Existing generated values are preferred only to satisfy overlay
                # interpolation if Compose inspects the project during readback.
                settings = load_disable_settings(root)
                restore_standard_profile(runner, settings)
            finally:
                lock.close()
            print("TURN/TLS profile disabled; the standard Compose profile is running.")
            return 0

        settings = load_settings(root, os.environ)
        lock = deployment_lock(root)
        try:
            _default_render, opt_in_render = static_preflight(runner, settings)
            if args.command == "preflight":
                print(json.dumps(redact_settings(settings), indent=2, sort_keys=True))
                print("TURN/TLS preflight passed; no containers were changed.")
                return 0
            if args.command == "render":
                print(json.dumps(safe_render_summary(opt_in_render, settings), indent=2, sort_keys=True))
                return 0
            activate_profile(runner, settings, opt_in_render)
        finally:
            lock.close()
        print("TURN/TLS profile is active and its TLS listener passed verification.")
        return 0
    except TurnTLSException as exc:
        print(f"TURN/TLS profile error: {exc}", file=sys.stderr)
        return 1
