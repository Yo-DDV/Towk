package natsauth_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"hmans.de/chatto/pkg/natsauth"
)

func TestConnectOptions_TransportSecurity(t *testing.T) {
	tests := []struct {
		name      string
		serverURL string
		caCert    string
		insecure  bool
		wantErr   string
	}{
		{name: "empty URL preserves option-only callers"},
		{name: "loopback IPv4 may use plaintext", serverURL: "nats://127.0.0.1:4222"},
		{name: "loopback IPv6 may use plaintext", serverURL: "nats://[::1]:4222"},
		{name: "loopback without scheme may use plaintext", serverURL: "localhost:4222"},
		{name: "localhost may use plaintext", serverURL: "ws://LOCALHOST.:8080"},
		{name: "TLS scheme uses system roots", serverURL: "tls://nats.example.com:4222"},
		{name: "secure websocket uses system roots", serverURL: "wss://nats.example.com:443"},
		{name: "custom CA forces TLS", serverURL: "nats://nats.internal:4222", caCert: makeCAPEM(t)},
		{name: "explicit override allows isolated plaintext network", serverURL: "nats://nats:4222", insecure: true},
		{name: "mixed secure and loopback endpoints", serverURL: "tls://nats.example.com:4222,nats://127.0.0.1:4222"},
		{name: "external plaintext rejected", serverURL: "nats://nats.example.com:4222", wantErr: "refusing plaintext NATS connection"},
		{name: "private address is not implicitly trusted", serverURL: "nats://10.0.0.4:4222", wantErr: "refusing plaintext NATS connection"},
		{name: "mixed pool with external plaintext rejected", serverURL: "tls://nats.example.com:4222,nats://fallback.example.com:4222", wantErr: "refusing plaintext NATS connection"},
		{name: "unsupported scheme rejected", serverURL: "http://nats.example.com:4222", wantErr: "unsupported NATS URL scheme"},
		{name: "custom CA does not excuse unsupported scheme", serverURL: "http://nats.example.com:4222", caCert: makeCAPEM(t), wantErr: "unsupported NATS URL scheme"},
		{name: "override does not excuse malformed URL", serverURL: "nats://bad host:4222", insecure: true, wantErr: "invalid server URL"},
		{name: "missing host rejected", serverURL: "nats://", wantErr: "missing host"},
		{name: "secure missing host rejected", serverURL: "tls://", wantErr: "missing host"},
		{name: "empty pool entry rejected", serverURL: "nats://127.0.0.1:4222, ", wantErr: "empty server URL"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := natsauth.ConnectOptions(natsauth.Config{
				ServerURL:     tt.serverURL,
				CACert:        tt.caCert,
				AllowInsecure: tt.insecure,
			})
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("ConnectOptions() unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("ConnectOptions() error = %v, want %q", err, tt.wantErr)
			}
		})
	}
}

func TestConnectOptions_TransportErrorDoesNotEchoCredentials(t *testing.T) {
	const secret = "do-not-log-this"
	_, err := natsauth.ConnectOptions(natsauth.Config{
		ServerURL: "nats://operator:" + secret + "@[::1",
	})
	if err == nil {
		t.Fatal("ConnectOptions() expected malformed URL error")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("ConnectOptions() error exposed URL credentials: %v", err)
	}
}

func TestConnectOptions(t *testing.T) {
	t.Run("none method returns no options", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{AuthMethod: natsauth.AuthNone})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 0 {
			t.Errorf("expected no options, got %d", len(opts))
		}
	})

	t.Run("empty method returns no options", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 0 {
			t.Errorf("expected no options, got %d", len(opts))
		}
	})

	t.Run("token method requires token", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{AuthMethod: natsauth.AuthToken})
		if err == nil {
			t.Fatal("expected error for missing token")
		}
	})

	t.Run("token method returns option", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthToken,
			Token:      "my-secret-token",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 1 {
			t.Errorf("expected 1 option, got %d", len(opts))
		}
	})

	t.Run("userpass method requires username", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthUserPass,
			Password:   "secret",
		})
		if err == nil {
			t.Fatal("expected error for missing username")
		}
	})

	t.Run("userpass method returns option", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthUserPass,
			Username:   "user",
			Password:   "pass",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 1 {
			t.Errorf("expected 1 option, got %d", len(opts))
		}
	})

	t.Run("credentials method requires file", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{AuthMethod: natsauth.AuthCredentials})
		if err == nil {
			t.Fatal("expected error for missing credentials file")
		}
	})

	t.Run("credentials method returns option", func(t *testing.T) {
		tmpDir := t.TempDir()
		credsFile := filepath.Join(tmpDir, "test.creds")
		if err := os.WriteFile(credsFile, []byte("dummy"), 0600); err != nil {
			t.Fatal(err)
		}

		opts, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod:      natsauth.AuthCredentials,
			CredentialsFile: credsFile,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 1 {
			t.Errorf("expected 1 option, got %d", len(opts))
		}
	})

	t.Run("nkey method requires seed", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{AuthMethod: natsauth.AuthNKey})
		if err == nil {
			t.Fatal("expected error for missing nkey seed")
		}
	})

	t.Run("nkey method with valid seed", func(t *testing.T) {
		seed, _, err := natsauth.GenerateUserNKey()
		if err != nil {
			t.Fatalf("failed to generate nkey: %v", err)
		}

		opts, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthNKey,
			NKeySeed:   seed,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 1 {
			t.Errorf("expected 1 option, got %d", len(opts))
		}
	})

	t.Run("nkey method with invalid seed", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthNKey,
			NKeySeed:   "invalid-seed",
		})
		if err == nil {
			t.Fatal("expected error for invalid nkey seed")
		}
	})

	t.Run("unknown method returns error", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{AuthMethod: "unknown"})
		if err == nil {
			t.Fatal("expected error for unknown method")
		}
	})

	t.Run("ca cert with token method returns auth + tls options", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{
			AuthMethod: natsauth.AuthToken,
			Token:      "tok",
			CACert:     makeCAPEM(t),
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 2 {
			t.Errorf("expected 2 options (auth + tls), got %d", len(opts))
		}
	})

	t.Run("ca cert without auth returns tls option only", func(t *testing.T) {
		opts, err := natsauth.ConnectOptions(natsauth.Config{
			CACert: makeCAPEM(t),
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(opts) != 1 {
			t.Errorf("expected 1 option (tls only), got %d", len(opts))
		}
		connectionOptions := nats.GetDefaultOptions()
		for _, opt := range opts {
			if err := opt(&connectionOptions); err != nil {
				t.Fatalf("apply connection option: %v", err)
			}
		}
		if !connectionOptions.Secure || connectionOptions.TLSConfig == nil {
			t.Fatal("custom CA option did not enable TLS")
		}
		if connectionOptions.TLSConfig.MinVersion != tls.VersionTLS12 {
			t.Fatalf("TLS minimum = %x, want TLS 1.2", connectionOptions.TLSConfig.MinVersion)
		}
		if connectionOptions.TLSConfig.RootCAs == nil {
			t.Fatal("custom CA option did not install a root pool")
		}
	})

	t.Run("invalid ca cert pem returns error", func(t *testing.T) {
		_, err := natsauth.ConnectOptions(natsauth.Config{
			CACert: "not a real pem",
		})
		if err == nil {
			t.Fatal("expected error for invalid PEM")
		}
	})
}

// makeCAPEM returns a self-signed PEM-encoded CA certificate for use in TLS tests.
// AppendCertsFromPEM only does basic PEM-decode + ASN.1 parsing, so the cert's
// trust chain / expiry is irrelevant here — we're testing that natsauth wires
// the CA into a nats.Secure option, not that TLS actually validates against it.
func makeCAPEM(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func TestGenerateUserNKey(t *testing.T) {
	seed, pubKey, err := natsauth.GenerateUserNKey()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(seed) < 2 || seed[:2] != "SU" {
		t.Errorf("seed should start with SU, got %q", seed[:2])
	}

	if len(pubKey) < 1 || pubKey[0] != 'U' {
		t.Errorf("public key should start with U, got %q", string(pubKey[0]))
	}
}

func TestPublicKeyFromSeed(t *testing.T) {
	t.Run("valid seed round-trips", func(t *testing.T) {
		seed, expectedPub, err := natsauth.GenerateUserNKey()
		if err != nil {
			t.Fatalf("failed to generate nkey: %v", err)
		}

		pubKey, err := natsauth.PublicKeyFromSeed(seed)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if pubKey != expectedPub {
			t.Errorf("public key mismatch: got %q, want %q", pubKey, expectedPub)
		}
	})

	t.Run("empty seed returns error", func(t *testing.T) {
		_, err := natsauth.PublicKeyFromSeed("")
		if err == nil {
			t.Fatal("expected error for empty seed")
		}
	})

	t.Run("garbage seed returns error", func(t *testing.T) {
		_, err := natsauth.PublicKeyFromSeed("not-a-valid-nkey-seed")
		if err == nil {
			t.Fatal("expected error for garbage seed")
		}
	})

	t.Run("truncated seed returns error", func(t *testing.T) {
		seed, _, err := natsauth.GenerateUserNKey()
		if err != nil {
			t.Fatalf("failed to generate nkey: %v", err)
		}
		// Truncate to half length
		_, err = natsauth.PublicKeyFromSeed(seed[:len(seed)/2])
		if err == nil {
			t.Fatal("expected error for truncated seed")
		}
	})
}

func TestGenerateUserNKey_Uniqueness(t *testing.T) {
	seed1, pub1, err := natsauth.GenerateUserNKey()
	if err != nil {
		t.Fatalf("first generation failed: %v", err)
	}

	seed2, pub2, err := natsauth.GenerateUserNKey()
	if err != nil {
		t.Fatalf("second generation failed: %v", err)
	}

	if seed1 == seed2 {
		t.Error("two generated seeds should be different")
	}
	if pub1 == pub2 {
		t.Error("two generated public keys should be different")
	}
}
