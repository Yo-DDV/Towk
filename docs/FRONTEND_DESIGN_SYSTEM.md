# Frontend design system

Towk's frontend design system is the public contract for reusable interface behavior. It keeps the
installed PWA visually coherent without turning the application into a collection of unrelated
component-library defaults.

The contract has four layers, in this order:

1. semantic application tokens and utilities in `apps/frontend/src/app.css`;
2. reusable Svelte primitives exported from `$lib/ui` and `$lib/ui/form`;
3. executable examples and state coverage in Storybook;
4. browser, accessibility, responsive, and regression tests.

`DESIGN.md` remains authoritative for product identity. This document governs how application UI is
assembled and extended.

## Canonical catalog

`apps/frontend/src/lib/ui/designSystem.ts` is the machine-readable registry of public UI primitives.
Every default component export from `$lib/ui` and `$lib/ui/form` must appear exactly once with:

- the situation in which it should be used;
- a boundary explaining when another primitive is preferable;
- its responsive or input-capability contract;
- its accessibility ownership;
- a Storybook entry when interactive or high-risk behavior needs live coverage.

`designSystem.spec.ts` parses both TypeScript export barrels, compares their exact export sets with
the registry, reports missing, stale, or duplicate entries, and verifies every declared story path.
Adding a public primitive without adding its contract must fail the frontend test suite.

Storybook is the executable catalog. A story is not a screenshot substitute: it must expose the
states and geometry that a maintainer needs to inspect, reuse, and test. The searchable catalog makes
component choice reviewable, while deterministic qualification stories keep the high-risk open states
of sheets, menus, comboboxes, and empty states available to automated browser and accessibility tests.

## Component decision tree

Use the most specific existing primitive before creating another surface.

| Need | Canonical primitive |
| --- | --- |
| Committed action or navigation styled as an action | `Button` |
| Text, textarea, checkbox, or native fixed-choice input | `$lib/ui/form` control |
| Searchable single-value input | `Combobox` |
| Consequential one-action confirmation | `ConfirmDialog` |
| Bounded data-entry task in an overlay | `FormDialog` |
| Focused custom modal content | `Dialog` |
| Touch-first action surface | `BottomSheet` |
| Contextual actions that adapt between pointer and touch | `ContextMenu` |
| Low-level anchored top-layer content | `FloatingPopover` |
| Optional contextual explanation | `HelpTooltip` or `FloatingTooltip` |
| Empty collection or no-result explanation | `EmptyState` |
| Pane title and compact actions | `PaneHeader` |

Do not create a local button, dialog, menu, sheet, input shell, tooltip, or popover when one of these
contracts already applies. Feature components should import Towk wrappers rather than a lower-level
third-party primitive directly.

## Responsive and PWA contract

Responsive behavior follows available geometry and input capabilities, not device names.

The baseline visual matrix is:

| Viewport | Primary risk |
| --- | --- |
| `320 × 568` | minimum phone width and short content height |
| `390 × 844` | representative large phone and installed-PWA safe areas |
| `768 × 1024` | tablet or unfolded compact display in portrait |
| `1024 × 768` | tablet or compact laptop in landscape |
| `1440 × 900` | standard desktop |
| `2560 × 1080` | ultrawide line length and excessive stretching |
| `844 × 390` | short landscape, software keyboard, and bounded overlays |

For every affected primitive or workflow, verify the relevant combinations of:

- fine pointer, coarse pointer, hover, no-hover, keyboard, and hybrid input;
- browser tab and installed PWA;
- `env(safe-area-inset-*)`, `dvh`, and `VisualViewport` where overlays or the keyboard are involved;
- normal and 200% text zoom;
- long labels in each supported locale;
- dark and light themes;
- `prefers-reduced-motion`, forced colors, and increased contrast where supported;
- no document-level horizontal overflow and no unreachable action.

Presentation may change between an anchored popover and a bottom sheet, but permissions, commands,
focus ownership, cancellation, and recovery must remain equivalent.

## Required states

Interactive and data-driven stories and tests should cover the states that actually apply:

- default and focused;
- hover, active, disabled, and busy;
- loading with stable geometry;
- validation error;
- empty and no-result;
- offline or temporarily unavailable;
- interrupted action, retry, and recovery;
- long content and translated labels;
- reduced motion and high contrast.

Do not use an empty state while data is still loading, and do not hide a recoverable error behind a
neutral empty state.

## Accessibility ownership

Each public primitive must state which accessibility behavior it owns and which behavior remains the
caller's responsibility.

At minimum:

- use native HTML and top-layer APIs where they fit the interaction;
- provide a visible title or an explicit accessible name for every modal surface;
- keep labels, descriptions, errors, and busy state associated with form controls;
- keep keyboard focus visible, trapped only when modal, and restored after dismissal;
- give menus a complete keyboard model, including initial focus, arrow navigation, Home, End,
  typeahead, disabled-item skipping, Escape, and focus restoration;
- keep combobox focus on the input, expose a stable active descendant, and keep the active option in
  view while results change;
- support Escape, browser/system Back, backdrop, and gestures without accidental dismissal races;
- preserve at least 44 by 44 CSS-pixel touch targets for compact actions;
- never communicate status or permission through color alone;
- make motion decorative and removable;
- validate with Storybook's accessibility checks and targeted browser tests.

## Performance contract

Reusable UI must remain proportionate to a self-hosted communication client:

- prefer platform primitives and Svelte/CSS over an additional runtime;
- import only what is required by the feature;
- keep large collections virtualized, paginated, or windowed;
- coalesce resize, scroll, pointer, and media events;
- attach observers, timers, and listeners once per lifecycle and always clean them up;
- animate compositor-friendly properties without introducing layout shifts;
- compare production bundle output before accepting a dependency for one primitive.

## External component and recipe policy

External component catalogs may be used to research interaction patterns, but copying code is an
implementation decision subject to Towk's provenance and licensing rules.

A new UI dependency is acceptable only when one concrete primitive has a demonstrated gap and all of
the following are true:

1. the package supports the current Svelte and TypeScript toolchain without introducing React or a
   second application runtime;
2. its license, provenance, release integrity, maintenance status, and transitive dependencies are
   reviewed;
3. the dependency supplies behavior that is materially safer or easier to maintain than the current
   web-platform implementation;
4. feature code accesses it only through a Towk-owned wrapper under `$lib/ui`;
5. Towk tokens, Iconify icons, localization, responsive behavior, and public component APIs remain
   authoritative;
6. accessibility behavior is proven in Chromium, Firefox, and WebKit;
7. the production bundle and interaction performance impact are measured;
8. the change has focused stories, tests, documentation, and a direct rollback path.

A Svelte-native headless package can therefore be evaluated in a future bounded pilot for a
specific complex control. It is not a reason to migrate working dialogs, sheets, popovers, or the
whole design system. Component galleries and recipe collections remain reference material unless an
independently reviewed fragment is deliberately adapted.

The following are not accepted as frontend foundations:

- React-only UI kits or a React compatibility layer;
- a second global theme, token system, icon library, or parallel component tree;
- remote fonts, CDN-hosted runtime assets, or provider-owned styling required for core UI;
- bulk component generation that overwrites Towk primitives;
- code or assets with uncertain license or provenance.

## Adding or changing a primitive

1. Inspect `DESIGN.md`, `app.css`, the registry, existing stories, and adjacent feature usage.
2. Select the narrowest existing primitive or explain the missing contract.
3. Keep the public API Svelte-native and semantic.
4. Add or update the registry entry.
5. Add stories for meaningful states, responsive boundaries, and input presentations.
6. Add browser tests for behavior that a static story cannot prove.
7. Check every listener, timer, observer, animation, focus path, and cleanup.
8. Verify localization when visible product copy changes.
9. Run the focused tests, frontend checks, production build, Storybook tests and build, and applicable
   E2E.
10. Review the complete diff for temporary files, private data, provenance, and rollback.

## Typical validation

```sh
mise exec -- pnpm --filter towk-frontend exec vitest --run --project server \
  src/lib/ui/designSystem.spec.ts
mise exec -- pnpm --filter towk-frontend exec vitest --run --project client \
  src/lib/ui/BottomSheet.svelte.spec.ts \
  src/lib/ui/ContextMenu.svelte.spec.ts \
  src/lib/ui/ContextMenu.a11y.svelte.spec.ts \
  src/lib/ui/form/Combobox.svelte.spec.ts
mise run lint-frontend
mise run build-frontend
mise run test-frontend
pnpm --filter towk-frontend test-storybook
pnpm --filter towk-frontend build-storybook
```

The Storybook Vitest configuration exercises deterministic design-system fixtures in light and dark
themes. Accessibility violations on those fixtures are test failures. Generated `storybook-static`
output is local build output and must not be committed.

Run the complete repository gate and the relevant browser/PWA campaign before describing a change as
qualified.

## Rollback

The registry, stories, Storybook test wiring, and documentation can be reverted without changing
persisted data or public API compatibility. A future headless-primitive pilot must remain behind a
Towk wrapper so its implementation can be replaced or reverted without changing feature call sites.
