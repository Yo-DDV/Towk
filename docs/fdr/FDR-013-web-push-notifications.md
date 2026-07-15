# FDR-013: Web Push Notifications

**Status:** Active
**Last reviewed:** 2026-07-15

## Overview

Users can opt in to receive notifications through the browser's W3C Web Push system, so persistent notifications for joined-room messages, DMs, mentions, replies, and newly started calls can reach them even when the Towk tab isn't open. Push permission remains opt-in per device, requires operator configuration (VAPID keys), and piggybacks on the persistent notification system (see FDR-012).

## Behavior

- The browser prompts the user for notification permission when they enable push.
- If push is configured and supported, signed-in users without permission see a small, non-blocking top-overlay prompt. Choosing "not now" opens a second confirmation before snoozing the reminder for seven days on that device.
- A denied permission produces a warning with browser/OS recovery guidance. Towk refreshes permission state when the app regains focus or becomes visible, so revoking a previously granted permission restores the warning immediately.
- Permission alone is not treated as delivery proof. When permission is granted, Towk re-registers the current browser subscription with the server; if that reconciliation fails, the enable guard remains visible and the settings page does not claim that push is active. One background reconciliation owner reacts to startup, configuration/key changes, focus, visibility, and service-worker replacement; the settings page performs its own explicit health read while open, and all registration mutations are serialized.
- On granting permission, the browser creates a subscription using the server's VAPID public key. The subscription details (endpoint URL, keys) are sent to the server and stored.
- When a signed-in user opens Towk and browser notification permission is already granted, Towk refreshes the server's copy of the current browser subscription without prompting again.
- A hidden browser `applicationServerKey` is trusted only when Towk has a same-origin record of the VAPID key used for the last successful registration. Older unproven subscriptions are rotated once, so a server key change cannot leave an apparently healthy but permanently undeliverable endpoint.
- Malformed or partially created browser subscriptions are revoked before a later retry. A transient server failure does not revoke an existing valid browser subscription.
- A browser push endpoint is active for only the account that most recently registered it. Switching accounts in the same browser transfers delivery to the current account; stale records for the previous account are not delivered.
- In multi-server mode, native Web Push controls are shown only for the server that served the installed app. Remote servers can still update in-app notification badges and sounds while Towk is open, but they do not offer direct browser push registration from another server's app origin.
- On iOS/iPadOS, Web Push is available only for Home Screen web apps on supported versions. Towk treats Web Push as a notification trigger rather than authoritative app state and reconciles pending-notification count, native notifications, and dock badge state when the app is open.
- Stored subscription fields are bounded: endpoint 4,096 bytes, public key 256 bytes, auth secret 128 bytes, user agent 512 bytes, and locale 16 bytes. The locale is normalized to one of Towk's supported languages (`en`, `de`, `fr`, `es`, or `pt`), with English as the compatibility fallback.
- Subscription endpoints must be absolute HTTPS URLs without embedded credentials or local/private literal addresses. Delivery resolves the hostname itself, refuses any local, private, link-local, shared, benchmark, or reserved destination before opening the connection, bypasses ambient proxies, and does not follow redirects.
- A user can have multiple devices subscribed simultaneously — every device receives every push.
- Push payloads include a title localized for the browser subscription, a truncated message preview (max 100 chars, broken at word boundaries), a navigation URL, and the pending app badge count when available. Message, mention, reply, and room-message pushes also include a mutable declarative-compatible notification envelope. Call-start pushes stay on the imperative service-worker path for exact-call validation and progressive actions, but carry the same root app badge count so installed-app badges remain synchronized. The full-color Towk icon identifies the app, while Android receives a separate transparent monochrome 96 px badge so the operating system can mask and tint it without turning the whole icon into a blank square. The legacy root fields remain present so older Towk service workers can display the same notification during upgrades.
- Clicking a push notification navigates to the relevant room, thread, or DM.
- A call-start push is sent only to current members whose effective room level is ALL_MESSAGES. It uses high urgency, a 60-second provider TTL, and a per-call collapse topic; a worker that receives it after its payload expiry drops it before display.
- Call notifications are localized in the five bundled languages. Their ordinary click and “view” action open the room or private conversation without joining. Where the browser exposes notification actions, an explicit “join” action carries the advertised call ID; the server rejects it if that exact call ended or was replaced, so a stale click cannot start a new call. Browsers without action support retain the safe ordinary-click fallback.
- A call-end event closes the matching native notification in connected app instances through realtime state. Call pushes do not change the message-count app badge.
- While the origin PWA is open, realtime dismissal events ask its service worker to close the matching native notification on that browser. Towk does not send data-only Web Push messages for dismissals: Web Push subscriptions are `userVisibleOnly`, and a silent close-only event can cause Chromium to surface a generic background-update notification. A native notification already delivered to an offline device can therefore remain until the app reconnects, the user opens or dismisses it, or the origin account signs out.
- Immediately before a regular push is sent, Towk confirms that the notification is still pending and the exact prepared subscription is still active. A provider request already accepted after that final check cannot be revoked without sending another user-visible notification.
- While the PWA is open, its pending-notification state is authoritative for the app icon badge. Towk sends that state to both the page and service-worker Badging APIs and replays it when service-worker control becomes available or changes.
- Exact counts from ordinary pushes cannot regress merely because provider deliveries arrive out of order, even if the browser evicts and restarts the service worker between deliveries. A foreground read, notification click, or dismiss reconciliation starts a fresh count window. Realtime count/list refreshes run one at a time and coalesce concurrent invalidations into authoritative follow-up passes until the burst is clean, including after a transient failed pass.
- Expired or invalid subscriptions (browsers report 404/410 on push delivery) are cleaned up automatically.
- Signing out of the origin account revokes the browser subscription before navigation, closes every native notification for that app origin, clears both the visible and service-worker-persisted app badge state, and prevents an in-flight registration from recreating the endpoint. Browser revocation remains effective when the authenticated cleanup call is already unavailable; stale server records are removed on a later 404/410 push response.
- Deleting the origin account removes its pending notification state and push subscriptions. The deleting browser also revokes its endpoint and clears its native notifications during the logout transition; other offline devices rely on endpoint invalidation and their next local cleanup instead of receiving a silent close-only push.
- If the server isn't configured with VAPID keys, the push UI is hidden entirely — no opt-in prompt, no settings toggle.

## Design Decisions

### 1. Piggyback on persistent notifications

**Decision:** A push fires only when a persistent notification is created. The two share the same gating logic (mute, level, thread follow).
**Why:** Two parallel decision trees would inevitably diverge — a user who muted a room would still get pushed, or vice versa. One source of truth eliminates that bug class. See FDR-012.
**Tradeoff:** No way to push without also creating an in-app notification. Considered a feature, not a limitation: a push you can't find later in the app would be confusing.

### 2. Per-device subscriptions with exclusive endpoint ownership

**Decision:** Each browser subscription is stored in `RUNTIME_STATE` as its own record, identified by a hash of the push endpoint URL. A separate OCC-protected claim makes the exact current record active for only one account at a time.
**Why:** The same user might be subscribed from a laptop and a phone, and pushing to both is the expected behavior. A browser can also retain the same endpoint while the person signs out and into another account; exclusive ownership prevents pushes for the previous account from leaking into that shared browser. Tying the claim to the subscription revision also prevents a stale unsubscribe from releasing newly rotated credentials.
**Tradeoff:** Old non-owner records can remain stored but inert until normal unsubscribe or account cleanup. Records created by older versions have no claim and do not deliver until the browser reopens Towk and performs its normal startup registration.

### 3. VAPID with self-managed keys

**Decision:** Operators provide a VAPID key pair and subject (contact URL). Without configuration, the feature is disabled.
**Why:** VAPID is the standard for Web Push. Self-managed keys mean the operator's server is the only entity that can send push notifications to its users — no third-party relay. Hiding the UI when unconfigured prevents user confusion.
**Tradeoff:** Operators have to generate keys and configure them. The setup docs cover this; it's a one-time cost.

### 4. Automatic cleanup of expired subscriptions

**Decision:** When a push delivery returns 404/410, the server removes that subscription record.
**Why:** Browsers expire subscriptions over time (uninstalled PWA, revoked permission, expired keys). Without cleanup, the subscription store would grow forever with dead entries, wasting send attempts.
**Tradeoff:** A transient 410 from a flaky push provider would prematurely delete an active subscription. The provider's contract is that 410 means "gone for good", so we trust it.

### 5. Realtime native-notification cleanup without silent push

**Decision:** An open origin PWA closes its matching native notification from the normal realtime dismissal event. The server never sends a data-only Web Push solely to close notifications.
**Why:** Push subscriptions are created with `userVisibleOnly`. A service worker that handles a silent close-only push without displaying a notification can trigger a browser-owned fallback such as Chromium's generic background-update notice, which is worse than leaving an already delivered notification for local cleanup.
**Tradeoff:** A notification already visible on an offline secondary device can linger until that device reconnects to Towk or the user handles it. Reliable offline cross-device close would require a browser-standard operation that does not currently exist or a visible replacement notification, which would be misleading.

### 6. Foreground subscription reconciliation

**Decision:** Browser/OS notification permission is the user-facing gate, while a successful subscription reconciliation is the delivery-health check. When a signed-in client starts, regains focus, or becomes visible and permission is already granted, it idempotently saves the current browser subscription to the server.
**Why:** Browsers, especially installed PWAs, can rotate or invalidate push subscriptions around updates, and the server-side record can fail independently of permission. Refreshing and checking the delivery cache prevents an apparently enabled client from silently losing push.
**Tradeoff:** Towk cannot repair a browser subscription while the app is completely closed. The next launch, focus, or visibility transition is the first reliable opportunity to observe and refresh the state.

### 7. Confirmed, periodic local reminders for disabled push

**Decision:** The enable-push prompt is device-local and non-blocking. Dismissing it requires confirmation and snoozes it for seven days instead of suppressing it forever. A previously granted permission that becomes unavailable clears the snooze and restores the warning.
**Why:** Missing push means the user cannot receive message alerts while Towk is closed, so the consequence should remain visible without taking control away from the user. Device-local cadence matches the browser permission and subscription boundary.
**Tradeoff:** Users who deliberately keep notifications disabled see a weekly reminder on each affected device. They can continue using Towk after confirming their choice; Towk never bypasses or repeatedly invokes the native permission prompt without a user action.

### 8. Origin-bound native push registration

**Decision:** Direct browser push registration is offered only for the Towk server that served the installed web app.
**Why:** A browser push subscription belongs to a service worker origin and is created with a single application server key. Registering arbitrary remote servers from another server's app origin would imply cross-origin routing and VAPID-key behavior that Towk has not designed yet.
**Tradeoff:** Users connected to remote servers do not get native OS notifications for those servers through this app origin. They still get realtime in-app badges and notification sounds while Towk is open, and remote-native push can be revisited with an explicit relay or shared-key design.

### 9. Declarative-compatible payloads with service-worker fallback

**Decision:** Regular push notifications use a mutable Declarative Web Push JSON envelope while keeping the older Towk root fields in the same payload.
**Why:** Modern browsers can display the standard declarative notification if the service worker is unavailable, while browsers with the Towk worker installed still dispatch a push event so the worker can keep badge and click reconciliation behavior intact. Older browsers and already-installed Towk service workers keep using the legacy root fields.
**Tradeoff:** Payloads duplicate a small amount of title/body/navigation data and include WebKit's `app_badge` field when the count is available. That is preferable to a flag-day service-worker rollout, a second subscription path, or losing badge reconciliation on declarative-capable installed PWAs.

### 10. Delivery and badge-state revalidation

**Decision:** Regular push delivery revalidates both the pending notification and exact active subscription immediately before sending. The foreground app retains its latest authoritative badge intent, while the service worker persists a separate monotonic push-count window and serializes badge transitions across push, click, dismiss, and foreground events.
**Why:** Notification creation and dismissal callbacks run asynchronously, so revalidation prevents a stale notification from being submitted in the common pre-delivery race. Separately, first-page control, service-worker replacement, worker eviction, and reordered provider delivery can silently drop a clear or regress an exact count. Persisted separation of foreground/push state and serialized replay make the latest authoritative badge boundary win.
**Tradeoff:** The server check cannot revoke a request after the final validation has already passed and the push provider has accepted it. Full ordering would require a durable per-user delivery queue; Towk does not attempt to compensate with a silent Web Push because that violates the user-visible delivery contract.

### 11. Browser-owned installed-app controls

**Decision:** Towk uses `minimal-ui` as its preferred installed display mode and falls back directly to `browser`; it deliberately does not keep `standalone` in the display fallback chain.
**Why:** Chromium owns the Android URL-copy notification that can appear while a standalone installed PWA is open. It is created by the browser's installed-web-app integration, not by Towk's service worker or Web Push sender. Using `minimal-ui` gives Chromium a browser-owned URL/share affordance in the app frame instead of a persistent silent notification where the browser supports that mode. Setting the primary `display` field to `minimal-ui` also gives existing Chrome Android WebAPKs a manifest field that participates in Chrome's update checks.
**Tradeoff:** Android Chromium can show a minimal browser bar instead of a completely standalone frame. Browsers that cannot use `minimal-ui` may open Towk in a normal browser surface. Existing Android installs that still report the legacy standalone display mode are stopped by a blocking localized notice with a user-triggered Chrome Android intent action, because a same-scope `_blank` link can be recaptured by the installed PWA. A fully Teams-like Android installed-app notification model requires a packaged mobile distribution strategy rather than a web-manifest-only change.

### 12. Progressive call actions with exact-call validation

**Decision:** Call-start pushes use the service worker path instead of the declarative envelope so Towk can enforce expiry, localized copy, and optional “view”/“join” actions. The main click is always non-joining. Only the explicit join action adds `joinCall={callId}`, and `JoinCall` treats that value as an exact precondition rather than permission to create a call.
**Why:** Notification action support is not universal, especially across installed-PWA platforms. Progressive actions improve capable browsers without making the baseline click surprising or unsafe, and the backend precondition closes races after provider or user delay.
**Tradeoff:** Browsers that omit notification actions require one extra tap on the room's active-call button. This is preferable to auto-joining with a microphone or creating a replacement call from stale state.

## Permissions

No Towk-side permission gates push. The OS and browser permissions are the only user-facing gates; Towk's stored subscriptions are a refreshed delivery cache.

## Related

- **FDRs:** FDR-006 (@Mentions), FDR-012 (Notifications)
