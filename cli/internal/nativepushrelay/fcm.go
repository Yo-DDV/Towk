package nativepushrelay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const firebaseMessagingScope = "https://www.googleapis.com/auth/firebase.messaging"

type FCMSender struct {
	projectID   string
	tokenSource oauth2.TokenSource
	client      *http.Client
}

func NewFCMSender(serviceAccountJSON []byte, client *http.Client) (*FCMSender, error) {
	var metadata struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(serviceAccountJSON, &metadata); err != nil || strings.TrimSpace(metadata.ProjectID) == "" {
		return nil, errors.New("Firebase service account has no project_id")
	}
	config, err := google.JWTConfigFromJSON(serviceAccountJSON, firebaseMessagingScope)
	if err != nil {
		return nil, fmt.Errorf("parse Firebase service account: %w", err)
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &FCMSender{projectID: metadata.ProjectID, tokenSource: config.TokenSource(context.Background()), client: client}, nil
}

func (s *FCMSender) Send(ctx context.Context, request SendRequest) (DeliveryResult, error) {
	token, err := s.tokenSource.Token()
	if err != nil {
		return DeliveryResult{}, fmt.Errorf("obtain Firebase access token: %w", err)
	}
	priority := "NORMAL"
	if request.Priority == "high" {
		priority = "HIGH"
	}
	payload := map[string]any{
		"message": map[string]any{
			"token": request.InstallationID,
			"data": map[string]string{
				"instance_id": request.InstanceID,
				"envelope":    request.Envelope,
			},
			"android": map[string]any{
				"priority":     priority,
				"ttl":          fmt.Sprintf("%ds", request.TTLSeconds),
				"collapse_key": request.Collapse,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return DeliveryResult{}, err
	}
	endpoint := "https://fcm.googleapis.com/v1/projects/" + s.projectID + "/messages:send"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return DeliveryResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return DeliveryResult{}, fmt.Errorf("call FCM: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return DeliveryResult{}, err
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var result struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(responseBody, &result); err != nil || result.Name == "" {
			return DeliveryResult{}, errors.New("FCM returned an invalid success response")
		}
		return DeliveryResult{MessageID: result.Name, Outcome: "accepted"}, nil
	}
	class := classifyFCMError(response.StatusCode, responseBody)
	outcome := "retryable"
	if class == "unregistered" || class == "invalid_argument" {
		outcome = "permanent"
	}
	return DeliveryResult{Outcome: outcome, Class: class}, nil
}

func classifyFCMError(status int, body []byte) string {
	upper := strings.ToUpper(string(body))
	switch {
	case strings.Contains(upper, "UNREGISTERED"):
		return "unregistered"
	case status == http.StatusTooManyRequests:
		return "rate_limited"
	case status >= 500:
		return "provider_unavailable"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "provider_auth"
	default:
		return "invalid_argument"
	}
}
