package connectapi

import (
	"testing"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func presenceSessionRequest(
	status apiv1.PresenceStatus,
	userSelected bool,
	installationID string,
	sessionID string,
	active bool,
) *connect.Request[apiv1.UpdatePresenceRequest] {
	return connect.NewRequest(&apiv1.UpdatePresenceRequest{
		Status:         status,
		UserSelected:   userSelected,
		InstallationId: installationID,
		SessionId:      sessionID,
		Active:         active,
	})
}

func releasePresenceInstallationRequest(installationID string) *connect.Request[apiv1.UpdatePresenceRequest] {
	return connect.NewRequest(&apiv1.UpdatePresenceRequest{
		Status:              apiv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
		UserSelected:        true,
		InstallationId:      installationID,
		ReleaseInstallation: true,
	})
}

func TestMyAccountServiceSessionAwarePresence(t *testing.T) {
	env := newConnectAPITestEnv(t)
	ctx := withCaller(env.ctx, env.viewer)

	active, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		false,
		"install-a",
		"tab-a",
		true,
	))
	if err != nil {
		t.Fatalf("active UpdatePresence: %v", err)
	}
	if active.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE {
		t.Fatalf("active status = %v, want ONLINE", active.Msg.GetStatus())
	}

	away, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_AWAY,
		false,
		"install-a",
		"tab-a",
		false,
	))
	if err != nil {
		t.Fatalf("away UpdatePresence: %v", err)
	}
	if away.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_AWAY {
		t.Fatalf("away status = %v, want AWAY", away.Msg.GetStatus())
	}

	otherActive, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		false,
		"install-b",
		"tab-b",
		true,
	))
	if err != nil {
		t.Fatalf("other active UpdatePresence: %v", err)
	}
	if otherActive.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE {
		t.Fatalf("other active status = %v, want ONLINE", otherActive.Msg.GetStatus())
	}

	released, err := env.account.UpdatePresence(ctx, releasePresenceInstallationRequest("install-a"))
	if err != nil {
		t.Fatalf("release install-a: %v", err)
	}
	if released.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE {
		t.Fatalf("status after releasing install-a = %v, want ONLINE from install-b", released.Msg.GetStatus())
	}

	released, err = env.account.UpdatePresence(ctx, releasePresenceInstallationRequest("install-b"))
	if err != nil {
		t.Fatalf("release install-b: %v", err)
	}
	if released.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_OFFLINE {
		t.Fatalf("status after releasing all installations = %v, want OFFLINE", released.Msg.GetStatus())
	}
}

func TestMyAccountServiceSessionPresenceValidatesMetadata(t *testing.T) {
	env := newConnectAPITestEnv(t)
	ctx := withCaller(env.ctx, env.viewer)

	partial := connect.NewRequest(&apiv1.UpdatePresenceRequest{
		Status:         apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		InstallationId: "install-a",
		Active:         true,
	})
	if _, err := env.account.UpdatePresence(ctx, partial); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("partial metadata code = %v, want invalid_argument", connect.CodeOf(err))
	}

	if _, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		false,
		"bad.install",
		"tab-a",
		true,
	)); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("invalid installation code = %v, want invalid_argument", connect.CodeOf(err))
	}

	badRelease := releasePresenceInstallationRequest("install-a")
	badRelease.Msg.SessionId = "tab-a"
	if _, err := env.account.UpdatePresence(ctx, badRelease); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("release with session id code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

func TestMyAccountServiceManualPresenceOverridesSessionAggregate(t *testing.T) {
	env := newConnectAPITestEnv(t)
	ctx := withCaller(env.ctx, env.viewer)

	manual, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_DO_NOT_DISTURB,
		true,
		"install-a",
		"tab-a",
		true,
	))
	if err != nil {
		t.Fatalf("manual DND: %v", err)
	}
	if manual.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_DO_NOT_DISTURB {
		t.Fatalf("manual status = %v, want DND", manual.Msg.GetStatus())
	}

	automatic, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		false,
		"install-b",
		"tab-b",
		true,
	))
	if err != nil {
		t.Fatalf("automatic online: %v", err)
	}
	if automatic.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_DO_NOT_DISTURB {
		t.Fatalf("automatic aggregate = %v, want DND", automatic.Msg.GetStatus())
	}

	cleared, err := env.account.UpdatePresence(ctx, presenceSessionRequest(
		apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		true,
		"install-b",
		"tab-b",
		true,
	))
	if err != nil {
		t.Fatalf("clear manual presence: %v", err)
	}
	if cleared.Msg.GetStatus() != apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE {
		t.Fatalf("cleared aggregate = %v, want ONLINE", cleared.Msg.GetStatus())
	}

	stored, err := env.core.GetUserPresence(env.ctx, env.viewer.Id)
	if err != nil {
		t.Fatalf("GetUserPresence: %v", err)
	}
	if stored != core.PresenceStatusOnline {
		t.Fatalf("stored aggregate = %q, want ONLINE", stored)
	}
}
