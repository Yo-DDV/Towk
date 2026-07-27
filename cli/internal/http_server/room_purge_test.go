package http_server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/charmbracelet/log"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/core"
)

func setupTestHTTPServerWithRoomPurge(t *testing.T) (*http.Client, string, *core.ChattoCore) {
	t.Helper()
	ts, client, chattoCore := setupTestHTTPServerWithHook(t, func(s *HTTPServer) {
		s.logger = log.WithPrefix("test.RoomPurgeHTTP")
		s.setupPushNotificationRoutes()
	})
	return client, ts.URL, chattoCore
}

func loginRoomPurgeTestUser(t *testing.T, client *http.Client, baseURL, login, password string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"login": login, "password": password})
	if err != nil {
		t.Fatalf("marshal login: %v", err)
	}
	resp, err := client.Post(baseURL+"/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("login status = %d, body = %s", resp.StatusCode, payload)
	}
}

func roomPurgeJSONRequest(
	t *testing.T,
	client *http.Client,
	method, url string,
	body io.Reader,
) (*http.Response, roomPurgeErrorResponse) {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request %s %s: %v", method, url, err)
	}
	var failure roomPurgeErrorResponse
	if resp.StatusCode >= http.StatusBadRequest {
		defer resp.Body.Close()
		if err := json.NewDecoder(resp.Body).Decode(&failure); err != nil {
			t.Fatalf("decode error response: %v", err)
		}
	}
	return resp, failure
}

func TestRoomPurgeRoutesRequireAuthenticationAndOwnerCapability(t *testing.T) {
	client, baseURL, chattoCore := setupTestHTTPServerWithRoomPurge(t)
	ctx := testContext(t)

	resp, failure := roomPurgeJSONRequest(t, client, http.MethodGet, baseURL+roomPurgeCapabilityPath, nil)
	if resp.StatusCode != http.StatusUnauthorized || failure.Code != "authentication_required" {
		t.Fatalf("unauthenticated capability = %d/%q, want 401/authentication_required", resp.StatusCode, failure.Code)
	}

	member, err := chattoCore.CreateUser(ctx, core.SystemActorID, "purge-http-member", "Purge HTTP Member", "password123")
	if err != nil {
		t.Fatalf("CreateUser member: %v", err)
	}
	loginRoomPurgeTestUser(t, client, baseURL, member.GetLogin(), "password123")

	resp, err = client.Get(baseURL + roomPurgeCapabilityPath)
	if err != nil {
		t.Fatalf("owner capability request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("member capability status = %d, want 200", resp.StatusCode)
	}
	var capability roomPurgeCapabilityResponse
	if err := json.NewDecoder(resp.Body).Decode(&capability); err != nil {
		resp.Body.Close()
		t.Fatalf("decode capability: %v", err)
	}
	resp.Body.Close()
	if capability.CanPurgeArchivedRooms {
		t.Fatal("non-owner capability unexpectedly allowed permanent room purge")
	}

	room, err := chattoCore.CreateRoom(ctx, core.SystemActorID, core.KindChannel, "", "purge-http-denied", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chattoCore.ArchiveRoom(ctx, core.SystemActorID, core.KindChannel, room.GetId()); err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}
	payload, _ := json.Marshal(roomPurgeRequest{Confirmation: room.GetName()})
	resp, failure = roomPurgeJSONRequest(
		t,
		client,
		http.MethodPost,
		baseURL+"/api/admin/rooms/"+room.GetId()+"/purge",
		bytes.NewReader(payload),
	)
	if resp.StatusCode != http.StatusForbidden || failure.Code != "forbidden" {
		t.Fatalf("non-owner purge = %d/%q, want 403/forbidden", resp.StatusCode, failure.Code)
	}
}

func TestRoomPurgeRoutesValidateThenPurgeArchivedRoomIdempotently(t *testing.T) {
	client, baseURL, chattoCore := setupTestHTTPServerWithRoomPurge(t)
	ctx := testContext(t)

	owner, err := chattoCore.CreateUser(ctx, core.SystemActorID, "purge-http-owner", "Purge HTTP Owner", "password123")
	if err != nil {
		t.Fatalf("CreateUser owner: %v", err)
	}
	if err := chattoCore.AssignOwnerRole(ctx, owner.GetId()); err != nil {
		t.Fatalf("AssignOwnerRole: %v", err)
	}
	loginRoomPurgeTestUser(t, client, baseURL, owner.GetLogin(), "password123")

	resp, err := client.Get(baseURL + roomPurgeCapabilityPath)
	if err != nil {
		t.Fatalf("capability request: %v", err)
	}
	var capability roomPurgeCapabilityResponse
	if err := json.NewDecoder(resp.Body).Decode(&capability); err != nil {
		resp.Body.Close()
		t.Fatalf("decode capability: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !capability.CanPurgeArchivedRooms {
		t.Fatalf("owner capability = %d/%v, want 200/true", resp.StatusCode, capability.CanPurgeArchivedRooms)
	}

	active, err := chattoCore.CreateRoom(ctx, owner.GetId(), core.KindChannel, "", "purge-http-active", "")
	if err != nil {
		t.Fatalf("CreateRoom active: %v", err)
	}
	activePayload, _ := json.Marshal(roomPurgeRequest{Confirmation: active.GetName()})
	resp, failure := roomPurgeJSONRequest(
		t,
		client,
		http.MethodPost,
		baseURL+"/api/admin/rooms/"+active.GetId()+"/purge",
		bytes.NewReader(activePayload),
	)
	if resp.StatusCode != http.StatusConflict || failure.Code != "room_not_archived" {
		t.Fatalf("active room purge = %d/%q, want 409/room_not_archived", resp.StatusCode, failure.Code)
	}

	archived, err := chattoCore.CreateRoom(ctx, owner.GetId(), core.KindChannel, "", "purge-http-archived", "")
	if err != nil {
		t.Fatalf("CreateRoom archived: %v", err)
	}
	if _, err := chattoCore.ArchiveRoom(ctx, owner.GetId(), core.KindChannel, archived.GetId()); err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}

	mismatchPayload, _ := json.Marshal(roomPurgeRequest{Confirmation: strings.ToUpper(archived.GetName())})
	resp, failure = roomPurgeJSONRequest(
		t,
		client,
		http.MethodPost,
		baseURL+"/api/admin/rooms/"+archived.GetId()+"/purge",
		bytes.NewReader(mismatchPayload),
	)
	if resp.StatusCode != http.StatusBadRequest || failure.Code != "confirmation_mismatch" {
		t.Fatalf("confirmation mismatch = %d/%q, want 400/confirmation_mismatch", resp.StatusCode, failure.Code)
	}

	payload, _ := json.Marshal(roomPurgeRequest{Confirmation: archived.GetName()})
	purgeURL := baseURL + "/api/admin/rooms/" + archived.GetId() + "/purge"
	req, err := http.NewRequest(http.MethodPost, purgeURL, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest purge: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("purge request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		failureBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("purge status = %d, body = %s", resp.StatusCode, failureBody)
	}
	if got := resp.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
	if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
	}
	var result roomPurgeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		resp.Body.Close()
		t.Fatalf("decode purge result: %v", err)
	}
	resp.Body.Close()
	if result.AlreadyPurged {
		t.Fatal("first purge reported alreadyPurged")
	}
	if _, err := chattoCore.GetRoom(ctx, core.KindChannel, archived.GetId()); !errors.Is(err, jetstream.ErrKeyNotFound) {
		t.Fatalf("GetRoom after purge error = %v, want key not found", err)
	}

	resp, err = client.Post(purgeURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("retry purge: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("retry purge status = %d, body = %s", resp.StatusCode, body)
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		resp.Body.Close()
		t.Fatalf("decode retry result: %v", err)
	}
	resp.Body.Close()
	if !result.AlreadyPurged {
		t.Fatal("retry purge did not report alreadyPurged")
	}
}

func TestRoomPurgeRoutesRejectMalformedForgedAndOversizedRequests(t *testing.T) {
	client, baseURL, chattoCore := setupTestHTTPServerWithRoomPurge(t)
	ctx := testContext(t)

	owner, err := chattoCore.CreateUser(ctx, core.SystemActorID, "purge-http-validation", "Purge Validation Owner", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if err := chattoCore.AssignOwnerRole(ctx, owner.GetId()); err != nil {
		t.Fatalf("AssignOwnerRole: %v", err)
	}
	loginRoomPurgeTestUser(t, client, baseURL, owner.GetLogin(), "password123")

	for name, body := range map[string]string{
		"unknown field": `{"confirmation":"room","unexpected":true}`,
		"trailing JSON": `{"confirmation":"room"}{"confirmation":"room"}`,
		"missing field": `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			resp, failure := roomPurgeJSONRequest(
				t,
				client,
				http.MethodPost,
				baseURL+"/api/admin/rooms/R00000000000000/purge",
				strings.NewReader(body),
			)
			if resp.StatusCode != http.StatusBadRequest || failure.Code != "invalid_request" {
				t.Fatalf("status/code = %d/%q, want 400/invalid_request", resp.StatusCode, failure.Code)
			}
		})
	}

	forgedPayload := `{"confirmation":"room"}`
	resp, failure := roomPurgeJSONRequest(
		t,
		client,
		http.MethodPost,
		baseURL+"/api/admin/rooms/R0000000000000%3E/purge",
		strings.NewReader(forgedPayload),
	)
	if resp.StatusCode != http.StatusBadRequest || failure.Code != "invalid_room_id" {
		t.Fatalf("forged id = %d/%q, want 400/invalid_room_id", resp.StatusCode, failure.Code)
	}

	oversized := `{"confirmation":"` + strings.Repeat("x", roomPurgeBodyLimit) + `"}`
	resp, failure = roomPurgeJSONRequest(
		t,
		client,
		http.MethodPost,
		baseURL+"/api/admin/rooms/R00000000000000/purge",
		strings.NewReader(oversized),
	)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized request status = %d/%q, want 413", resp.StatusCode, failure.Code)
	}
}
