package linkpreview

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

// privateIPBlocks contains non-public CIDR ranges that must never be reached by
// the link preview fetcher. The list includes private networks as well as
// shared, documentation, benchmarking, multicast, and reserved address space.
var privateIPBlocks []*net.IPNet

func init() {
	// Initialize private IP blocks
	cidrs := []string{
		"0.0.0.0/8",       // "This network" (RFC1122) - routes to localhost on Linux
		"127.0.0.0/8",     // IPv4 loopback
		"10.0.0.0/8",      // RFC1918
		"100.64.0.0/10",   // RFC6598 shared address space, including provider metadata endpoints
		"172.16.0.0/12",   // RFC1918
		"192.168.0.0/16",  // RFC1918
		"169.254.0.0/16",  // RFC3927 link-local
		"192.0.0.0/24",    // IETF protocol assignments
		"192.0.2.0/24",    // TEST-NET-1
		"192.88.99.0/24",  // Deprecated 6to4 relay anycast
		"198.18.0.0/15",   // Benchmarking
		"198.51.100.0/24", // TEST-NET-2
		"203.0.113.0/24",  // TEST-NET-3
		"224.0.0.0/4",     // IPv4 multicast
		"240.0.0.0/4",     // IPv4 reserved and limited broadcast
		"::1/128",         // IPv6 loopback
		"64:ff9b::/96",    // IPv4/IPv6 translation
		"64:ff9b:1::/48",  // Local-use IPv4/IPv6 translation
		"100::/64",        // Discard-only
		"2001::/23",       // IETF protocol assignments
		"2001:db8::/32",   // Documentation
		"2002::/16",       // Deprecated 6to4
		"3fff::/20",       // Documentation
		"fe80::/10",       // IPv6 link-local
		"fec0::/10",       // Deprecated IPv6 site-local
		"fc00::/7",        // IPv6 unique local
		"ff00::/8",        // IPv6 multicast
	}

	for _, cidr := range cidrs {
		_, block, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("failed to parse CIDR %s: %v", cidr, err))
		}
		privateIPBlocks = append(privateIPBlocks, block)
	}
}

// allowLocalhost can be set to true to permit loopback addresses (e.g. for e2e tests
// that use a local mock HTTP server). This is set via init() in ssrf_testing.go when
// built with the test_endpoints build tag.
var allowLocalhost bool

// isPrivateIP checks whether an IP address is unsuitable for public link
// previews. Only globally routable unicast addresses outside the explicit
// special-use ranges are accepted.
func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() {
		return !allowLocalhost
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	if !ip.IsGlobalUnicast() {
		return true
	}

	for _, block := range privateIPBlocks {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

// ssrfSafeDialContext returns a DialContext function that validates resolved IPs
// against the private IP blocklist before establishing a connection.
// This prevents DNS rebinding attacks by checking the IP at connection time
// (not in a separate pre-check that could be subject to TOCTOU races).
func ssrfSafeDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("ssrf: invalid address %s: %w", addr, err)
		}

		if host == "" {
			return nil, fmt.Errorf("ssrf: empty hostname")
		}

		// Resolve hostname to IP addresses
		resolveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()

		ips, err := net.DefaultResolver.LookupIP(resolveCtx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("ssrf: failed to resolve hostname %s: %w", host, err)
		}

		// Check all resolved IPs against the blocklist
		for _, ip := range ips {
			if isPrivateIP(ip) {
				return nil, fmt.Errorf("ssrf: blocked request to %s (resolves to private IP %s)", host, ip)
			}
		}

		// Connect to the first validated IP directly, preventing any second DNS lookup
		dialer := &net.Dialer{
			Timeout:   timeout,
			KeepAlive: 30 * time.Second,
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
}

// NewSSRFSafeClient creates an HTTP client with SSRF protection.
// IP validation happens at connection time in DialContext, preventing DNS rebinding attacks.
func NewSSRFSafeClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext:           ssrfSafeDialContext(10 * time.Second),
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConns:          10,
			IdleConnTimeout:       30 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("ssrf: too many redirects (max 5)")
			}
			return nil
		},
	}
}
