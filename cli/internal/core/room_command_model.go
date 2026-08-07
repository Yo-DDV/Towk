package core

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func (c *ChattoCore) RoomCommands() *RoomCommandModel { return c.roomCommands }

type RoomCommandModel struct{ core *ChattoCore }

type RoomCreateInput struct {
	ActorID, GroupID, Name, Description string
	Universal                           bool
}

type RoomUpdateInput struct {
	ActorID, RoomID string
	Name            *string
	Description     *string
	Universal       *bool
}

type RoomIDInput struct{ ActorID, RoomID string }

type RoomPostingPolicyInput struct {
	ActorID          string
	RoomID           string
	ExpectedRevision uint64
	PostingPolicy    corev1.RoomPostingPolicy
}

type RoomHistoryPurgeInput struct {
	ActorID, RoomID string
	ExpectedRevision uint64
	ConfirmationName string
}

type RoomUserInput struct{ ActorID, RoomID, UserID string }

type RoomStartDMInput struct {
	ActorID        string
	ParticipantIDs []string
}

type RoomBanInput struct {
	ActorID, RoomID, UserID, Reason string
	ExpiresAt                       *time.Time
}

type RoomUnbanInput struct{ ActorID, RoomID, UserID, Reason string }

type RoomBanListInput struct {
	ActorID string
	RoomID  *string
}

func (s *RoomCommandModel) CreateRoom(ctx context.Context, input RoomCreateInput) (*corev1.Room, error) {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return nil, err }
	if err := validateRoomNameAndDescription(input.Name, input.Description); err != nil { return nil, err }
	can, err := s.core.CanCreateRoom(ctx, input.ActorID, KindChannel, input.GroupID)
	if err != nil { return nil, err }
	if !can { return nil, ErrPermissionDenied }
	return s.core.CreateRoom(ctx, input.ActorID, KindChannel, input.GroupID, input.Name, input.Description, WithUniversalRoom(input.Universal))
}

func (s *RoomCommandModel) UpdateRoom(ctx context.Context, input RoomUpdateInput) (*corev1.Room, error) {
	kind, err := s.authorizeRoomManage(ctx, input.ActorID, input.RoomID)
	if err != nil { return nil, err }
	if input.Name == nil && input.Description == nil && input.Universal == nil {
		return nil, fmt.Errorf("%w: provide at least one room field to update", ErrInvalidArgument)
	}
	room, err := s.core.GetRoom(ctx, kind, input.RoomID)
	if err != nil { return nil, err }
	if input.Universal != nil && kind == KindDM { return nil, fmt.Errorf("%w: DM rooms cannot be universal", ErrInvalidArgument) }
	name, description := room.GetName(), room.GetDescription()
	if input.Name != nil { name = *input.Name }
	if input.Description != nil { description = *input.Description }
	if err := validateRoomNameAndDescription(name, description); err != nil { return nil, err }
	if input.Name != nil || input.Description != nil {
		room, err = s.core.UpdateRoom(ctx, input.ActorID, kind, input.RoomID, name, description)
		if err != nil { return nil, err }
	}
	if input.Universal != nil {
		room, err = s.core.SetRoomUniversal(ctx, input.ActorID, kind, input.RoomID, *input.Universal)
		if err != nil { return nil, err }
	}
	return room, nil
}

func (s *RoomCommandModel) ArchiveRoom(ctx context.Context, input RoomIDInput) (*corev1.Room, error) {
	kind, err := s.authorizeRoomManage(ctx, input.ActorID, input.RoomID)
	if err != nil { return nil, err }
	return s.core.ArchiveRoom(ctx, input.ActorID, kind, input.RoomID)
}

func (s *RoomCommandModel) UnarchiveRoom(ctx context.Context, input RoomIDInput) (*corev1.Room, error) {
	kind, err := s.authorizeRoomManage(ctx, input.ActorID, input.RoomID)
	if err != nil { return nil, err }
	return s.core.UnarchiveRoom(ctx, input.ActorID, kind, input.RoomID)
}

func (s *RoomCommandModel) SetPostingPolicy(ctx context.Context, input RoomPostingPolicyInput) (*corev1.Room, error) {
	kind, err := s.authorizeRoomPermission(ctx, input.ActorID, input.RoomID, PermRoomLock)
	if err != nil { return nil, err }
	if kind != KindChannel { return nil, invalidArgument("DM rooms cannot be locked") }
	return s.core.SetRoomPostingPolicy(ctx, input.ActorID, input.RoomID, input.PostingPolicy, input.ExpectedRevision)
}

func (s *RoomCommandModel) PurgeHistory(ctx context.Context, input RoomHistoryPurgeInput) (*corev1.Room, *RoomHistoryPurgeOperation, error) {
	kind, err := s.authorizeRoomPermission(ctx, input.ActorID, input.RoomID, PermRoomPurgeMessages)
	if err != nil { return nil, nil, err }
	if kind != KindChannel { return nil, nil, invalidArgument("DM room history cannot be purged") }
	return s.core.StartRoomHistoryPurge(ctx, input)
}

func (s *RoomCommandModel) GetHistoryPurgeOperation(ctx context.Context, actorID, operationID string) (*RoomHistoryPurgeOperation, error) {
	if err := requireAuthenticatedActor(actorID); err != nil { return nil, err }
	operation, starterID, err := s.core.GetRoomHistoryPurgeOperation(ctx, operationID)
	if err != nil { return nil, err }
	if starterID == actorID { return operation, nil }
	can, err := s.core.PermResolver().HasRoomPermission(ctx, actorID, KindChannel, operation.RoomID, PermRoomPurgeMessages)
	if err != nil { return nil, err }
	if !can { return nil, ErrPermissionDenied }
	return operation, nil
}

func (s *RoomCommandModel) JoinRoom(ctx context.Context, input RoomIDInput) (*corev1.Room, error) {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return nil, err }
	kind, err := s.resolveRoomKind(ctx, input.RoomID)
	if err != nil { return nil, err }
	if kind == KindDM { return nil, invalidArgument("DM rooms cannot be joined through RoomService") }
	can, err := s.core.CanJoinRoomAt(ctx, input.ActorID, kind, input.RoomID)
	if err != nil { return nil, err }
	if !can { return nil, ErrPermissionDenied }
	if _, err := s.core.JoinRoom(ctx, input.ActorID, kind, input.ActorID, input.RoomID); err != nil { return nil, err }
	return s.core.GetRoom(ctx, kind, input.RoomID)
}

func (s *RoomCommandModel) LeaveRoom(ctx context.Context, input RoomIDInput) error {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return err }
	kind, err := s.resolveRoomKind(ctx, input.RoomID)
	if err != nil { return err }
	if kind == KindDM { return s.core.ForgetOneToOneDM(ctx, input.ActorID, input.RoomID) }
	return s.core.LeaveRoom(ctx, input.ActorID, kind, input.ActorID, input.RoomID)
}

func (s *RoomCommandModel) AddMember(ctx context.Context, input RoomUserInput) (*corev1.RoomMembership, error) {
	kind, err := s.authorizeRoomManage(ctx, input.ActorID, input.RoomID)
	if err != nil { return nil, err }
	if err := s.requireNonOwnerTarget(ctx, input.UserID); err != nil { return nil, err }
	return s.core.AddMember(ctx, input.ActorID, kind, input.RoomID, input.UserID)
}

func (s *RoomCommandModel) RemoveMember(ctx context.Context, input RoomUserInput) (bool, error) {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return false, err }
	kind, err := s.resolveRoomKind(ctx, input.RoomID)
	if err != nil { return false, err }
	if kind == KindDM { return false, invalidArgument("DM room participants cannot be managed through RoomService") }
	can, err := s.core.CanRemoveRoomMember(ctx, input.ActorID, kind, input.RoomID)
	if err != nil { return false, err }
	if !can { return false, ErrPermissionDenied }
	if err := s.requireNonOwnerTarget(ctx, input.UserID); err != nil { return false, err }
	return s.core.RemoveMember(ctx, input.ActorID, kind, input.RoomID, input.UserID)
}

func (s *RoomCommandModel) StartDM(ctx context.Context, input RoomStartDMInput) (*corev1.Room, bool, error) {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return nil, false, err }
	if len(input.ParticipantIDs) > MaxDMParticipants-1 { return nil, false, invalidArgument("DM conversations are limited to 10 participants") }
	can, err := s.core.CanStartDM(ctx, input.ActorID)
	if err != nil { return nil, false, err }
	if !can { return nil, false, ErrPermissionDenied }
	room, created, err := s.core.FindOrCreateDM(ctx, input.ActorID, input.ParticipantIDs)
	if err != nil { return nil, false, err }
	if !created && len(s.core.RoomMembership.Members(room.GetId())) == 2 {
		if err := s.core.RestoreOneToOneDMVisibility(ctx, input.ActorID, room.GetId()); err != nil { return nil, false, err }
	}
	return room, created, nil
}

func (s *RoomCommandModel) BanMember(ctx context.Context, input RoomBanInput) (*RoomBan, error) {
	kind, err := s.authorizeRoomBan(ctx, input.ActorID, input.RoomID)
	if err != nil { return nil, err }
	if err := s.requireNonOwnerTarget(ctx, input.UserID); err != nil { return nil, err }
	if err := validateRoomBanInput(input.Reason, input.ExpiresAt); err != nil { return nil, err }
	return s.core.BanMember(ctx, input.ActorID, kind, input.RoomID, input.UserID, input.Reason, input.ExpiresAt)
}

func (s *RoomCommandModel) UnbanMember(ctx context.Context, input RoomUnbanInput) error {
	kind, err := s.authorizeRoomBan(ctx, input.ActorID, input.RoomID)
	if err != nil { return err }
	if err := validateRoomBanReason(input.Reason); err != nil { return err }
	return s.core.UnbanMember(ctx, input.ActorID, kind, input.RoomID, input.UserID, input.Reason)
}

func (s *RoomCommandModel) ListActiveRoomBans(ctx context.Context, input RoomBanListInput) ([]RoomBan, error) {
	if err := requireAuthenticatedActor(input.ActorID); err != nil { return nil, err }
	if input.RoomID == nil {
		canListAll, err := s.core.PermResolver().HasServerPermission(ctx, input.ActorID, PermRoomMemberBan)
		if err != nil { return nil, err }
		if !canListAll { return nil, ErrPermissionDenied }
	}
	bans, err := s.core.ListActiveRoomBans(ctx, input.RoomID)
	if err != nil { return nil, err }
	filtered := make([]RoomBan, 0, len(bans))
	for _, ban := range bans {
		canModerate, err := s.core.PermResolver().HasRoomPermission(ctx, input.ActorID, KindChannel, ban.RoomID, PermRoomMemberBan)
		if err != nil { return nil, err }
		if canModerate { filtered = append(filtered, ban) }
	}
	if input.RoomID != nil && len(filtered) == 0 {
		canModerate, err := s.core.PermResolver().HasRoomPermission(ctx, input.ActorID, KindChannel, *input.RoomID, PermRoomMemberBan)
		if err != nil { return nil, err }
		if !canModerate { return nil, ErrPermissionDenied }
	}
	return filtered, nil
}

func (s *RoomCommandModel) requireNonOwnerTarget(ctx context.Context, userID string) error {
	isOwner, err := s.core.IsServerOwner(ctx, userID)
	if err != nil { return err }
	if isOwner { return ErrPermissionDenied }
	return nil
}

func (s *RoomCommandModel) authorizeRoomManage(ctx context.Context, actorID, roomID string) (RoomKind, error) {
	return s.authorizeRoomPermission(ctx, actorID, roomID, PermRoomManage)
}

func (s *RoomCommandModel) authorizeRoomPermission(ctx context.Context, actorID, roomID string, permission Permission) (RoomKind, error) {
	if err := requireAuthenticatedActor(actorID); err != nil { return KindChannel, err }
	kind, err := s.resolveRoomKind(ctx, roomID)
	if err != nil { return KindChannel, err }
	if kind == KindDM { return KindChannel, invalidArgument("DM rooms cannot be managed through RoomService") }
	can, err := s.core.PermResolver().HasRoomPermission(ctx, actorID, kind, roomID, permission)
	if err != nil { return KindChannel, err }
	if !can { return KindChannel, ErrPermissionDenied }
	return kind, nil
}

func (s *RoomCommandModel) authorizeRoomBan(ctx context.Context, actorID, roomID string) (RoomKind, error) {
	if err := requireAuthenticatedActor(actorID); err != nil { return KindChannel, err }
	kind, err := s.resolveRoomKind(ctx, roomID)
	if err != nil { return KindChannel, err }
	if kind == KindDM { return KindChannel, ErrCannotBanDMRoomMember }
	can, err := s.core.PermResolver().HasRoomPermission(ctx, actorID, kind, roomID, PermRoomMemberBan)
	if err != nil { return KindChannel, err }
	if !can { return KindChannel, ErrPermissionDenied }
	return kind, nil
}

func (s *RoomCommandModel) resolveRoomKind(ctx context.Context, roomID string) (RoomKind, error) {
	if strings.TrimSpace(roomID) == "" { return KindChannel, invalidArgument("room_id is required") }
	return s.core.FindRoomKind(ctx, roomID)
}

func validateRoomBanInput(reason string, expiresAt *time.Time) error {
	if err := validateRoomBanReason(reason); err != nil { return err }
	if expiresAt != nil && !expiresAt.After(time.Now()) { return invalidArgument("ban expiry must be in the future") }
	return nil
}

func validateRoomNameAndDescription(name, description string) error {
	if err := ValidateRoomName(name); err != nil { return invalidArgument(err.Error()) }
	if err := ValidateRoomDescription(description); err != nil { return invalidArgument(err.Error()) }
	return nil
}

func validateRoomBanReason(reason string) error {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" { return invalidArgument("ban reason is required") }
	if len([]rune(trimmed)) > MaxRoomBanReasonLength { return invalidArgument(fmt.Sprintf("ban reason exceeds %d characters", MaxRoomBanReasonLength)) }
	return nil
}
