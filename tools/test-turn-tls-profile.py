#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0
"""Run the deterministic TURN/TLS profile regression suite."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from turn_tls_tests import (
    test_activation,
    test_certificates,
    test_compose,
    test_inputs,
    test_livekit_config,
    test_ports,
)


def main() -> int:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite(
        loader.loadTestsFromModule(module)
        for module in (
            test_activation,
            test_certificates,
            test_compose,
            test_inputs,
            test_livekit_config,
            test_ports,
        )
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
