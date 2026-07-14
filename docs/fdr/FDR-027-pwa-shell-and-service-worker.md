# FDR-027: PWA Shell & Service Worker

**Status:** Active
**Last reviewed:** 2026-07-14

## Overview

Towk ships a service worker so the installed web app can launch reliably, update safely, and handle push notifications. The worker caches the SPA fallback shell, SvelteKit build assets, the manifest, and essential install icons during install, then caches other static PWA assets when the browser actually requests them. The web manifest remains network-first so current server branding wins online, with the cached copy used only when the network is unavailable. The worker deliberately does not cache chat data, API responses, live-event traffic, or protected uploaded asset bodies.

Offline support means the app can open and show its normal disconnected state instead of the browser's generic offline page. It does not mean offline message history, offline search, or an outbox for composing messages while disconnected.

Reconnect catch-up is owned by the foreground web app, not the service worker. When a controlled PWA tab wakes or reconnects, server-scoped stores refetch projected ConnectRPC state and the room UI refetches the currently viewed room/thread window. The worker must not cache or replay messages, API responses, or live-event traffic.

## Behavior

- The service worker is registered by SvelteKit in production builds.
- On install, the worker caches the SPA fallback shell and SvelteKit build assets required to boot it. If any required shell response is missing or unsuccessful, installation fails and the previous active worker remains in place.
- The worker also attempts to precache the manifest and bundled install, maskable, Apple touch, favicon, and offline-symbol icons. A temporary metadata/icon failure does not invalidate an otherwise complete executable shell.
- Updated workers wait until the foreground app says that reloading is safe. The app activates the waiting worker before reloading and does not auto-reload while the user is typing or in a call; the update action remains an explicit override.
- On activate, old Towk shell caches are deleted, navigation preload is enabled when supported, and the new worker claims open clients.
- Known shell assets are served cache-first from the versioned cache; static PWA assets other than the web manifest are cached lazily on first request.
- The served web manifest prefers the uploaded server logo when one exists, but keeps bundled Towk PNG icons as installable fallbacks. Apple touch icon metadata uses the uploaded server logo when available and falls back to the bundled Towk icon otherwise.
- Same-origin navigations are network-first and use a browser navigation preload when available, falling back to the cached SPA shell only when the network fails.
- The manifest is network-first with a cached fallback. API, auth, OAuth, webhook, uploaded-asset, non-GET, and cross-origin requests remain network-only.
- An offline launch renders a localized offline state without network-dependent images, with explicit retry guidance. A running client also shows one persistent offline notice and replaces it with a reconnecting notice when the browser reports network recovery.
- Protected uploaded asset loads use direct signed asset URLs owned by the foreground app. The worker does not receive registered-server API bearer tokens, does not proxy asset requests, and does not cache protected asset bodies.
- Push notifications continue to display native OS notifications and route notification clicks into the SPA.
- Push dismiss payloads still close matching visible notifications on the device.

## Design Decisions

### 1. Shell-only caching

**Decision:** Cache only the app shell and static PWA assets that do not expose private server state. Build assets are mandatory during install; install metadata and essential icons are best-effort during install; nonessential static assets are cached lazily. The manifest is refreshed from the network and falls back to its cached copy offline.
**Why:** Towk is a real-time chat app. Serving stale messages, permissions, assets, or notification state as if they were live would be worse than showing the disconnected state.
**Tradeoff:** Offline launches do not show recent rooms or messages unless the live app already has that state in memory, and full static asset coverage accumulates as the app requests assets. The cached manifest can briefly carry old branding while offline, but it is never preferred over a successful network response.

### 2. Versioned cache names

**Decision:** Shell caches include the SvelteKit app version in their name.
**Why:** A deploy can replace hashed JavaScript and CSS chunks. Versioned cache names let the new worker populate a fresh shell cache and delete older shell caches during activation.
**Tradeoff:** A user briefly stores two shell versions during update. The cached asset set is small, so this is acceptable.

### 3. SvelteKit owns registration

**Decision:** The frontend relies on SvelteKit's production service-worker registration instead of registering manually from the push-notification setup component.
**Why:** The service worker is now useful even when Web Push is not enabled. Registration should be tied to the PWA shell, not to push settings.
**Tradeoff:** Production users get the service worker whenever the app includes one. The worker's fetch policy is conservative to make that safe.

### 4. Protected assets stay outside the worker

**Decision:** Protected uploaded assets are loaded through direct signed asset URLs and refreshed by foreground components when they approach expiry or fail to load. The service worker treats uploaded assets as network-only and never proxies or caches their bodies.
**Why:** The asset tickets and `AssetService` refresh flow are the actual reliability and authorization mechanism. Keeping asset routing out of the worker removes hidden worker/client state and keeps the service worker focused on shell availability and notifications.
**Tradeoff:** Ticketed asset URLs are visible in normal page markup. Their exposure is bounded by the ticket expiry and by the server's room-membership check on every fetch.

### 5. Install metadata follows server branding

**Decision:** The HTTP frontend server generates the web manifest from the bundled manifest and prepends transformed server-logo URLs for install icons when a logo is configured, while preserving the bundled PNG manifest icons as acceptable browser fallbacks. The served HTML similarly replaces the Apple touch icon link with a fixed-size server-logo transform.
**Why:** Self-hosted servers should install with their own visible identity without requiring a custom frontend build.
**Tradeoff:** Browsers decide when to refresh installed PWA metadata, so existing installs may keep the previous icon until the browser updates the manifest or the user reinstalls the app. When a server logo transform is not accepted as an install icon by a browser, the static Towk PNG fallback preserves installability.

### 6. Updates are coordinated with foreground activity

**Decision:** A newly installed worker remains in the standard waiting phase. The foreground update notifier asks it to activate only when the user accepts the update or Towk's shared idle policy says a reload is safe, then waits for `controllerchange` before reloading.
**Why:** Unconditional `skipWaiting()` can put an older open document under a newer worker while the user is typing or in a voice/video call. Coordinating activation and reload keeps the document, cached shell, and routing policy on one version.
**Tradeoff:** A busy tab may keep the update waiting longer. A persistent update action and the next safe navigation provide bounded recovery without interrupting active work.

### 7. Portable reliability before platform-specific queues

**Decision:** Towk uses capabilities that degrade cleanly across current Safari/WebKit, Chromium, and Firefox: service-worker caching, navigation preload when exposed, online/offline lifecycle signals, Web Push, Notifications, and Badging behind feature detection. It does not automatically queue ConnectRPC mutations with Background Sync, request persistent storage during startup, or declare experimental launch/file/protocol handlers.
**Why:** Browser background execution is opportunistic, and Background Sync support is not portable. Replaying arbitrary authenticated mutations also requires an explicit per-command idempotency, expiry, authorization, encryption, and cancellation contract. Persistent storage may prompt in Firefox and should be requested from a meaningful user gesture only when critical unsynced local data exists. Experimental manifest handlers must not become required navigation behavior.
**Tradeoff:** Towk does not yet offer an offline outbox or offline message history. Those features require their own encrypted local-data and reconciliation design rather than a generic service-worker retry rule.

## Platform capability policy

- **iOS and iPadOS:** the shell and offline state use standard service-worker and cache behavior. Web Push and application badges remain progressive enhancements for Home Screen web apps, where WebKit exposes them after the user grants notification permission.
- **Android and Chromium desktop (Windows/Linux):** the same portable shell is used. Chromium-only install or background APIs may enhance later workflows, but Towk correctness does not depend on them.
- **Safari, Firefox, and other desktop browsers:** unsupported enhancement APIs are skipped. Network recovery continues through the normal WebSocket reconnect and foreground state catch-up paths.
- **Storage:** cache and browser storage remain eviction-tolerant. Towk will request persistent storage only from an explicit, relevant user action if a future feature introduces critical unsynced local data.

## Standards and vendor references

- [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [MDN: NavigationPreloadManager](https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager)
- [Chrome: Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
- [Chrome: Background Sync](https://developer.chrome.com/docs/workbox/modules/workbox-background-sync)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13966/web-push-for-web-apps-on-ios-and-ipados/)
- [MDN: StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

## Related

- **ADRs:** ADR-043 (client-shell internationalization), ADR-047 (direct ticketed asset URLs)
- **FDRs:** FDR-008 (File Attachments & Video Processing), FDR-012 (Notifications), FDR-013 (Web Push Notifications)
