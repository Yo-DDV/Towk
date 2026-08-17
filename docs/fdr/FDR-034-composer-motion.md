# FDR-034: Composer Focus & Typing Motion

**Status:** Active  
**Last reviewed:** 2026-08-17

## Overview

Towk gives the shared message composer a restrained sense of activity while it is focused. A small orange flare travels around the existing focus boundary, and inserted text can produce a brief light pulse at the caret. The effect is decorative: it does not change message content, editor state, keyboard handling, persistence, transport, or permissions.

The behavior applies to every place that uses the shared `MessageComposer`, including rooms, direct messages, threads, replies, and message editing. The Linux client receives the same rendering from the shared frontend and contributes only a normalized desktop motion policy.

## Behavior

- The existing orange focus ring remains the baseline and the no-motion fallback.
- One perimeter flare moves only while the composer contains focus, the document is visible, and the active environment permits decorative motion.
- A short caret-localized pulse may follow insertion input. It is suppressed during IME composition and emitted once composition completes.
- Motion stops when focus leaves the composer, the page becomes hidden, forced-colors is active, reduced motion is requested, or the Linux desktop bridge reports a reduced/hidden policy.
- Unsupported browsers keep the pre-existing CSS treatment instead of failing the composer.
- No motion is exposed as semantic content, announced by assistive technology, or made interactive.

## Design decisions

### 1. Keep the editor DOM authoritative

**Decision:** Towk never wraps, replaces, delays, or replays individual glyphs to create a typing animation. The micro-interaction is rendered by one reusable decoration positioned from the current collapsed selection.

**Why:** TipTap/ProseMirror must retain complete ownership of its document. Per-glyph presentation wrappers would risk breaking IME composition, selection, undo/redo, paste, collaborative updates, and screen-reader output.

**Tradeoff:** The effect is a subtle ink pulse rather than characters physically tweening into place.

### 2. Animate only transform and opacity

**Decision:** The orbit uses the Web Animations API with precomputed rounded-rectangle keyframes. JavaScript recalculates the path only when the composer is resized; it does not run a per-frame loop.

**Why:** Transform and opacity can remain compositor-friendly, while a continuously animated gradient, blur, or box shadow would create unnecessary paint work around a frequently used input.

**Tradeoff:** The flare is deliberately small and does not illuminate the entire border at once.

### 3. Preserve a static, accessible fallback

**Decision:** The existing focus ring remains visible regardless of animation support. Decorative elements are hidden from accessibility APIs and disabled for reduced motion and forced colors.

**Why:** Focus indication is functional UI; decorative motion is not. Losing animation must never weaken keyboard focus visibility.

### 4. Share rendering, specialize lifecycle policy

**Decision:** Web and Linux use the same frontend effect. The Linux preload publishes only `full`, `reduced`, or `hidden` through a document attribute and a namespaced DOM event. Android renders an equivalent native Canvas flare and smooths multiline height changes without emulating browser text behavior.

**Why:** This keeps visual behavior consistent while preserving each platform's native lifecycle, accessibility, and input stack.

## Performance envelope

At most one flare animation runs per focused composer. The orbit uses one DOM node, transform/opacity keyframes, and a `ResizeObserver` that reacts only to layout changes. The typing pulse reuses a second node and lasts 180 milliseconds. Hidden, unfocused, reduced-motion, and forced-colors states perform no decorative animation.

## Compatibility and rollback

The change is client-side only. It introduces no API, protobuf, database, event, permission, encryption, storage, or mixed-version dependency. Rollback consists of removing the controller and platform-specific motion adapters; the original static focus treatment remains intact.
