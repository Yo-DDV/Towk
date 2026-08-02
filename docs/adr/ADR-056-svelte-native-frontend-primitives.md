# ADR-056: Svelte-Native Frontend Primitives with an Executable Towk Catalog

**Date:** 2026-08-01

## Context

Towk is delivered as a responsive SvelteKit PWA. It already has semantic application tokens,
Svelte-owned form and overlay primitives, Storybook, browser component tests, and PWA-specific
handling for input capabilities, safe areas, the software keyboard, and the visual viewport.

The component contract is nevertheless distributed across source comments, isolated stories,
tests, and feature implementations. A maintainer can therefore miss an existing primitive or its
responsive boundary and create an overlapping local control. Generic component catalogs may shorten
initial markup work, but adopting their runtime or global theme can add a second design system,
framework-specific dependencies, inaccessible behavior, or provenance obligations without solving a
measured Towk defect.

## Decision

Towk keeps a Svelte-native public component boundary.

- Semantic application tokens and utilities remain authoritative for visual identity.
- Reusable primitives are exported only through `$lib/ui` and `$lib/ui/form`.
- A machine-readable registry records the use, exclusion, responsive, accessibility, and Storybook
  contracts of every exported primitive.
- An automated test compares that registry with the export barrels and verifies declared stories.
- Storybook is the executable catalog for component discovery, states, themes, responsive geometry,
  and accessibility review.
- Feature code reuses Towk-owned primitives instead of importing a lower-level component-library
  implementation directly.

Towk does not adopt React-only UI kits, a React compatibility layer, a second global theme, remote
runtime styling, or bulk-generated components that overwrite existing primitives.

A Svelte-native headless dependency may be evaluated only through a separate, bounded pilot for one
concrete complex primitive. The pilot must demonstrate an accessibility or maintainability benefit,
use a Towk wrapper, preserve tokens and public APIs, quantify bundle impact, pass cross-browser tests,
and provide a direct rollback. A library recommendation alone is not sufficient evidence for a
migration.

External component galleries remain research and recipe sources. Any copied code or asset is still
subject to license, provenance, integrity, necessity, and notice review.

## Consequences

- Codified component discovery reduces duplicated buttons, overlays, forms, and responsive patterns.
- Storybook and tests become reviewable evidence rather than optional visual examples.
- Towk retains a coherent identity across desktop, tablet, phone, foldable, and installed-PWA
  presentations.
- Platform-specific behavior in existing dialogs, sheets, and popovers is not discarded by a broad
  migration.
- Adding a public primitive now requires a registry contract and, when appropriate, a live story.
- A future headless library remains replaceable because feature code depends on Towk wrappers.
- Registry maintenance adds a small deliberate cost whenever the public component surface changes.

## Alternatives considered

### Adopt a React component library

Rejected. It would introduce another runtime and framework boundary into a Svelte application for
behavior that Towk can implement natively or through Svelte-specific primitives.

### Initialize a complete generated component theme

Rejected. It would create competing tokens, icons, component names, and upgrade paths, and could
overwrite PWA-specific behavior already implemented in Towk.

### Keep documentation informal

Rejected. Source comments and isolated stories do not prevent exported primitives from becoming
undocumented or duplicated.

### Immediately adopt a Svelte headless library everywhere

Rejected. No measured defect justifies replacing mature primitives wholesale. A bounded pilot keeps
the decision evidence-based and reversible.

## References

- [Towk design direction](../../DESIGN.md)
- [Frontend design system](../FRONTEND_DESIGN_SYSTEM.md)
- [ADR-018: SvelteKit SPA Embedded in Go Binary](ADR-018-sveltekit-spa-embedded-in-go.md)
- [ADR-043: Client-Shell Internationalization](ADR-043-client-shell-internationalization.md)
