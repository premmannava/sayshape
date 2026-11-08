# tip=: tooltips on any element

Roadmap item 4 from the overnight run ("tooltip"), kept minimal. The owner prefers a prop over a new element, so this is a prop every element takes (`COMMON_PROPS`), not a `tooltip` element wrapping others.

```
stat label="Open orders" value={open} tip="Paid, not yet handed to the carrier"
icon name=info tip="Counts refresh every 5 minutes"
button "Ship all" on=set:open:0 tip="Marks every open order shipped"
```

## How it works

**Showing.** The engine draws the tip last (`paintTip`), above everything, including an open dialog or popup.
- It's a small bubble in the theme's `ink` with `surface` words.
- It sits above its element, or below when there's no room above, kept inside the canvas.
- It wraps at about 280 px and is cut at 8 lines.

**What shows it** (WCAG 1.4.13, content on hover or focus):
- hover;
- keyboard focus;
- a tap on a touch screen, which pins the tip until the next press anywhere.

The pointer can move onto the bubble without it vanishing. Escape hides it without moving focus, until focus or the pointer moves to something else.

**Reaching it.** Every element with a tip gets a region for it (`TIP`), registered under its children's and its own parts, so the pointer shows the tip anywhere on it. An element with a tip that registers no hit region of its own (text, stat, icon, card) gets one (`TIP`). It is registered before its children's regions, so a card's buttons still take their own presses. The keyboard can therefore reach the tip, and so can a tap. An element that is already pressable keeps its own behaviour; its tip shows as its region is hovered or focused.

**Screen readers.**
- The tip is the node's description (`aria-description`), read after its name.
- An element pressable only for its tip becomes the focusable node itself.
- Layout or decoration (an icon) with a tip gets a node of its own, named by its words or the tip.

**Copy text** leaves tips out: they explain the screen, they aren't its content.

**After review.**
- A tip pinned by a tap or Enter lets go when focus moves.
- A second tap hides it, and a press on the bubble presses nothing under it.
- Tips show again after Escape once focus or the pointer moves away and back.
- No tip shows while a popup is open.
- The bubble stays on the canvas: above, else below, else the side with more room.
- A tip follows its element as it is in this frame, and goes when the element is scrolled out of sight.
- A new spec forgets pinned and hidden tips.
- `tip=` on an element its parent draws (`ComponentDef.drawnByParent`: `table-column`, `detail`, `compare-row`, `menu-item`) is a warning that says where to put it.
- In a dialog, the first Escape hides the focused element's tip and the second closes the dialog (WCAG 1.4.13 asks that a tip be dismissible without moving focus).

## Tests

`test/tip.test.ts` covers:
- hover;
- Tab stops;
- Escape;
- tap to pin;
- presses still reaching pressable elements and a card's children;
- the accessibility tree;
- state in the tip;
- an empty tip;
- 240 px wrapping.

## Left out

- Rich text in tips.
- A delay before showing.
- An arrow pointing at the element.
- Tips on parts of an element (one star of a rating).

A scene's shapes keep their own `tip=`.
