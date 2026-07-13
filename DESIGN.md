---
product: Towk
version: 1
status: active
---

# Towk design direction

Towk is a fast, self-hosted communication workspace for teams and communities.
The interface should feel direct, calm, dependable, and comfortable during long
sessions. It is a working communication surface, not a marketing dashboard.

## Identity

- Display name: **Towk**
- Product line: **Your conversations. Your infrastructure.**
- Voice: concise, warm, technically honest
- Mark: the exact v2 orange `T` with symmetrical silver conversation wings
- Logo usage: dark wordmark on light backgrounds, light wordmark on dark
  backgrounds, and the standalone symbol only at 32 px or larger
- Avoid: redrawing or simplifying the mark, changing its type or spacing,
  stretching it, adding effects, cat imagery, upstream purple cube artwork,
  fake activity, or claims not supported by the current product

## Palette

| Token | Value | Use |
|---|---:|---|
| Dark canvas | `#03040B` | dark brand backgrounds |
| Light canvas | `#F8F9FB` | light brand backgrounds |
| Light wordmark | `#F5F4F4` | wordmark on dark backgrounds |
| Dark wordmark | `#141821` | wordmark on light backgrounds |
| Orange highlight | `#F9A763` | upper mark highlight |
| Orange mid | `#E8783B` | primary mark color |
| Orange shadow | `#C25224` | lower mark depth |
| Silver highlight | `#C7C5C2` | wing highlight |
| Silver mid | `#989AA0` | primary wing color |
| Silver shadow | `#717277` | wing depth |

Existing semantic application tokens remain authoritative for actions, status,
links, warnings, errors, and application surfaces. The brand palette governs
official artwork; it does not remap functional UI colors by itself.

## Typography and geometry

- Keep the existing highly legible sans-serif stack for the application shell.
- Use balanced wrapping for headings and tabular numerals for changing counts.
- Prefer compact, stable layouts over oversized headings or decorative cards.
- Nested radii must be concentric; touch targets are at least 44 by 44 pixels.
- Motion is short, interruptible, and disabled when reduced motion is requested.

## Responsive behavior

The primary mobile workflow is reading and replying in one room. The primary
desktop workflow is navigating rooms while retaining message and member context.
Branding must never reduce content space or introduce a separate mobile-only
feature model.

Verify at 320×568, 390×844, 768×1024, 1024×768, and 1440×900. Installed-PWA
safe areas, mobile keyboard resize, long translated labels, offline state, and
dark mode are release gates for shell changes.

## Attribution

Attribution is factual, quiet, and accessible from the README, legal notices,
documentation, and in-product source/legal surface. It must not reuse upstream
names or logos as Towk branding or imply that an upstream rights holder operates
Towk.
