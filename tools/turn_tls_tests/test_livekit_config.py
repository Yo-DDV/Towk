# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class LiveKitConfigurationTests(unittest.TestCase):
    def test_replaces_only_top_level_turn_section(self) -> None:
        rendered = turn_tls.render_livekit_config(BASE_LIVEKIT, "turn.example.test")
        self.assertEqual(rendered.count("\nturn:\n"), 1)
        self.assertIn("  tls_port: 443", rendered)
        self.assertIn("  external_tls: false", rendered)
        self.assertIn('  domain: "turn.example.test"', rendered)
        self.assertIn("  cert_file: /etc/livekit-certs/fullchain.pem", rendered)
        self.assertIn("test-secret-that-is-at-least-thirty-two-characters", rendered)
        self.assertIn("https://chat.example.test/webhooks/livekit", rendered)
        self.assertNotIn("tls_port: 443\n  tls_port: 443", rendered)

    def test_preserves_unmanaged_turn_permissions(self) -> None:
        source = BASE_LIVEKIT.replace(
            "  relay_range_end: 50400\n",
            "  relay_range_end: 50400\n  allow_restricted_peer_cidrs:\n    - 10.0.0.10/32\n",
        )
        rendered = turn_tls.render_livekit_config(source, "turn.example.test")
        self.assertIn("  allow_restricted_peer_cidrs:\n    - 10.0.0.10/32", rendered)
        self.assertEqual(rendered.count("allow_restricted_peer_cidrs"), 1)

    def test_appends_turn_section_when_absent(self) -> None:
        source = BASE_LIVEKIT.replace(
            "turn:\n  enabled: true\n  udp_port: 3478\n  relay_range_start: 50201\n  relay_range_end: 50400\n\n",
            "",
        )
        rendered = turn_tls.render_livekit_config(source, "turn.example.test")
        self.assertIn("turn:\n  enabled: true", rendered)
        self.assertTrue(rendered.endswith("key_file: /etc/livekit-certs/privkey.pem\n"))

    def test_refuses_unknown_single_node_contract(self) -> None:
        with self.assertRaisesRegex(turn_tls.ValidationError, "missing rtc.tcp_port"):
            turn_tls.render_livekit_config(BASE_LIVEKIT.replace("  tcp_port: 7881\n", ""), "turn.example.test")

    def test_atomic_output_is_group_readable_but_not_world_readable(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "state" / "livekit.yaml"
            turn_tls.atomic_write_private(target, "secret: synthetic\n", TEST_GID)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
            self.assertEqual(target.stat().st_gid, TEST_GID)
            self.assertEqual(target.read_text(encoding="utf-8"), "secret: synthetic\n")
