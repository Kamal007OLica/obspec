---
tags: [component, design-system]
figma_component: Button
---
# Button

The primary interactive element. Four variants, three sizes, five states.

## Variants
- `primary` — brand fill, white label. One per view.
- `secondary` — outline, used next to primary.
- `ghost` — text only, for low-emphasis actions.
- `danger` — destructive. Always confirm.

## Sizes
| Size | Height | Padding | Font |
| --- | --- | --- | --- |
| sm | 28 | 0 10 | 11/500 |
| md | 36 | 0 14 | 13/500 |
| lg | 44 | 0 18 | 15/600 |

## States
default · hover · pressed · focus-visible · disabled

Tokens come from [[Design Tokens]]. Focus ring is `--focus-ring`, 2px, offset 1px.
