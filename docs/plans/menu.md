# menu: a list of actions

Roadmap item 3 from the overnight run, kept minimal, following `docs/PLAN.md` (`menu` in Tier B).

## Syntax

```
menu "Actions"
  menu-item "Edit" icon=file on=emit:edit
  menu-item "Duplicate" icon=copy on=emit:duplicate
  menu-item "Delete" icon=x-circle tone=bad on=emit:delete
```

`menu`:
- The quoted text is the button's words. Without it, the button is a ⋯ square.
- `label=` gives a screen reader name for the ⋯ button ("More actions" by default).
- `variant=secondary|primary`.
- `align=start|end`: where it sits in its room. The default is end for a ⋯ and start for a menu with words, like a button.
- `disabled=`.

`menu-item`:
- The quoted text is what it does (required).
- `on=` (required).
- `icon=` takes any of SayShape's own icons.
- `tone=bad` is for removing things or for anything that can't be undone.
- `disabled=`.

## How it works

- **No new layer.** The list is the existing popup layer (`ComponentDef.popup`), the same one a select's options use. That layer already places the list in sight, draws it on top, swallows presses outside, closes on Escape and Tab, and gives focus back.
- **Placement.** A ⋯ sits at the end of the room it's given (the trailing ⋯ of a row); a menu with words sits at the start, like a button; `align=` changes either. On the right half of the screen, its list lines up with its right edge, through a new `PopupSize.alignEnd`.
- **Highlight.** It's kept as the item's element id, not its position, so it stays on the same item when the list changes while open (an item shown by `if=`, items from `each`).
- **Choosing.** Choosing an item closes the list, then runs the item's `on=` through a new `PressContext.runAs(node, actions)`. Its names and writes are seen from the item's own line, so `set:o.status:Shipped` inside `each` writes that order.
- **Keys.**
  - On the button: Enter, Space or Down opens the list on the first item; Up opens it on the last.
  - In the list: Up and Down move round, Home and End jump, and a letter moves to the next item starting with it. Disabled items are skipped. Enter and Space choose.
- **Screen readers.**
  - Closed, it's a button with `aria-haspopup="menu"`.
  - Open, the same focused node becomes the `menu`, named like the button, holding its `menuitem`s, with the highlighted one as its active descendant (`ElementSemantics.active`, new). `aria-activedescendant` works on a menu, not on a button.
  - A screen reader moving onto an item highlights it (`PopupDef.point`, new; select has it too), so Enter chooses what it's on.
  - New roles: `menu` and `menuitem`. A new `hasPopup` semantics field.
- **Copy text.** Left out, like other controls.
- **Limits.** At most 20 items (`MAX_MENU_ITEMS`), with a warning.

## Tests

- `test/components/menu.test.ts`:
  - sizes at 240 to 1024 px;
  - the pointer, and writes per `each` copy;
  - keys;
  - the accessibility tree;
  - disabled;
  - the limit;
  - Copy text;
  - streaming.
- The contract tests check `menu-item` through its menu (`PRESSED_IN_PARENT_LIST`): the menu has a popup, Tab reaches it, Down opens it with a region per item, each item is a named node, and Enter runs the first item's own `on=`, closes the list and gives focus back to the menu. A menu-item has no box of its own, so the per-box checks can't apply to it.

## Left out

- Submenus.
- Separators and group headings.
- Checkable items.
- Menus opened by a right-click.
