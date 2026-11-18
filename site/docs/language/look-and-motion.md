---
title: Look, motion and pictures
description: How a spec gives a screen its own character with roles only. A look line for the whole interface, entrances with enter= and stagger=, and content laid over a photo.
---

# Look, motion and pictures

A spec never names a color, a font or a size, but two answers don't have to look the same. Three sets of roles give a screen its own character, and the engine turns each into the real values:

- a **look line** chooses how the whole interface looks,
- **`enter=`** and **`stagger=`** choose how elements come in,
- an **`image` with elements under it** puts words and buttons over a photo, readable on any picture.

The parser accepts all three whatever the model was told. The model guide explains them only when the app asks for it ([below](#telling-the-model)).

## The look line

One line, first in the spec and unindented, picks a named option for up to four props. Leave a prop out, or write `default`, to keep the app's own look.

```sayshape live
look mood=bold type=editorial shape=soft density=airy
card
  text "Yosemite weekend" style=title
  text "Two days on the valley floor, with an easy hike each morning."
  button "Plan it" on=emit:plan
```

| Prop | Options | What it changes |
|---|---|---|
| `mood` | `quiet`, `bold` | How the app's accent is used: flat with no shadows, or as a gradient with deeper shadows |
| `type` | `editorial`, `classic`, `technical` | The typefaces: serif headings, serif headings and text, or monospaced headings |
| `shape` | `sharp`, `soft`, `round` | How round corners are |
| `density` | `compact`, `airy` | Spacing and control height |

The look only scales the app's own theme: it never brings colors of its own, and faces come from a fixed list that falls back to system fonts. Every option keeps the contrast the themes pass, and Windows Contrast Themes still win over it. An app can turn look lines off with the engine's `look: false`. The details are in [the language reference](https://github.com/premmannava/sayshape/blob/main/docs/language.md#look).

## Entrances

Any element with a box of its own takes `enter=fade|rise|scale`: how it comes in the first time it's in sight. A container with `stagger=true` brings its children in one after another.

```sayshape live
column enter=rise
  text "Your trip" style=title
row stagger=true enter=rise
  stat label="Days" value="2"
  stat label="Hikers" value="3"
  stat label="Water (L)" value="18"
button "Book" on=emit:book enter=scale
```

- **Roles, not timings.** The engine chooses the duration, the distance and the easing. A spec never names them.
- **Once.** An entrance plays when the element first comes into sight, and never again: not on a state change and not when a later streamed line arrives. Lines that arrive while a spec streams in enter as they arrive.
- **Only the drawing moves.** Layout, pressing, Tab and screen readers see every element where it ends up, from the first frame.
- **Reduced motion wins.** With the person's reduced motion setting, or the engine's `animate: false`, everything is drawn at rest. Reduced motion now wins even over `animate: true`.

## Content over a photo

Indent elements under an `image` to lay them over it. The picture is at least as tall as its `ratio=` and grows to hold them. The engine darkens the photo and draws the words light, so they stay readable on any picture; a spec never chooses an overlay or a shade.

```sayshape
image "Lake at dawn" src="https://images.unsplash.com/photo-1501785888041-af3ef285b470" ratio=16:9 zoom=slow
  text "Quiet mornings" style=title
  text "Cabins by the water"
  button "Book" on=emit:book
```

- **`shape=rounded|square|circle`** sets the outline. `circle` with `ratio=1:1` gives a round picture.
- **`zoom=slow`** lets the photo drift a little closer over several seconds, once. With reduced motion it stays still.
- Buttons and other controls over the photo work as anywhere else. A `caption=` isn't shown on such an image: write the words as a `text` line.

Images only load from hosts the app allows ([Images](../integration/images)).

## Telling the model

These are left out of the default model guide, so it stays the same size. Turn on the sections an app supports:

```ts
languageGuide(registry, { look: true, motion: true, pictures: true });
```

In chat apps, the MCP server keeps them out of its quick start too. A model asks `sayshape_docs` for the `look`, `motion` or `pictures` topic when it wants them ([In chat apps](../integration/mcp)).
