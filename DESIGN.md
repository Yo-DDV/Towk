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
- Mark: two connected conversation paths forming a compact `T`
- Avoid: cat imagery, upstream purple cube artwork, ornamental gradients, fake
  activity, or claims not supported by the current product

## Palette

| Token | Value | Use |
|---|---:|---|
| Ink | `#0B1020` | dark surfaces and primary text |
| Paper | `#F7F9FC` | light application background |
| Mint | `#43D8B0` | primary action and live state |
| Violet | `#7867F2` | secondary identity accent |
| Sky | `#4AA8FF` | links and informational state |
| Amber | `#F4B860` | warning state |
| Rose | `#F26D7D` | destructive and error state |

Existing semantic application tokens remain authoritative for component states.
Brand colors enter through shared tokens; components must not hard-code the table
above independently.

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
documentation, and in-product source/legal surface. It must not reuse the Chatto
name or logo as Towk branding or imply that ChattoCorp operates Towk.
