# FDR-027: PWA Shell & Service Worker

**Status:** Active
**Last reviewed:** 2026-07-20

## Overview

Towk ships a service worker so the installed web app can launch reliably, update safely, and handle push notifications. The worker caches the SPA fallback shell, SvelteKit build assets, and essential install icons during install, then caches other static PWA assets when the browser actually requests them. The web manifest is always network-only because it may carry current server branding and browsers must be able to refresh install metadata promptly. The worker deliberately does not cache chat data, API responses, live-event traffic, web-manifest responses, or protected uploaded asset bodies.

Offline support means the app can open and show its normal disconnected state instead of the browser's generic offline page. Authenticated accounts also keep bounded encrypted drafts and their pending attachments, pending text messages, and recent room timelines on the device. Cached timelines are visibly identified as cached state; they never masquerade as a live server response. Offline search and offline attachment upload are not supported.

Reconnect catch-up and outbox delivery are owned by the authenticated foreground web app, not the service worker. When a controlled PWA tab wakes or reconnects, server-scoped stores refetch projected ConnectRPC state, the room UI refetches the currently viewed room/thread window, and the foreground outbox retries pending sends. A Background Sync event can wake controlled clients, but the worker never receives credentials and never sends a message itself. The worker must not cache messages, API responses, or live-event traffic.

## Behavior

- The service worker is registered by SvelteKit in production builds.
- On install, the worker caches the SPA fallback shell and SvelteKit build assets required to boot it. If any required shell response is missing or unsuccessful, installation fails and the previous active worker remains in place.
- The worker also attempts to precache bundled install, maskable, Apple touch, favicon, and offline-symbol icons. A temporary icon failure does not invalidate an otherwise complete executable shell.
- Updated workers wait until the foreground app says that reloading is safe. The app activates the waiting worker before reloading and does not auto-reload while the user is typing or in a call; the update action remains an explicit override.
- On activate, old Towk shell caches are deleted, navigation preload is enabled when supported, and the new worker claims open clients.
- Known shell assets are served cache-first from the versioned cache; static PWA assets other than the web manifest are cached lazily on first request.
- The served web manifest prefers the uploaded server logo when one exists, but keeps bundled Towk PNG icons as installable fallbacks. Apple touch icon metadata uses the uploaded server logo when available and falls back to the bundled Towk icon otherwise.
- Same-origin navigations are network-first and use a browser navigation preload when available, falling back to the cached SPA shell only when the network fails.
- The manifest is network-only. API, auth, OAuth, webhook, uploaded-asset, non-GET, and cross-origin requests also remain network-only.
- An offline launch renders a localized offline state without network-dependent images, with explicit retry guidance. A running client also shows one persistent offline notice and replaces it with a reconnecting notice when the browser reports network recovery.
- Protected uploaded asset loads use direct signed asset URLs owned by the foreground app. The worker does not receive registered-server API bearer tokens, does not proxy asset requests, and does not cache protected asset bodies.
- Push notifications continue to display native OS notifications and route notification clicks into the SPA.
- Push dismiss payloads still close matching visible notifications on the device, and native notification-center closes are replayed through the next authenticated foreground app window so the server-side notification state can synchronize across devices.
- Text messages that fail for a retryable network reason can enter a bounded encrypted outbox. Each logical send keeps one stable client request ID, so a lost response and a retry cannot create duplicate messages. Users can inspect, retry, or discard pending items. Unuploaded attachments remain in the encrypted draft rather than entering the outbox and are uploaded after connectivity returns.
- Drafts and recent timeline windows are encrypted per server account with non-extractable device keys. Account removal writes a durable revocation tombstone and crypto-shreds that account namespace before an explicit sign-out redirect. Other open tabs stop new writes through an origin-scoped lifecycle signal, while IndexedDB key-generation checks reject stale writes even if a tab is suspended or receives the signal late. Records have age, count, and byte quotas and remain eviction-tolerant.
- The installed app can receive text, links, supported media, PDFs, and text files from an operating-system share sheet or file handler. Incoming payloads are validated, encrypted in a short-lived device inbox, and require an explicit destination conversation; Towk never auto-sends shared content.
- The header always exposes installed-versus-browser status. The document shell captures Chromium's one-shot `beforeinstallprompt` event before manifest discovery so it survives public-shell loading and authentication, but the native install dialog still opens only from the user's later click. When no native event is available, Towk shows platform-specific instructions for iOS/iPadOS Safari and Chrome, Android Chromium and Firefox, Windows Firefox, macOS Safari, and desktop Chromium.
- A local install reminder waits for a return visit and one minute of engagement, never invokes native browser UI automatically, avoids calls and active text input, and can be snoozed for fourteen days. The first critical queued message or persisted draft attachment still makes a best-effort persistent-storage request only from the related user action.
- Native Web Share, launch handling, file handling, app shortcuts, screen Wake Lock during calls, Media Session call controls, and video Picture-in-Picture are capability-detected enhancements. Correctness never depends on their presence.

## Design Decisions

### 1. Shell-only caching

**Decision:** Cache only the app shell and static PWA assets that do not expose private server state. Build assets are mandatory during install; essential icons are best-effort during install; nonessential static assets are cached lazily. The manifest is served from the network only and never falls back to a cached copy.
**Why:** Towk is a real-time chat app. Serving stale messages, permissions, assets, or notification state as if they were live would be worse than showing the disconnected state.
**Tradeoff:** The shell cache alone never supplies room or message data. An already scoped account may separately show its labeled encrypted timeline window, while full static asset coverage accumulates as the app requests assets. Offline launches cannot refresh install metadata or current branding.

### 2. Versioned cache names

**Decision:** Shell caches include the SvelteKit app version in their name.
**Why:** A deploy can replace hashed JavaScript and CSS chunks. Versioned cache names let the new worker populate a fresh shell cache and delete older shell caches during activation.
**Tradeoff:** A user briefly stores two shell versions during update. The cached asset set is small, so this is acceptable.

### 3. Explicit registration bypasses stale HTTP cache

**Decision:** The frontend registers Towk's service worker explicitly with `updateViaCache: none`.
**Why:** The service worker is useful even when Web Push is not enabled, and stale HTTP/CDN cache reuse for `/service-worker.js` can leave installed PWAs on old notification behavior. Registration is tied to the PWA shell, not to push settings.
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

### 7. Encrypted local state has explicit product contracts

**Decision:** Draft, outbox, recent-timeline, and draft-attachment records are account-scoped, AES-GCM encrypted with non-extractable browser keys, bounded by independent record/age/byte quotas, and purged when the account is removed. Purge first marks the account inactive in every local writer, waits for writes already in flight, then atomically replaces each store key with a revocation tombstone while deleting that account's records. Key-generation guards in the final IndexedDB write transactions prevent another tab from recreating readable data after sign-out. A later authenticated session explicitly clears the tombstones and creates fresh key generations. Draft attachments use chunked encryption in a separate store so a restart does not discard staged files. Timeline reads are labeled as cached. Outbox attachment bodies, authorization state, API responses, and arbitrary mutations are excluded.
**Why:** Useful offline continuity requires more than caching HTTP responses. Account scoping, authenticated revalidation, encryption, expiry, cancellation, cross-tab revocation, and visible stale-state semantics prevent one server account or a later device user from inheriting another account's local chat data.
**Tradeoff:** Browser storage remains local, device-specific, and eviction-tolerant. A cleared browser profile or unavailable key makes those records unrecoverable. Recent timeline windows improve continuity but are not a backup or full offline archive.

### 8. Background Sync is a wake-up hint, not an authenticated sender

**Decision:** The foreground app creates and delivers outbox items with the normal authenticated ConnectRPC client. A stable `client_request_id` gives each logical send server-side idempotency. Background Sync, when exposed, only posts a wake-up message to controlled windows. It never stores credentials or replays requests in the worker.
**Why:** Browser background execution is opportunistic and not portable, while Towk credentials deliberately stay in foreground connection stores. Server-side request claims make retries safe even if the original response is lost after commit.
**Tradeoff:** A completely closed PWA may wait until the next foreground launch before sending. Unsupported browsers use the same online/visibility/reconnect foreground retry path. Attachments require a live authenticated upload flow and are therefore rejected from the offline queue.

### 9. OS shares remain encrypted and user-confirmed

**Decision:** The manifest declares a POST share target and safe file handlers. The service worker validates and encrypts incoming payloads into a separate short-lived inbox using chunked AES-GCM. The destination chooser decrypts metadata only; file bytes are decrypted when the selected room composer imports them. The user reviews the resulting draft before sending.
**Why:** Share targets can receive private content before Towk knows which server account or room owns it. A temporary device namespace avoids plaintext Cache Storage and prevents premature account association. Reusing the normal attachment validation blocks executable metadata, signatures, unsafe filenames, and oversized payloads.
**Tradeoff:** The temporary inbox keeps at most three entries, expires them after one hour, and accepts at most eight files, 50 MiB per file, and 100 MiB in total. Unsupported platforms ignore the manifest handlers and users can still attach or paste files normally.

### 10. Installed-app APIs are progressive enhancements

**Decision:** Towk uses one stable manifest identity with `display: standalone`, captures the native install event in the document shell before the authenticated UI mounts, and otherwise renders a guide selected from the current platform and browser. The captured browser event is consumed once and never prompts without an explicit user click. Native sharing, launch/file handling, persistent storage, Wake Lock, Media Session call actions, and standards or WebKit Picture-in-Picture remain capability-detected. Every rejection or missing API falls back to normal in-app navigation and controls.
**Why:** PWA APIs differ materially across iOS/iPadOS, Android, Chromium desktop, Safari, and Firefox. Detecting behavior at runtime keeps one web codebase usable without falsely advertising unavailable OS integration.
**Tradeoff:** The exact install surface and system controls vary by browser. The earlier Android browser-mode identity cannot be upgraded into the canonical app identity in place; those shortcuts may need removal and reinstall. Other manifest changes can require a browser metadata refresh before an existing installation exposes them.

## Platform capability policy

- **iOS and iPadOS Home Screen:** service-worker shell, encrypted local state, Web Push, badges, Web Share, Media Session, Wake Lock, and WebKit/standard video Picture-in-Picture are used when exposed. Safari is the recommended installation route because its flow explicitly offers Open as Web App; Chrome's Share → Add to Home Screen route is also documented. Share-target, file-handler, Background Sync, and mobile screen capture availability are not assumed.
- **Android Chromium PWA:** service-worker shell, browser install prompt, Web Share/share target, push, badges, encrypted local state, Wake Lock, Media Session, and foreground outbox retries are available when the browser grants them. Background Sync remains an optional wake-up hint.
- **Desktop:** Chromium on Windows, Linux, macOS, and ChromeOS uses its native install surface when exposed. Safari on macOS uses Add to Dock. Firefox 143 or later on Windows exposes its Web apps address-bar action; Firefox on macOS and Linux does not currently expose that installed-app surface, so Towk recommends Chrome/Edge or Safari as applicable.
- **Other browsers:** the portable shell, encrypted local state, foreground retries, and supported notification/media APIs remain active. Unsupported manifest or background enhancements are skipped and the guide routes the user to a supported browser.
- **Storage:** cache and IndexedDB remain eviction-tolerant. Towk requests persistent storage only when critical unsynced local data or a draft attachment is first persisted, never during passive startup or installation alone.

## Standards and vendor references

- [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [MDN: NavigationPreloadManager](https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager)
- [Chrome: Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
- [Chrome: PWA install criteria](https://web.dev/articles/install-criteria)
- [Chrome Help: Use web apps](https://support.google.com/chrome/answer/9658361)
- [Chrome: Background Sync](https://developer.chrome.com/docs/workbox/modules/workbox-background-sync)
- [Apple: Turn a website into an app in Safari on iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)
- [Apple: Use a website as an app in Safari on Mac](https://support.apple.com/guide/safari/use-a-website-as-an-app-ibrw9e991864/mac)
- [Mozilla: Use Web Apps with Firefox for Android](https://support.mozilla.org/kb/use-web-apps-firefox-android)
- [Mozilla: Use web apps in Firefox for Windows](https://support.mozilla.org/kb/web-apps-firefox-windows)
- [Microsoft Edge: Use Progressive Web Apps](https://learn.microsoft.com/microsoft-edge/progressive-web-apps-chromium/ux)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13966/web-push-for-web-apps-on-ios-and-ipados/)
- [MDN: StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [MDN: Web Share Target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [MDN: Launch Handler](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/launch_handler)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN: Media Session setActionHandler()](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler)
- [MDN: HTMLVideoElement.requestPictureInPicture()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestPictureInPicture)

## Related

- **ADRs:** ADR-043 (client-shell internationalization), ADR-047 (direct ticketed asset URLs)
- **FDRs:** FDR-008 (File Attachments & Video Processing), FDR-012 (Notifications), FDR-013 (Web Push Notifications)
