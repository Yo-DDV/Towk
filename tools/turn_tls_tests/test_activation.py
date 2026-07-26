# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class ActivationFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        cert = root / "cert.pem"
        key = root / "key.pem"
        cert.write_text("synthetic", encoding="utf-8")
        key.write_text("synthetic", encoding="utf-8")
        key.chmod(0o640)
        self.settings = fixture_settings(root, cert, key)
        self.default = {"services": {}}
        self.opt_in = {"services": {"caddy": {"environment": {"PUBLIC_URL": "chat.example.test"}}}}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_existing_stack_moves_caddy_before_livekit(self) -> None:
        events: list[str] = []

        def record_up(_runner, _settings, *, overlay, services=(), no_deps=False, force_recreate=False):
            events.append(f"up:{overlay}:{','.join(services) or 'all'}")

        with (
            mock.patch.object(deployment_impl, "service_running", side_effect=[True]),
            mock.patch.object(deployment_impl, "compose_up", side_effect=record_up),
            mock.patch.object(deployment_impl, "wait_service", side_effect=lambda *a, **k: events.append(f"wait:{a[2]}")),
            mock.patch.object(deployment_impl, "verify_https", side_effect=lambda *a, **k: events.append("https")),
            mock.patch.object(deployment_impl, "verify_turn_tls", side_effect=lambda *a, **k: events.append("tls")),
        ):
            turn_tls.activate_profile(object(), self.settings, self.opt_in)

        self.assertEqual(
            events,
            [
                "up:True:caddy",
                "wait:caddy",
                "https",
                "up:True:livekit",
                "wait:livekit",
                "tls",
                "up:True:all",
            ],
        )

    def test_failure_restores_standard_profile(self) -> None:
        with (
            mock.patch.object(deployment_impl, "service_running", return_value=True),
            mock.patch.object(deployment_impl, "compose_up"),
            mock.patch.object(deployment_impl, "wait_service"),
            mock.patch.object(deployment_impl, "verify_https"),
            mock.patch.object(deployment_impl, "verify_turn_tls", side_effect=turn_tls.ValidationError("synthetic failure")),
            mock.patch.object(deployment_impl, "restore_standard_profile") as rollback,
        ):
            with self.assertRaisesRegex(turn_tls.ValidationError, "standard profile was restored"):
                turn_tls.activate_profile(object(), self.settings, self.opt_in)
        rollback.assert_called_once()

    def test_rollback_orders_livekit_before_caddy(self) -> None:
        events: list[str] = []

        def record_up(_runner, _settings, *, overlay, services=(), no_deps=False, force_recreate=False):
            events.append(f"up:{','.join(services) or 'all'}")

        with (
            mock.patch.object(deployment_impl, "compose_up", side_effect=record_up),
            mock.patch.object(deployment_impl, "wait_service", side_effect=lambda *a, **k: events.append(f"wait:{a[2]}")),
        ):
            turn_tls.restore_standard_profile(object(), self.settings)
        self.assertEqual(events[:4], ["up:livekit", "wait:livekit", "up:caddy", "wait:caddy"])
        self.assertEqual(events[-1], "up:all")
