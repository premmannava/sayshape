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
- `disabled=`.

`menu-item`:
- The quoted text is what it does (required).
- `on=` (required).
- `icon=` takes any of SayShape's own icons.
- `tone=bad` is for removing things or for anything that can't be undone.
- `disabled=`.

## How it works

- **No new layer.** The list is the existing popup layer (`ComponentDef.popup`), the same one a select's options use. That layer already places the list in sight, draws it on top, swallows presses outside, closes on Escape and Tab, and gives focus back.
- **Placement.** A menu sits at the end of the room it's given: the trailing ⋯ of a row, or actions beside a title. Its list lines up with its right edge, through a new `PopupSize.alignEnd`.
- **Choosing.** Choosing an item closes the list, then runs the item's `on=` through a new `PressContext.runAs(node, actions)`. Its names and writes are seen from the item's own line, so `set:o.status:Shipped` inside `each` writes that order.
- **Keys.**
  - On the button: Enter, Space or Down opens the list on the first item; Up opens it on the last.
  - In the list: Up and Down move round, Home and End jump, and a letter moves to the next item starting with it. Disabled items are skipped. Enter and Space choose.
- **Screen readers.**
  - The button has `aria-haspopup="menu"` and `aria-expanded`.
  - While open, the list is a `menu` of `menuitem`s, with the highlighted one as the active descendant, as select does.
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
- The contract tests check `menu-item` through its menu (`PRESSED_IN_PARENT_LIST`): Tab reaches the menu, Down opens it with a region per item, and Enter runs the first item's own `on=`. A menu-item has no box of its own, so the per-box checks can't apply to it.

## Left out

- Submenus.
- Separators and group headings.
- Checkable items.
- Menus opened by a right-click.
