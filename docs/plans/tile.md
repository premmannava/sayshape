# tile: small fixed-size faces

## What it's for

Playing cards, seats, dice, keyboard keys, lottery numbers and periodic-table cells: a short value on a small face, often several side by side. A model could fake these with cards or badges, but those stretch to fill their space, and a stretched playing card stops reading as one.

## Syntax

```
row gap=8
  tile "4" icon=club label="4 of clubs"
  tile "Q" icon=heart tone=bad label="Queen of hearts"
  tile "B4" shape=square detail="$14" selected={s.picked} disabled={s.taken} on=toggle:s.picked
```

## Props

- Quoted text: the value (short: A, 10, B4, Fe).
- `icon=`: any SayShape icon. The suits are `club`, `spade`, `heart` and `diamond`; red suits use `tone=bad`.
- `shape=card|square`: card is portrait, 5:7 like a playing card; square is for seats, keys and dice.
- `size=sm|md|lg`: from the theme's control height, so tiles follow the theme's scale.
- `detail=`: a small line under the value.
- `tone=`, `variant=raised|outline`.
- `selected=`, `disabled=`, `on=`.
- `label=`: what screen readers and Copy text say. The default is the value and detail.

## Decisions

- **Never stretched.** A tile's layout keeps its own size. Rows pack tiles like buttons and badges, at their own width. A row of only tiles sits in the middle, like a hand of cards or a row of seats, and wraps onto more lines when they don't fit. Only when one tile is wider than its whole space does it shrink, keeping its shape, so nothing spills.
- **A card face**: value and a small icon in the top-left corner, a large icon in the middle. A square face centres an icon above the value, or either alone. A card without an icon is drawn like a square face.
- **Selected** draws the accent border and a light accent wash (8%, so red and amber values still meet AA contrast); a value in the default tone turns accent. **Disabled** is flat, grey and muted, and not pressable.
- **Suit icons** are drawn from scratch in `src/icons.ts`, with the same stroke as the heart:
  - a spade is a heart turned over, on a flared stem;
  - a club is the outer arcs of three overlapping circles on the same stem;
  - a diamond has slightly curved sides.
- **Accessibility:**
  - a pressable tile is a button; with `selected=` it's a toggle button (`aria-pressed`), and with `disabled=` it's disabled;
  - a tile that only shows something is text, with "(selected)" or "(unavailable)" after its name;
  - without `label=`, a tile with a suit icon is named like a card ("Q of hearts");
  - Copy text prints the names of tiles that only show something. Pressable tiles are controls, so like buttons they're left out of Copy text.

## Left out of version 1

Dice pips, a back face, flipping animations, and tiles you drag.
