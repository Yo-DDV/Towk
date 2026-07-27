package core

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// RoomPurgeSnapshot is the minimum process-local reference set needed before
// an archived room aggregate is physically erased. It contains identifiers and
// detached attachment metadata only; message text is never copied into the
// purge journal or logs.
type RoomPurgeSnapshot struct {
	EventIDs            []string
	MessageEventIDs     []string
	AssetIDs            []string
	LinkPreviewAssetIDs []string
	LegacyAttachments   []*corev1.Attachment
}

// RoomPurgeCleanupProjection reacts to the durable RoomDeleted tombstone on
// every replica and releases private room content retained by sibling in-memory
// projections. It intentionally stores no independent state.
type RoomPurgeCleanupProjection struct {
	events.MemoryProjection
	waitForCurrent func(context.Context) error
	timeline       *RoomTimelineProjection
	threads        *ThreadProjection
	reactions      *ReactionProjection
	rbac           *RBACProjection
	config         *ConfigProjection
	calls          *CallStateProjection
}

func NewRoomPurgeCleanupProjection(
	waitForCurrent func(context.Context) error,
	timeline *RoomTimelineProjection,
	threads *ThreadProjection,
	reactions *ReactionProjection,
	rbac *RBACProjection,
	config *ConfigProjection,
	calls *CallStateProjection,
) *RoomPurgeCleanupProjection {
	return &RoomPurgeCleanupProjection{
		waitForCurrent: waitForCurrent,
		timeline:       timeline,
		threads:        threads,
		reactions:      reactions,
		rbac:           rbac,
		config:         config,
		calls:          calls,
	}
}

func (p *RoomPurgeCleanupProjection) Subjects() []string {
	return []string{events.RoomEventTypeFilter(events.EventRoomDeleted)}
}

func (p *RoomPurgeCleanupProjection) Apply(event *corev1.Event, _ uint64) error {
	if p == nil || event == nil {
		return nil
	}
	deleted := event.GetRoomDeleted()
	if deleted == nil || deleted.GetRoomId() == "" {
		return nil
	}
	// This cleanup projector has its own narrow consumer. It can observe the
	// RoomDeleted tombstone before the core's shared evt.> replay consumer has
	// applied every earlier room fact. Wait for the registered projections to
	// become current before releasing their target-room state; otherwise an
	// older message could be projected after cleanup and reintroduce private
	// content into memory on a replica.
	if p.waitForCurrent != nil {
		waitCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := p.waitForCurrent(waitCtx); err != nil {
			return fmt.Errorf("wait for core projections before room purge cleanup: %w", err)
		}
	}
	p.PurgeRoom(deleted.GetRoomId())
	return nil
}

func (p *RoomPurgeCleanupProjection) PurgeRoom(roomID string) {
	if p == nil || roomID == "" {
		return
	}
	if err := events.ValidateSecureDeleteAggregate(events.RoomAggregate(roomID)); err != nil {
		return
	}

	var snapshot RoomPurgeSnapshot
	if p.timeline != nil {
		snapshot = p.timeline.RoomPurgeSnapshot(roomID)
	}
	if p.threads != nil {
		p.threads.PurgeRoom(roomID, snapshot.MessageEventIDs, snapshot.EventIDs)
	}
	if p.reactions != nil {
		p.reactions.PurgeRoom(roomID, snapshot.MessageEventIDs, snapshot.EventIDs)
	}
	if p.rbac != nil {
		p.rbac.PurgeRoom(roomID)
	}
	if p.config != nil {
		p.config.PurgeRoom(roomID)
	}
	if p.calls != nil {
		p.calls.PurgeRoom(roomID)
	}
	if p.timeline != nil {
		p.timeline.PurgeRoom(roomID)
	}
}

// RoomPurgeCleanupService is a narrow durable projector that is started by the
// HTTP runtime on every replica. Unlike a Core-NATS live subscription, it
// replays a missed RoomDeleted tombstone after reconnect or process restart.
type RoomPurgeCleanupService struct {
	projection *RoomPurgeCleanupProjection
	projector  *events.Projector
}

func (c *ChattoCore) NewRoomPurgeCleanupService() (*RoomPurgeCleanupService, error) {
	if c == nil || c.js == nil || c.storage == nil || c.storage.serverEvtStream == nil {
		return nil, fmt.Errorf("room purge cleanup dependencies are unavailable")
	}
	projection := NewRoomPurgeCleanupProjection(
		c.WaitForProjectionsCurrent,
		c.RoomTimeline,
		c.Threads,
		c.Reactions,
		c.RBAC,
		c.ServerConfig,
		c.CallState,
	)
	return &RoomPurgeCleanupService{
		projection: projection,
		projector: events.NewProjector(
			c.js,
			c.storage.serverEvtStream,
			projection,
			c.logger.WithPrefix("core.RoomPurgeCleanup"),
		),
	}, nil
}

func (s *RoomPurgeCleanupService) Run(ctx context.Context) error {
	if s == nil || s.projector == nil {
		return fmt.Errorf("room purge cleanup service is unavailable")
	}
	return s.projector.Run(ctx)
}

func (s *RoomPurgeCleanupService) WaitForCurrent(ctx context.Context) error {
	if s == nil || s.projector == nil {
		return fmt.Errorf("room purge cleanup service is unavailable")
	}
	for !s.projector.Started() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Millisecond):
		}
	}
	return s.projector.WaitForCurrent(ctx)
}

func (s *RoomPurgeCleanupService) Healthy() error {
	if s == nil || s.projector == nil {
		return fmt.Errorf("room purge cleanup service is unavailable")
	}
	return s.projector.Err()
}

// ApplyRoomDeletionCleanup synchronously removes target-room content from this
// process. The durable cleanup service performs the same operation on every
// other replica and recovers missed live delivery by replaying the tombstone.
func (c *ChattoCore) ApplyRoomDeletionCleanup(roomID string) {
	if c == nil {
		return
	}
	NewRoomPurgeCleanupProjection(
		nil,
		c.RoomTimeline,
		c.Threads,
		c.Reactions,
		c.RBAC,
		c.ServerConfig,
		c.CallState,
	).PurgeRoom(roomID)
}

func (p *RoomTimelineProjection) RoomPurgeSnapshot(roomID string) RoomPurgeSnapshot {
	if p == nil || roomID == "" {
		return RoomPurgeSnapshot{}
	}
	p.RLock()
	defer p.RUnlock()

	eventIDs := make(map[string]struct{})
	messageIDs := make(map[string]struct{})
	assetIDs := make(map[string]struct{})
	previewIDs := make(map[string]struct{})
	legacyAttachments := make(map[string]*corev1.Attachment)

	for eventID, idx := range p.byEventID {
		entry := p.entryAtLocked(idx)
		if entry == nil || entry.Event == nil || roomIDOfEvent(entry.Event) != roomID {
			continue
		}
		if eventID != "" {
			eventIDs[eventID] = struct{}{}
		}
		if entry.Event.GetMessagePosted() != nil && eventID != "" {
			messageIDs[eventID] = struct{}{}
		}
	}
	for _, idx := range p.messagePostsByRoom[roomID] {
		entry := p.entryAtLocked(idx)
		if entry == nil || entry.Event == nil || entry.Event.GetId() == "" {
			continue
		}
		messageIDs[entry.Event.GetId()] = struct{}{}
		eventIDs[entry.Event.GetId()] = struct{}{}
	}

	for eventID := range messageIDs {
		body := p.latestBody[eventID]
		if body == nil {
			continue
		}
		for _, assetID := range body.GetAssetIds() {
			if assetID != "" {
				assetIDs[assetID] = struct{}{}
			}
		}
		if preview := body.GetLinkPreview(); preview != nil {
			assetID := preview.GetImageAssetId()
			if assetID == "" && preview.GetImageAsset() != nil {
				assetID = preview.GetImageAsset().GetId()
			}
			if assetID != "" {
				previewIDs[assetID] = struct{}{}
			}
		}
		for _, attachment := range body.GetAttachments() {
			if attachment == nil || attachment.GetId() == "" {
				continue
			}
			legacyAttachments[attachment.GetId()] = proto.Clone(attachment).(*corev1.Attachment)
		}
	}

	attachments := make([]*corev1.Attachment, 0, len(legacyAttachments))
	for _, attachment := range legacyAttachments {
		attachments = append(attachments, attachment)
	}
	sort.Slice(attachments, func(i, j int) bool {
		return attachments[i].GetId() < attachments[j].GetId()
	})
	return RoomPurgeSnapshot{
		EventIDs:            sortedSetKeys(eventIDs),
		MessageEventIDs:     sortedSetKeys(messageIDs),
		AssetIDs:            sortedSetKeys(assetIDs),
		LinkPreviewAssetIDs: sortedSetKeys(previewIDs),
		LegacyAttachments:   attachments,
	}
}

// PurgeRoom releases every process-local timeline reference for roomID. The
// immutable backing slice keeps holes so indexes for unrelated rooms remain
// stable; target event pointers and decrypted current bodies are cleared.
func (p *RoomTimelineProjection) PurgeRoom(roomID string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()

	eventIDs := make(map[string]struct{})
	messageIDs := make(map[string]struct{})
	entryIndexes := make(map[int]struct{})
	for eventID, idx := range p.byEventID {
		entry := p.entryAtLocked(idx)
		if entry == nil || entry.Event == nil || roomIDOfEvent(entry.Event) != roomID {
			continue
		}
		entryIndexes[idx] = struct{}{}
		if eventID != "" {
			eventIDs[eventID] = struct{}{}
		}
		if entry.Event.GetMessagePosted() != nil && eventID != "" {
			messageIDs[eventID] = struct{}{}
		}
	}
	for _, idx := range p.byRoom[roomID] {
		entryIndexes[idx] = struct{}{}
	}
	for _, idx := range p.messagePostsByRoom[roomID] {
		entryIndexes[idx] = struct{}{}
		entry := p.entryAtLocked(idx)
		if entry != nil && entry.Event != nil && entry.Event.GetId() != "" {
			eventIDs[entry.Event.GetId()] = struct{}{}
			messageIDs[entry.Event.GetId()] = struct{}{}
		}
	}
	for idx := range entryIndexes {
		entry := p.entryAtLocked(idx)
		if entry == nil || entry.Event == nil {
			continue
		}
		delete(p.byEventID, entry.Event.GetId())
		entry.Event = nil
	}

	for eventID := range messageIDs {
		delete(p.latestBody, eventID)
		delete(p.bodyEventSeqs, eventID)
		delete(p.currentBodySeq, eventID)
		delete(p.retractedFlags, eventID)
		delete(p.tombstonedAt, eventID)
		delete(p.hiddenEchoes, eventID)
		p.removeAttachmentMessageLocked(eventID)
		delete(p.echoLinks, eventID)
	}
	for originalID, echoIDs := range p.echoLinks {
		filtered := echoIDs[:0]
		for _, echoID := range echoIDs {
			if _, purged := messageIDs[echoID]; !purged {
				filtered = append(filtered, echoID)
			}
		}
		if len(filtered) == 0 {
			delete(p.echoLinks, originalID)
		} else {
			p.echoLinks[originalID] = filtered
		}
	}

	delete(p.byRoom, roomID)
	delete(p.messagePostsByRoom, roomID)
	delete(p.attachmentMessageIDsByRoom, roomID)
	p.assets.purgeRoom(roomID)
	p.replayGuard.forgetEventIDs(eventIDs)
}

func (p *ThreadProjection) PurgeRoom(roomID string, messageEventIDs, eventIDs []string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()

	messages := stringSet(messageEventIDs)

	for replyID, rootID := range p.messageToThread {
		_, replyPurged := messages[replyID]
		_, rootPurged := messages[rootID]
		if !replyPurged && !rootPurged {
			continue
		}
		delete(p.messageToThread, replyID)
		delete(p.replySummaries, replyID)
	}
	for rootID, entries := range p.byThread {
		if _, purged := messages[rootID]; purged {
			delete(p.byThread, rootID)
			delete(p.summaryByThread, rootID)
			continue
		}
		filtered := entries[:0]
		for _, entry := range entries {
			if _, purged := messages[entry.EventID]; purged {
				delete(p.replySummaries, entry.EventID)
				delete(p.messageToThread, entry.EventID)
				continue
			}
			filtered = append(filtered, entry)
		}
		if len(filtered) != len(entries) {
			p.byThread[rootID] = filtered
			p.recomputeSummaryLocked(rootID)
		}
	}

	for stateKey := range p.followState {
		parts := strings.Split(stateKey, "\x00")
		if len(parts) == 3 && parts[1] == roomID {
			delete(p.followState, stateKey)
		}
	}
	for key := range p.followers {
		parts := strings.Split(key, "\x00")
		if len(parts) == 2 && parts[0] == roomID {
			delete(p.followers, key)
		}
	}
	for userID, followed := range p.followedByUser {
		for key, ref := range followed {
			if ref.roomID == roomID {
				delete(followed, key)
			}
		}
		if len(followed) == 0 {
			delete(p.followedByUser, userID)
		}
	}
	p.replayGuard.forgetEventIDs(stringSet(eventIDs))
}

func (p *ReactionProjection) PurgeRoom(roomID string, messageEventIDs, eventIDs []string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()

	messages := stringSet(messageEventIDs)
	for eventID, ownerRoomID := range p.messageRoom {
		if ownerRoomID == roomID {
			messages[eventID] = struct{}{}
		}
	}
	for eventID := range messages {
		canonicalID := p.canonicalMessageEventIDLocked(eventID)
		if canonicalID != eventID && p.messageRoom[canonicalID] != roomID {
			// Corrupt or cross-room echo metadata must never let one room purge
			// erase another room's canonical reaction state.
			canonicalID = eventID
		}
		delete(p.byMessage, canonicalID)
		delete(p.byMessage, eventID)
		delete(p.messageRoom, eventID)
		delete(p.echoOriginal, eventID)
	}
	for echoID, originalID := range p.echoOriginal {
		if _, purged := messages[echoID]; purged {
			delete(p.echoOriginal, echoID)
			continue
		}
		if _, purged := messages[originalID]; purged {
			delete(p.echoOriginal, echoID)
		}
	}
	for assetID, ownerRoomID := range p.assetRoom {
		if ownerRoomID == roomID {
			delete(p.assetRoom, assetID)
		}
	}
	delete(p.roomSeq, roomID)
	p.replayGuard.forgetEventIDs(stringSet(eventIDs))
}

func (p *RBACProjection) PurgeRoom(roomID string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()
	for key := range p.decisions {
		if key.scope == ScopeRoom && key.scopeID == roomID {
			delete(p.decisions, key)
		}
	}
}

func (p *ConfigProjection) PurgeRoom(roomID string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()
	for userID, config := range p.users {
		if config == nil || config.roomLevelByRoom == nil {
			continue
		}
		delete(config.roomLevelByRoom, roomID)
		if len(config.roomLevelByRoom) == 0 {
			config.roomLevelByRoom = nil
		}
		if config.timezone == nil && config.timeFormat == nil && config.showLastActivity == nil &&
			config.serverLevel == nil && config.roomLevelByRoom == nil {
			delete(p.users, userID)
		}
	}
}

func (p *CallStateProjection) PurgeRoom(roomID string) {
	if p == nil || roomID == "" {
		return
	}
	p.Lock()
	defer p.Unlock()
	delete(p.rooms, roomID)
	delete(p.activeCalls, roomID)
	delete(p.connectionObservations, roomID)
	delete(p.roomSeq, roomID)
}

func (idx *roomTimelineAssetIndex) purgeRoom(roomID string) {
	if idx == nil || roomID == "" {
		return
	}
	assetIDs := make(map[string]struct{})
	for assetID := range idx.assetCreations {
		if idx.assetRoomIDLocked(assetID) == roomID {
			assetIDs[assetID] = struct{}{}
		}
	}
	for assetID, owner := range idx.messageOwners {
		if owner.roomID == roomID {
			assetIDs[assetID] = struct{}{}
		}
	}
	for assetID := range assetIDs {
		delete(idx.assetCreations, assetID)
		delete(idx.assetChildren, assetID)
		delete(idx.videoManifests, assetID)
		delete(idx.messageOwners, assetID)
	}
	for parentID, children := range idx.assetChildren {
		filtered := children[:0]
		for _, childID := range children {
			if _, purged := assetIDs[childID]; !purged {
				filtered = append(filtered, childID)
			}
		}
		if len(filtered) == 0 {
			delete(idx.assetChildren, parentID)
		} else {
			idx.assetChildren[parentID] = filtered
		}
	}
}

func (g *projectionReplayGuard) forgetEventIDs(eventIDs map[string]struct{}) {
	if g == nil || len(eventIDs) == 0 || len(g.eventIDs) == 0 {
		return
	}
	for eventID := range eventIDs {
		delete(g.eventIDs, eventID)
	}
}

func stringSet(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			out[value] = struct{}{}
		}
	}
	return out
}
