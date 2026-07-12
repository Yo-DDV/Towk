# Towk brand system

These assets implement the exact Towk v2 identity. The orange `T`, silver
conversation wings, wordmark geometry, and spacing come from the validated
raster master; they must not be redrawn or reconstructed.

The source master SHA-256 is
`63d82e4555ee56c07208d7be1c296f12d880674aeba1d5eda070e38ea07ca229`.

## Palette

| Role | Color |
|---|---|
| Dark canvas | `#03040B` |
| Light canvas | `#F8F9FB` |
| Light wordmark | `#F5F4F4` |
| Dark wordmark | `#141821` |
| Orange highlight | `#F9A763` |
| Orange mid | `#E8783B` |
| Orange shadow | `#C25224` |
| Silver highlight | `#C7C5C2` |
| Silver mid | `#989AA0` |
| Silver shadow | `#717277` |

## Assets

- `towk-horizontal-on-light.webp` is the full logo for light backgrounds.
- `towk-horizontal-on-dark.webp` is the full logo for dark backgrounds.
- `towk-symbol-256.png` is the transparent symbol for compact product UI,
  documentation navigation, and generated Open Graph cards.
- `towk-app-icon-192.png` and `towk-app-icon-512.png` are opaque install icons.
- `towk-maskable-icon-512.png` is the safe-zone-aware Android maskable icon.
- `towk-apple-touch-icon.png`, `towk-favicon-32.png`, and `towk-favicon.ico` are
  the platform-specific small-format assets.
- `towk-social-preview-dark.png` is the 1200 x 630 repository/social preview.

Regenerate the frontend and documentation copies after changing a canonical
asset:

```sh
mise x -- node apps/frontend/scripts/generate-icons.mjs
```

Keep clear space of at least 15% of the logo height on every side. The full logo
must be at least 240 px wide; the standalone symbol must be at least 32 px wide.
Do not recolor, stretch, compress, tilt, simplify, outline, shadow, or otherwise
modify the supplied artwork.
