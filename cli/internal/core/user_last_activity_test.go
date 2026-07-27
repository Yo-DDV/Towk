package core

import (
	"bytes"
	"sync"
	"testing"
	"time"
)

func TestRecordUserLastActivityIsEncryptedMonotonicAndCoalesced(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "last-activity", "Last Activity", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	initial := time.Date(2026, 7, 24, 12, 0, 0, 123, time.UTC)
	changed, err := core.recordUserLastActivity(ctx, user.GetId(), initial)
	if err != nil {
		t.Fatalf("record initial activity: %v", err)
	}
	if !changed {
		t.Fatal("initial activity did not change storage")
	}

	entry, err := core.storage.runtimeStateKV.Get(ctx, userLastActivityKey(user.GetId()))
	if err != nil {
		t.Fatalf("read runtime state: %v", err)
	}
	if bytes.Contains(entry.Value(), []byte(initial.Format(time.RFC3339Nano))) {
		t.Fatal("runtime state contains plaintext activity timestamp")
	}

	for name, observedAt := range map[string]time.Time{
		"older":             initial.Add(-time.Minute),
		"same":              initial,
		"inside coalescing": initial.Add(UserLastActivityCoalesceInterval - time.Second),
	} {
		t.Run(name, func(t *testing.T) {
			changed, err := core.recordUserLastActivity(ctx, user.GetId(), observedAt)
			if err != nil {
				t.Fatalf("record activity: %v", err)
			}
			if changed {
				t.Fatal("activity unexpectedly changed storage")
			}
		})
	}

	second := initial.Add(UserLastActivityCoalesceInterval)
	changed, err = core.recordUserLastActivity(ctx, user.GetId(), second)
	if err != nil {
		t.Fatalf("record coalesced activity: %v", err)
	}
	if !changed {
		t.Fatal("activity at coalescing boundary did not change storage")
	}
	got, err := core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity: %v", err)
	}
	if !got.Equal(second) {
		t.Fatalf("last activity = %s, want %s", got, second)
	}
}

func TestRecordUserLastActivityConcurrentWritersKeepLatestValue(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "last-activity-race", "Last Activity Race", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	start := time.Date(2026, 7, 24, 8, 0, 0, 0, time.UTC)
	const writers = 4
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		observedAt := start.Add(time.Duration(i) * (UserLastActivityCoalesceInterval + time.Minute))
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := core.recordUserLastActivity(ctx, user.GetId(), observedAt)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent record activity: %v", err)
		}
	}

	got, err := core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity: %v", err)
	}
	want := start.Add((writers - 1) * (UserLastActivityCoalesceInterval + time.Minute))
	if !got.Equal(want) {
		t.Fatalf("last activity = %s, want %s", got, want)
	}
}

func TestLastActivityVisibilityClearsAndStopsRecording(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "last-activity-privacy", "Last Activity Privacy", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	initial := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	if _, err := core.recordUserLastActivity(ctx, user.GetId(), initial); err != nil {
		t.Fatalf("record initial activity: %v", err)
	}

	hidden := false
	settings, err := core.UpdateUserSettings(ctx, user.GetId(), UserSettingsInput{ShowLastActivity: &hidden})
	if err != nil {
		t.Fatalf("disable last activity: %v", err)
	}
	if effectiveShowLastActivity(settings) {
		t.Fatal("last activity is still enabled")
	}
	got, err := core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity after opt-out: %v", err)
	}
	if !got.IsZero() {
		t.Fatalf("last activity after opt-out = %s, want zero", got)
	}

	if err := core.SetPresence(ctx, user.GetId(), PresenceStatusOnline); err != nil {
		t.Fatalf("SetPresence while hidden: %v", err)
	}
	got, err = core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity while hidden: %v", err)
	}
	if !got.IsZero() {
		t.Fatalf("hidden presence advanced last activity to %s", got)
	}

	visible := true
	settings, err = core.UpdateUserSettings(ctx, user.GetId(), UserSettingsInput{ShowLastActivity: &visible})
	if err != nil {
		t.Fatalf("enable last activity: %v", err)
	}
	if !effectiveShowLastActivity(settings) {
		t.Fatal("last activity is still disabled")
	}
	got, err = core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity after re-enable: %v", err)
	}
	if !got.IsZero() {
		t.Fatalf("stale last activity reappeared after re-enable: %s", got)
	}

	core.touchUserLastActivityIfKnown(ctx, user.GetId())
	got, err = core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity after visible activity: %v", err)
	}
	if got.IsZero() {
		t.Fatal("visible activity was not recorded")
	}
}

func TestDeleteUserRemovesAndCryptoShredsLastActivity(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "last-activity-delete", "Last Activity Delete", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := core.recordUserLastActivity(ctx, user.GetId(), time.Now().UTC()); err != nil {
		t.Fatalf("record activity: %v", err)
	}

	if err := core.DeleteUser(ctx, user.GetId(), user.GetId()); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	got, err := core.GetUserLastActivity(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserLastActivity after deletion: %v", err)
	}
	if !got.IsZero() {
		t.Fatalf("last activity after deletion = %s, want zero", got)
	}
}
