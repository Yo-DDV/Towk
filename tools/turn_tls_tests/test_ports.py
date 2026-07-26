# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class PortOwnershipTests(unittest.TestCase):
    def test_listener_address_parser(self) -> None:
        self.assertEqual(turn_tls.listener_ip("0.0.0.0:443"), "0.0.0.0")
        self.assertEqual(turn_tls.listener_ip("198.51.100.10:443"), "198.51.100.10")
        self.assertEqual(turn_tls.listener_ip("[::]:443"), "::")
        self.assertTrue(turn_tls.binding_covers_listener("0.0.0.0", "198.51.100.10"))
        self.assertFalse(turn_tls.binding_covers_listener("198.51.100.10", "0.0.0.0"))

    def test_rejects_external_container_and_uncovered_host_listener(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic")
            key.write_text("synthetic")
            settings = fixture_settings(root, cert, key)
            external = {
                "Id": "external-id",
                "Name": "/other-proxy",
                "HostConfig": {"PortBindings": {"443/tcp": [{"HostIp": "0.0.0.0", "HostPort": "443"}]}},
            }
            with (
                mock.patch.object(containers_impl, "compose_service_ids", return_value=set()),
                mock.patch.object(containers_impl, "all_running_container_ids", return_value={"external-id"}),
                mock.patch.object(containers_impl, "inspect_containers", return_value=[external]),
            ):
                with self.assertRaisesRegex(turn_tls.ValidationError, "outside this Compose stack"):
                    turn_tls.validate_port_443_ownership(object(), settings)

            with (
                mock.patch.object(containers_impl, "compose_service_ids", return_value=set()),
                mock.patch.object(containers_impl, "all_running_container_ids", return_value=set()),
                mock.patch.object(containers_impl, "inspect_containers", return_value=[]),
                mock.patch.object(containers_impl, "active_tcp443_listener_ips", return_value={settings.turn_bind_ip}),
            ):
                with self.assertRaisesRegex(turn_tls.ValidationError, "already occupied"):
                    turn_tls.validate_port_443_ownership(object(), settings)

    def test_accepts_current_stack_wildcard_listener_for_staged_transition(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic")
            key.write_text("synthetic")
            settings = fixture_settings(root, cert, key)
            caddy = {
                "Id": "caddy-id",
                "Name": "/towk-caddy-1",
                "HostConfig": {"PortBindings": {"443/tcp": [{"HostIp": "0.0.0.0", "HostPort": "443"}]}},
            }
            with (
                mock.patch.object(containers_impl, "compose_service_ids", return_value={"caddy-id"}),
                mock.patch.object(containers_impl, "all_running_container_ids", return_value={"caddy-id"}),
                mock.patch.object(containers_impl, "inspect_containers", return_value=[caddy]),
                mock.patch.object(containers_impl, "active_tcp443_listener_ips", return_value={"0.0.0.0"}),
            ):
                turn_tls.validate_port_443_ownership(object(), settings)

    def test_ignores_external_listener_bound_to_unrelated_address(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert = root / "cert.pem"
            key = root / "key.pem"
            cert.write_text("synthetic")
            key.write_text("synthetic")
            settings = fixture_settings(root, cert, key)
            external = {
                "Id": "external-id",
                "Name": "/other-proxy",
                "HostConfig": {
                    "PortBindings": {
                        "443/tcp": [{"HostIp": "192.0.2.12", "HostPort": "443"}],
                    },
                },
            }
            with (
                mock.patch.object(containers_impl, "compose_service_ids", return_value=set()),
                mock.patch.object(containers_impl, "all_running_container_ids", return_value={"external-id"}),
                mock.patch.object(containers_impl, "inspect_containers", return_value=[external]),
                mock.patch.object(
                    containers_impl,
                    "active_tcp443_listener_ips",
                    return_value={"192.0.2.12"},
                ),
            ):
                turn_tls.validate_port_443_ownership(object(), settings)

    def test_extracts_only_tcp_443_bindings(self) -> None:
        container = {
            "HostConfig": {
                "PortBindings": {
                    "443/tcp": [{"HostIp": "198.51.100.10", "HostPort": "443"}],
                    "443/udp": [{"HostIp": "198.51.100.10", "HostPort": "443"}],
                }
            }
        }
        self.assertEqual(turn_tls.published_tcp443_bindings(container), {"198.51.100.10"})
