# ADR-059: Managed FCM for Android and resident WebSocket notifications for Linux

**Status:** Accepted  
**Date:** 2026-08-10

## Context

Towk instances are self-hosted and cannot reliably wake an Android application
without using the platform push service. Distributing one Google service-account
credential to every instance would make revocation, quota control, abuse
response, and credential rotation unsafe. It would also put a shared private
credential in third-party infrastructure.

Linux desktop applications do not need a platform push provider while their
process is running. The authenticated Towk realtime connection already carries
the notification source of truth.

UnifiedPush and ntfy were evaluated for Android. They remain useful independent
ecosystem components, but they do not provide the consistent stock-Android wake
behaviour required by this phase. Web Push remains a separate browser/PWA
transport.

## Decision

### Android

Android uses `ANDROID_MANAGED_FCM`.

- A dedicated Towk relay is the only component that owns the Google
  service-account credential.
- Self-hosted instances enroll with an automatically generated Ed25519 identity
  and prove control of their public HTTPS origin.
- Instances sign short-lived relay requests containing an audience, issued-at
  time, expiry, unique nonce, and body digest.
- The instance retains the durable outbox and sends the current FCM registration
  token with each relay request. The relay does not need to retain that token.
- FCM messages are data-only. They carry an opaque, installation-encrypted wake
  signal, never message, room, person, media, or call content.
- After wake-up, Android reads the authoritative state from its Towk instance.

The Android application owns an installation encryption key protected by Android
Keystore. Token rotation never changes ownership: the authenticated user may
rotate or revoke only their own installation endpoints.

### Linux

Linux uses `LINUX_RESIDENT_WEBSOCKET`.

- The client derives native notifications from its authenticated instance
  WebSocket.
- No managed relay, FCM, ntfy, or other push provider is contacted.
- Web Push is disabled inside the native shell to prevent duplicates.
- Close-to-tray and autostart are explicit user options. An explicit process
  quit means no Linux notification is expected.

## Relay privacy boundary

The relay can observe unavoidable transport metadata: enrolled instance,
source IP, timestamps, request size, FCM token in transit, encrypted signal, and
FCM result class. It must not log or persist FCM tokens or encrypted payloads.
It cannot read message text, room or person names, media URLs, call content,
Towk session credentials, installation private keys, or Towk content keys.

Google receives the FCM token, delivery metadata, and encrypted data payload.
The administrator interface must state this boundary accurately and must not
claim that the relay is invisible or that Android delivery is fully independent
of Google.

## Enrollment and anti-abuse

Enrollment is manual and initiated by a server administrator:

1. The instance checks that its canonical URL is public HTTPS.
2. The relay issues a short-lived one-time challenge.
3. The instance publishes the challenge below its own
   `/.well-known/towk-managed-push` endpoint.
4. The relay fetches that exact same-origin endpoint with strict TLS, no
   cross-origin redirects, bounded response size and time, public-IP-only DNS
   resolution, and DNS-rebinding protection.
5. The relay pins the instance domain to its Ed25519 public key.

The relay applies nonce replay protection, per-instance and per-IP rate limits,
request and payload size limits, bounded deadlines, and revocation. A key
rotation requires proof from the current and replacement identities. Operator
revocation is fail-closed.

## Delivery semantics

The instance is the source of truth and owns:

- endpoint ownership and generation;
- transactional/reconcilable outbox creation;
- at-least-once delivery with `(notification_id, endpoint_id)` deduplication;
- per-kind TTL and collapse keys;
- bounded retries with exponential backoff, jitter, and `Retry-After`;
- terminal invalidation after the relay reports an unregistered FCM token;
- deletion on logout, account deletion, or installation removal.

The relay is synchronous. It normalizes FCM success, authentication failure,
rate limiting, transient failure, and terminal token invalidation. It does not
become a second notification source of truth.

## Limits

- Android delivery after the user explicitly force-stops the application is not
  promised.
- High-priority FCM is used only for immediate user-visible events such as an
  incoming call; Google may downgrade abusive or non-visible high-priority use.
- Incoming-call full-screen presentation depends on current Android permission
  and platform policy.
- A Linux process that is not running cannot receive resident notifications.
- iOS, macOS, and Windows are outside this implementation phase. A future iOS
  design must account for APNs even if FCM is used as an abstraction.

## Operational consequences

The relay is independently deployable and movable behind a stable DNS name.
Its database contains enrollment identities, revocation state, nonce hashes,
and bounded aggregate delivery metadata only. The Google credential is mounted
at runtime from an external secret and is never embedded in a repository,
container image, client package, CI artifact, log, or command argument.

Web Push remains unchanged. Native clients and mixed-version servers negotiate
capabilities and fail closed when the requested transport is unavailable.

## Rollback

Operators can disable managed Android delivery without disabling Web Push or
Linux realtime. An instance can revoke its enrollment and endpoints. Relay
operators can revoke an instance or the Google service-account key. Removing
the relay route does not alter Towk message state; queued outbox items expire
according to their original TTL.
