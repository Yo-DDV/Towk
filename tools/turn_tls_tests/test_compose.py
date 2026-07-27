# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class ComposeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cert = self.root / "cert.pem"
        self.key = self.root / "key.pem"
        self.cert.write_text("synthetic", encoding="utf-8")
        self.key.write_text("synthetic", encoding="utf-8")
        self.key.chmod(0o640)
        self.settings = fixture_settings(self.root, self.cert, self.key)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_default_render_has_no_tls_listener_mount_or_capability(self) -> None:
        config = {
            "services": {
                "livekit": {
                    "ports": [
                        port("0.0.0.0", 50000, "50000-50200", "udp"),
                        port("0.0.0.0", 50201, "50201-50400", "udp"),
                        port("0.0.0.0", 7881, 7881),
                        port("0.0.0.0", 3478, 3478, "udp"),
                    ],
                    "cap_add": [],
                    "volumes": [
                        {
                            "type": "bind",
                            "source": str(self.settings.source_config),
                            "target": "/etc/livekit.yaml",
                            "read_only": True,
                        }
                    ],
                }
            }
        }
        turn_tls.assert_default_render(config)
        config["services"]["livekit"]["ports"].append(port("0.0.0.0", 443, 443))
        with self.assertRaisesRegex(turn_tls.ValidationError, "unexpectedly publishes"):
            turn_tls.assert_default_render(config)

    def test_valid_opt_in_render_has_exact_bindings_and_hardening(self) -> None:
        config = opt_in_render(self.settings)
        turn_tls.assert_opt_in_render(config, self.settings)

    def test_render_summary_omits_service_secrets_and_private_key_path(self) -> None:
        config = opt_in_render(self.settings)
        config["services"]["towk"] = {"environment": {"SYNTHETIC_SECRET": "must-not-appear"}}
        rendered = json.dumps(turn_tls.safe_render_summary(config, self.settings), sort_keys=True)
        self.assertNotIn("must-not-appear", rendered)
        self.assertNotIn(str(self.settings.key_file), rendered)
        self.assertIn("operator private key (path redacted)", rendered)

        preflight = json.dumps(turn_tls.redact_settings(self.settings), sort_keys=True)
        self.assertNotIn(str(self.settings.cert_file), preflight)
        self.assertNotIn(str(self.settings.key_file), preflight)
        self.assertIn("publicly trusted", preflight)

    def test_rejects_wildcard_or_extra_tcp_443_binding(self) -> None:
        config = opt_in_render(self.settings)
        config["services"]["livekit"]["ports"].append(port("0.0.0.0", 443, 443))
        with self.assertRaisesRegex(turn_tls.ValidationError, "exact direct UDP"):
            turn_tls.assert_opt_in_render(config, self.settings)

    def test_rejects_missing_key_mount_or_excess_capability(self) -> None:
        config = opt_in_render(self.settings)
        config["services"]["livekit"]["volumes"].pop()
        with self.assertRaisesRegex(turn_tls.ValidationError, "privkey.pem"):
            turn_tls.assert_opt_in_render(config, self.settings)

        config = opt_in_render(self.settings)
        config["services"]["livekit"]["cap_add"].append("NET_ADMIN")
        with self.assertRaisesRegex(turn_tls.ValidationError, "only NET_BIND_SERVICE"):
            turn_tls.assert_opt_in_render(config, self.settings)
