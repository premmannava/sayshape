# dialog: the first overlay

This is roadmap item 2 from the overnight run, "a general overlay plus `dialog`". It is kept minimal and follows `docs/PLAN.md`: "A layer above the page for dialogs, dropdowns, tooltips and toasts, with focus trapping and Escape to close."

## Syntax

```
state confirm=false
button "Delete order" variant=danger on=set:confirm:true
dialog "Delete order NW-2041?" bind=confirm size=sm
  text "The order and its invoice are removed. This can't be undone." tone=muted
  row
    button "Cancel" variant=secondary on=set:confirm:false
    button "Delete" variant=danger on="emit:delete;set:confirm:false"
```

| Part | Meaning |
|---|---|
| `bind=` (required) | A true/false state. True shows the dialog. It's opened and closed with ordinary actions, so a model needs nothing new to learn. |
| `size=sm\|md\|lg` | How wide it gets, from the theme's control height. It is never wider than the screen less a margin. |
| `on=` | Runs when the person dismisses it: with its ×, with Escape, or by pressing outside it. Closing it from a button inside is that button's own `on=`. |
| The quoted text | The title. Screen readers use it as the dialog's name. |
| Children | Anything. |

## How it works

**Overlay (`ComponentDef.overlay`).** This is general, not dialog-specific. It has three parts:

- `open(node, ctx)`
- `width(node, screen, ctx)`
- `close(pressContext)`

**Layout.**

- `visibleChildren` leaves overlay elements out of their parent's layout and collects them, so they take no room where they're written.
- After the root is laid out, the engine lays out the first open overlay on its own, at its width, centred in what's in sight.
- It grows the canvas if the dialog needs more room.
- One overlay shows at a time. If several are open, the first one written shows, and the next shows when it closes.

**Paint.**

- First the screen.
- Then the theme's new `scrim` token over the whole canvas. The scrim is dark in every theme, so the dialog stands out in dark mode too.
- Then the dialog, as a raised panel with a soft shadow.

**Inert behind.**

- Hit regions registered before the dialog are dropped, so nothing behind it can be pressed, hovered or reached with Tab.
- A press outside the dialog closes it, and the press stops there.
- Escape closes it, unless a popup inside it, such as a select's list, is open; that popup closes first.

**Focus.**

- When the dialog opens, focus moves to its first stop.
- When it closes, focus goes back to what had it before.
- In keyboard mode, DOM focus follows.

**Screen readers and Copy text.**

- While the dialog is open, the accessibility tree and Copy text hold only the dialog.
- Its mirror element is `role="dialog"` with `aria-modal="true"`, named by its title.
- Its × is a "Close" button part.

**`boxes`.** While a dialog is open, it is the root's last child, so the inspector and tests find it on top.

## Tests

`test/components/dialog.test.ts` covers:

- parsing;
- taking no room;
- size and centring at 240, 360, 600 and 1024 px;
- buttons inside;
- an inert screen behind;
- Escape, ×, and a press outside running `on=`;
- focus moving in and back;
- the tree and Copy text;
- the scrim;
- streaming;
- a path `bind=` inside `each`.

Two other places also test it:

- `test/write-data.test.ts`
- `test/copy-text.test.ts`

## Left out

- Menus, tooltips and toasts. These need an overlay placed beside its owner rather than centred.
- Sheets that slide in from an edge, and animation.
- Stacking several dialogs at once.
- Scrolling inside a dialog taller than the screen. The canvas grows instead; put a `scroll` inside for long content.
