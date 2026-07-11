# Towk brand system

Towk uses a dark, product-owned identity built around an orange `T` and one
graphite message bubble on each side. Together, the two bubbles form symmetrical
wings that connect the mark to conversation without reproducing Chatto's
identity.

## Palette

| Role                  | Color     |
| --------------------- | --------- |
| Dark canvas           | `#05050A` |
| Warm wordmark         | `#F5F2ED` |
| Lilium orange         | `#FF7A3D` |
| Orange highlight      | `#FFC48A` |
| Orange shadow         | `#D8491F` |
| Graphite wing         | `#555A65` |
| Silver wing highlight | `#E4E6EB` |

## Assets

- `towk-mark.svg` is the square application mark and source for PWA icons.
- `towk-wordmark.svg` is the horizontally and optically centered README lockup.

Regenerate the PNG derivatives after changing the mark:

```sh
mise x -- node apps/frontend/scripts/generate-icons.mjs
```

Keep a clear area of at least one quarter of the mark's width around either
asset. Do not recolor the `T`, remove the message-bubble tails, place the dark
lockup on a white card, stretch the assets, or add unreviewed effects.

The orange palette follows the LiliumNetwork brand system. Towk remains a
separate product and does not reuse the LiliumNetwork mark.
