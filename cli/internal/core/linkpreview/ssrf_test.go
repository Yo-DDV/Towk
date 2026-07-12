package linkpreview

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsPrivateIP(t *testing.T) {
	// Ensure allowLocalhost is false for this test (may be true under test_endpoints tag)
	orig := allowLocalhost
	allowLocalhost = false
	defer func() { allowLocalhost = orig }()

	tests := []struct {
		name     string
		ip       string
		expected bool
	}{
		// Private IPs - should be blocked
		{"loopback 127.0.0.1", "127.0.0.1", true},
		{"loopback 127.255.255.255", "127.255.255.255", true},
		{"RFC1918 10.0.0.1", "10.0.0.1", true},
		{"RFC1918 10.255.255.255", "10.255.255.255", true},
		{"RFC1918 172.16.0.1", "172.16.0.1", true},
		{"RFC1918 172.31.255.255", "172.31.255.255", true},
		{"RFC1918 192.168.0.1", "192.168.0.1", true},
		{"RFC1918 192.168.255.255", "192.168.255.255", true},
		{"shared address space lower bound", "100.64.0.0", true},
		{"shared address space metadata endpoint", "100.100.100.200", true},
		{"shared address space upper bound", "100.127.255.255", true},
		{"benchmarking", "198.18.0.1", true},
		{"TEST-NET-1", "192.0.2.1", true},
		{"TEST-NET-2", "198.51.100.1", true},
		{"TEST-NET-3", "203.0.113.1", true},
		{"IPv4 multicast", "239.255.255.250", true},
		{"IPv4 reserved", "240.0.0.1", true},
		{"link-local 169.254.0.1", "169.254.0.1", true},
		{"unspecified 0.0.0.0", "0.0.0.0", true},
		{"this-network 0.0.0.1", "0.0.0.1", true},
		{"this-network 0.1.2.3", "0.1.2.3", true},
		{"IPv6 loopback", "::1", true},
		{"IPv6 link-local", "fe80::1", true},
		{"IPv6 unique local", "fc00::1", true},
		{"IPv6 documentation", "2001:db8::1", true},
		{"IPv6 6to4", "2002:7f00:1::", true},
		{"IPv6 multicast", "ff02::1", true},
		{"IPv6 unspecified", "::", true},

		// Public IPs - should be allowed
		{"public 8.8.8.8", "8.8.8.8", false},
		{"public 1.1.1.1", "1.1.1.1", false},
		{"public 93.184.216.34", "93.184.216.34", false},
		{"outside shared address space below", "100.63.255.255", false},
		{"outside shared address space above", "100.128.0.0", false},
		{"not RFC1918 172.32.0.1", "172.32.0.1", false},
		{"public IPv6", "2001:4860:4860::8888", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip := net.ParseIP(tt.ip)
			assert.NotNil(t, ip, "failed to parse IP %s", tt.ip)
			assert.Equal(t, tt.expected, isPrivateIP(ip))
		})
	}
}

func TestAllowLocalhost(t *testing.T) {
	// Save and restore original value
	orig := allowLocalhost
	defer func() { allowLocalhost = orig }()

	loopback := net.ParseIP("127.0.0.1")
	loopbackV6 := net.ParseIP("::1")
	private := net.ParseIP("10.0.0.1")

	// Default: loopback is private
	allowLocalhost = false
	assert.True(t, isPrivateIP(loopback), "loopback should be private by default")
	assert.True(t, isPrivateIP(loopbackV6), "IPv6 loopback should be private by default")

	// With allowLocalhost: loopback is allowed
	allowLocalhost = true
	assert.False(t, isPrivateIP(loopback), "loopback should be allowed when allowLocalhost is true")
	assert.False(t, isPrivateIP(loopbackV6), "IPv6 loopback should be allowed when allowLocalhost is true")

	// Other private IPs remain blocked regardless
	assert.True(t, isPrivateIP(private), "RFC1918 should still be blocked with allowLocalhost")
}
