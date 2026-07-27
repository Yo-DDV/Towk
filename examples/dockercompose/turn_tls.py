#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0
"""Safe activation helper for Towk's optional dedicated-address TURN/TLS profile."""

from __future__ import annotations

import sys
from pathlib import Path

# importlib-based tests load this file directly, so ensure the adjacent package is
# available without relying on the caller's current working directory.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from turn_tls_lib.cli import *  # noqa: F401,F403,E402


if __name__ == "__main__":
    raise SystemExit(main())
