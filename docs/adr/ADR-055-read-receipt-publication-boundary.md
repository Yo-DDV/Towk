# ADR-055: Read Receipt Publication Boundary

**Date:** 2026-07-25

## Context

Towk already keeps private per-user read state for unread markers and notification dismissal. Read receipts add a public, reciprocal surface: another member may learn that a user has read a message.

A single cursor would be too coarse for this privacy boundary. If a user disables receipts, reads messages, and later re-enables the feature, a simple cursor could accidentally make disabled-period reads public. Thread timelines also need to stay separate from their parent room timeline.

## Decision

Read receipts are stored as server-authoritative publication state separate from private unread state.

Towk records public receipt progress as monotonic intervals scoped by room, optional thread root, user, and opt-in generation. Disabling the server or user setting stops new publication and inspection, but it does not rewind private unread markers. Re-enabling receipts starts a new publication generation, so messages read during the disabled interval are not backfilled.

The ConnectRPC API exposes three operations on the room service:

- advance the current user's public receipt for a room or thread;
- fetch count-only summaries for a bounded set of message event IDs;
- list readers for one message with pagination.

Realtime delivery uses an anonymous room-scoped invalidation containing only the room and optional thread root. It omits the reader, read timestamp, target message, sequence, envelope actor, and envelope creation time. Clients refetch authorized count-only summaries; reader identities and read timestamps remain behind the explicit paginated detail request.

## Consequences

- The privacy switch is durable across disable/enable cycles.
- Private unread markers, notification dismissal, and public receipts can evolve independently.
- Counts can be rendered without exposing reader identities in every message response or realtime frame.
- Reader identity and timestamp disclosure happens only after an explicit paginated request for one message.
- Old clients can continue to use private unread APIs. They do not publish receipts unless they call the new receipt API.
- Rollback can disable the feature at server level without migrating private unread state.
- The storage model adds room/thread/user-scoped keys that must be removed when the room or account lifecycle removes the underlying membership state.

## References

- [ADR-004: Authorization Enforced at the API Boundary](ADR-004-authorization-at-api-boundary.md)
- [ADR-028: Event-ID-Keyed Read State](ADR-028-event-id-keyed-read-state.md)
- [ADR-033: Event-Sourced State with Derived Projections](ADR-033-event-sourced-state-with-projections.md)
- [FDR-031: Read Receipts](../fdr/FDR-031-read-receipts.md)
