# FDR-011: User Presence

**Status:** Active
**Last reviewed:** 2026-08-06

## Overview

Every user has one server-wide presence status visible to others as a colored dot on their avatar: **Online**, **Away**, **Do Not Disturb**, or **Offline**. Presence is an ephemeral availability hint, not durable account history and not a statement that a browser process is currently executing.

Installed PWAs and mobile browsers can be frozen, suspended, discarded, or disconnected without a reliable final callback. Towk therefore derives public presence from authenticated, expiring session leases rather than treating a foreground WebSocket or a single browser tab as the user.

## Behavior

- Current clients report presence through `MyAccountService.UpdatePresence` on the ConnectRPC API.
- Each report carries an opaque browser-installation ID, an ephemeral page-session ID, the requested status, whether the page is active, and whether the report represents meaningful activity.
- In automatic mode, an active visible/focused page reports Online.
- A hidden page retains Online for 10 seconds, then reports Away.
- A visible but unfocused window retains Online for 30 seconds, then reports Away.
- A visible/focused page reports Away after 10 minutes without keyboard, pointer, wheel, scroll, or touch activity.
- Meaningful interaction, focus restoration, page resume, or visibility restoration returns automatic mode to Online immediately.
- Active sessions refresh every 30 seconds. Inactive sessions refresh every 5 minutes, reducing background traffic while remaining well inside the 45-minute recent-session lease.
- If an active client stops refreshing unexpectedly, its active lease expires after 60 seconds. The account becomes Away when another recent lease still exists.
- A recently observed installation remains Away for up to 45 minutes after its last successful report, then becomes Offline if no other active or recent session exists.
- All tabs, installed PWAs, browsers, profiles, and devices authenticated as the same user are aggregated. One active session keeps automatic presence Online; otherwise one recent session keeps it Away.
- Users can explicitly set Away or Do Not Disturb. These user-selected modes override automatic session aggregation until explicitly cleared or until no recent session remains.
- Choosing automatic mode explicitly clears a prior user-selected Away/DND before the session aggregate is recalculated.
- Choosing "Look offline" releases the current browser installation's ephemeral session leases and pauses its live event subscriptions. No durable invisible flag or presence history is stored. Another active device can still keep the account visible.
- Explicit sign-out releases the browser installation before invalidating authentication. Account/presence deletion removes all active and recent leases so a watcher cannot recreate presence for a deleted account.
- DND continues to preserve notification records while suppressing alerting behavior according to FDR-012.
- Presence dots update across the UI in real time only when the aggregated public status changes.
- Heartbeats and lease refreshes never advance profile latest activity. Only a foreground/resume transition, direct user interaction, or explicit presence choice may advance the privacy-aware latest-activity value.
- Disabling latest-activity visibility removes the stored value and filters it from profile responses as defined by FDR-022.

## Timing Contract

| Observation | Public automatic status | Boundary |
| --- | --- | ---: |
| Visible, focused, recently active page | Online | immediate |
| Page hidden or installed PWA backgrounded | Online grace, then Away | 10 seconds |
| Window visible but unfocused | Online grace, then Away | 30 seconds |
| Visible/focused without meaningful input | Away | 10 minutes |
| Active lease no longer refreshed | no stale Online beyond | 60 seconds |
| No active lease, at least one recent lease | Away | up to 45 minutes |
| No active or recent lease | Offline | after 45 minutes |
| Authenticated page resumes | Online | next successful report |

The 45-minute boundary is a product decision. It is intentionally longer than a brief application switch or mobile suspension, but bounded so abandoned installations cannot keep an account visible indefinitely.

## Storage and Aggregation

### Public aggregate

`MEMORY_CACHE` stores the public aggregate as:

```text
presence.{userId}
```

The value remains the existing `UserPresence` protobuf containing the public status and the `manually_set` marker. `OFFLINE` is represented by absence of this key.

### Session leases

Session-aware clients additionally maintain:

```text
presence-active.{userId}.{installationId}.{sessionId}
presence-recent.{userId}.{installationId}.{sessionId}
```

- active leases have a 60-second per-message TTL;
- recent leases have a 45-minute per-message TTL;
- installation IDs are opaque and stable for one browser installation;
- session IDs are opaque and unique to one page lifetime;
- IDs are validated and bounded before they can become NATS subjects;
- creation is serialized across replicas and capped at 8 recent sessions per installation and 32 per user;
- lease values carry no message content, room information, IP address, device name, operating-system name, or activity history.

A process-wide session hub watches lease membership. Refreshes of an existing key update an in-memory expiry deadline but do not fan out a presence event. The hub uses a stale-entry-tolerant min-heap and revision-guarded OCC deletion to enforce active and recent expiry even when a NATS configuration does not emit a delete marker for per-message TTL age-out. A timer observed before a concurrent refresh cannot delete the refreshed lease. Create/delete/expiry transitions trigger an idempotent reconciliation against the shared KV state, so multiple Towk replicas converge on the same aggregate.

## Design Decisions

### 1. Server-wide, not per-room

**Decision:** A user has one presence status across all spaces and rooms in one Towk server.

**Why:** Presence describes availability to the server, not selective participation in individual rooms. Room notification preferences remain separate.

**Tradeoff:** Users cannot appear online in one room and away in another.

### 2. Offline is inferred from bounded leases

**Decision:** Offline remains the absence of public presence, but the inference now uses active and recent session leases rather than one 60-second user key.

**Why:** Closing, suspending, freezing, discarding, losing network, or terminating a PWA are indistinguishable to the server. A lease gives a truthful statement: the server has or has not received sufficiently recent evidence.

**Tradeoff:** A user who really leaves Towk normally remains Away for 45 minutes. This is deliberate and preferable to falsely showing Offline during ordinary mobile app switching.

### 3. Session aggregation replaces last-writer-wins

**Decision:** Current clients identify a browser installation and page session. Public automatic presence is Online if any active lease exists, Away if only recent leases exist, and Offline if neither exists.

**Why:** A sleeping phone must not overwrite an active desktop, and one hidden tab must not erase another visible tab. Per-session leases provide deterministic multi-tab and multi-device behavior.

**Tradeoff:** Towk stores additional ephemeral KV keys proportional to concurrently recent page sessions. IDs are bounded, creation is serialized by a short distributed lock, and the server caps leases at 8 sessions per installation and 32 per user. Existing sessions remain refreshable at the cap.

### 4. Three independent automatic transitions

**Decision:** Automatic Away can result from 10 minutes of input inactivity, 10 seconds hidden, or 30 seconds visible-but-unfocused.

**Why:** These signals represent different user journeys. Separate grace periods avoid status flicker during app switching and false Online state for a covered desktop window.

**Tradeoff:** Focus and visibility remain approximations. Towk does not claim to know whether the person is physically at the device.

### 5. DND and explicit Away remain live user intent

**Decision:** User-selected Away/DND overrides automatic leases while at least one recent session remains. Explicit automatic/Online clears the override.

**Why:** A second device or tab must not defeat an intentional availability choice.

**Tradeoff:** The choice is live state, not durable account configuration. It disappears after the recent-session horizon when all clients stop reporting.

### 6. Invisible mode releases only the current installation

**Decision:** "Look offline" deletes the current installation's active and recent leases and pauses its live subscriptions. Towk stores no explicit invisible status.

**Why:** This makes the privacy action effective without pretending to hide other independently active devices. It also avoids a durable record of the user's choice.

**Tradeoff:** Another device signed into the same account can keep the aggregate Online or Away. The invisible client must catch up from projected reads when it returns.

### 7. Last activity is not transport liveness

**Decision:** Routine refreshes, retries, reconnects, and background lease maintenance do not change latest activity. The client marks only meaningful foreground/resume transitions and coalesced user interactions.

**Why:** A sleeping phone or surviving timer is not evidence that the person used Towk. Separating the signals avoids a misleading profile timestamp and unnecessary durable writes.

**Tradeoff:** Latest activity is intentionally approximate and can lag until the next bounded report. It is unsuitable for auditing, attendance, moderation evidence, or billing.

### 8. Mixed-version compatibility is additive

**Decision:** Session metadata is carried by additive fields on the existing `UpdatePresenceRequest`. New servers retain the previous single-key path when those fields are absent. Older servers ignore unknown protobuf fields and continue applying their legacy presence behavior.

**Why:** The request remains one authenticated ConnectRPC command, including for remote multi-server clients, without introducing custom CORS headers or a second transport. Generated clients stay schema-driven and rolling upgrades remain possible.

**Tradeoff:** Old clients keep the former 60-second last-writer behavior until upgraded. They can briefly compete with a session-aware aggregate during a mixed-version rollout, but their public key remains TTL-bounded.

## Failure and Recovery

- A failed report does not optimistically create server presence; the last accepted leases remain authoritative.
- A process crash does not erase shared leases. Other replicas and restarted watchers rebuild from `MEMORY_CACHE`.
- Duplicate reports are idempotent lease refreshes.
- Expiry cleanup is guarded by the exact KV revision observed by the watcher. A concurrent refresh wins and installs a new deadline instead of being removed by a stale timer.
- Explicit sign-out attempts installation release before logout; failure is bounded and does not trap the user because leases still expire automatically.
- Late reports cannot write another user's presence because caller identity comes from authenticated server context.
- Invalid, oversized, wildcard-bearing, partially supplied, or over-limit session identifiers are rejected.
- A lease refresh changes no public event when the aggregate remains unchanged.
- Returning from suspension immediately refreshes both active and recent evidence.

## Performance

- Active pages use the existing 30-second reporting cadence.
- Away/hidden/passive pages report only every 5 minutes while JavaScript is allowed to run.
- No service-worker daemon, silent push, wake lock, or extra polling channel is introduced.
- Public presence fanout remains deduplicated by `PresenceHub`.
- Session watchers react to membership changes rather than every refresh write.

## Permissions and Privacy

Presence status is public to authenticated users according to the existing server policy. Presence mutation remains self-only because the authenticated caller ID is authoritative; client-supplied IDs identify only that caller's installation/session.

Latest activity is a separate encrypted profile field filtered server-side by the target user's visibility preference and unavailable for deleted accounts. Session leases are ephemeral infrastructure metadata and are not exported as profile data or durable EVT history.

## Rollback

The change is additive and requires no durable migration. Reverting the session-aware code returns clients to the existing single-key 60-second behavior. `presence-active.*` and `presence-recent.*` keys expire automatically; they do not need destructive cleanup. The existing `presence.{userId}` protobuf and public event contracts remain compatible.

## Related

- **ADRs:** ADR-012 (two-tier real-time events), ADR-025 (multi-instance client architecture)
- **FDRs:** FDR-012 (Notifications), FDR-022 (User Profile)
