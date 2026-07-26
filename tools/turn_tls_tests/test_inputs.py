# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class InputValidationTests(unittest.TestCase):
    def test_compose_version_boundary(self) -> None:
        self.assertEqual(turn_tls.validate_compose_version("Docker Compose version v2.24.4"), (2, 24, 4))
        with self.assertRaisesRegex(turn_tls.ValidationError, "2.24.4 or newer"):
            turn_tls.validate_compose_version("2.24.3")

    def test_requires_distinct_global_ipv4_addresses(self) -> None:
        self.assertEqual(turn_tls.validate_ipv4("WEB_BIND_IP", "8.8.8.8"), "8.8.8.8")
        for value in ("", "0.0.0.0", "127.0.0.1", "10.0.0.1", "2001:db8::1", "host.example"):
            with self.subTest(value=value), self.assertRaises(turn_tls.ValidationError):
                turn_tls.validate_ipv4("WEB_BIND_IP", value)

    def test_domain_rejects_shell_and_control_payloads(self) -> None:
        self.assertEqual(turn_tls.validate_domain("TURN.Example.COM."), "turn.example.com")
        for value in (
            "turn.example.com;id",
            "$(id).example.com",
            "turn example.com",
            "*.example.com",
            "turn.example.com\nSECOND=value",
            "localhost",
        ):
            with self.subTest(value=value), self.assertRaises(turn_tls.ValidationError):
                turn_tls.validate_domain(value)

    def test_dns_must_resolve_only_to_dedicated_address(self) -> None:
        result = turn_tls.validate_dns(
            "turn.example.com",
            "8.8.8.8",
            resolver=lambda _: {"8.8.8.8"},
        )
        self.assertEqual(result, {"8.8.8.8"})
        for answers in ({"1.1.1.1"}, {"8.8.8.8", "1.1.1.1"}, set()):
            with self.subTest(answers=answers), self.assertRaisesRegex(
                turn_tls.ValidationError,
                "must resolve only",
            ):
                turn_tls.validate_dns(
                    "turn.example.com",
                    "8.8.8.8",
                    resolver=lambda _, values=answers: values,
                )

    def test_load_settings_rejects_missing_and_equal_addresses(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n")
            (root / "compose.turn-tls.yml").write_text("services: {}\n")
            (root / "livekit.yaml").write_text(BASE_LIVEKIT)
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic")
            key.write_text("synthetic")
            key.chmod(0o640)
            if key.stat().st_gid == 0:
                os.chown(key, -1, TEST_GID)
            env = {
                "TURN_DOMAIN": "turn.example.test",
                "TURN_CERT_FILE": str(cert),
                "TURN_KEY_FILE": str(key),
            }
            with self.assertRaisesRegex(turn_tls.ValidationError, "WEB_BIND_IP is required"):
                turn_tls.load_settings(root, env, require_global_ips=False)
            env.update({"WEB_BIND_IP": "192.0.2.10", "TURN_BIND_IP": "192.0.2.10"})
            with self.assertRaisesRegex(turn_tls.ValidationError, "must be different"):
                turn_tls.load_settings(root, env, require_global_ips=False)

    def test_each_public_input_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n", encoding="utf-8")
            (root / "compose.turn-tls.yml").write_text("services: {}\n", encoding="utf-8")
            (root / "livekit.yaml").write_text(BASE_LIVEKIT, encoding="utf-8")
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic", encoding="utf-8")
            key.write_text("synthetic", encoding="utf-8")
            cert.chmod(0o644)
            key.chmod(0o640)
            if key.stat().st_gid == 0:
                os.chown(key, -1, TEST_GID)
            complete = {
                "WEB_BIND_IP": "192.0.2.10",
                "TURN_BIND_IP": "192.0.2.11",
                "TURN_DOMAIN": "turn.example.test",
                "TURN_CERT_FILE": str(cert),
                "TURN_KEY_FILE": str(key),
            }
            for name in complete:
                env = dict(complete)
                env.pop(name)
                with self.subTest(name=name), self.assertRaisesRegex(
                    turn_tls.ValidationError, f"{name} is required"
                ):
                    turn_tls.load_settings(root, env, require_global_ips=False)

    def test_rejects_bind_address_not_present_on_host(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic")
            key.write_text("synthetic")
            settings = fixture_settings(root, cert, key)
            with self.assertRaisesRegex(turn_tls.ValidationError, "TURN_BIND_IP is not configured"):
                turn_tls.validate_local_bind_addresses(settings, {settings.web_bind_ip})

    def test_key_permissions_allow_only_owner_and_dedicated_group_read(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            key = Path(temp) / "key.pem"
            key.write_text("synthetic", encoding="utf-8")
            for mode in (0o644, 0o660, 0o650, 0o740):
                key.chmod(mode)
                with self.subTest(mode=oct(mode)), self.assertRaisesRegex(
                    turn_tls.ValidationError, "too broad"
                ):
                    turn_tls.validate_key_permissions(key)
            key.chmod(0o640)
            if key.stat().st_gid == 0:
                os.chown(key, -1, TEST_GID)
            self.assertEqual(turn_tls.validate_key_permissions(key), TEST_GID)

    def test_certificate_must_not_be_world_writable(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            certificate = Path(temp) / "cert.pem"
            certificate.write_text("synthetic", encoding="utf-8")
            certificate.chmod(0o664)
            with self.assertRaisesRegex(turn_tls.ValidationError, "remove group and other write access"):
                turn_tls.validate_certificate_permissions(certificate, TEST_GID)

    def test_paths_reject_compose_separator_and_control_characters(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cert.pem"
            path.write_text("synthetic", encoding="utf-8")
            self.assertEqual(turn_tls.validate_path_input("TURN_CERT_FILE", str(path)), path.resolve())
            with self.assertRaisesRegex(turn_tls.ValidationError, "must not contain ':'"):
                turn_tls.validate_path_input("TURN_CERT_FILE", f"{path}:ro")

    def test_generated_config_must_stay_in_private_profile_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(
                turn_tls.output_config_path(root, {}),
                (root / ".turn-tls" / "livekit.yaml").resolve(),
            )
            with self.assertRaisesRegex(turn_tls.ValidationError, "must stay inside"):
                turn_tls.output_config_path(
                    root,
                    {"TURN_LIVEKIT_CONFIG_FILE": str(root / "outside.yaml")},
                )
            (root / ".turn-tls").symlink_to(root / "other", target_is_directory=True)
            with self.assertRaisesRegex(turn_tls.ValidationError, "must not be a symlink"):
                turn_tls.output_config_path(root, {})
