---
title: Accessibility
description: How SayShape's canvas interfaces work with screen readers, keyboards and accessibility settings, and how to check them.
---

# Accessibility

SayShape draws on a `<canvas>`, which is one picture to assistive technology. So it keeps a hidden **accessibility mirror** beside the canvas: an invisible element over each thing it draws, with a role, a name and a state, kept in step as the screen changes. Screen readers, keyboards and phones' touch exploration work through it. It's on by default.

## Screen readers

- **Every element describes itself.** Buttons, links, checkboxes, switches, radios (grouped by `bind=`), sliders and steppers with their values, text fields with what's typed, headings, images by their description, lists, tabs, breadcrumbs, pagination, and tables with their headers and sort order.
- **Popups follow the combobox pattern.** A select or date picker is read with its current choice; while it's open, the highlighted option or day is read as the arrows move.
- **Charts and maps have text alternatives.** A chart is read as a figure with its title and a one-sentence summary worked out from its data ("3 items. Highest: Mar, $1,600. Lowest: Feb, $900."), and its numbers can be read as a table. A map lists its places.
- **Announcements.** `notify:` messages, new screens, and "Ready" once a streamed screen has arrived. While a spec streams in or data loads, the interface is marked busy so screen readers don't read half-built screens.
- **Names.** A control is named by its quoted text, or by the text just above it. `label=` names a segmented control, a rating or an icon that means something. The [model guide](../integration/model) asks models for labels and chart titles.

## Keyboard

Every interactive element is reachable with Tab and Shift+Tab, including separate parts of one element (a stepper's buttons, each star of a rating, each tab, each page number, a table's headers and rows). Enter and Space press the focused element; sliders, selects, date pickers, tables and segmented controls follow the arrow keys; Escape closes a popup. The engine draws a focus ring, and the browser's focus moves with it, so screen readers say where you are. Tab past the last element, or Shift+Tab before the first, leaves the interface.

While someone types, a real `<input>` sits over the field, so typing, input methods, autofill, password managers and the phone keyboard work as they do in any form.

## Settings and contrast

- **Contrast.** Text and accent colors meet 4.5:1 against their surfaces, and control outlines (a field's border, an unchecked box, a switch that's off), the focus ring and chart colors meet 3:1, in light and dark.
- **High contrast.** In Windows Contrast Themes (forced colors), SayShape redraws everything in the person's own colors, whatever theme the page chose.
- **Reduced motion.** Nothing fades or slides when the person has asked for reduced motion.
- **Target size.** Everything you can press is at least 24 px tall.
- **Messages.** Longer `notify:` messages stay up longer, up to 10 seconds.

## Using it

```js
canvas.setAttribute("aria-label", "Trip planner"); // what the whole interface is called
const sayshape = new SayShape(canvas, { components: coreComponents });
```

The canvas is labelled "Generated interface" unless you set your own label. Pass `accessibility: "off"` to turn the mirror off.

## Checking it

- In tests, `render(spec).accessibility()` from `sayshape/testing` shows the screen as a screen reader gets it, `ui.announcements` what it was told, and `ui.mirror` sends a screen reader's actions.
- SayShape's own tests run the [axe](https://github.com/dequelabs/axe-core) checker on every element's example, every sample and every example on this site.
- Automated checks can't prove WCAG conformance on their own. Before claiming it, run the 15-minute manual pass with VoiceOver and NVDA in [`docs/accessibility-testing.md`](https://github.com/premmannava/sayshape/blob/main/docs/accessibility-testing.md).

## Not covered yet

- The world map can't be reached by keyboard (its places are still listed for screen readers).
- Text selection and the browser's find in page. To copy, hosts can offer a button that calls `copyText()`, which gives the whole screen as plain text (the MCP view has one).
- Right-to-left text and complex script shaping beyond what the canvas does on its own.
- The person's own text size setting.

## On this website

The site's own pages, navigation, documentation and controls are ordinary HTML with keyboard focus styles. The interfaces in demos are SayShape canvases with the accessibility mirror, and next to each one the **spec** is shown as text.
