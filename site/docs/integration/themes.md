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

## Brand colors {#brand-colors}

A host can give SayShape its brand colors: **one color or a list of up to six**, as hex (`#e4572e`, or `#e45` for short), most important first. Specs still never contain colors. Brand colors come from the host (a theme in your app, the MCP server's `--accent` or `--colors`) or, in a chat app, from a tool argument when the person names colors in the conversation. They never come from a line of a spec, and a model can't set them by writing one. (`scene` is the one exception, as before: a model that paints a picture chooses that picture's colors.)

### What each color becomes

- **The first color is the accent.** It colors buttons, selections and highlights, and a map's highlighted country. The text on it (`onAccent`) is chosen to be readable, and the first chart series is the same color.
- **The rest are the next chart series, in order.** The second color is series 2, the third series 3, and so on.
- **Missing series are worked out from the first color.** With fewer than six colors, the other series are stepped around the first color's hue, kept away from the colors used for good and bad, and made quieter so the first stays the strongest, alternately darker and lighter. A grey first color has no hue to step from, so SayShape's own companion series fill in.
- **A near-duplicate becomes a shade, not another hue.** A color that looks too much like an earlier one (a second navy beside the first) keeps its hue and becomes a clearly lighter or darker shade of itself, so charts still tell series apart and stay in the brand's colors. Only when no shade stands apart is it dropped and a worked-out color used in its place.
- **Only the accent and the chart series change.** Surface, text, lines and the good, warn and bad colors stay the theme's own.

### Every color is made readable, per mode

Colors that read well on white can vanish on near-black, so each color is adjusted separately for light and for dark: the accent to **4.5:1** against the surface (it is used as text and strokes), every other series to **3:1** (the contrast chart marks need). A color already readable in a mode is used as it is there. For example, three colors on the default (Teal) theme:

| You give | Light mode | Dark mode |
|---|---|---|
| `#e4572e` (accent, series 1) | `#ca4f2b` (darkened) | `#e4572e` (as is) |
| `#2e86ab` (series 2) | `#2e86ab` (as is) | `#2e86ab` (as is) |
| `#f2c14e` (series 3) | `#b3903e` (darkened) | `#f2c14e` (as is) |
| Series 4 to 6, worked out | `#6f5a85` `#7c95c0` `#5a6c40` | `#7e6994` `#98ac7c` `#906c46` |

The exact values come from the code and may be tuned between releases.

### Where the code lives

The work is done by `resolveTheme` (and `deriveSeries`, which it calls) in the repository's `playground/appearance/`. The MCP server, the playground and this website use it. It is **not** exported from the `sayshape` package, so don't import it from there. A host that embeds the engine builds its theme with `extendTheme` and puts in the values itself, one theme per mode, each checked for contrast:

```ts
import { extendTheme, lightTheme, darkTheme } from "sayshape";

const light = extendTheme(lightTheme, {
  colors: {
    accent: "#ca4f2b", onAccent: "#ffffff",
    series1: "#ca4f2b", series2: "#2e86ab", series3: "#b3903e",
    series4: "#6f5a85", series5: "#7c95c0", series6: "#5a6c40",
  },
});
const dark = extendTheme(darkTheme, {
  colors: {
    accent: "#e4572e", onAccent: "#0b0f14",
    series1: "#e4572e", series2: "#2e86ab", series3: "#f2c14e",
    series4: "#7e6994", series5: "#98ac7c", series6: "#906c46",
  },
});
ui.setTheme(matchMedia("(prefers-color-scheme: dark)").matches ? dark : light);
```

If you set only `accent`, the first chart series follows it. Check the contrast of anything you choose in both modes ([Contrast](#contrast)). In the MCP server these are the options `--accent`, `--colors` and `--no-model-colors`, and the `colors` argument; see [In Claude, ChatGPT and other chat apps](./mcp#brand-colors).

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
