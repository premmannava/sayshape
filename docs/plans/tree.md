# tree: a hierarchy you can open and close

## What it's for

Anything that nests: an org chart, folders, a budget split by department, a category drill-down. A model gives a flat list of records where each one names its parent; the element builds the hierarchy, draws it, and lets people open and close branches.

## Syntax

```
tree items=people id=id parent=manager label=name detail=role
tree "Budget 2027" items=lines parent=parent label=name value=amount format=money open=2
tree "Northwind Mutual" items=people parent=manager label=name detail=role kind=org bind=picked
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| text | string | | Title above the tree. |
| items | expression | required | Flat list of records. At most `MAX_TREE_NODES` (300). |
| id | name | id | Field that identifies each record. |
| parent | name | parent | Field with the parent's id. Empty or missing: a top-level item. |
| label | name | name | Field with what each item says. |
| detail | name | | Field with a quieter line (a role, a path). |
| value | name | | Field with a number shown on the right. |
| format | text, number, money | text | How value= reads. |
| kind | list, org | list | list: indented rows that open and close. org: a top-down chart with boxes and connecting lines. |
| open | number | 1 | How many levels start open in a list (0: only the top level shows). |
| bind | state | | Holds the selected item's id. |
| on | action | | Runs after an item is selected. |

## Behavior

- **list**: a row per shown item, indented by level (fewer levels get their own indent on a narrow screen), with a chevron on items that have children. Pressing the chevron opens or closes; pressing the row selects it (or opens and closes when nothing is bound). Keyboard, as the ARIA tree pattern has it: the tree is one Tab stop; Up and Down move between rows, Home and End to the first and last; Right opens a branch or moves into its first child; Left closes it or moves to the parent; Enter or Space selects. The branch holding the selected item starts open. Org charts keep a Tab stop per box in version 1. Open and closed state is engine-held view state (`ctx.view`), never app state; `open=` sets where it starts.
- **org**: a tidy top-down layout written here: each subtree as wide as its children need, a parent centred over them, elbow lines between. Every item shows (no opening and closing in version 1). Too wide for its space, it scrolls sideways, as `table` does.
- Problems never throw: an item whose parent isn't in the list, and items in a loop of parents, are shown at the top level with a warning that names them and says how to fix the data. Duplicate ids keep the first.

## Accessibility and Copy text

An ARIA `tree` of `treeitem`s with `aria-level` and `expanded` (list), each named by its label, value and detail. Copy text is an indented outline of what shows, two spaces per level: `Ana Ruiz, COO` then `  Ben Okafor, Head of Claims`.

## Left out of version 1

Opening and closing in the org view, dragging items to a new parent, lazy loading of children, search and filtering inside the tree, multi-select, sideways org charts, and more than one root drawn as separate charts (several roots share one org chart side by side).
