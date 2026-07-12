// Package natsauth provides authentication option builders for NATS connections.
// It supports token, username/password, credentials file, and NKey authentication,
// plus optional TLS with a custom CA.
package natsauth

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

// AuthMethod defines how to authenticate with NATS.
type AuthMethod string

const (
	AuthNone        AuthMethod = "none"        // No authentication
	AuthToken       AuthMethod = "token"       // Simple bearer token
	AuthUserPass    AuthMethod = "userpass"    // Username/password
	AuthCredentials AuthMethod = "credentials" // JWT credentials file
	AuthNKey        AuthMethod = "nkey"        // NKey seed
)

// Config holds the parameters needed to build NATS authentication + TLS options.
type Config struct {
	// ServerURL is the comma-separated NATS server pool passed to nats.Connect.
	// When set, ConnectOptions rejects plaintext non-loopback endpoints unless
	// AllowInsecure explicitly opts into that risk.
	ServerURL string

	AuthMethod      AuthMethod
	Token           string
	Username        string
	Password        string
	CredentialsFile string
	NKeySeed        string

	// CACert is a PEM-encoded CA certificate used to verify the NATS server's
	// TLS certificate. When non-empty, a nats.Secure option is added to the
	// connection. When empty, no TLS option is added — the connection uses
	// system defaults (which kick in automatically if the URL is tls://).
	CACert string

	// AllowInsecure permits plaintext connections to non-loopback endpoints.
	// It should only be used on an isolated, trusted network because NATS
	// credentials and application data otherwise cross the network unencrypted.
	AllowInsecure bool
}

// ConnectOptions returns NATS connection options for the given auth + TLS configuration.
func ConnectOptions(cfg Config) ([]nats.Option, error) {
	if err := ValidateTransportSecurity(cfg); err != nil {
		return nil, err
	}

	opts, err := authOptions(cfg)
	if err != nil {
		return nil, err
	}

	if cfg.CACert != "" {
		tlsOpt, err := tlsOption(cfg.CACert)
		if err != nil {
			return nil, err
		}
		opts = append(opts, tlsOpt)
	}

	return opts, nil
}

// ValidateTransportSecurity rejects plaintext NATS connections to non-loopback
// endpoints unless the operator explicitly opted into that risk. A custom CA
// causes nats.Secure to protect the whole server pool, including nats:// URLs.
func ValidateTransportSecurity(cfg Config) error {
	if strings.TrimSpace(cfg.ServerURL) == "" {
		return nil
	}

	for i, raw := range strings.Split(cfg.ServerURL, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return fmt.Errorf("nats transport: empty server URL at position %d", i+1)
		}

		candidate := raw
		if !strings.Contains(candidate, "://") {
			candidate = "nats://" + candidate
		}
		u, err := url.Parse(candidate)
		if err != nil {
			return fmt.Errorf("nats transport: invalid server URL at position %d", i+1)
		}

		host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
		if host == "" {
			return fmt.Errorf("nats transport: missing host at position %d", i+1)
		}

		scheme := strings.ToLower(u.Scheme)
		switch scheme {
		case "tls", "wss":
			continue
		case "nats", "ws":
		default:
			return fmt.Errorf("nats transport: unsupported NATS URL scheme %q at position %d", scheme, i+1)
		}

		if cfg.CACert != "" || cfg.AllowInsecure {
			continue
		}
		if host == "localhost" {
			continue
		}
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			continue
		}

		return fmt.Errorf("nats transport: refusing plaintext NATS connection to a non-loopback endpoint; use tls:// or wss://, configure nats.client.ca_cert, or set nats.client.allow_insecure = true only for an isolated trusted network")
	}

	return nil
}

// authOptions returns the auth-method-specific connection options.
func authOptions(cfg Config) ([]nats.Option, error) {
	switch cfg.AuthMethod {
	case AuthNone, "":
		return nil, nil

	case AuthToken:
		if cfg.Token == "" {
			return nil, fmt.Errorf("nats auth: token is required for token method")
		}
		return []nats.Option{nats.Token(cfg.Token)}, nil

	case AuthUserPass:
		if cfg.Username == "" {
			return nil, fmt.Errorf("nats auth: username is required for userpass method")
		}
		return []nats.Option{nats.UserInfo(cfg.Username, cfg.Password)}, nil

	case AuthCredentials:
		if cfg.CredentialsFile == "" {
			return nil, fmt.Errorf("nats auth: credentials_file is required for credentials method")
		}
		return []nats.Option{nats.UserCredentials(cfg.CredentialsFile)}, nil

	case AuthNKey:
		if cfg.NKeySeed == "" {
			return nil, fmt.Errorf("nats auth: nkey_seed is required for nkey method")
		}
		opt, err := nkeyOption(cfg.NKeySeed)
		if err != nil {
			return nil, err
		}
		return []nats.Option{opt}, nil

	default:
		return nil, fmt.Errorf("nats auth: unknown method %q", cfg.AuthMethod)
	}
}

// tlsOption builds a nats.Secure option from a PEM-encoded CA certificate.
func tlsOption(caPEM string) (nats.Option, error) {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(caPEM)) {
		return nil, fmt.Errorf("nats auth: parsing CA cert PEM")
	}
	return nats.Secure(&tls.Config{
		RootCAs:    pool,
		MinVersion: tls.VersionTLS12,
	}), nil
}

// nkeyOption creates a NATS option for NKey authentication.
func nkeyOption(seed string) (nats.Option, error) {
	kp, err := nkeys.FromSeed([]byte(seed))
	if err != nil {
		return nil, fmt.Errorf("nats auth: invalid nkey seed: %w", err)
	}

	pubKey, err := kp.PublicKey()
	if err != nil {
		return nil, fmt.Errorf("nats auth: failed to get public key: %w", err)
	}

	return nats.Nkey(pubKey, func(nonce []byte) ([]byte, error) {
		return kp.Sign(nonce)
	}), nil
}

// PublicKeyFromSeed extracts the public key from an NKey seed.
// This is useful for generating the nats-server.conf authorization section.
func PublicKeyFromSeed(seed string) (string, error) {
	kp, err := nkeys.FromSeed([]byte(seed))
	if err != nil {
		return "", fmt.Errorf("invalid nkey seed: %w", err)
	}
	return kp.PublicKey()
}

// GenerateUserNKey generates a new user NKey pair.
// Returns the seed (private, for config) and public key (for nats-server.conf).
func GenerateUserNKey() (seed, publicKey string, err error) {
	kp, err := nkeys.CreateUser()
	if err != nil {
		return "", "", fmt.Errorf("failed to create user nkey: %w", err)
	}

	seedBytes, err := kp.Seed()
	if err != nil {
		return "", "", fmt.Errorf("failed to get seed: %w", err)
	}

	pubKey, err := kp.PublicKey()
	if err != nil {
		return "", "", fmt.Errorf("failed to get public key: %w", err)
	}

	return string(seedBytes), pubKey, nil
}
