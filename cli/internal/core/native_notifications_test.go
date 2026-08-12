package core

import (
	"context"
	"crypto/elliptic"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func testNativePublicKey(scalar byte) []byte {
	x, y := elliptic.P256().ScalarBaseMult([]byte{scalar})
	return elliptic.Marshal(elliptic.P256(), x, y)
}

func testNativeRegistration(installationID string) NativeEndpointRegistration {
	return NativeEndpointRegistration{
		InstallationID:    installationID,
		Platform:          NativeNotificationPlatformAndroid,
		Transport:         NativeNotificationTransportManagedFCM,
		AppID:             "com.yoddv.towk.android",
		FCMInstallationID: "cOpaqueTowkInstallId01",
		ClientPublicKey:   testNativePublicKey(2),
		Locale:            "fr-FR",
	}
}

func testNativeNotification(id, userID, roomID string, createdAt time.Time) *corev1.Notification {
	return &corev1.Notification{
		Id:          id,
		RecipientId: userID,
		CreatedAt:   timestamppb.New(createdAt),
		ActorId:     "actor-1",
		Notification: &corev1.Notification_Mention{
			Mention: &corev1.MentionNotification{RoomId: roomID, EventId: "event-1"},
		},
	}
}

func TestNativeNotificationKindTreatsMissedCallAsCallPreferenceWithMessageTTL(t *testing.T) {
	notification := &corev1.Notification{
		Notification: &corev1.Notification_CallStarted{
			CallStarted: &corev1.CallStartedNotification{Missed: true},
		},
	}
	if got := nativeNotificationKind(notification); got != NativeNotificationKindMissedCall {
		t.Fatalf("nativeNotificationKind(missed call) = %q, want %q", got, NativeNotificationKindMissedCall)
	}
	if got, want := nativeNotificationTTL(NativeNotificationKindMissedCall), defaultNativeMessageTTL; got != want {
		t.Fatalf("nativeNotificationTTL(missed call) = %s, want %s", got, want)
	}
	endpoint := &NativeEndpointRecord{
		State:     NativeEndpointStateActive,
		Transport: NativeNotificationTransportManagedFCM,
		Preferences: NativeEndpointPreferences{
			Enabled:  true,
			Messages: false,
			Calls:    true,
		},
	}
	if !nativeEndpointAcceptsNotification(endpoint, NativeNotificationKindMissedCall) {
		t.Fatal("missed call should honor the calls preference")
	}
	endpoint.Preferences.Calls = false
	endpoint.Preferences.Messages = true
	if nativeEndpointAcceptsNotification(endpoint, NativeNotificationKindMissedCall) {
		t.Fatal("missed call should not honor the messages preference")
	}
}

func TestRegisterNativeEndpointIsIdempotentAndRotatesAtomically(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	registration := testNativeRegistration("installation-0001")

	first, err := core.RegisterNativeEndpoint(ctx, "user-1", registration)
	if err != nil {
		t.Fatalf("RegisterNativeEndpoint first: %v", err)
	}
	if first.Generation != 1 || first.Locale != "fr" || first.State != NativeEndpointStateActive {
		t.Fatalf("first endpoint = %#v", first)
	}

	second, err := core.RegisterNativeEndpoint(ctx, "user-1", registration)
	if err != nil {
		t.Fatalf("RegisterNativeEndpoint idempotent: %v", err)
	}
	if second.EndpointID != first.EndpointID || second.Generation != first.Generation {
		t.Fatalf("idempotent endpoint = %#v, want endpoint %q generation %d", second, first.EndpointID, first.Generation)
	}

	rotatedRegistration := registration
	rotatedRegistration.FCMInstallationID = "cReplacementInstall02"
	rotatedRegistration.ClientPublicKey = testNativePublicKey(4)
	rotated, err := core.RotateNativeEndpoint(ctx, "user-1", first.EndpointID, first.Generation, rotatedRegistration)
	if err != nil {
		t.Fatalf("RotateNativeEndpoint: %v", err)
	}
	if rotated.Generation != 2 || rotated.FCMInstallationID == first.FCMInstallationID {
		t.Fatalf("rotated endpoint = %#v", rotated)
	}
	if _, err := core.RotateNativeEndpoint(ctx, "user-1", first.EndpointID, first.Generation, registration); !errors.Is(err, ErrNativeEndpointConflict) {
		t.Fatalf("stale rotation error = %v, want conflict", err)
	}
}

func TestUnregisterNativeEndpointCannotRevokeNewerGeneration(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	registration := testNativeRegistration("installation-0002")
	endpoint, err := core.RegisterNativeEndpoint(ctx, "user-1", registration)
	if err != nil {
		t.Fatal(err)
	}

	registration.FCMInstallationID = "cNewTowkInstallId003"
	registration.ClientPublicKey = testNativePublicKey(6)
	rotated, err := core.RotateNativeEndpoint(ctx, "user-1", endpoint.EndpointID, 1, registration)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := core.UnregisterNativeEndpoint(ctx, "user-1", endpoint.EndpointID, 1); !errors.Is(err, ErrNativeEndpointConflict) {
		t.Fatalf("stale logout error = %v, want conflict", err)
	}
	current, _, err := core.GetNativeEndpoint(ctx, "user-1", endpoint.EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	if current == nil || current.Generation != rotated.Generation || current.State != NativeEndpointStateActive {
		t.Fatalf("newer endpoint was revoked: %#v", current)
	}

	unregistered, err := core.UnregisterNativeEndpoint(ctx, "user-1", endpoint.EndpointID, rotated.Generation)
	if err != nil || !unregistered {
		t.Fatalf("UnregisterNativeEndpoint = %v, %v", unregistered, err)
	}
	disabled, _, err := core.GetNativeEndpoint(ctx, "user-1", endpoint.EndpointID)
	if err != nil {
		t.Fatal(err)
	}
	if disabled.State != NativeEndpointStateDisabled || disabled.Generation != rotated.Generation+1 {
		t.Fatalf("disabled endpoint = %#v", disabled)
	}
	if disabled.FCMInstallationID != "" || len(disabled.ClientPublicKey) != 0 {
		t.Fatalf("disabled endpoint retained transport material: %#v", disabled)
	}
	if again, err := core.UnregisterNativeEndpoint(ctx, "user-1", endpoint.EndpointID, rotated.Generation); err != nil || !again {
		t.Fatalf("idempotent unregister = %v, %v", again, err)
	}
}

func TestNativeEndpointOwnershipAndPreferencesAreUserScoped(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	registration := testNativeRegistration("installation-0003")
	ownerEndpoint, err := core.RegisterNativeEndpoint(ctx, "owner", registration)
	if err != nil {
		t.Fatal(err)
	}
	otherRegistration := registration
	otherRegistration.InstallationID = "installation-0004"
	if _, err := core.RegisterNativeEndpoint(ctx, "other", otherRegistration); err != nil {
		t.Fatal(err)
	}

	if endpoint, _, err := core.GetNativeEndpoint(ctx, "other", ownerEndpoint.EndpointID); err != nil || endpoint != nil {
		t.Fatalf("cross-user endpoint lookup = %#v, %v", endpoint, err)
	}
	if _, err := core.UpdateNativeEndpointPreferences(ctx, "other", ownerEndpoint.EndpointID, ownerEndpoint.Generation, NativeEndpointPreferencesPatch{Enabled: boolPointer(false)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user preference update error = %v, want not found", err)
	}

	updated, err := core.UpdateNativeEndpointPreferences(ctx, "owner", ownerEndpoint.EndpointID, ownerEndpoint.Generation, NativeEndpointPreferencesPatch{
		Messages: boolPointer(false),
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Preferences.Messages || !updated.Preferences.Calls || updated.Generation != ownerEndpoint.Generation+1 {
		t.Fatalf("updated preferences = %#v", updated)
	}
}

func TestRegisterNativeEndpointRejectsInvalidTransportMaterial(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	cases := []NativeEndpointRegistration{
		func() NativeEndpointRegistration {
			registration := testNativeRegistration("installation-0005")
			registration.Platform = NativeNotificationPlatformLinux
			return registration
		}(),
		func() NativeEndpointRegistration {
			registration := testNativeRegistration("installation-0006")
			registration.FCMInstallationID = "bad:installation:id"
			return registration
		}(),
		func() NativeEndpointRegistration {
			registration := testNativeRegistration("installation-0007")
			registration.FCMInstallationID = "invalid token"
			return registration
		}(),
		func() NativeEndpointRegistration {
			registration := testNativeRegistration("installation-0008")
			registration.ClientPublicKey = []byte("not-a-key")
			return registration
		}(),
	}
	for index, registration := range cases {
		if _, err := core.RegisterNativeEndpoint(ctx, "user-1", registration); err == nil {
			t.Fatalf("case %d unexpectedly succeeded", index)
		}
	}
}

func TestNativeOutboxIsIdempotentCollapsedAndLeased(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	endpoint, err := core.RegisterNativeEndpoint(ctx, "user-1", testNativeRegistration("installation-0009"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	first := testNativeNotification("notification-1", "user-1", "room-1", now)
	if count, err := core.EnqueueNativeNotification(ctx, first); err != nil || count != 1 {
		t.Fatalf("enqueue first = %d, %v", count, err)
	}
	if count, err := core.EnqueueNativeNotification(ctx, first); err != nil || count != 0 {
		t.Fatalf("enqueue duplicate = %d, %v", count, err)
	}

	second := testNativeNotification("notification-2", "user-1", "room-1", now.Add(time.Second))
	if count, err := core.EnqueueNativeNotification(ctx, second); err != nil || count != 1 {
		t.Fatalf("enqueue collapsed replacement = %d, %v", count, err)
	}
	if count, err := core.countNativeOutboxForEndpoint(ctx, endpoint.EndpointID); err != nil || count != 1 {
		t.Fatalf("outbox count = %d, %v, want 1", count, err)
	}

	claimed, err := core.ClaimNativeNotificationOutbox(ctx, "worker-0001", now.Add(2*time.Second), 10, time.Minute)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %#v, %v", claimed, err)
	}
	if claimed[0].Item.NotificationID != second.Id || claimed[0].Item.Attempts != 1 {
		t.Fatalf("claimed item = %#v", claimed[0])
	}
	if other, err := core.ClaimNativeNotificationOutbox(ctx, "worker-0002", now.Add(3*time.Second), 10, time.Minute); err != nil || len(other) != 0 {
		t.Fatalf("concurrent claim = %#v, %v", other, err)
	}

	if err := core.RetryNativeNotificationOutbox(ctx, claimed[0], "worker-0001", "http_503", 2*time.Second, now.Add(4*time.Second)); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if early, err := core.ClaimNativeNotificationOutbox(ctx, "worker-0002", now.Add(5*time.Second), 10, time.Minute); err != nil || len(early) != 0 {
		t.Fatalf("early retry claim = %#v, %v", early, err)
	}
	reclaimed, err := core.ClaimNativeNotificationOutbox(ctx, "worker-0002", now.Add(7*time.Second), 10, time.Minute)
	if err != nil || len(reclaimed) != 1 {
		t.Fatalf("reclaim = %#v, %v", reclaimed, err)
	}
	if err := core.CompleteNativeNotificationOutbox(ctx, reclaimed[0], "worker-0002"); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if count, err := core.countNativeOutboxForEndpoint(ctx, endpoint.EndpointID); err != nil || count != 0 {
		t.Fatalf("completed outbox count = %d, %v", count, err)
	}
	current, _, err := core.GetNativeEndpoint(ctx, "user-1", endpoint.EndpointID)
	if err != nil || current.LastDeliveryStatus != NativeDeliveryStatusDeliveredToTransport {
		t.Fatalf("delivery status = %#v, %v", current, err)
	}
}

func TestNativeOutboxReconciliationRecoversMissingIntent(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	endpoint, err := core.RegisterNativeEndpoint(ctx, "user-1", testNativeRegistration("installation-0010"))
	if err != nil {
		t.Fatal(err)
	}
	notification := testNativeNotification("notification-recovery", "user-1", "room-2", time.Now().UTC())
	data, err := notificationMarshal(notification)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := core.storage.runtimeStateKV.Create(ctx, notificationKey("user-1", notification.Id), data, jetstream.KeyTTL(time.Hour)); err != nil {
		t.Fatal(err)
	}

	reconciled, err := core.ReconcileNativeNotificationOutbox(ctx, 100)
	if err != nil || reconciled != 1 {
		t.Fatalf("reconcile = %d, %v", reconciled, err)
	}
	if count, err := core.countNativeOutboxForEndpoint(ctx, endpoint.EndpointID); err != nil || count != 1 {
		t.Fatalf("reconciled outbox count = %d, %v", count, err)
	}
	if again, err := core.ReconcileNativeNotificationOutbox(ctx, 100); err != nil || again != 0 {
		t.Fatalf("idempotent reconcile = %d, %v", again, err)
	}
}

func TestDeleteAllUserNativeEndpointsRemovesOnlyTargetUser(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	for index := range 2 {
		registration := testNativeRegistration(fmt.Sprintf("installation-a-%04d", index))
		if _, err := core.RegisterNativeEndpoint(ctx, "user-a", registration); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := core.RegisterNativeEndpoint(ctx, "user-b", testNativeRegistration("installation-b-0001")); err != nil {
		t.Fatal(err)
	}

	deleted, err := core.DeleteAllUserNativeEndpoints(ctx, "user-a")
	if err != nil || deleted != 2 {
		t.Fatalf("DeleteAllUserNativeEndpoints = %d, %v", deleted, err)
	}
	if endpoints, err := core.ListNativeEndpoints(ctx, "user-a", true); err != nil || len(endpoints) != 0 {
		t.Fatalf("user-a endpoints = %#v, %v", endpoints, err)
	}
	if endpoints, err := core.ListNativeEndpoints(ctx, "user-b", true); err != nil || len(endpoints) != 1 {
		t.Fatalf("user-b endpoints = %#v, %v", endpoints, err)
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func notificationMarshal(notification *corev1.Notification) ([]byte, error) {
	return proto.Marshal(notification)
}

func TestNativeOutboxExpiredNotificationIsNotEnqueued(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	if _, err := core.RegisterNativeEndpoint(ctx, "user-1", testNativeRegistration("installation-0011")); err != nil {
		t.Fatal(err)
	}
	expired := testNativeNotification("notification-expired", "user-1", "room-1", time.Now().Add(-time.Hour))
	if count, err := core.EnqueueNativeNotification(ctx, expired); err != nil || count != 0 {
		t.Fatalf("expired enqueue = %d, %v", count, err)
	}
}
