// Package push provides Web Push notification functionality.
package push

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/charmbracelet/log"
	"github.com/rivo/uniseg"

	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// Sender sends Web Push notifications.
type Sender struct {
	config       config.PushConfig
	logger       *log.Logger
	httpClient   webpush.HTTPClient
	requestSlots chan struct{}
}

const (
	pushRecordSize                       uint32 = 2048
	maxPushProviderResponseBodyBytes            = 2048
	truncatedPushProviderResponseBodyMsg        = "…"
	declarativeWebPushValue                     = 8030
	pushRequestTimeout                          = 10 * time.Second
	maxConcurrentPushRequests                   = 16
)

// NewSender creates a new push notification sender.
// Returns nil if push is not configured.
func NewSender(cfg config.PushConfig, logger *log.Logger) *Sender {
	if !cfg.IsConfigured() {
		return nil
	}
	return &Sender{
		config:       cfg,
		logger:       logger,
		httpClient:   newPushHTTPClient(),
		requestSlots: make(chan struct{}, maxConcurrentPushRequests),
	}
}

func newPushHTTPClient() *http.Client {
	transport, ok := http.DefaultTransport.(*http.Transport)
	if ok {
		transport = transport.Clone()
	} else {
		// Applications are allowed to replace http.DefaultTransport with any
		// RoundTripper. Keep the standard library defaults without assuming its
		// concrete type so push initialization cannot panic in an embedding host.
		transport = &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}
	}
	// Push endpoints are browser-issued public HTTPS URLs. Bypassing ambient
	// proxy variables keeps endpoint validation effective and avoids delegating
	// target resolution to a proxy that may reach private networks.
	transport.Proxy = nil
	transport.DialContext = dialPublicPushAddress
	return &http.Client{
		Timeout:       pushRequestTimeout,
		Transport:     transport,
		CheckRedirect: rejectPushRedirect,
	}
}

func rejectPushRedirect(_ *http.Request, _ []*http.Request) error {
	// Browser-issued push endpoints are final HTTPS destinations. Refusing
	// redirects prevents a compromised endpoint from downgrading or replaying
	// the encrypted request and VAPID metadata to a different origin.
	return http.ErrUseLastResponse
}

func dialPublicPushAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid push service address: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve push service address: %w", err)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("push service address resolved to no IPs")
	}
	for _, resolved := range addresses {
		if !isPublicPushAddress(resolved) {
			return nil, fmt.Errorf("push service address resolved to a non-public IP")
		}
	}

	dialer := &net.Dialer{}
	var lastErr error
	for _, resolved := range addresses {
		connection, err := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.String(), port))
		if err == nil {
			return connection, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("connect to push service: %w", lastErr)
}

func isPublicPushAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsUnspecified() {
		return false
	}
	if address.Is4() {
		for _, prefix := range []netip.Prefix{
			netip.MustParsePrefix("100.64.0.0/10"),
			netip.MustParsePrefix("192.0.0.0/24"),
			netip.MustParsePrefix("198.18.0.0/15"),
			netip.MustParsePrefix("240.0.0.0/4"),
		} {
			if prefix.Contains(address) {
				return false
			}
		}
	}
	return true
}

// Payload represents the data sent in a push notification.
type Payload struct {
	Title          string           `json:"title,omitempty"`
	Body           string           `json:"body,omitempty"`
	Icon           string           `json:"icon,omitempty"`
	Badge          string           `json:"badge,omitempty"`
	Tag            string           `json:"tag,omitempty"`
	NotificationID string           `json:"notificationId,omitempty"`
	URL            string           `json:"url,omitempty"`
	ExpiresAt      int64            `json:"expiresAt,omitempty"`
	Call           *CallPushPayload `json:"call,omitempty"`
	AppBadge       string           `json:"-"`
	TTL            int              `json:"-"`
	Urgency        webpush.Urgency  `json:"-"`
	Topic          string           `json:"-"`
	// Action is used for special payloads like "dismiss" to close notifications on other devices
	Action string `json:"action,omitempty"`
}

type CallPushPayload struct {
	ActorName  string `json:"actorName"`
	ActorKnown bool   `json:"actorKnown"`
	RoomName   string `json:"roomName,omitempty"`
	IsPrivate  bool   `json:"isPrivate,omitempty"`
	CallID     string `json:"callId"`
	JoinURL    string `json:"joinUrl"`
}

type declarativeNotification struct {
	Title    string                       `json:"title"`
	Body     string                       `json:"body,omitempty"`
	Navigate string                       `json:"navigate"`
	Tag      string                       `json:"tag,omitempty"`
	Icon     string                       `json:"icon,omitempty"`
	Badge    string                       `json:"badge,omitempty"`
	AppBadge string                       `json:"app_badge,omitempty"`
	Data     *declarativeNotificationData `json:"data,omitempty"`
}

type declarativeNotificationData struct {
	NotificationID string `json:"notificationId,omitempty"`
	URL            string `json:"url,omitempty"`
}

func (p Payload) MarshalJSON() ([]byte, error) {
	type payloadJSON struct {
		Title          string                   `json:"title,omitempty"`
		Body           string                   `json:"body,omitempty"`
		Icon           string                   `json:"icon,omitempty"`
		Badge          string                   `json:"badge,omitempty"`
		Tag            string                   `json:"tag,omitempty"`
		NotificationID string                   `json:"notificationId,omitempty"`
		URL            string                   `json:"url,omitempty"`
		ExpiresAt      int64                    `json:"expiresAt,omitempty"`
		Call           *CallPushPayload         `json:"call,omitempty"`
		Action         string                   `json:"action,omitempty"`
		WebPush        int                      `json:"web_push,omitempty"`
		Mutable        bool                     `json:"mutable,omitempty"`
		Notification   *declarativeNotification `json:"notification,omitempty"`
	}

	out := payloadJSON{
		Title:          p.Title,
		Body:           p.Body,
		Icon:           p.Icon,
		Badge:          p.Badge,
		Tag:            p.Tag,
		NotificationID: p.NotificationID,
		URL:            p.URL,
		ExpiresAt:      p.ExpiresAt,
		Call:           p.Call,
		Action:         p.Action,
	}
	if p.declarativeNotificationEligible() {
		out.WebPush = declarativeWebPushValue
		out.Mutable = true
		out.Notification = &declarativeNotification{
			Title:    p.Title,
			Body:     p.Body,
			Navigate: p.URL,
			Tag:      p.Tag,
			Icon:     p.Icon,
			Badge:    p.Badge,
			AppBadge: p.AppBadge,
			Data: &declarativeNotificationData{
				NotificationID: p.NotificationID,
				URL:            p.URL,
			},
		}
	}
	return json.Marshal(out)
}

func (p Payload) declarativeNotificationEligible() bool {
	return p.Action == "" && p.Title != "" && p.URL != "" && p.Call == nil && p.ExpiresAt == 0
}

// PayloadContext provides optional context for building push payloads.
type PayloadContext struct {
	// MessagePreview is a truncated preview of the message body
	MessagePreview string
	// RoomName is the name of the room (for mentions)
	RoomName string
	// IsPrivate distinguishes one-to-one conversations from channel rooms.
	IsPrivate bool
	// ActorKnown lets localized workers avoid leaking the English fallback name.
	ActorKnown bool
}

type notificationCopy struct {
	unknownActor       string
	directMessage      string
	mention            string
	mentionInRoom      string
	reply              string
	replyInRoom        string
	roomMessage        string
	roomMessageInRoom  string
	defaultTitle       string
	defaultDescription string
}

var notificationCopies = map[string]notificationCopy{
	"en": {
		unknownActor:       "Someone",
		directMessage:      "@%s sent you a new DM",
		mention:            "@%s mentioned you",
		mentionInRoom:      "@%s mentioned you in #%s",
		reply:              "@%s replied to you",
		replyInRoom:        "@%s replied to you in #%s",
		roomMessage:        "@%s posted a message",
		roomMessageInRoom:  "@%s posted in #%s",
		defaultTitle:       "New notification",
		defaultDescription: "You have a new notification",
	},
	"de": {
		unknownActor:       "Jemand",
		directMessage:      "@%s hat dir eine neue Direktnachricht gesendet",
		mention:            "@%s hat dich erwähnt",
		mentionInRoom:      "@%s hat dich in #%s erwähnt",
		reply:              "@%s hat dir geantwortet",
		replyInRoom:        "@%s hat dir in #%s geantwortet",
		roomMessage:        "@%s hat eine Nachricht gesendet",
		roomMessageInRoom:  "@%s hat in #%s geschrieben",
		defaultTitle:       "Neue Benachrichtigung",
		defaultDescription: "Du hast eine neue Benachrichtigung",
	},
	"fr": {
		unknownActor:       "Quelqu’un",
		directMessage:      "@%s vous a envoyé un nouveau message privé",
		mention:            "@%s vous a mentionné",
		mentionInRoom:      "@%s vous a mentionné dans #%s",
		reply:              "@%s vous a répondu",
		replyInRoom:        "@%s vous a répondu dans #%s",
		roomMessage:        "@%s a publié un message",
		roomMessageInRoom:  "@%s a publié un message dans #%s",
		defaultTitle:       "Nouvelle notification",
		defaultDescription: "Vous avez une nouvelle notification",
	},
	"es": {
		unknownActor:       "Alguien",
		directMessage:      "@%s te envió un nuevo mensaje directo",
		mention:            "@%s te mencionó",
		mentionInRoom:      "@%s te mencionó en #%s",
		reply:              "@%s te respondió",
		replyInRoom:        "@%s te respondió en #%s",
		roomMessage:        "@%s publicó un mensaje",
		roomMessageInRoom:  "@%s publicó un mensaje en #%s",
		defaultTitle:       "Nueva notificación",
		defaultDescription: "Tienes una nueva notificación",
	},
	"pt": {
		unknownActor:       "Alguém",
		directMessage:      "@%s enviou uma nova mensagem direta para você",
		mention:            "@%s mencionou você",
		mentionInRoom:      "@%s mencionou você em #%s",
		reply:              "@%s respondeu a você",
		replyInRoom:        "@%s respondeu a você em #%s",
		roomMessage:        "@%s publicou uma mensagem",
		roomMessageInRoom:  "@%s publicou uma mensagem em #%s",
		defaultTitle:       "Nova notificação",
		defaultDescription: "Você tem uma nova notificação",
	},
}

// NormalizeLocale returns a supported Towk notification locale. Legacy-empty
// and unsupported values intentionally fall back to English.
func NormalizeLocale(locale string) string {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "de", "fr", "es", "pt":
		return strings.ToLower(strings.TrimSpace(locale))
	default:
		return "en"
	}
}

func notificationCopyForLocale(locale string) notificationCopy {
	copy, ok := notificationCopies[NormalizeLocale(locale)]
	if !ok {
		return notificationCopies["en"]
	}
	return copy
}

// maxPreviewLength is the maximum number of user-perceived characters kept in
// message previews before the ellipsis.
const maxPreviewLength = 100

// truncatePreview truncates a message to maxPreviewLength grapheme clusters so
// accents, emoji modifiers, and zero-width-joiner emoji sequences stay intact.
func truncatePreview(text string) string {
	graphemes := uniseg.NewGraphemes(text)
	clusters := make([]string, 0, maxPreviewLength+1)
	for graphemes.Next() {
		clusters = append(clusters, graphemes.Str())
	}
	if len(clusters) <= maxPreviewLength {
		return text
	}
	// Find a good break point (space) near the limit
	breakPoint := maxPreviewLength
	for i := maxPreviewLength - 1; i > maxPreviewLength-20 && i > 0; i-- {
		if strings.TrimSpace(clusters[i]) == "" {
			breakPoint = i
			break
		}
	}
	return strings.Join(clusters[:breakPoint], "") + "…"
}

// SendResult contains the result of a push notification send attempt.
type SendResult struct {
	Endpoint string
	Success  bool
	Error    error
	// Gone indicates the subscription is no longer valid and should be deleted
	Gone bool
}

// Send sends a push notification to a single subscription.
func (s *Sender) Send(ctx context.Context, sub *corev1.PushSubscription, payload *Payload) *SendResult {
	result := &SendResult{
		Endpoint: sub.Endpoint,
	}
	if ctx == nil {
		ctx = context.Background()
	}
	requestCtx, cancel := context.WithTimeout(ctx, pushRequestTimeout)
	defer cancel()

	select {
	case s.requestSlots <- struct{}{}:
		defer func() { <-s.requestSlots }()
	case <-requestCtx.Done():
		result.Error = requestCtx.Err()
		return result
	}

	// Marshal payload to JSON
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		result.Error = fmt.Errorf("failed to marshal payload: %w", err)
		return result
	}

	// Create webpush subscription from our proto
	subscription := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256Dh,
			Auth:   sub.Auth,
		},
	}

	// Send the push notification
	ttl := payload.TTL
	if ttl <= 0 {
		ttl = 86400
	}
	resp, err := webpush.SendNotificationWithContext(requestCtx, payloadJSON, subscription, &webpush.Options{
		Subscriber:      normalizeVAPIDSubject(s.config.VAPIDSubject),
		VAPIDPublicKey:  s.config.VAPIDPublicKey,
		VAPIDPrivateKey: s.config.VAPIDPrivateKey,
		TTL:             ttl,
		Urgency:         payload.Urgency,
		Topic:           payload.Topic,
		RecordSize:      pushRecordSize,
		HTTPClient:      s.httpClient,
	})
	if err != nil {
		result.Error = err
		return result
	}
	defer resp.Body.Close()

	// Check response status
	switch resp.StatusCode {
	case 200, 201, 202:
		// Drain body to allow connection reuse
		_, _ = io.Copy(io.Discard, resp.Body)
		result.Success = true
	case 404, 410:
		// 404 Not Found or 410 Gone - subscription is no longer valid
		body, readErr := readPushProviderResponseBody(resp.Body)
		result.Gone = true
		result.Error = pushServiceStatusError("subscription expired or invalid", resp.StatusCode, body, readErr)
	default:
		body, readErr := readPushProviderResponseBody(resp.Body)
		result.Error = pushServiceStatusError("push service returned status", resp.StatusCode, body, readErr)
	}

	return result
}

func normalizeVAPIDSubject(subject string) string {
	return strings.TrimPrefix(subject, "mailto:")
}

func readPushProviderResponseBody(body io.Reader) (string, error) {
	var buf bytes.Buffer
	_, err := io.Copy(&buf, io.LimitReader(body, maxPushProviderResponseBodyBytes+1))
	_, _ = io.Copy(io.Discard, body)
	if err != nil {
		return "", err
	}

	responseBody := buf.Bytes()
	truncated := false
	if len(responseBody) > maxPushProviderResponseBodyBytes {
		responseBody = responseBody[:maxPushProviderResponseBodyBytes]
		truncated = true
	}

	text := strings.TrimSpace(strings.ToValidUTF8(string(responseBody), ""))
	if truncated {
		text += truncatedPushProviderResponseBodyMsg
	}
	return text, nil
}

func pushServiceStatusError(prefix string, statusCode int, body string, readErr error) error {
	if readErr != nil {
		return fmt.Errorf("%s %d (failed to read response body: %w)", prefix, statusCode, readErr)
	}
	if body == "" {
		return fmt.Errorf("%s %d", prefix, statusCode)
	}
	return fmt.Errorf("%s %d: %s", prefix, statusCode, body)
}

// EndpointLogID returns a stable, opaque identifier for a push endpoint.
func EndpointLogID(endpoint string) string {
	hash := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(hash[:8])
}

// SendToMany sends a push notification to multiple subscriptions.
// Returns results for each subscription.
func (s *Sender) SendToMany(ctx context.Context, subscriptions []*corev1.PushSubscription, payload *Payload) []*SendResult {
	results := make([]*SendResult, len(subscriptions))
	if len(subscriptions) == 0 {
		return results
	}

	workerCount := min(len(subscriptions), maxConcurrentPushRequests)
	jobs := make(chan int)
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for i := range jobs {
				results[i] = s.Send(ctx, subscriptions[i], payload)
			}
		}()
	}
	for i := range subscriptions {
		jobs <- i
	}
	close(jobs)
	workers.Wait()
	return results
}

func buildAppURL(baseURL string, segments []string, queryKey, queryValue string) string {
	raw, err := url.JoinPath(baseURL, segments...)
	if err != nil {
		return ""
	}

	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if queryKey != "" && queryValue != "" {
		query := u.Query()
		query.Set(queryKey, queryValue)
		u.RawQuery = query.Encode()
	}
	return u.String()
}

func buildNotificationURL(baseURL, roomID, threadRootID, highlightEventID string) string {
	segments := []string{"chat", "-"}
	if roomID != "" {
		segments = append(segments, roomID)
	}
	if threadRootID != "" {
		segments = append(segments, threadRootID)
	}
	return buildAppURL(baseURL, segments, "highlight", highlightEventID)
}

// BuildPayloadFromNotification creates a push payload from a notification.
// The baseURL is used to build navigation URLs (e.g., "https://towk.example.com").
// The optional payloadCtx provides message preview and room name for richer notifications.
func BuildPayloadFromNotification(notif *corev1.Notification, actorDisplayName, baseURL string, payloadCtx *PayloadContext) *Payload {
	return BuildLocalizedPayloadFromNotification(notif, actorDisplayName, baseURL, payloadCtx, "en")
}

// BuildLocalizedPayloadFromNotification creates a push payload in the browser
// subscription's language. Unsupported or legacy-empty locales use English.
func BuildLocalizedPayloadFromNotification(notif *corev1.Notification, actorDisplayName, baseURL string, payloadCtx *PayloadContext, locale string) *Payload {
	copy := notificationCopyForLocale(locale)
	if strings.TrimSpace(actorDisplayName) == "" {
		actorDisplayName = copy.unknownActor
	}
	payload := &Payload{
		NotificationID: notif.Id,
		Icon:           buildAppURL(baseURL, []string{"icons", "icon-192.png"}, "", ""),
		Badge:          buildAppURL(baseURL, []string{"icons", "badge-monochrome-96.png"}, "", ""),
	}

	// Get preview from context, truncate if needed
	preview := ""
	roomName := ""
	if payloadCtx != nil {
		preview = truncatePreview(payloadCtx.MessagePreview)
		roomName = payloadCtx.RoomName
	}

	switch n := notif.Notification.(type) {
	case *corev1.Notification_DmMessage:
		payload.Title = fmt.Sprintf(copy.directMessage, actorDisplayName)
		payload.Body = preview
		payload.Tag = "dm-" + n.DmMessage.EventId
		payload.URL = buildNotificationURL(baseURL, n.DmMessage.RoomId, n.DmMessage.InThread, n.DmMessage.EventId)

	case *corev1.Notification_Mention:
		if roomName != "" {
			payload.Title = fmt.Sprintf(copy.mentionInRoom, actorDisplayName, roomName)
		} else {
			payload.Title = fmt.Sprintf(copy.mention, actorDisplayName)
		}
		payload.Body = preview
		payload.Tag = "mention-" + n.Mention.EventId
		payload.URL = buildNotificationURL(baseURL, n.Mention.RoomId, n.Mention.InThread, n.Mention.EventId)

	case *corev1.Notification_Reply:
		if roomName != "" {
			payload.Title = fmt.Sprintf(copy.replyInRoom, actorDisplayName, roomName)
		} else {
			payload.Title = fmt.Sprintf(copy.reply, actorDisplayName)
		}
		payload.Body = preview
		payload.Tag = "reply-" + n.Reply.EventId
		payload.URL = buildNotificationURL(baseURL, n.Reply.RoomId, n.Reply.InThread, n.Reply.EventId)

	case *corev1.Notification_RoomMessage:
		if roomName != "" {
			payload.Title = fmt.Sprintf(copy.roomMessageInRoom, actorDisplayName, roomName)
		} else {
			payload.Title = fmt.Sprintf(copy.roomMessage, actorDisplayName)
		}
		payload.Body = preview
		payload.Tag = "room-message-" + n.RoomMessage.EventId
		payload.URL = buildNotificationURL(baseURL, n.RoomMessage.RoomId, n.RoomMessage.InThread, n.RoomMessage.EventId)

	case *corev1.Notification_CallStarted:
		isPrivate := payloadCtx != nil && payloadCtx.IsPrivate
		payload.Title = fmt.Sprintf("%s started a call", actorDisplayName)
		payload.Tag = "call-" + n.CallStarted.CallId
		payload.URL = buildNotificationURL(baseURL, n.CallStarted.RoomId, "", "")
		payload.Call = &CallPushPayload{
			ActorName:  actorDisplayName,
			ActorKnown: payloadCtx != nil && payloadCtx.ActorKnown,
			RoomName:   roomName,
			IsPrivate:  isPrivate,
			CallID:     n.CallStarted.CallId,
			JoinURL:    buildAppURL(baseURL, []string{"chat", "-", n.CallStarted.RoomId}, "joinCall", n.CallStarted.CallId),
		}
		createdAt := time.Now()
		if notif.GetCreatedAt() != nil {
			createdAt = notif.GetCreatedAt().AsTime()
		}
		payload.ExpiresAt = createdAt.Add(time.Minute).UnixMilli()
		payload.TTL = 60
		payload.Urgency = webpush.UrgencyHigh
		payload.Topic = payload.Tag

	default:
		payload.Title = copy.defaultTitle
		payload.Body = copy.defaultDescription
	}

	return payload
}
