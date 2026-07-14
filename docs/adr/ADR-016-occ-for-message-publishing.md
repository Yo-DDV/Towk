# ADR-016: Optimistic Concurrency Control for Message Publishing

**Date:** 2026-03-01

## Context

When multiple users post messages simultaneously in the same room (or the same thread), the events must be ordered consistently. JetStream assigns sequence numbers to stream entries, but concurrent publishes to the same subject can race. Without coordination, two messages could claim the same logical position.

The options are:

- **Distributed locking**: Acquire a per-room lock before publishing. Guarantees ordering but adds latency and requires lock management (TTLs, deadlock detection).
- **At-least-once without coordination**: Publish freely and accept potential duplicates. Simpler but risks duplicate events for the same logical operation.
- **Optimistic concurrency control (OCC)**: Use JetStream's `ExpectLastSequencePerSubject` header to detect concurrent writes. Retry on conflict.

## Decision

Use OCC via `WithExpectLastSequencePerSubject`. Before publishing, the publisher reads the current last sequence for the subject. The publish includes this expected sequence as a header. If another publish landed first (sequence mismatch), JetStream rejects the publish and the client retries.

Retry policy: up to 5 attempts with exponential backoff (1ms, 2ms, 4ms, 8ms, 16ms) plus random jitter to avoid thundering herd on contention.

### Client retry identity

`MessageService.CreateMessage` accepts an optional, bounded `client_request_id`.
The authenticated actor, room, and request ID identify one logical send. The
server fingerprints the semantic request without the ID, converts that digest
to a server-keyed HMAC proof, and atomically appends a private
`MessageRequestClaimedEvent`, the encrypted body, and `MessagePostedEvent`.
The claim uses its own exact OCC subject:
`evt.room.{roomId}.message_request_claimed.{sha256(actorId, requestId)}`.

The first append expects that claim subject to be empty. A concurrent or later
retry with the same proof returns the already committed message after the room
projection catches up. Reusing the ID for different content returns
`ALREADY_EXISTS`. Authorization and validation are repeated on replay, and an
empty ID preserves the pre-existing non-idempotent API behavior. The raw
request digest is never persisted because a digest of a short message body
would weaken the encrypted-body boundary through offline guessing.

## Consequences

- **No distributed locks**: Message publishing doesn't require per-room locks, lock servers, or lock TTL management. This simplifies multi-process deployments.
- **Correct ordering under contention**: Two concurrent posts to the same room are serialized by JetStream's sequence check. One succeeds; the other retries with the updated sequence.
- **Low latency in the common case**: When there's no contention (the vast majority of publishes), OCC adds zero overhead — it's a single publish with a header. Retries only happen under genuine contention.
- **Bounded retries**: 5 attempts with ~31ms total max backoff. If contention is so high that 5 retries fail, the publish errors out. This is a safety valve, not a normal path.
- **Used beyond messages**: The same OCC mechanism is used for room layout updates and space config updates — any operation that appends to a subject where ordering matters.
- **Safe client retries**: foreground reconnect and PWA outbox retries can reuse
  one request ID without creating duplicate messages, including when the first
  response is lost after the batch commits.
- **Durable request claims**: one small internal event is retained per
  idempotent message. Claim events are hidden from room timelines and live
  delivery but remain available for restart-safe replay decisions.
