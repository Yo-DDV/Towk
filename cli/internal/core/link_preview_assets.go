package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	linkPreviewRateLimitKeyPrefix = "link_preview_rate_limit."
	linkPreviewAssetKeyPrefix     = "link_preview_asset."
	linkPreviewClaimStaleAfter    = time.Minute
)

var (
	ErrLinkPreviewRateLimitExceeded = errors.New("link preview rate limit exceeded")
	ErrLinkPreviewClaimBusy         = errors.New("link preview image claim in progress")
)

type linkPreviewAssetStatus string

const (
	linkPreviewAssetPending  linkPreviewAssetStatus = "pending"
	linkPreviewAssetClaiming linkPreviewAssetStatus = "claiming"
	linkPreviewAssetClaimed  linkPreviewAssetStatus = "claimed"
	linkPreviewAssetDeleting linkPreviewAssetStatus = "deleting"
)

type linkPreviewAssetRecord struct {
	AssetID        string                 `json:"asset_id"`
	Status         linkPreviewAssetStatus `json:"status"`
	CreatedAt      time.Time              `json:"created_at"`
	ClaimEventID   string                 `json:"claim_event_id,omitempty"`
	ClaimStartedAt time.Time              `json:"claim_started_at,omitempty"`
}

// ReserveLinkPreviewFetch atomically reserves a fetch budget for both the
// request source and the authenticated actor. Cached requests are counted too:
// they still consume server work and must not bypass abuse controls.
func (c *ChattoCore) ReserveLinkPreviewFetch(ctx context.Context, actorID string) (time.Duration, error) {
	window := c.config.Assets.LinkPreviews.FetchWindowOrDefault()
	ipHash := "unknown"
	if metadata := AuditRequestMetadataFromContext(ctx); metadata != nil && metadata.GetIpHash() != "" {
		ipHash = metadata.GetIpHash()
	}
	dimensions := []struct {
		name    string
		subject string
		limit   int
	}{
		{name: "ip", subject: ipHash, limit: c.config.Assets.LinkPreviews.FetchPerIPOrDefault()},
		{name: "user", subject: actorID, limit: c.config.Assets.LinkPreviews.FetchPerUserOrDefault()},
	}
	var longestRetry time.Duration
	for _, dimension := range dimensions {
		if dimension.subject == "" {
			continue
		}
		hash := c.runtimeTokenHash("link_preview_rate_limit."+dimension.name, dimension.subject)
		key := linkPreviewRateLimitKeyPrefix + dimension.name + "." + hash
		retryAfter, err := c.reserveFixedWindowRateLimit(
			ctx,
			key,
			dimension.limit,
			window,
			ErrLinkPreviewRateLimitExceeded,
		)
		if retryAfter > longestRetry {
			longestRetry = retryAfter
		}
		if err != nil {
			return longestRetry, err
		}
	}
	return 0, nil
}

func linkPreviewAssetKey(assetID string) string {
	return linkPreviewAssetKeyPrefix + assetID
}

func (c *ChattoCore) recordPendingLinkPreviewAsset(ctx context.Context, assetID string, createdAt time.Time) error {
	record := linkPreviewAssetRecord{
		AssetID:   assetID,
		Status:    linkPreviewAssetPending,
		CreatedAt: createdAt,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal pending link preview asset: %w", err)
	}
	if _, err := c.storage.runtimeStateKV.Create(ctx, linkPreviewAssetKey(assetID), data); err != nil {
		return fmt.Errorf("create pending link preview asset: %w", err)
	}
	return nil
}

func (c *ChattoCore) readLinkPreviewAsset(ctx context.Context, assetID string) (linkPreviewAssetRecord, uint64, error) {
	entry, err := c.storage.runtimeStateKV.Get(ctx, linkPreviewAssetKey(assetID))
	if err != nil {
		return linkPreviewAssetRecord{}, 0, err
	}
	var record linkPreviewAssetRecord
	if err := json.Unmarshal(entry.Value(), &record); err != nil {
		return linkPreviewAssetRecord{}, entry.Revision(), fmt.Errorf("decode link preview asset %s: %w", assetID, err)
	}
	if record.AssetID != assetID {
		return linkPreviewAssetRecord{}, entry.Revision(), fmt.Errorf("link preview lifecycle key for %s contains asset %s", assetID, record.AssetID)
	}
	return record, entry.Revision(), nil
}

func (c *ChattoCore) updateLinkPreviewAsset(ctx context.Context, record linkPreviewAssetRecord, revision uint64) error {
	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("marshal link preview asset %s: %w", record.AssetID, err)
	}
	if _, err := c.storage.runtimeStateKV.Update(ctx, linkPreviewAssetKey(record.AssetID), data, revision); err != nil {
		return err
	}
	return nil
}

// beginLinkPreviewAssetClaim binds a pending image to the event ID that is
// about to make it durable. It returns true only when the caller must finalize
// or abort the claim. Legacy objects and already-claimed images are unmanaged.
func (c *ChattoCore) beginLinkPreviewAssetClaim(ctx context.Context, assetID, eventID string) (bool, error) {
	if assetID == "" || eventID == "" {
		return false, nil
	}
	for range authRateLimitMaxRetries {
		record, revision, err := c.readLinkPreviewAsset(ctx, assetID)
		if err != nil {
			if !isRuntimeStateKeyAbsent(err) {
				return false, err
			}
			// Assets outside LINK_PREVIEW_ASSETS predate this lifecycle and remain
			// readable through the legacy server/S3 probes.
			info, infoErr := c.storage.linkPreviewAssets.GetInfo(ctx, assetID)
			if errors.Is(infoErr, jetstream.ErrObjectNotFound) {
				return false, nil
			}
			if infoErr != nil {
				return false, fmt.Errorf("inspect link preview asset %s: %w", assetID, infoErr)
			}
			if err := c.recordPendingLinkPreviewAsset(ctx, assetID, info.ModTime); err != nil {
				if errors.Is(err, jetstream.ErrKeyExists) {
					continue
				}
				return false, err
			}
			continue
		}

		switch record.Status {
		case linkPreviewAssetClaimed:
			return false, nil
		case linkPreviewAssetClaiming:
			if record.ClaimEventID == eventID {
				return true, nil
			}
			if c.linkPreviewClaimProjected(record.AssetID, record.ClaimEventID) {
				record.Status = linkPreviewAssetClaimed
				record.ClaimStartedAt = time.Time{}
				if err := c.updateLinkPreviewAsset(ctx, record, revision); err == nil {
					return false, nil
				} else if isRuntimeStateRevisionConflict(err) {
					continue
				} else {
					return false, err
				}
			}
			if time.Since(record.ClaimStartedAt) < linkPreviewClaimStaleAfter {
				return false, ErrLinkPreviewClaimBusy
			}
		case linkPreviewAssetPending:
		case linkPreviewAssetDeleting:
			return false, ErrLinkPreviewClaimBusy
		default:
			return false, fmt.Errorf("link preview asset %s has invalid status %q", assetID, record.Status)
		}

		record.Status = linkPreviewAssetClaiming
		record.ClaimEventID = eventID
		record.ClaimStartedAt = time.Now()
		if err := c.updateLinkPreviewAsset(ctx, record, revision); err == nil {
			return true, nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return false, err
		}
	}
	return false, fmt.Errorf("link preview asset claim conflict after %d retries", authRateLimitMaxRetries)
}

func (c *ChattoCore) finalizeLinkPreviewAssetClaim(ctx context.Context, assetID, eventID string) error {
	for range authRateLimitMaxRetries {
		record, revision, err := c.readLinkPreviewAsset(ctx, assetID)
		if err != nil {
			return err
		}
		if record.Status == linkPreviewAssetClaimed {
			return nil
		}
		if record.Status != linkPreviewAssetClaiming || record.ClaimEventID != eventID {
			return fmt.Errorf("link preview asset %s is not claimed by event %s", assetID, eventID)
		}
		record.Status = linkPreviewAssetClaimed
		record.ClaimStartedAt = time.Time{}
		if err := c.updateLinkPreviewAsset(ctx, record, revision); err == nil {
			return nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return err
		}
	}
	return fmt.Errorf("finalize link preview asset claim conflict after %d retries", authRateLimitMaxRetries)
}

func (c *ChattoCore) abortLinkPreviewAssetClaim(ctx context.Context, assetID, eventID string) error {
	for range authRateLimitMaxRetries {
		record, revision, err := c.readLinkPreviewAsset(ctx, assetID)
		if err != nil {
			if isRuntimeStateKeyAbsent(err) {
				return nil
			}
			return err
		}
		if record.Status != linkPreviewAssetClaiming || record.ClaimEventID != eventID {
			return nil
		}
		record.Status = linkPreviewAssetPending
		record.ClaimEventID = ""
		record.ClaimStartedAt = time.Time{}
		if err := c.updateLinkPreviewAsset(ctx, record, revision); err == nil {
			return nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return err
		}
	}
	return fmt.Errorf("abort link preview asset claim conflict after %d retries", authRateLimitMaxRetries)
}

// handleFailedLinkPreviewAppend rolls a claim back only when no durable EVT
// sequence was assigned. A non-zero sequence means the append committed and
// only a later projection wait failed; cleanup must repair that claiming state.
func (c *ChattoCore) handleFailedLinkPreviewAppend(ctx context.Context, assetID, eventID string, sequenceID uint64) error {
	if sequenceID != 0 {
		return nil
	}
	return c.abortLinkPreviewAssetClaim(ctx, assetID, eventID)
}

func (c *ChattoCore) linkPreviewClaimProjected(assetID, eventID string) bool {
	if assetID == "" || eventID == "" {
		return false
	}
	body, retracted, found := c.rooms().latestBody(eventID)
	if !found || retracted || body == nil || body.GetLinkPreview() == nil {
		return false
	}
	preview := body.GetLinkPreview()
	return preview.GetImageAssetId() == assetID || preview.GetImageAsset().GetId() == assetID
}

// ensureLinkPreviewCompatibilityLink keeps new preview images readable by
// replicas that only know SERVER_ASSETS. The link carries no duplicate payload;
// NATS resolves it to the quota-bounded LINK_PREVIEW_ASSETS object.
func (c *ChattoCore) ensureLinkPreviewCompatibilityLink(ctx context.Context, target *jetstream.ObjectInfo) error {
	if target == nil || target.Name == "" {
		return fmt.Errorf("link preview target is required")
	}
	existing, err := c.storage.serverAssets.GetInfo(ctx, target.Name)
	if err == nil {
		if existing.Opts == nil || existing.Opts.Link == nil {
			return fmt.Errorf("SERVER_ASSETS object %s already exists and is not a compatibility link", target.Name)
		}
		if linkPreviewCompatibilityLinkMatches(existing, target) {
			return nil
		}
	} else if !errors.Is(err, jetstream.ErrObjectNotFound) {
		return fmt.Errorf("inspect SERVER_ASSETS compatibility link %s: %w", target.Name, err)
	}
	if _, err := c.storage.serverAssets.AddLink(ctx, target.Name, target); err != nil {
		// A transport error can arrive after the metadata was committed. Re-read
		// the link before rolling back the target so an acknowledged-by-storage
		// success is not converted into a dangling link.
		persisted, inspectErr := c.storage.serverAssets.GetInfo(ctx, target.Name)
		if inspectErr == nil && linkPreviewCompatibilityLinkMatches(persisted, target) {
			return nil
		}
		return errors.Join(
			fmt.Errorf("link SERVER_ASSETS/%s to %s/%s: %w", target.Name, target.Bucket, target.Name, err),
			inspectErr,
		)
	}
	return nil
}

func linkPreviewCompatibilityLinkMatches(link, target *jetstream.ObjectInfo) bool {
	return link != nil && target != nil &&
		link.Opts != nil && link.Opts.Link != nil &&
		link.Opts.Link.Bucket == target.Bucket && link.Opts.Link.Name == target.Name
}

func (c *ChattoCore) deleteLinkPreviewCompatibilityLink(ctx context.Context, target *jetstream.ObjectInfo) error {
	existing, err := c.storage.serverAssets.GetInfo(ctx, target.Name)
	if errors.Is(err, jetstream.ErrObjectNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect SERVER_ASSETS compatibility link %s: %w", target.Name, err)
	}
	if existing.Opts == nil || existing.Opts.Link == nil {
		return fmt.Errorf("refusing to delete non-link SERVER_ASSETS object %s", target.Name)
	}
	if !linkPreviewCompatibilityLinkMatches(existing, target) {
		return fmt.Errorf(
			"refusing to delete SERVER_ASSETS link %s targeting %s/%s",
			target.Name,
			existing.Opts.Link.Bucket,
			existing.Opts.Link.Name,
		)
	}
	if err := c.storage.serverAssets.Delete(ctx, target.Name); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
		return err
	}
	return nil
}

// cleanupExpiredLinkPreviewAssets deletes unclaimed or no-longer-referenced
// objects after the composer/cache grace period. Current projected references
// dominate every lifecycle status, and a crash after a durable message append
// is repaired from the room projection before physical deletion.
func (c *ChattoCore) cleanupExpiredLinkPreviewAssets(ctx context.Context, now time.Time) error {
	objects, err := c.storage.linkPreviewAssets.List(ctx)
	if errors.Is(err, jetstream.ErrNoObjectsFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list link preview assets: %w", err)
	}
	var cleanupErr error
	cutoff := now.Add(-c.config.Assets.LinkPreviews.PendingTTLOrDefault())
	expired := objects[:0]
	for _, info := range objects {
		if info.Deleted {
			continue
		}
		if err := c.ensureLinkPreviewCompatibilityLink(ctx, info); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("repair SERVER_ASSETS compatibility link %s: %w", info.Name, err))
		}
		if !info.ModTime.After(cutoff) {
			expired = append(expired, info)
		}
	}
	if len(expired) == 0 {
		return cleanupErr
	}
	referencedAssetIDs := c.rooms().currentLinkPreviewAssetIDs()
	for _, info := range expired {
		record, revision, recordErr := c.readLinkPreviewAsset(ctx, info.Name)
		if _, referenced := referencedAssetIDs[info.Name]; referenced {
			switch {
			case recordErr == nil:
				if record.Status != linkPreviewAssetClaimed {
					record.Status = linkPreviewAssetClaimed
					record.ClaimStartedAt = time.Time{}
					if err := c.updateLinkPreviewAsset(ctx, record, revision); err != nil {
						if isRuntimeStateRevisionConflict(err) {
							continue
						}
						cleanupErr = errors.Join(cleanupErr, fmt.Errorf("repair referenced link preview %s: %w", info.Name, err))
					}
				}
			case isRuntimeStateKeyAbsent(recordErr):
				record = linkPreviewAssetRecord{
					AssetID:   info.Name,
					Status:    linkPreviewAssetClaimed,
					CreatedAt: info.ModTime,
				}
				data, marshalErr := json.Marshal(record)
				if marshalErr != nil {
					cleanupErr = errors.Join(cleanupErr, fmt.Errorf("marshal referenced link preview repair %s: %w", info.Name, marshalErr))
				} else if _, createErr := c.storage.runtimeStateKV.Create(ctx, linkPreviewAssetKey(info.Name), data); createErr != nil && !errors.Is(createErr, jetstream.ErrKeyExists) {
					cleanupErr = errors.Join(cleanupErr, fmt.Errorf("create referenced link preview repair %s: %w", info.Name, createErr))
				}
			default:
				// Corrupt lifecycle metadata must never make a referenced object
				// deletable. Surface the error and leave the bytes intact.
				cleanupErr = errors.Join(cleanupErr, recordErr)
			}
			continue
		}
		if recordErr == nil {
			if record.Status == linkPreviewAssetClaiming && c.linkPreviewClaimProjected(info.Name, record.ClaimEventID) {
				record.Status = linkPreviewAssetClaimed
				record.ClaimStartedAt = time.Time{}
				if err := c.updateLinkPreviewAsset(ctx, record, revision); err != nil {
					cleanupErr = errors.Join(cleanupErr, fmt.Errorf("repair link preview claim %s: %w", info.Name, err))
				}
				continue
			}
			if record.Status == linkPreviewAssetClaiming && now.Sub(record.ClaimStartedAt) < linkPreviewClaimStaleAfter {
				continue
			}
			if record.Status != linkPreviewAssetDeleting {
				record.Status = linkPreviewAssetDeleting
				record.ClaimEventID = ""
				record.ClaimStartedAt = time.Time{}
				if err := c.updateLinkPreviewAsset(ctx, record, revision); err != nil {
					if isRuntimeStateRevisionConflict(err) {
						// A concurrent message claim won. Re-evaluate next pass.
						continue
					}
					cleanupErr = errors.Join(cleanupErr, fmt.Errorf("reserve link preview deletion %s: %w", info.Name, err))
					continue
				}
			}
		} else if !isRuntimeStateKeyAbsent(recordErr) {
			cleanupErr = errors.Join(cleanupErr, recordErr)
			continue
		} else {
			// Orphans can exist if a process stopped after ObjectStore.Put and
			// before the lifecycle record was created. Claim the deletion key so
			// a concurrent post cannot recreate a pending state around deletion.
			record = linkPreviewAssetRecord{
				AssetID:   info.Name,
				Status:    linkPreviewAssetDeleting,
				CreatedAt: info.ModTime,
			}
			data, marshalErr := json.Marshal(record)
			if marshalErr != nil {
				cleanupErr = errors.Join(cleanupErr, fmt.Errorf("marshal orphan link preview deletion %s: %w", info.Name, marshalErr))
				continue
			}
			if _, createErr := c.storage.runtimeStateKV.Create(ctx, linkPreviewAssetKey(info.Name), data); createErr != nil {
				if errors.Is(createErr, jetstream.ErrKeyExists) {
					continue
				}
				cleanupErr = errors.Join(cleanupErr, fmt.Errorf("reserve orphan link preview deletion %s: %w", info.Name, createErr))
				continue
			}
		}

		if err := c.deleteLinkPreviewCompatibilityLink(ctx, info); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("delete SERVER_ASSETS compatibility link %s: %w", info.Name, err))
			continue
		}
		if err := c.storage.linkPreviewAssets.Delete(ctx, info.Name); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("delete expired link preview asset %s: %w", info.Name, err))
			continue
		}
		if err := c.storage.runtimeStateKV.Delete(ctx, linkPreviewAssetKey(info.Name)); err != nil && !isRuntimeStateKeyAbsent(err) {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("delete link preview lifecycle %s: %w", info.Name, err))
		}
		if _, err := c.media().DeleteCachedResizesForServerAsset(ctx, info.Name); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("delete link preview resizes %s: %w", info.Name, err))
		}
	}
	return cleanupErr
}
