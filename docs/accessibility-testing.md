# Testing accessibility by hand

Automated checks (axe in `visual/a11y.spec.ts`, the contract tests, `test/a11y/`) catch missing roles, names and broken links between nodes. They can't tell whether a screen reader actually reads the interface well. Run this pass before telling anyone SayShape meets WCAG 2.1 AA, and after changes to `src/a11y/` or to how a component describes itself.

**Time:** about 15 minutes per screen reader.
**Where:** the playground (`npm run dev`, then `/playground/index.html`), with the samples below.

## Setup

| Screen reader | Browser | Start it | Read next / previous | Press | Notes |
|---|---|---|---|---|---|
| VoiceOver (macOS) | Safari | Cmd+F5 | VO+Right / VO+Left (VO = Ctrl+Option) | VO+Space | Turn on "Press Tab to highlight each item" in Safari's Advanced settings |
| NVDA (Windows) | Firefox or Chrome | Ctrl+Alt+N | Down / Up in browse mode | Enter | Tab and the arrows switch NVDA to focus mode on controls |
| VoiceOver (iOS) | Safari | Settings, Accessibility | Swipe right / left | Double tap | Drag a finger over the canvas: what's under it should be read |

## The pass

Tick each line; note anything read wrongly, read twice, or not read at all.

### 1. A form (samples: Packing list, Checkout)

- [ ] Tabbing into the interface lands on its first control, and the screen reader says its name and kind ("Name, edit text").
- [ ] Tab and Shift+Tab move through every control in reading order and then leave the interface, both ways.
- [ ] A field: typing works, and its label is read when it's focused.
- [ ] A checkbox and a switch: their state is read, and Space changes it and the new state is read.
- [ ] Radios: read as a group with its name ("Size") and "2 of 3".
- [ ] A stepper: Decrease and Increase are read with the label, and each new value is read after a press.
- [ ] A slider: its value is read, the arrows change it, and on iOS swiping up and down does.
- [ ] Pressing a button that shows a message (`notify:`): the message is read once, without moving focus.

### 2. A select and a date picker (samples: Directory, Design showcase)

- [ ] The select is read as a pop-up button or combobox with its current choice.
- [ ] Opening it (Down arrow, or pressing it) and moving with the arrows reads each option as it's highlighted.
- [ ] Enter chooses and closes it; focus stays on the select and its new value is read.
- [ ] Escape closes it without changing anything.
- [ ] The date picker: opening it reads the day the arrows are on; arrows move by day and week, Page Down by month; Enter chooses.

### 3. A dashboard (sample: Sales charts, or Dashboard answer)

- [ ] Headings are read as headings; with VoiceOver's rotor (VO+U) or NVDA's H key you can jump between them.
- [ ] Each chart is read as a figure with its title and a one-sentence summary, and its numbers can be read as a table, cell by cell, with headers.
- [ ] Stats are read with their label and value ("Revenue: $1,200, +12%").
- [ ] A table: headers are read with each cell; a sortable header says its sort order, and pressing it re-sorts; a choosable row says whether it's selected.

### 4. Screens and tabs (sample: Gear finder)

- [ ] Going to another screen reads its title once.
- [ ] Tabs are read as tabs with "selected" on the current one; choosing another shows its panel next.
- [ ] Pagination reads "Page 2, current page".

### 5. Streaming (the playground's Ask a model box)

- [ ] While a model's answer streams in, the screen reader doesn't read half-built screens.
- [ ] "Ready" is read once when it's done, and the finished screen can be read from the top.

### 6. Without a screen reader

- [ ] Windows: turn on a Contrast Theme (Settings, Accessibility, Contrast themes). The interface redraws in its colors, and turning it off redraws it back.
- [ ] Reduce motion (macOS: Accessibility, Display; Windows: Animation effects off): nothing fades or slides.
- [ ] Zoom the browser to 200%: everything still fits and can be used.

## When something's wrong

Find the element's node with `render(spec).accessibility()` in a test, or with the browser's accessibility inspector on the mirror (the `[data-sayshape-a11y]` element right after the canvas). Most fixes are in the component's `semantics` (its role, name or state); focus and announcements are in `src/a11y/dom.ts` and the engine's `syncAccessibility`.
