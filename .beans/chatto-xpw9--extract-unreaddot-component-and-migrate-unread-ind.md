---
# chatto-xpw9
title: Extract UnreadDot component and migrate unread indicators
status: completed
type: task
priority: normal
created_at: 2026-04-19T12:20:16Z
updated_at: 2026-04-19T12:23:56Z
---

DRY up the ~8 near-identical small-dot unread/notification indicators across the frontend into a single `<UnreadDot>` component in `frontend/src/lib/ui/UnreadDot.svelte`.

Props:
- `color?: 'warning' | 'primary' | 'muted'` (default `warning`)
- `overlay?: boolean` — switches to the avatar-overlay style (h-3 w-3 + shadow-sm ring-2 ring-background)
- `class?: string` — for positioning/margin at call sites
- `testid?: string` — forwarded to data-testid

Pure refactor — no visual change, no new colours/sizes.

## Tasks

- [x] Create `frontend/src/lib/ui/UnreadDot.svelte`
- [x] Migrate `MyThreadsNavItem.svelte` (keep `my-threads-unread-dot` testid)
- [x] Migrate `RoomList.svelte` mention/thread-reply dot (inside notification button)
- [x] Migrate `RoomList.svelte` unread dot (keep `room-unread-dot` testid)
- [x] Migrate `SpaceIcon.svelte` notification overlay (clickable + static branches)
- [x] Migrate `SpaceIcon.svelte` unread overlay (keep `space-unread-dot` testid)
- [x] Migrate `DMConversationList.svelte` unread dot
- [x] Migrate `AppHeader.svelte` notification bell dot
- [x] Migrate `MessageMetaBar.svelte` thread-notification dot
- [x] Run typecheck / lint / unit tests

## Summary of Changes

Added `frontend/src/lib/ui/UnreadDot.svelte` — a small reusable indicator component with three props:

- `color?: warning | primary | muted` (default `warning`)
- `overlay?: boolean` — avatar-overlay style (h-3 w-3 + shadow-sm ring-2 ring-background) vs default inline (h-2 w-2)
- `class?: string` pass-through for positioning
- `testid?: string` forwarded to `data-testid`

Migrated all 9 inline unread/notification dots across 6 files:

- `MyThreadsNavItem.svelte`, `RoomList.svelte` (×2), `SpaceIcon.svelte` (×4), `DMConversationList.svelte`, `AppHeader.svelte`, `MessageMetaBar.svelte`

Also removed a dead `@utility unread-dot` block from `app.css` that had no remaining consumers.

Net diff: +21 / -29 across 7 files, plus the new component.

### Intentionally out of scope

- `UserAvatar` presence indicator (different semantics, 5 responsive sizes, 4 dynamic colours)
- Admin system connection dot (single-use, dynamic success/danger)
- Radio-button selection inner dots in settings pages (selection, not unread)

### Verification

- `pnpm check`: 0 errors / 0 warnings
- `pnpm test:unit`: 489 tests pass
- `pnpm lint`: only pre-existing failures on `main` (untouched e2e fixtures + `m/[messageId]/+page.svelte`). No new lint issues in changed files.
- svelte-autofixer: clean on all touched components.
- All existing `data-testid` values preserved: `my-threads-unread-dot`, `room-unread-dot`, `space-unread-dot`.
