---
title: Themes
description: How SayShape themes work. Design tokens, light and dark themes, CSS overrides and extendTheme.
---

# Themes

Components never use literal colors or sizes. They read design tokens from the theme: `colors`, `space`, `radius`, `font`, `text` sizes and the `control` height. Specs choose **roles** (`tone=good`, `variant=secondary`, `style=title`) and the theme decides what each role looks like, so a generated screen always matches your app.

SayShape ships `lightTheme` and `darkTheme`. With `theme: "auto"` (the default) it follows the page: a `data-theme="light"` or `data-theme="dark"` attribute on `<html>` if there is one, otherwise the system's light or dark setting.

## Overriding colors from CSS

With `theme: "auto"`, color tokens can be set as `--sayshape-*` CSS variables on the canvas or any ancestor:

```css
canvas {
  --sayshape-accent: #6d28d9;
  --sayshape-on-accent: #ffffff;
}
```

Token names become kebab case: `onAccent` is `--sayshape-on-accent`, `landHighlight` is `--sayshape-land-highlight`.

## Building a theme in code

```ts
import { extendTheme, lightTheme, darkTheme } from "sayshape";

const brand = extendTheme(lightTheme, {
  colors: { accent: "#6d28d9" },
  radius: { md: 6 },
});
ui.setTheme(brand);
```

`setTheme` keeps the spec, state, selections and any open popup as they are. To follow light and dark yourself, set one theme or the other when your page's mode changes. This site does that: its own light/dark switch calls `setTheme` with `lightTheme` or `darkTheme`.

## Color tokens

| Token | Used for |
|---|---|
| `surface` | The background the screen is drawn on, and inset fields such as inputs |
| `raised` | Cards, lists, tables and popups. Equal to `surface` in light; a step lighter in dark, so surfaces layer. Change `surface` without `raised` and it follows |
| `ink`, `muted` | Text, and quieter text |
| `line` | Dividers and table rules |
| `control` | Outlines that show where a control is: field borders, unchecked boxes and radios, a switch that's off. Keep it at 3:1 against `surface` and `raised` |
| `accent`, `onAccent` | Primary buttons, selections and focus of attention; the label color on the accent |
| `good`, `warn`, `bad` | Status roles (`tone=good`, …) |
| `focus` | The keyboard focus ring |
| `shadow` | The soft shadow under cards, buttons and popups |
| `land`, `landHighlight`, `landHover` | The world map |
| `debug` | The inspector's overlays |

## Trying styles

The [playground](/playground) can preview a spec in four color styles and in light or dark, and copies the TypeScript to recreate a style with `extendTheme`. Styles change colors only; they're a playground feature, not part of the language, so models still can't choose colors.

## Contrast

SayShape's default text and accent colors meet 4.5:1 against their surfaces, and its control outlines, focus ring and chart colors meet the 3:1 that WCAG asks of control boundaries. Check contrast for any custom accent or `control` color you choose, in both light and dark. In Windows Contrast Themes SayShape uses the person's colors instead ([Accessibility](../architecture/accessibility)).

## Slide tokens {#slides}

A [`slide`](../elements/slide) is laid out 960 px wide and 540 px tall, then drawn scaled to the space it has. So that a slide's type reads at presentation size, a theme carries a second set of size tokens, `slide`, used inside a slide and nowhere else. The colors are the theme's own: the slide's face is `raised`, its frame `line`, its title `ink`, its eyebrow, opening rule and progress bar `accent`.

| Token | Holds |
|---|---|
| `slide.space` | The spacing steps `xs` to `xl` inside a slide (the default `xl`, 48, is a slide's margin) |
| `slide.radius` | Corner radii `sm`, `md`, `lg` (the slide's own frame uses `lg`) |
| `slide.text` | The type sizes `caption`, `body`, `lead`, `title` and `display`, in design pixels (body 24, display 52 in the default themes) |
| `slide.control` | The control `height` (56 in the default themes) |
| `slide.heading` | The size of a slide's title: `cover` for the opening slide (`layout=title`) and `slide` for every other |

`lightTheme`, `darkTheme` and the Studio themes set all of these. To change them, patch the whole group you mean to change:

```ts
import { extendTheme, lightTheme } from "sayshape";

const bigger = extendTheme(lightTheme, {
  slide: { heading: { cover: 72, slide: 48 } },
});
```

### A theme without slide tokens

`slide` is optional. A theme built by hand without it still draws decks: the engine scales the theme's own `space`, `radius`, `text` and `control` up by 1.6 (the opening title is 2.0 times the theme's `display` size, other titles 1.36 times) with `slideTokens` from `sayshape/slides`, so slides look like a larger copy of the screen's type. Add `slide` only to tune it.

### Deck settings for hosts

`theme.deck` is for the app around the engine, never for a spec:

| Setting | Effect |
|---|---|
| `logo` | An image address, from the page's own origin or one of your `imageHosts`, drawn small at the bottom left of every slide |
| `square` | `true` draws slides without their rounded frame, for pictures that fill a page |

```ts
ui.setTheme({ ...lightTheme, deck: { logo: "https://cdn.example.com/logo.png" } });
```

The [MCP server](./mcp#slide-decks) sets `logo` from its `--logo` option.
