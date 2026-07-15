package push

import (
	"net"
	"net/url"
	"strings"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// CanonicalApplicationOrigin normalizes a configured public web URL to the
// browser origin used to attribute Web Push permissions and notifications.
func CanonicalApplicationOrigin(rawURL string) (string, bool) {
	return normalizeHTTPOrigin(rawURL, true)
}

// NormalizeApplicationOrigin normalizes browser-provided application origins.
func NormalizeApplicationOrigin(applicationOrigin string) (string, bool) {
	return normalizeHTTPOrigin(applicationOrigin, false)
}

func normalizeHTTPOrigin(rawURL string, allowPath bool) (string, bool) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", false
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	if !allowPath && (parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "") {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", false
	}
	port := parsed.Port()
	hostForOrigin := host
	if strings.Contains(hostForOrigin, ":") {
		hostForOrigin = "[" + hostForOrigin + "]"
	}
	if port == "" || (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		return scheme + "://" + hostForOrigin, true
	}
	return scheme + "://" + net.JoinHostPort(host, port), true
}

// FilterSubscriptionsByCanonicalOrigin prevents stale alternate-origin browser
// registrations from receiving the same push as the canonical app origin. It
// intentionally keeps legacy records without application_origin metadata for
// compatibility; active legacy records are still handled by ownership and push
// provider expiry checks.
func FilterSubscriptionsByCanonicalOrigin(
	subscriptions []*corev1.PushSubscription,
	canonicalURL string,
) []*corev1.PushSubscription {
	canonicalOrigin, ok := CanonicalApplicationOrigin(canonicalURL)
	if !ok || len(subscriptions) < 2 {
		return subscriptions
	}

	hasCanonical := false
	for _, subscription := range subscriptions {
		origin, ok := NormalizeApplicationOrigin(subscription.GetApplicationOrigin())
		if ok && origin == canonicalOrigin {
			hasCanonical = true
			break
		}
	}
	if !hasCanonical {
		return subscriptions
	}

	filtered := make([]*corev1.PushSubscription, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		applicationOrigin := strings.TrimSpace(subscription.GetApplicationOrigin())
		if applicationOrigin == "" {
			filtered = append(filtered, subscription)
			continue
		}
		origin, ok := NormalizeApplicationOrigin(applicationOrigin)
		if ok && origin == canonicalOrigin {
			filtered = append(filtered, subscription)
		}
	}
	return filtered
}
