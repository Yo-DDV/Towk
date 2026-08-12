package nativepushrelay

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"), netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("ff00::/8"),
}

type Resolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

func CanonicalPublicOrigin(ctx context.Context, resolver Resolver, raw string) (string, []netip.Addr, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", nil, errors.New("a public HTTPS origin is required")
	}
	if u.Path != "" && u.Path != "/" {
		return "", nil, errors.New("origin must not contain a path")
	}
	port := u.Port()
	if port != "" && port != "443" {
		return "", nil, errors.New("origin must use HTTPS port 443")
	}
	hostname := strings.ToLower(u.Hostname())
	addresses, err := resolver.LookupNetIP(ctx, "ip", hostname)
	if err != nil || len(addresses) == 0 {
		return "", nil, errors.New("origin DNS lookup failed")
	}
	for _, address := range addresses {
		if !publicAddress(address.Unmap()) {
			return "", nil, errors.New("origin resolves to a non-public address")
		}
	}
	u.Path = ""
	u.RawPath = ""
	u.Host = hostname
	return u.String(), addresses, nil
}

func publicAddress(address netip.Addr) bool {
	if !address.IsValid() || !address.IsGlobalUnicast() {
		return false
	}
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func DecodePublicKey(encoded string) (ed25519.PublicKey, error) {
	value, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(value) != ed25519.PublicKeySize {
		return nil, errors.New("invalid Ed25519 public key")
	}
	return ed25519.PublicKey(value), nil
}

func EnrollmentProofMessage(baseURL, challenge string) []byte {
	return []byte("towk-relay-enrollment-v1\n" + baseURL + "\n" + challenge)
}

func RequestSignatureMessage(method, path, timestamp, nonce string, body []byte) []byte {
	digest := sha256.Sum256(body)
	return []byte("towk-relay-request-v1\n" + method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + hex.EncodeToString(digest[:]))
}

func ParseRequestTime(value string, now time.Time) (time.Time, error) {
	seconds, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return time.Time{}, errors.New("invalid request timestamp")
	}
	parsed := time.Unix(seconds, 0).UTC()
	if delta := now.Sub(parsed); delta < -2*time.Minute || delta > 2*time.Minute {
		return time.Time{}, errors.New("request timestamp is outside allowed window")
	}
	return parsed, nil
}

func VerifySignature(publicKey ed25519.PublicKey, encoded string, message []byte) bool {
	signature, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return false
	}
	return subtle.ConstantTimeByteEq(boolByte(ed25519.Verify(publicKey, message, signature)), 1) == 1
}

func boolByte(value bool) byte {
	if value {
		return 1
	}
	return 0
}

func pinnedAddress(address netip.Addr) string {
	return net.JoinHostPort(address.String(), "443")
}

func instanceID(baseURL string, publicKey ed25519.PublicKey) string {
	digest := sha256.Sum256(append(append([]byte("towk-relay-instance-v1\x00"+baseURL+"\x00"), publicKey...), 0))
	return "twi_" + base64.RawURLEncoding.EncodeToString(digest[:18])
}

func validateNonce(value string) error {
	if len(value) < 16 || len(value) > 128 {
		return errors.New("invalid nonce")
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_-", r)) {
			return fmt.Errorf("invalid nonce")
		}
	}
	return nil
}
