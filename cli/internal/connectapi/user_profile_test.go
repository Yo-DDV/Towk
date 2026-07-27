package connectapi

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func profileRequest(userID string) *connect.Request[apiv1.GetUserProfileRequest] {
	return connect.NewRequest(&apiv1.GetUserProfileRequest{
		Target: &apiv1.GetUserProfileRequest_UserId{UserId: userID},
	})
}

func TestGetUserProfileRequiresAuthentication(t *testing.T) {
	env := newConnectAPITestEnv(t)
	_, err := env.users.GetUserProfile(env.ctx, profileRequest(env.viewer.GetId()))
	requireConnectCode(t, err, connect.CodeUnauthenticated)
}

func TestGetUserProfileReturnsDetailedPrivacyAwareProfile(t *testing.T) {
	env := newConnectAPITestEnv(t)
	target, err := env.core.CreateUser(env.ctx, core.SystemActorID, "profile-target", "Profile Target", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := env.core.CreateServerRole(env.ctx, core.SystemActorID, "vip", "Community VIP", "Honorific role"); err != nil {
		t.Fatalf("CreateServerRole: %v", err)
	}
	if err := env.core.AssignServerRole(env.ctx, core.SystemActorID, target.GetId(), "vip"); err != nil {
		t.Fatalf("AssignServerRole vip: %v", err)
	}
	if err := env.core.AssignServerRole(env.ctx, core.SystemActorID, target.GetId(), core.RoleModerator); err != nil {
		t.Fatalf("AssignServerRole moderator: %v", err)
	}
	biography := "## Builder\n\nShips **carefully**."
	if err := env.core.UpdateUserBiography(env.ctx, target.GetId(), biography); err != nil {
		t.Fatalf("UpdateUserBiography: %v", err)
	}
	if err := env.core.SetPresence(env.ctx, target.GetId(), core.PresenceStatusOnline); err != nil {
		t.Fatalf("SetPresence: %v", err)
	}

	ctx := withCaller(env.ctx, env.viewer)
	response, err := env.users.GetUserProfile(ctx, profileRequest(target.GetId()))
	if err != nil {
		t.Fatalf("GetUserProfile: %v", err)
	}
	profile := response.Msg.GetProfile()
	if profile == nil || profile.GetUser().GetId() != target.GetId() {
		t.Fatalf("profile user = %+v", profile.GetUser())
	}
	if profile.GetBiographyMarkdown() != biography {
		t.Fatalf("biography = %q, want %q", profile.GetBiographyMarkdown(), biography)
	}
	if !profile.GetLastActivityVisible() || profile.GetLastActivity() == nil {
		t.Fatalf("default last activity = visible:%v value:%v", profile.GetLastActivityVisible(), profile.GetLastActivity())
	}
	if profile.GetViewerIsSelf() {
		t.Fatal("viewer_is_self = true for another user")
	}
	if !profile.GetViewerCanMessage() {
		t.Fatal("viewer_can_message = false")
	}
	if profile.GetViewerCanCall() {
		t.Fatal("viewer_can_call = true without configured LiveKit")
	}

	roles := make(map[string]*apiv1.UserProfileRole, len(profile.GetRoles()))
	for _, role := range profile.GetRoles() {
		roles[role.GetName()] = role
	}
	if got := roles["vip"]; got == nil || got.GetDisplayName() != "Community VIP" || got.GetModeration() {
		t.Fatalf("vip role = %+v", got)
	}
	if got := roles[core.RoleModerator]; got == nil || !got.GetModeration() {
		t.Fatalf("moderator role = %+v", got)
	}

	env.api.config.LiveKit = config.LiveKitConfig{
		Enabled:   true,
		URL:       "ws://livekit.invalid",
		APIKey:    "test-key",
		APISecret: "test-secret",
	}
	response, err = env.users.GetUserProfile(ctx, profileRequest(target.GetId()))
	if err != nil {
		t.Fatalf("GetUserProfile with LiveKit: %v", err)
	}
	if !response.Msg.GetProfile().GetViewerCanCall() {
		t.Fatal("viewer_can_call = false with configured LiveKit")
	}

	hidden := false
	if _, err := env.core.UpdateUserSettings(env.ctx, target.GetId(), core.UserSettingsInput{ShowLastActivity: &hidden}); err != nil {
		t.Fatalf("hide last activity: %v", err)
	}
	response, err = env.users.GetUserProfile(ctx, profileRequest(target.GetId()))
	if err != nil {
		t.Fatalf("GetUserProfile after opt-out: %v", err)
	}
	profile = response.Msg.GetProfile()
	if profile.GetLastActivityVisible() || profile.GetLastActivity() != nil {
		t.Fatalf("hidden last activity leaked: visible=%v value=%v", profile.GetLastActivityVisible(), profile.GetLastActivity())
	}
}

func TestUpdateProfilePrevalidatesBiographyBeforeIdentityMutations(t *testing.T) {
	env := newConnectAPITestEnv(t)
	ctx := withCaller(env.ctx, env.viewer)
	before, err := env.core.GetUser(env.ctx, env.viewer.GetId())
	if err != nil {
		t.Fatalf("GetUser before update: %v", err)
	}
	originalDisplayName := before.GetDisplayName()
	originalLogin := before.GetLogin()

	displayName := "Should Not Persist"
	login := "should-not-persist"
	invalidBiography := strings.Repeat("x", core.MaxUserBiographyBytes+1)
	_, err = env.account.UpdateProfile(ctx, connect.NewRequest(&apiv1.UpdateProfileRequest{
		DisplayName:       &displayName,
		Login:             &login,
		BiographyMarkdown: &invalidBiography,
	}))
	requireConnectCode(t, err, connect.CodeInvalidArgument)

	after, err := env.core.GetUser(env.ctx, env.viewer.GetId())
	if err != nil {
		t.Fatalf("GetUser after rejected update: %v", err)
	}
	if after.GetDisplayName() != originalDisplayName || after.GetLogin() != originalLogin {
		t.Fatalf(
			"identity changed after invalid biography: display=%q login=%q, want %q/%q",
			after.GetDisplayName(),
			after.GetLogin(),
			originalDisplayName,
			originalLogin,
		)
	}
	biography, err := env.core.GetUserBiography(env.ctx, env.viewer.GetId())
	if err != nil {
		t.Fatalf("GetUserBiography: %v", err)
	}
	if biography != "" {
		t.Fatalf("biography = %q, want empty", biography)
	}
}
