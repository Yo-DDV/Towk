# FDR-022: User Profile

**Status:** Active
**Last reviewed:** 2026-08-01

## Overview

A user's profile carries the public identity they present to the rest of the server (login, display name, avatar, custom status), explicitly assigned roles, account age, a Markdown biography, and a privacy-aware latest-activity value. The web client presents these fields through one canonical profile dialog opened from user identity surfaces while directory rows remain lightweight. Most profile data is self-editable; one field — the login — is throttled to discourage identity-confusion abuse, with an admin escape hatch for legitimate needs. Browser-local display preferences, such as theme, live outside the profile.

## Behavior

- **Display name** — freely editable by the user. Shown in messages, member lists, mention autocomplete, etc.
- **Login (username)** — editable by the user with a 30-day cooldown between changes. Each successful change records a timestamp; subsequent changes within the window are rejected with a clear error message.
- **Case-only changes** (e.g., `alice` → `Alice`) bypass the cooldown.
- **Avatar** — users upload JPEG, PNG, WebP, or GIF content up to 10 MiB. The server resizes every avatar to a 256×256 maximum box, stores static inputs and single-frame GIFs as lossless WebP, and stores multi-frame GIFs as animated WebP forced to loop continuously. The old avatar binary is retained until the new avatar event commits, then deleted. Users can also delete their avatar (falling back to an initial-letter placeholder).
- **Custom status** — users can set an emoji plus short text. The emoji is shown next to their name; the text is shown alongside it where space allows and as hover/accessible text in compact places.
- **Custom status templates** — the web client offers preset statuses for lunch, vacation, and sick leave plus a custom mode. Presets store reserved text tokens in the same free-form status text field so each client can render the label in its active language. Custom mode stores the user's literal text.
- **Custom status expiry** — users can optionally choose an expiry date and time. After that instant, projected reads and the web client hide the status automatically. Users can also clear it manually.
- **Settings** — currently timezone (IANA name, e.g., `Europe/Berlin`) and time format (browser default / 12-hour / 24-hour). Stored server-side so they sync across devices. If not set, the frontend uses the browser timezone and locale time-format default.
- **Display theme** — users can choose System, Light, or Dark. System follows the browser or OS color-scheme preference. The choice is browser-local and applies immediately on that device.
- **Detailed profile** — authenticated server members can open one on-demand profile surface showing avatar, display name, login, presence, custom status, all explicitly assigned configured roles, join date, Markdown biography, and latest activity when visible.
- **Biography** — users can store up to 1,024 Unicode code points and 4 KiB of valid UTF-8 Markdown inside the existing user-PII encryption boundary. Supported clients render it through the same sanitized Markdown path used for message content; raw HTML is not trusted. Long biographies open as a bounded preview and can be expanded without truncating the stored Markdown.
- **Latest activity** — Towk stores one encrypted, monotonic, coalesced timestamp rather than an activity history. Visibility is enabled by default for upgrade compatibility and can be disabled by the profile owner. Disabling visibility removes the stored latest value before the preference is published.
- **Profile actions** — the server returns viewer-specific Message and Call capabilities. Message opens the direct conversation and focuses its composer. Call opens the direct conversation, exposes the call surface, and starts the existing device-aware join flow. The call action is exposed only when direct messaging is allowed and LiveKit is configured, and it does not interrupt another active room call. Deleted accounts expose neither action.
- **Responsive dialog** — the profile is centered on wide viewports and Fold-class layouts, and becomes safe-area-aware full-screen UI on narrow or low viewports. It supports Escape, backdrop, browser/system Back, focus restoration, and a bounded touch dismissal gesture.
- **Admin overrides** — operators with the right permissions can update other users' profiles, bypass the login cooldown, clear the cooldown so the user can change again before the 30 days expire, and force-delete an avatar.

## Design Decisions

### 1. 30-day login change cooldown

**Decision:** A user can change their login only once every 30 days.
**Why:** Logins are the basis for `@mentions`, search results, and recognition across the server. Frequent changes are an impersonation/confusion risk — `@alice` today might be a different person tomorrow. A 30-day cooldown discourages rapid churn while still allowing occasional rename for legitimate needs. Case-only changes are exempt because they don't change identity.
**Tradeoff:** A user who legitimately needs to change twice in 30 days (e.g., picked a typo'd name) is stuck. The admin clear-cooldown affordance handles those cases.

### 2. Login uniqueness is enforced with projection catch-up and OCC

**Decision:** Login changes wait for the user projection to catch up, check the decrypted login index, and append the login-change event with optimistic concurrency over the user subject family. If another writer wins first, the operation retries against the updated projection.
**Why:** User profile state now lives in the event-sourced user aggregate, and new durable login-change facts carry encrypted PII. Projection catch-up plus OCC keeps uniqueness race-safe without reintroducing a separate login KV as source of truth.
**Tradeoff:** The write path depends on projection readiness and may retry under contention. In exchange, the durable event stream remains append-only and the login index stays derived state.

### 3. Admin path doesn't advance the cooldown timestamp

**Decision:** When an admin changes a user's login, the user's cooldown clock isn't reset. The user can still wait out their own cooldown and change to a different login.
**Why:** The cooldown is about the *user's* identity stability, not the admin's. An admin-driven correction shouldn't reset the user's own quota.
**Tradeoff:** A user who keeps getting admin-renamed has a slightly confusing experience around when their next self-change is allowed. Acceptable; uncommon edge case.

### 4. Avatars are canonical WebP assets capped at 256×256

**Decision:** Uploaded JPEG, PNG, WebP, and GIF avatars are admitted only after magic-byte and decoded-image validation. Static inputs and single-frame GIFs are re-encoded as lossless WebP; multi-frame GIFs are composited, resized, encoded as animated WebP, and forced to loop continuously. Both the compressed upload and canonical result are capped at 10 MiB. Source dimensions are capped at 4,096 per axis and 16,777,216 pixels; animated avatars are additionally capped at 120 frames and 16,777,216 full-canvas frame-pixels. Original uploads are discarded. Because the animated asset is already canonical at 256 px, avatar reads return it directly instead of generating a static derivative.
**Why:** Avatars render at small sizes everywhere — 256px is the largest the UI ever shows. Storing originals is waste. WebP supports transparency and animation while keeping one served media type. The byte, dimension, frame, and decoded-pixel budgets bound CPU, memory, storage, and transfer cost even for adversarially compressed GIFs. Retaining the previous binary until the profile event commits prevents a rejected or interrupted replacement from destroying the current avatar.
**Tradeoff:** A user uploading a high-resolution avatar cannot recover the original. Animated avatars do not use smaller per-surface derivatives, so compact views rely on the browser's immutable cache for the shared 256 px asset. Avatar motion is decorative and must never convey presence, role, or other essential state; Towk does not currently expose an avatar-specific pause preference.

### 5. Server-side settings, not browser-local

**Decision:** Timezone and time format live in the user's profile (in `User.settings`), synced server-side. Display theme is browser-local.
**Why:** A user signing in from a new browser shouldn't have to re-pick their preferences. Local storage works fine for one device; for multi-device users it's actively worse than server-side.
**Tradeoff:** Every timezone or time-format change requires a mutation, but settings change rarely so the cost is negligible. Theme can differ per browser, which is appropriate for device-specific light/dark preferences but means it does not sync across devices.

### 6. Browser timezone fallback when unset

**Decision:** If the user hasn't picked a timezone, the frontend uses the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`.
**Why:** Forcing every new user to pick a timezone at signup is friction. The browser usually knows.
**Tradeoff:** Travelers see times rendered in their travel timezone if they haven't explicitly set one. Most users either don't notice or prefer this.

### 7. Cross-user edits gated by `user.manage-accounts`

**Decision:** Admin updates to other users' profiles require `user.manage-accounts` for cross-user edits. Self-edits bypass that permission because they're privilege-neutral identity edits.
**Why:** Towk's simplified RBAC model is permission-based for everyone except effective owners, who are protected by the owner override rather than target-rank gates.
**Tradeoff:** A user with `user.manage-accounts` can edit any target user's profile.

### 8. Custom status is durable profile metadata, not presence

**Decision:** Custom statuses are stored as user-aggregate EVT facts (`custom_status_set` / `custom_status_cleared`) and projected into `User.customStatus`. The status is independent of online/away/DND presence and does not affect notification routing.
**Why:** The product meaning is user-authored profile context ("working on X", "back after lunch"), not a current connection-state hint. Persisting it in EVT makes it replayable, backup-safe, and consistent across replicas and devices while keeping presence ephemeral.
**Tradeoff:** An expired status remains in historical EVT facts. Projections and clients hide it after `expiresAt`; clearing is a separate explicit fact rather than a background rewrite or KV delete.

### 9. Custom status writes use the protobuf-first API

**Decision:** The web client writes custom status through `MyAccountService` on the ConnectRPC `/api/connect` surface. Projected profile reads and realtime profile-change signals are also consumed through the ConnectRPC/realtime surface.
**Why:** Keeping profile writes, projected reads, and live refetch signals on the protobuf-first path avoids transport drift and keeps profile behavior aligned with the rest of the public API migration.
**Tradeoff:** Clients need to combine request/response profile APIs with the app-session realtime stream rather than relying on one subscription protocol for both.

### 10. Status templates are client-side reserved text tokens

**Decision:** Built-in templates use the same persisted `CustomUserStatus` shape as custom statuses. The emoji is stored normally, while the text field stores a reserved token such as `chatto:status:out_for_lunch`. Clients that understand the token render a localized label; unknown/custom text is rendered literally.
**Why:** This keeps the durable EVT model simple and preserves the "any emoji plus any text" API while allowing built-in statuses to be localized for each viewer.
**Tradeoff:** Older clients that do not know the reserved tokens may display the raw token. This is acceptable during early development and avoids a protobuf shape change solely for UI presets.

### 11. Detailed profiles are loaded on demand

**Decision:** Directory and room-member rows stay lightweight. The complete profile is fetched through `UserService.GetUserProfile` only when a viewer opens it.
**Why:** Biography, role presentation, latest activity, and viewer-specific capabilities are not needed for every row and would inflate frequently loaded directory payloads.
**Tradeoff:** Opening a profile requires one additional request. The frontend uses a small server-scoped cache and realtime invalidation to avoid repeated reads while preventing stale responses from repopulating invalidated entries.

### 12. Biography uses the existing user-PII envelope

**Decision:** Biography Markdown is normalized, validated before any multi-field profile mutation, limited to 1,024 Unicode code points and 4 KiB of UTF-8, and encrypted with the user's PII DEK. Clearing it appends an explicit clear event.
**Why:** Biography is user-authored personal information and belongs inside the same encryption and crypto-erasure boundary as other profile PII. Preflight validation prevents an invalid biography from partially applying a display-name or login change.
**Tradeoff:** Existing biographies above the new product boundary remain readable and are never truncated automatically, but their owners must shorten them before a later save. The editor reports both Unicode characters and UTF-8 bytes so the boundary is explicit.

### 13. Latest activity is a latest-value privacy signal, not surveillance history

**Decision:** The runtime store keeps at most one encrypted UTC timestamp per user, advances it monotonically, and coalesces writes to a five-minute interval. No sequence of activity observations is retained.
**Why:** The profile needs a useful "last active" hint without creating a durable behavior history or writing every heartbeat. Runtime-state storage matches the latest-value semantics, while the user PII key preserves crypto-erasure.
**Tradeoff:** The timestamp is approximate within the coalescing window and is not an audit record. Backups that contain both encrypted data and still-valid keys retain the same limitations documented for other encrypted PII.

### 14. Visibility is enforced and cleaned up server-side

**Decision:** An absent preference means visible. When a user disables latest activity, the server deletes the stored value before publishing the hidden preference and fails closed if cleanup cannot complete. Invisible clients do not report presence and therefore do not advance latest activity.
**Why:** Hiding a field only in the frontend would leave stale data available through the API and could reappear after re-enabling. Server-side filtering and cleanup make the privacy choice authoritative.
**Tradeoff:** Re-enabling visibility starts with no previous timestamp; a new value appears only after later eligible activity.

### 15. One accessible responsive surface replaces divergent profile popovers

**Decision:** User identities open the same detailed profile dialog. Selectors and autocomplete preserve their primary selection action and expose profile opening as a secondary affordance.
**Why:** A canonical surface keeps desktop, mobile, accessibility, privacy, caching, and action rules consistent across messages, member lists, the current-user bar, and selection controls.
**Tradeoff:** The dialog carries more layout logic than a small popover, including history integration and safe-area handling, but removes duplicated contextual implementations.

## Permissions

- Read a detailed profile — authentication on the same server; latest activity is filtered by the target user's privacy preference.
- Self-edit (display name, avatar, biography, custom status, settings, own login subject to cooldown) — no explicit permission; just authentication.
- Message/Call actions — returned as viewer-specific capabilities; Call additionally requires configured LiveKit service.
- Cross-user edit — `user.manage-accounts`.
- Clear another user's login cooldown — same gate.

## Related

- **ADRs:** ADR-007 (per-user encryption with crypto-shredding), ADR-036 (runtime-state boundary), ADR-042 (protobuf-first public API), ADR-043 (client-shell internationalization)
- **FDRs:** FDR-001 (Roles & Permissions), FDR-008 (File Attachments & Video Processing), FDR-011 (User Presence), FDR-018 (Account Lifecycle)
