---
title: Slide decks
description: How deck and slide work. A presentation written as slides, shown one at a time, that fits every screen.
---

# Slide decks

A [`deck`](../elements/deck) holds [`slide`](../elements/slide)s and shows one at a time, with arrows and a dot per slide under it. Which slide shows is a number in state, starting at 0, named by `bind=` (the way a `carousel` keeps its page). Write the deck at the top level, not inside a card, and a slide per idea, with the title as the point it makes.

```sayshape live
state page=0
deck bind=page footer="Northwind · Confidential"
  slide "Q3 business review" layout=title eyebrow="Q3 2026"
    text "Revenue is up 18% on last year" style=lead tone=muted
  slide "Three numbers that sum up the quarter"
    grid min=220
      stat label="Revenue" value="$4.82M" change="+18%"
      stat label="New customers" value="312" change="+9%"
  slide "What we do next"
    timeline
      step "Hire two in support" time="Nov" status=current
      step "Open the Denver warehouse" time="Dec" status=upcoming
```

There is nothing to turn on: `deck` and `slide` are ordinary elements, and the model guide tells models about them. Each element's props are on its reference page.

## A slide is always 16:9

A slide is as wide as its space and laid out at 960 by 540, then drawn scaled to fit, so it looks the same on a phone and on a wall. Its quoted text is its title, which it draws itself. Everything indented under it goes below the title, centred in the room that is left. On a `layout=title` slide the title and what is under it sit together in the middle.

Content that is too tall is laid out wider and drawn smaller, down to 60% of its size. Past that it is cut off at the bottom, and a warning names the slide and says to split it in two. A `table` or `list` shows about five rows on a slide, so show the top few with `take()` and `sort()`, a total, or a chart.

## Filling in a slide

- `eyebrow=` is a few words above the title in the accent color, and `subtitle=` a quieter line under it.
- `footer=` on the deck is a line at the bottom left of every slide, `numbers=false` takes away the number in the corner (2 / 4), and `progress=true` draws a thin bar along the bottom showing how far through the deck it is.
- A `layout=agenda` slide lists the other slides' titles by itself, not the opening slide, itself or backup slides: up to six lines, then "and N more".
- `appendix=true` marks a backup slide after the main ones. It is left out of the count and the agenda, and numbered "Appendix 1 / 2".

```sayshape live
state page=0
deck bind=page numbers=true
  slide "Today" layout=agenda
  slide "Revenue"
    stat label="Revenue" value="$4.82M" change="+18%"
  slide "Costs"
    stat label="Costs" value="$3.1M" change="+4%" good=down
  slide "Method" appendix=true subtitle="How the numbers were worked out"
    text "Figures are from the finance close, in US dollars."
```

## Moving, and shared state

The arrows, the dots, Left, Right, Home and End (while one of the deck's controls has focus) and a sideways swipe on a touch screen all move between slides. `transition=fade`, the default, fades a new slide in; `none` doesn't, and with reduced motion nothing fades. `on=` on the deck runs after the slide changes.

State is shared by every slide, so one control can change what all of them show, and a button can jump to a slide:

```sayshape live
state page=0 region="North"
deck bind=page
  slide "Pick a region"
    segmented bind=region options="North,South"
    button "See the numbers" on=set:page:1
  slide "{region} revenue"
    stat label="{region}" value="{region == 'North' ? '$2.4M' : '$1.9M'}"
```

Only the slide shown is laid out, so the others are neither drawn, pressed nor read out. A deck streams in a slide at a time: a slide still being written draws what has arrived so far.

## Screen readers and copying

A screen reader finds a region called a slide deck, named by the slide shown, with a description such as "Slide 2 of 4". The arrows and dots are buttons, and each slide is a group named by its title. Copy text gives the slide shown.

## Looks, not colors

A slide uses the theme's [slide tokens](../integration/themes#slides), so the same deck matches every brand and a host can tune its type. A spec never chooses a color or a size. A host can also put its logo in every slide's corner, and in the [MCP view](../integration/mcp#slide-decks) a deck can be saved as a PDF or a PowerPoint file.

A `slide` outside a `deck` is an error and is skipped, and so is anything but a `slide` written directly inside a `deck`. A `deck` without `bind=` gets a warning.
