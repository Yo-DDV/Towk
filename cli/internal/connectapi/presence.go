package connectapi

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

const maxPresenceSessionMetadataLength = 96

func (s *accountService) UpdatePresence(ctx context.Context, req *connect.Request[apiv1.UpdatePresenceRequest]) (*connect.Response[apiv1.UpdatePresenceResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	installationID := strings.TrimSpace(req.Msg.GetInstallationId())
	sessionID := strings.TrimSpace(req.Msg.GetSessionId())
	releaseInstallation := req.Msg.GetReleaseInstallation()
	sessionAware := installationID != "" || sessionID != "" || releaseInstallation || req.Msg.GetActive() || req.Msg.GetMeaningfulActivity()

	if req.Msg.Status == apiv1.PresenceStatus_PRESENCE_STATUS_OFFLINE {
		if !releaseInstallation || !validPresenceSessionMetadataID(installationID) || sessionID != "" {
			return nil, connect.NewError(
				connect.CodeInvalidArgument,
				errors.New("OFFLINE requires a valid installation release without a session id"),
			)
		}
		storedStatus, err := s.api.core.ReleasePresenceInstallation(ctx, caller.UserID, installationID)
		if err != nil {
			return nil, connectError(err)
		}
		return connect.NewResponse(&apiv1.UpdatePresenceResponse{
			Status: corePresenceStatusToAPI(storedStatus),
		}), nil
	}

	status, err := apiPresenceStatusToCore(req.Msg.Status)
	if err != nil {
		return nil, err
	}

	var storedStatus string
	if sessionAware {
		if releaseInstallation ||
			!validPresenceSessionMetadataID(installationID) ||
			!validPresenceSessionMetadataID(sessionID) {
			return nil, connect.NewError(
				connect.CodeInvalidArgument,
				errors.New("presence installation and session ids are required and must be valid"),
			)
		}
		storedStatus, err = s.api.core.ReportPresenceSession(ctx, caller.UserID, core.PresenceSessionReport{
			InstallationID:     installationID,
			SessionID:          sessionID,
			Status:             status,
			Active:             req.Msg.GetActive(),
			UserSelected:       req.Msg.UserSelected,
			MeaningfulActivity: req.Msg.GetMeaningfulActivity(),
		})
		if errors.Is(err, core.ErrPresenceSessionLimit) {
			return nil, connect.NewError(connect.CodeResourceExhausted, err)
		}
		if errors.Is(err, core.ErrPresenceSessionBusy) {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
	} else {
		err = s.api.core.SetPresenceWithOptions(ctx, caller.UserID, status, req.Msg.UserSelected)
		if err == nil {
			storedStatus, err = s.api.core.GetUserPresence(ctx, caller.UserID)
		}
	}
	if err != nil {
		return nil, connectError(err)
	}

	return connect.NewResponse(&apiv1.UpdatePresenceResponse{
		Status: corePresenceStatusToAPI(storedStatus),
	}), nil
}

func validPresenceSessionMetadataID(value string) bool {
	if value == "" || len(value) > maxPresenceSessionMetadataLength {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func apiPresenceStatusToCore(status apiv1.PresenceStatus) (string, error) {
	switch status {
	case apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE:
		return core.PresenceStatusOnline, nil
	case apiv1.PresenceStatus_PRESENCE_STATUS_AWAY:
		return core.PresenceStatusAway, nil
	case apiv1.PresenceStatus_PRESENCE_STATUS_DO_NOT_DISTURB:
		return core.PresenceStatusDoNotDisturb, nil
	case apiv1.PresenceStatus_PRESENCE_STATUS_OFFLINE:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("OFFLINE is only valid for an installation release"))
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("status must be ONLINE, AWAY, or DO_NOT_DISTURB"))
	}
}

func corePresenceStatusToAPI(status string) apiv1.PresenceStatus {
	switch status {
	case core.PresenceStatusOffline:
		return apiv1.PresenceStatus_PRESENCE_STATUS_OFFLINE
	case core.PresenceStatusAway:
		return apiv1.PresenceStatus_PRESENCE_STATUS_AWAY
	case core.PresenceStatusDoNotDisturb:
		return apiv1.PresenceStatus_PRESENCE_STATUS_DO_NOT_DISTURB
	default:
		return apiv1.PresenceStatus_PRESENCE_STATUS_ONLINE
	}
}
