package nativepushrelay

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Server struct {
	store    *Store
	sender   Sender
	resolver Resolver
	now      func() time.Time
	limitsMu sync.Mutex
	limits   map[string][]time.Time
}

func NewServer(store *Store, sender Sender) (*Server, error) {
	if store == nil || sender == nil {
		return nil, errors.New("relay store and FCM sender are required")
	}
	return &Server{store: store, sender: sender, resolver: net.DefaultResolver, now: time.Now, limits: map[string][]time.Time{}}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/enrollment/challenges", s.createChallenge)
	mux.HandleFunc("POST /v1/enrollments", s.completeEnrollment)
	mux.HandleFunc("POST /v1/messages:send", s.send)
	return securityHeaders(mux)
}

func (s *Server) createChallenge(w http.ResponseWriter, r *http.Request) {
	var input struct {
		BaseURL   string `json:"base_url"`
		PublicKey string `json:"public_key"`
	}
	if !decodeJSON(w, r, 8<<10, &input) {
		return
	}
	baseURL, _, err := CanonicalPublicOrigin(r.Context(), s.resolver, input.BaseURL)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "origin_not_compliant")
		return
	}
	if _, err := DecodePublicKey(input.PublicKey); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_public_key")
		return
	}
	id, err := randomToken(18)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	value, err := randomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	challenge := Challenge{ID: id, BaseURL: baseURL, PublicKey: input.PublicKey, Value: value, ExpiresAt: s.now().UTC().Add(10 * time.Minute)}
	if err := s.store.PutChallenge(challenge); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"challenge_id": challenge.ID,
		"challenge":    challenge.Value,
		"expires_at":   challenge.ExpiresAt,
		"proof_url":    challenge.BaseURL + "/.well-known/towk-relay-enrollment",
	})
}

func (s *Server) completeEnrollment(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ChallengeID string `json:"challenge_id"`
	}
	if !decodeJSON(w, r, 4<<10, &input) {
		return
	}
	challenge, ok := s.store.Challenge(input.ChallengeID, s.now().UTC())
	if !ok {
		writeError(w, http.StatusNotFound, "challenge_not_found")
		return
	}
	publicKey, err := DecodePublicKey(challenge.PublicKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_public_key")
		return
	}
	proof, err := s.fetchProof(r.Context(), challenge)
	if err != nil || proof.BaseURL != challenge.BaseURL || proof.PublicKey != challenge.PublicKey || proof.Challenge != challenge.Value || !VerifySignature(publicKey, proof.Signature, EnrollmentProofMessage(challenge.BaseURL, challenge.Value)) {
		writeError(w, http.StatusUnprocessableEntity, "domain_proof_failed")
		return
	}
	now := s.now().UTC()
	enrollment := Enrollment{InstanceID: instanceID(challenge.BaseURL, publicKey), BaseURL: challenge.BaseURL, PublicKey: challenge.PublicKey, Active: true, CreatedAt: now, LastSeenAt: now}
	if err := s.store.CompleteEnrollment(challenge.ID, enrollment); err != nil {
		writeError(w, http.StatusInternalServerError, "state_unavailable")
		return
	}
	writeJSON(w, http.StatusCreated, enrollment)
}

type proofResponse struct {
	BaseURL   string `json:"base_url"`
	PublicKey string `json:"public_key"`
	Challenge string `json:"challenge"`
	Signature string `json:"signature"`
}

func (s *Server) fetchProof(ctx context.Context, challenge Challenge) (proofResponse, error) {
	baseURL, addresses, err := CanonicalPublicOrigin(ctx, s.resolver, challenge.BaseURL)
	if err != nil {
		return proofResponse{}, err
	}
	parsed, _ := url.Parse(baseURL)
	transport := &http.Transport{
		Proxy:           nil,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: parsed.Hostname()},
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var last error
			for _, address := range addresses {
				connection, dialErr := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, pinnedAddress(address))
				if dialErr == nil {
					return connection, nil
				}
				last = dialErr
			}
			return nil, last
		},
	}
	client := &http.Client{Timeout: 8 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	proofURL := baseURL + "/.well-known/towk-relay-enrollment?challenge=" + url.QueryEscape(challenge.Value)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, proofURL, nil)
	if err != nil {
		return proofResponse{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return proofResponse{}, err
	}
	defer response.Body.Close()
	mediaType, _, contentTypeErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != http.StatusOK || contentTypeErr != nil || mediaType != "application/json" {
		return proofResponse{}, errors.New("invalid proof response")
	}
	var proof proofResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 8<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&proof); err != nil {
		return proofResponse{}, err
	}
	return proof, nil
}

func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<10))
	if err != nil || len(body) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	var input SendRequest
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	enrollment, ok := s.store.Enrollment(input.InstanceID)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unknown_instance")
		return
	}
	publicKey, err := DecodePublicKey(enrollment.PublicKey)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_instance")
		return
	}
	timestamp := r.Header.Get("X-Towk-Timestamp")
	nonce := r.Header.Get("X-Towk-Nonce")
	requestTime, err := ParseRequestTime(timestamp, s.now().UTC())
	if err != nil || validateNonce(nonce) != nil || !VerifySignature(publicKey, r.Header.Get("X-Towk-Signature"), RequestSignatureMessage(r.Method, r.URL.Path, timestamp, nonce, body)) {
		writeError(w, http.StatusUnauthorized, "invalid_signature")
		return
	}
	accepted, err := s.store.AcceptNonce(enrollment.InstanceID, nonce, requestTime.Add(3*time.Minute), s.now().UTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "state_unavailable")
		return
	}
	if !accepted {
		writeError(w, http.StatusConflict, "replayed_request")
		return
	}
	if !s.allow(enrollment.InstanceID, s.now().UTC()) {
		writeError(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	if err := validateSendRequest(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_message")
		return
	}
	result, err := s.sender.Send(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "provider_unavailable")
		return
	}
	status := http.StatusAccepted
	if result.Outcome == "permanent" {
		status = http.StatusGone
	} else if result.Outcome == "retryable" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, result)
}

func validateSendRequest(input SendRequest) error {
	if input.InstanceID == "" || len(input.InstallationID) < 20 || len(input.InstallationID) > MaxTokenBytes || len(input.Envelope) < 16 || len(input.Envelope) > MaxEnvelopeBytes*2 || len(input.Collapse) > 128 {
		return errors.New("invalid relay message")
	}
	if _, err := base64.RawURLEncoding.DecodeString(input.Envelope); err != nil {
		return errors.New("invalid envelope")
	}
	if input.TTLSeconds < 1 || input.TTLSeconds > 86400 || (input.Priority != "normal" && input.Priority != "high") {
		return errors.New("invalid delivery options")
	}
	return nil
}

func (s *Server) allow(instanceID string, now time.Time) bool {
	s.limitsMu.Lock()
	defer s.limitsMu.Unlock()
	window := now.Add(-time.Minute)
	entries := s.limits[instanceID][:0]
	for _, entry := range s.limits[instanceID] {
		if entry.After(window) {
			entries = append(entries, entry)
		}
	}
	if len(entries) >= 600 {
		s.limits[instanceID] = entries
		return false
	}
	s.limits[instanceID] = append(entries, now)
	return true
}

func randomToken(bytesCount int) (string, error) {
	value := make([]byte, bytesCount)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, maximum int64, target any) bool {
	if r.Header.Get("Content-Type") != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "json_required")
		return false
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, maximum))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	return true
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
