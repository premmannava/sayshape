# scroll: scrolling regions

Roadmap item 1 from the overnight run ("scrolling regions"), kept minimal, following `docs/PLAN.md`: "Scroll containers that clip children, handle wheel, touch and keyboard scrolling" (virtualization left for later).

## Syntax

```
scroll "Recent activity" size=md
  list
    each items=events as=e
      list-item "{e.title}" detail="{e.when}"
```

- `size=sm|md|lg`: how tall it gets before it scrolls, from the theme's control height (6, 9 or 12 controls), since specs never hold pixel sizes.
- The quoted text names it for screen readers and isn't drawn.
- `gap=` and `pad=` work as in `column`.

## How it works

- **Layout:** the children are stacked at full height, then shifted up by the offset, which is engine-held view state (`ctx.view`, read in layout through `LayoutContext.view`). The box is as tall as the content or the size, whichever is less. What follows it sits right under its box.
- **Drawing (engine):** `ComponentDef.clipChildren(box)` gives the rectangle the children show through, and the engine clips their painting to it. Nested scrolls intersect.
- **Pointer (engine):** every region registered while painting a clipped subtree carries the clip (`HitRegion.clip`). The pointer reaches a region only inside it, so a button scrolled out of sight can't be pressed.
- **Wheel (engine):** the wheel goes to the element under the pointer first, then to each element under it in turn, until one uses it. A list of buttons scrolls when you wheel over a button.
- **Keyboard:**
  - the scroll is a Tab stop of its own when it scrolls (Up, Down, Page Up, Page Down, Home, End);
  - when Tab moves to something out of sight inside it, the engine asks the scrolling element to bring it into view (`ComponentDef.revealChild`), once per move, so scrolling away afterwards isn't undone;
  - a layout asked for while painting now runs in the same frame (`renderNow`), so the screen never shows the step before.
- **Touch and mouse drag** on its background scroll it. A drag that starts on a child button is that button's.
- **Accessibility:** a `region` named by its text ("Scrolling area" without one), with all its children inside, scrolled or not. Copy text keeps everything.
- A thin scrollbar shows how much there is and where it is. The focus ring goes around the region.

## Tests

- `test/components/scroll.test.ts` covers heights, wheel, clipped pointer, keys, revealing on Tab, semantics, Copy text, nesting and streaming.
- The contract tests now know that a clipping parent holds children taller than itself, and that text scrolled out of sight isn't on screen (`test/overflow.ts`).

## Left out

- Virtualization (laying out only what's in sight) for very long lists.
- Sideways scrolling, sticky headers, and scroll position in state.
