# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: Apache-2.0

from .common import *

class CertificateTests(unittest.TestCase):
    def setUp(self) -> None:
        if not shutil_which("openssl"):
            self.skipTest("openssl is unavailable")

    def create_certificate(self, directory: Path, name: str, san: str, days: int = 30) -> tuple[Path, Path]:
        key = directory / f"{name}.key"
        cert = directory / f"{name}.crt"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                str(days),
                "-subj",
                f"/CN={san}",
                "-addext",
                f"subjectAltName=DNS:{san}",
                "-keyout",
                str(key),
                "-out",
                str(cert),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        key.chmod(0o640)
        cert.chmod(0o644)
        return cert, key

    def test_valid_certificate_and_matching_key(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert, key = self.create_certificate(root, "valid", "turn.example.test")
            turn_tls.validate_certificate(
                turn_tls.Runner(),
                cwd=root,
                cert_file=cert,
                key_file=key,
                domain="turn.example.test",
                min_validity_days=14,
                trust_ca_file=cert,
            )

    def test_rejects_self_signed_certificate_without_explicit_test_trust(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert, key = self.create_certificate(root, "untrusted", "turn.example.test")
            with self.assertRaises(turn_tls.ValidationError):
                turn_tls.validate_certificate(
                    turn_tls.Runner(),
                    cwd=root,
                    cert_file=cert,
                    key_file=key,
                    domain="turn.example.test",
                    min_validity_days=14,
                )

    def test_rejects_bad_san_mismatched_key_and_near_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cert, key = self.create_certificate(root, "valid", "other.example.test")
            with self.assertRaises(turn_tls.ValidationError):
                turn_tls.validate_certificate(
                    turn_tls.Runner(),
                    cwd=root,
                    cert_file=cert,
                    key_file=key,
                    domain="turn.example.test",
                    min_validity_days=14,
                    trust_ca_file=cert,
                )

            cert_a, _ = self.create_certificate(root, "a", "turn.example.test")
            _, key_b = self.create_certificate(root, "b", "turn.example.test")
            with self.assertRaisesRegex(turn_tls.ValidationError, "does not match"):
                turn_tls.validate_certificate(
                    turn_tls.Runner(),
                    cwd=root,
                    cert_file=cert_a,
                    key_file=key_b,
                    domain="turn.example.test",
                    min_validity_days=1,
                    trust_ca_file=cert_a,
                )

            expiring_cert, expiring_key = self.create_certificate(root, "expiring", "turn.example.test", days=1)
            with self.assertRaises(turn_tls.ValidationError):
                turn_tls.validate_certificate(
                    turn_tls.Runner(),
                    cwd=root,
                    cert_file=expiring_cert,
                    key_file=expiring_key,
                    domain="turn.example.test",
                    min_validity_days=2,
                    trust_ca_file=expiring_cert,
                )
