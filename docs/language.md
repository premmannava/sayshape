# The SayShape language

## Elements

One element per line: its type, optional quoted text, then `name=value` props.

```
button "Save changes" variant=secondary on=emit:save
```

Prop values can be bare (`variant=secondary`), quoted (`label="Water (L)"`) or an expression (`value={price * qty}`). Quotes can be escaped with a backslash. A quoted value is always text, in props and on `state` lines alike: `value="56"` is the text 56, so `{q == '56'}` matches it, and `state zip="02139"` keeps its leading zero. Bare `56`, `true` and `false` are a number and booleans; a boolean prop reads `"false"` as false either way.

## Nesting

Indent children under a container. Two spaces is the convention; tabs count as two spaces.

```
card
  text "Your order" style=title
  row
    button "Cancel" variant=secondary
    button "Pay"
```

## State

Declare state on unindented `state` lines, usually at the top. Values are numbers, `true`/`false`, `null`, text, lists `[…]` and records `{name: value}`.

```
state qty=2 price=24 gift=false name="Ada"
state todos=[{text: "Pack water", done: false}, {text: "Snacks", done: true}]
```

A value must fit on one line, however long, so a streamed spec can render line by line. Lists and records hold data only: they're parsed, never run, and are limited to 20 levels deep and 10,000 values. Data your app passes in with `state.set` may hold up to 1,000,000 values (each row and field counts).

State declared in a spec only sets the starting value. A value the user has already changed is kept when the spec is re-parsed with the same declaration (while streaming, or after an edit elsewhere). When a new spec declares a different starting value, such as a refined screen with new data, the new value replaces the old one. Values your app set itself are never replaced by a declaration. Your app can supply data too, with `ui.state.set("products", rows)` ([Lists](#lists)).

## Derived values

A `derive` line works a value out from state and keeps it up to date, so a total, a filtered list or a chart's data is written once and every element reads the same thing:

```
state quantity=2 price=350 taxRate=0.08
derive subtotal={quantity * price}
derive tax={subtotal * taxRate}
derive total={subtotal + tax}
stat label="Total" value={total}
```

- **Grammar.** `derive name={expression}`, unindented, at the top level of the spec; several pairs may share a line, as with `state`. A line with one derived value may leave out the braces, as models often do: `derive order=find(orders, 'id', picked)` and `derive byCat=sort(group(spend, 'cat', 'amt'), 'amt', 'desc')` both work. A fixed value (`derive b=5`) still gets a warning to use `state` instead. The expression is the same safe kind as everywhere else in SayShape, with the same functions; there are no functions of your own, callbacks or side effects.
- **Reading.** A derived name reads like state, in text, props, `if=`, `items=` and other `derive` lines. Its expression can read state, data your app sets with `ui.state.set`, and other derived values.
- **Order.** Declarations can come in any order: a value is worked out from whatever it reads, wherever that's declared. While a spec streams in, a value whose inputs haven't arrived yet shows as nothing (—) until they do.
- **Updates.** A value is worked out the first time it's read and kept until something it reads changes, directly or through other derived values; then it's worked out again the next time it's read. Changes to state it doesn't read leave it alone, and a render reads each value at most once per change.
- **Failures.** If a value can't be worked out (it reads an item that's gone, say), it's nothing (—), never the last good result, and so is everything derived from it. The reason is reported once through `onWarning`, and the value comes back when what it reads is fixed.
- **Read-only.** Derived values aren't state. `bind=` and actions (`set:`, `inc:`, `toggle:`, `add:`, `remove:`, `clear:`) can't change one, nor items of a derived list (`each items=open` with `bind=t.done`): the parser reports it, and the engine refuses with a warning. `ui.state.set` throws a `DerivedWriteError`. To let people change items, loop over the list in state and hide items with `if=`. `ui.state.snapshot()` holds state only; `ui.state.derivedSnapshot()` has the derived values.
- **Problems the parser reports**, each skipping only that value: an expression not in braces or with a syntax error, a name used twice, a name that's already state, a name expressions can't read (`__proto__`, `constructor`, `prototype`) or the engine uses (`screen`), a name nothing defines, and cycles, direct (`derive x={x + 1}`) or through others (`p` → `q` → `p`), which are left out with the loop named. A spec can derive at most 200 values.
- Lists that derived values hold are new, frozen lists: filtering or sorting never changes the list in state.

## Expressions

Anything inside `{…}` is evaluated against state.

```
state qty=2 price=24 gift=true
text "Total: ${qty * price + (gift ? 4 : 0)}"
stat label="Each" value={round(price / 3, 2)}
```

- Operators: `+ - * / %`, `== != < <= > >=`, `&& || !`, and `a ? b : c`
- Text joins with `+`: `{'$' + price}` (use single quotes inside a quoted prop)
- Functions: `min`, `max`, `round(n, digits)`, `floor`, `ceil`, `abs`, `pow(base, power)`, `fixed(n, digits)`, and the list and formatting functions in [Lists](#lists)
- `pow` covers compound growth and loan payments: `{round(amount * r * pow(1 + r, n) / (pow(1 + r, n) - 1), 2)}`. A result too large to show, or with no real answer like `pow(-8, 0.5)`, shows as `—`
- Fields and items: `{order.city}`, `{cart[0].price}`, `{todos.length}`
- Words inside `{…}` are state names, so quote text: `{done ? 'Packed' : 'To pack'}`
- There is no assignment, no calling methods and no global access, and `__proto__`, `constructor` and `prototype` can't be read. Anything that can't be read shows as `—` rather than guessing, and the parser warns about names nothing defines.

## Actions

Interactive elements run actions from their `on=` prop.

| Action | Effect |
|---|---|
| `inc:key` or `inc:key:by` | Add 1 (or `by`) |
| `dec:key` or `dec:key:by` | Subtract 1 (or `by`), never below 0 |
| `toggle:key` | Flip true/false |
| `set:key:value` | Set a literal, or an expression: `set:total:{a + b}` |
| `emit:name` or `emit:name:value` | Tell the host app what the user chose |
| `go:screen` | Show another screen ([Screens](#screens)) |
| `back` | Return to the previous screen |
| `notify:'message'` | Show a short message for a few seconds; it can include `{expressions}` |
| `add:list:value` | Add an item to the end of a list: `add:todos:{text: 'Map', done: false}` |
| `remove:t` or `remove:list:index` | Remove the current item inside `each`, or the item at a position |
| `clear:list` | Empty a list |

The key of `inc`, `dec`, `toggle` and `set` can be a path into data, like `toggle:t.done` ([Lists](#lists)). A quoted value is text: `set:msg:'Hi there'`.

Run several in order with `;`:

```
state qty=2 placed=false
button "Place order" on="set:placed:true;emit:order:{qty}"
```

`emit` is how a generated screen talks back to your app, for example to send the user's choice to the model for the next step.

`notify` shows a message at the bottom of the visible area, drawn by the engine in the theme's colors, and fires a `notify` event so your app can also announce it. Quote the message when it has spaces or `;`:

```
button "Add to cart" on="inc:items;notify:'Added. {items} in your cart'"
```

## Lists

`each` repeats what's indented under it once per item of a list. It has no look of its own: the copies sit in the container around it, so `each` inside a `row`, `grid`, `list` or `tabs` makes one cell, row or tab per item.

```
state todos=[{text: "Pack water", done: true}, {text: "Charge headlamp", done: false}]
card
  text "{count(todos, 'done')} of {len(todos)} packed" tone=muted
  each items=todos as=t
    row
      check "{t.text}" bind=t.done
      button "Remove" variant=secondary on=remove:t
  button "Add snacks" on="add:todos:{text: 'Snacks', done: false}"
```

| Prop | Meaning |
|---|---|
| `items` | The list: a state name, a field (`o.lines`) or an `{expression}` |
| `as` | Name of the current item inside (default `item`) |
| `index` | Name of its position, from 0 |
| `key` | A value unique to each item, like `{t.id}`, so focus stays with the item when the list changes (default: the position) |

- **Reading:** `{t.text}` inside the `each`. A loop variable only exists inside its `each`; using it outside is a warning.
- **Changing an item:** `bind=t.done`, `toggle:t.done`, `inc:item.qty`. This works only when `items=` names a list in state, not a computed one. Changes never edit data in place: the whole list is replaced, so the `change` event reports it (`todos`) and your app can save it.
- **Changing the list:** `add`, `remove` and `clear` (see [Actions](#actions)).
- **Lists in lists:** put an `each` inside an `each`, as in `each items=o.lines as=line`. Inner items can read outer ones.
- **Limits:** at most 500 items per `each`, and 10,000 repeated elements per screen however lists nest. Past either, the rest are left out with a warning.

List functions, for computing instead of typing numbers:

| Function | Result |
|---|---|
| `len(list)` | Number of items |
| `count(list, 'done')` | Items whose field is true |
| `sum(list)`, `sum(list, 'price')`, `sum(list, 'price', 'qty')` | Total of the items, of a field, or of two fields multiplied per item (cart totals). Only numbers count: a missing field, `null`, `true`/`false` or text (even `"12"`) makes the total — rather than being read as a number; an empty list totals 0. `avg`, `min` and `max` of a field work the same way |
| `avg(list, 'field')` | Average |
| `join(list)`, `join(list, 'name', ' / ')` | Text listing the items or a field |
| `includes(list, value)` | Whether a value is in the list |
| `min(list)`, `max(list)`, `min(list, 'price')`, `max(list, 'price')` | Smallest and largest, of the items or of a field |
| `count(list, 'cat', 'Gas')` | Items whose field equals a value, or any value in a list: `count(list, 'region', shown)` |
| `filter(list, 'done')`, `filter(list, 'cat', 'Gas')`, `filter(list, 'region', shown)`, `filter(list, 'date', period)`, `filter(list, 'price', {to: budget})` | The items whose field is true, equals a value, is any value in a list (a multi-select's; an empty list keeps none), or is within a `{from, to}` range (a date range's, or numbers; both ends included, an empty end open), as a list |
| `find(list, 'id', picked)` | The first item whose field equals a value, or `null`: `{find(rooms, 'id', room).rate}` |
| `search(list, 'name', query)` | Items whose field contains some text, ignoring case (all of them for empty text) |
| `sort(list, 'price')`, `sort(list, 'price', 'desc')`, `sort(list)` | The list in order, by a field or by value |
| `take(list, 3)` | The first items |
| `slice(list, 10, 20)`, `slice(name, 0, 1)` | Items (or characters) from a start up to, not including, an end, counting from 0: one page of a `pagination` is `slice(rows, (page - 1) * 10, page * 10)` |
| `pluck(list, 'revenue')` | One field of every item, as a list (`null` where it's missing), e.g. for a stat's `spark=` |
| `first(list)`, `last(list)` | The first or last item, or nothing for an empty list: `first(sort(sales, 'revenue', 'desc')).month` is the best month |
| `group(list, 'region')`, `group(list, 'region', 'revenue')`, `group(list, 'region', 'revenue', 'avg')` | Totals per category: one record per region, in the order each first appears, with `count` (how many items) and, given a field, its total under the field's own name: `[{region: "West", count: 12, revenue: 48200}, …]`. A fourth argument works out `'avg'`, `'min'` or `'max'` instead. Totals follow `sum()`'s rules. Values group as they are (`"US"` and `"USA"` are two groups), and items without the field share a `null` group. The groups are new, read-only records |

They combine: `{money(sum(filter(tx, 'cat', 'Gas'), 'amount'))}`, `{take(sort(runners, 'miles', 'desc'), 3)}`. There are no methods or template strings: `rows.slice(0, 5)` is written `slice(rows, 0, 5)`, and text with values in it goes in quotes without braces around it (`value="${total}K"`, not `value={"${total}K"}`, which is reported because its braces would show as they are), and a function given more arguments than it takes is reported rather than silently ignoring the extras. Use them for counts and totals, and for the lists people work with: items of a filtered, sorted or searched list keep their place in state, so `bind=t.done` inside `each items=shown` (with `derive shown={filter(tasks, 'owner', owner)}`) ticks the task in `tasks`, and totals worked out from `tasks` follow. To hide items without a derived list, put `if=` on the `each` or on the repeated element. On the `each`, `if=` is read per item, with the item in scope: `each items=tasks as=t if={owner == 'All' || t.owner == owner}`.

Formatting, for text people read:

| Function | Result |
|---|---|
| `money(2400)`, `money(-84.1)`, `money(n, 'EUR')` | `$2,400.00`, `-$84.10`, `€…` |
| `number(37000)`, `number(n, 2)` | `37,000`; always two decimals |
| `compact(12345678)`, `compact(n, 'USD')` | `12.3M`, `$12.3M`: big figures in small spaces, like a `stat`. Keeps 3 significant digits or 1 decimal, whichever says more: `compact(1240000)` is `1.24M` |
| `plural(n, 'item')`, `plural(n, 'child', 'children')` | `1 item`, `3 items`, `2 children` |
| `lower(text)`, `upper(text)`, `trim(text)` | Text in lower or upper case, or without spaces at the ends |

Numbers and money are formatted in US English for now.

Your app can pass its own data, which is copied into plain, frozen SayShape data (functions, class instances and cycles are refused with a clear error):

```ts
ui.state.set("products", await fetchProducts());
ui.on("change", ({ key, value }) => { if (key === "cart") saveCart(value); });
```

While data is on its way, name it with `setLoading`. Elements that read it, directly or through `derive` lines, draw a placeholder shaped like themselves (bars or a line for a chart, rows under the real header for a table, the label and a bar for a stat) with a soft highlight sweeping over them, instead of an empty state. When the data arrives they draw in: bars grow, lines run in from the left, pies sweep round, rows slide in and stat figures count up. With reduced motion, placeholders are still and the data simply appears.

```ts
ui.setLoading(["products"]);            // before or after setSpec
ui.state.set("products", await fetchProducts());
ui.setLoading([]);                      // whatever is still loading; [] when all is here
```

`setAwaiting(true)` treats every name an element reads that has no value yet as loading. Use it while a spec streams in and you don't yet know which names you'll fill; turn it off when you do.

### Charts

`chart` draws a list of records as bars, lines, a pie or a donut, and redraws whenever the list changes, from state, the screen's own controls or the host:

```
state sales=[{month: "Jan", revenue: 12000, last_year: 10000}, {month: "Feb", revenue: 18000, last_year: 14000}, {month: "Mar", revenue: 15000, last_year: 16000}]
chart "Monthly revenue" kind=bar items=sales x=month y=revenue format=money
chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year labels="This year,Last year" format=money
chart "Revenue by month" kind=donut items=sales x=month y=revenue format=money
```

`x=` and `y=` name fields, as `sum(list, 'price')` does, so they're written without quotes; `items=` is any expression that gives a list, like `items={filter(sales, 'open')}`. The props are in the [reference](components.md#chart). How it treats data:

- Bar and line take up to 6 fields in `y=`, separated by commas with no spaces. Each is a series in the theme's series colors, all on one scale, with grouped bars side by side and a legend below (only for 2 or more). `labels=` names them in the legend; otherwise it shows the field names. One field draws exactly as it always has, in the accent, with no legend. More than 6 shows a message instead.
- Pie and donut take one field. Each item with a value above 0 is a slice, in list order, and the legend below shows each slice's label, value and share. More than 6 slices keeps the 5 largest and adds an "Other" slice holding the rest. A donut shows the total in its middle, formatted by `format=`. Zero values are left out; a negative value, or nothing above 0, shows a message instead. A comma list in `y=` is a warning, and only the first field is used.
- Stacked (`kind=stacked`) takes up to 6 fields, like bar. Each item is one bar, and each field a segment in the series colors, from the bottom up in the order written, with a legend. Positive values stack up from 0 and negative ones down from it. A field without a number is left out of that bar, never counted as 0. The total sits above each bar when every bar has room.
- Area (`kind=area`) is a line with the space under it filled down to 0, for amounts over time. Unlike a line, its scale always includes 0. Up to 6 fields draw as overlapping areas with a legend; a missing number breaks the area there.
- Funnel (`kind=funnel`) takes one field. Each item is a stage, top to bottom in list order, as wide as its value against the largest, narrowing to the next stage's width. Beside each band are its name, its value and its share of the stage before (`640 · 53%`). At most 12 stages; a negative value shows a message instead.
- Waterfall (`kind=waterfall`) takes one field. Each item is a change: its bar starts where the running total stands and ends where the change takes it, rises in the good color and falls in the bad one, joined by thin lines. `total="Net income"` adds a last bar from 0 to where the changes end. An item without a number is a gap, and the total carries on without it.
- Bullet (`kind=bullet`) takes one field, plus `target=` naming the field with each item's goal. Each item is a row: its name and "actual of target" (`$310K of $400K`), a bar for the actual and a dark tick at the target. Each row has its own scale, so KPIs in different units sit together; `format=` applies to every row, so mix money with counts only under `format=number`. The bar is good at or past the target, warn within 15% of it and bad further off; `good=down` turns that round for costs, churn or response times. An item with no target is drawn in the accent and not judged; one with no actual is a gap. At most 20 rows; a negative value shows a message instead.
- Heatmap (`kind=heatmap`) takes one field, plus `rows=` naming the field with each item's row; `x=` names its column. Each item is a cell, shaded in the accent by its number (darker is more, from 0, or the lowest value when some are negative, to the highest), with a key below. Rows and columns go in the order they first appear. A cell no item fills is left empty, and so is an item without a number; when two items share a cell, the first is shown and the line says so. Numbers sit in the cells when they all fit, as whole numbers if that's what it takes; column labels thin out when they'd run together, and too many columns for the width show a message instead.
- Scatter (`kind=scatter`) puts a dot per item at its `x` and `y` numbers, each on its own number scale (0 isn't forced in), so it's the one kind with a numeric x-axis. `label=` names each dot, `size=` sizes dots by a number (their area), `group=` colors them by category with a legend (at most 6), and `labels="Risk,Return"` names the two axes. Items without both numbers aren't drawn, with a warning. It's the one chart Tab lands on: the arrow keys move from dot to dot in x order and show each dot's tip, as hovering does. Screen readers get how the two numbers relate ("Return mostly rises as Risk rises") and the dots as a table.
- Treemap (`kind=treemap`) takes one field. Each item above 0 is a rectangle whose area is its share of the total, laid out squarified (rows kept as close to square as they can be) with the biggest at the top left, in a stronger accent for more (never at a strength where its words would miss AA contrast). Names and values sit inside where they fit; every part is in the tip, the summary and the data table. At most 60 parts: the smallest, and any too small to see, are drawn together as one "N others" rectangle. Negative values show a message.
- Sankey (`kind=sankey`) takes `from=` and `to=` naming each flow's ends and one `y=` field for its amount (no `x=`). Places are columns worked out from the flows (each one column after the furthest place flowing into it; places nothing flows out of go last, and places nothing flows into sit just before what they feed), as tall as what flows through them, joined by bands as thick as their amounts, in the source's series color. Repeated pairs are added up. Flows without both ends or a number above 0 are left out with a warning; flows that go round in a circle, or more columns than fit the width, show a message. At most 40 places and 120 flows.
- `format=percent` shows values that are already percentages with a % sign: a rate of 42 reads 42%, on every kind.

For one number against its range, like progress toward a goal or a score, use `meter` instead of a chart: a `ring` or a `gauge`, colored bad, warn or good by `bands=`:

```
state score=72 done=41
meter "Health score" kind=gauge value=score max=100 bands="60,85"
meter "Goal reached" value=done max=50 format=percent
```

- Each item is one category, in list order, evenly spaced. Line charts don't treat x as dates or numbers.
- A value must be a number. A missing field, `null`, or text (even `"12"`) is a gap: no bar, and the line breaks there instead of joining across it. Nothing is turned into 0. A missing label shows as "—".
- Bars always include 0, with negative values below it. A line is scaled from its lowest to its highest value, rounded out to whole ticks; a constant line gets room above and below.
- Labels are thinned out evenly when they'd overlap. Bars and points never are.
- An empty list, a value that isn't a list, or no numbers at all shows "No data to chart" or "No numbers to chart". More than 200 items, or too little width for them, shows a message saying so instead of a partial chart.
- Problems a model can fix (items that aren't a list, gaps, too little room) are reported once through the engine's `onWarning`, not on every frame.

### Selects

`select` picks one option from a list, in a field that opens the list in a [popup](engine.md#popups):

```
state departments=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}, {id: "legal", name: "Legal", full: true}] department=""
select "Department" items=departments value=id label=name unavailable=full bind=department placeholder="Choose a department"
```

`items=` is a list of records, with `value=` naming the field to store and `label=` the field to show, or a plain list of text or numbers, each its own value and label. `bind=` holds the chosen value, and `on=` runs after it's stored. The props are in the [reference](components.md#select). How it treats options:

- A value is text or a number, 0 included; `0` and `"0"` are different options. Items with no usable value, or repeating an earlier option's value, aren't offered.
- `unavailable=` names a field that, when `true`, greys an option out; it can't be chosen by pointer or keyboard.
- A `bind=` value no option has shows the placeholder, and the state keeps its value. To offer "all", add an option for it, like `{id: "", name: "All departments"}`.
- With no options, items that aren't a list, or more than 200 options, the field says so ("No options", "Too many options") and doesn't open. Narrow a long list with `filter()` or `search()`.
- Long labels are cut with an ellipsis, in the field and in the list.
- Problems a model can fix (no value field, repeated values, a chosen value no option has, too many options) are reported once through `onWarning`.

With `multiple=true` it picks several, for filters like which regions to show. `bind=` then holds a list of the chosen values, starting from a list in state:

```
state regions=["West", "East", "Central", "South"] shown=["West", "East"] sales=[{region: "West", amt: 820}, {region: "East", amt: 610}, {region: "South", amt: 380}]
derive picked={len(shown) ? filter(sales, 'region', shown) : sales}
select "Regions" items=regions bind=shown multiple=true placeholder="All regions"
chart "Sales" kind=hbar items=picked x=region y=amt
```

- Each option has a box, ticked when chosen. Choosing one adds or removes it and runs `on=`; the list stays open until Escape, Tab or a press outside. The values are kept in the options' order.
- The field shows the chosen labels, or the first ones and how many more when they don't fit ("West, East +2"), or the placeholder when none are chosen.
- `filter(list, 'field', chosen)` keeps the items whose field is any chosen value. An empty list keeps none, so show everything then, as above.
- A `bind=` that isn't a list, or values no option has, are reported through `onWarning`.

### Dates

`date-picker` picks one calendar day, in a field that opens a month calendar in a [popup](engine.md#popups):

```
state due=""
date-picker "Due date" bind=due min="2026-01-01" max="2027-12-31"
```

The props are in the [reference](components.md#date-picker). How it treats dates:

- **The value** is text, `YYYY-MM-DD`, or `""` for no date: a day on the calendar with no time and no time zone. SayShape works dates out itself (leap years, month lengths, weekdays) instead of using JavaScript's `Date`, so a date never shifts by a day across time zones and text like `2026-02-30` is never quietly read as March 2.
- **Limits.** `min=` and `max=` are inclusive. Days outside them are greyed out and can't be chosen, and paging stops at them. A limit that isn't a real date is ignored, and if `min` is after `max` both are, each with a warning.
- **Values it can't use.** A bound value that isn't a real date shows "Invalid date"; one outside the limits is still shown but can't be chosen again. Both are reported once through `onWarning`. Drawing never changes state.
- **Opening.** The calendar opens on the chosen date's month, or else on today's, moved inside the limits. Today is the device's local day, or the engine's `today` option, which tests and screenshots use to fix it.
- **Choosing** a day, or Today, writes `bind=`, closes the calendar and runs `on=` if the date changed. Clear, and Delete or Backspace on the field, write `""`, unless `required=true`.
- **Locale.** Month and day names are US English, weeks start on Sunday, and the field shows dates like "Tue, Mar 3, 2026". There's no other locale yet.

With `range=true` it picks a start and an end, for report filters like the last 30 days. `bind=` then holds `{from, to}`, starting from a record in state:

```
state period={from: "", to: ""} orders=[{id: 1, date: "2026-10-02", amt: 120}, {id: 2, date: "2026-10-12", amt: 340}]
derive shown={filter(orders, 'date', period)}
date-picker "Period" bind=period range=true
stat label="Revenue" value={money(sum(shown, 'amt'))}
```

- **Choosing.** The first day pressed (or entered with the keyboard) marks the start; the band follows the pointer to show the range so far. The second day writes both ends, earliest first, closes the calendar and runs `on=` if the range changed. The start is the calendar's own until then, never state.
- **Presets.** Last 7 days and Last 30 days end today and stay inside `min=` and `max=`. Clear, and Delete or Backspace on the field, write `{from: "", to: ""}` unless `required=true`.
- **The field** shows "Oct 6 – Oct 16, 2026", without the year when it doesn't fit, and across years "Dec 28, 2026 – Jan 3, 2027".
- **Filtering.** `filter(list, 'date', period)` keeps the items from the start to the end, both included, and every item while the range is empty. A value that isn't a `{from, to}` record shows "Invalid dates" and is reported through `onWarning`.

### Tables

`table` shows a list of records as rows, with one `table-column` line per field, in the order written:

```
state equipment=[{id: "laptop", name: "Laptop", price: 1200, stock: 12}, {id: "monitor", name: "Monitor", price: 350, stock: 24}] selected="" sortField="name" sortDirection="asc"
table "Available equipment" items=equipment key=id bind=selected sort=sortField direction=sortDirection
  table-column "Equipment" field=name
  table-column "Price" field=price format=money
  table-column "In stock" field=stock format=number
```

Everything beyond showing rows is opt-in through state, so it can be read, shown and changed like any other state: `sort=` and `direction=` make the headers pressable (press to sort, press again to flip), and `bind=` with `key=` makes the rows pressable (`on=` runs after the selection is stored). The props are in the [reference](components.md#table). How it treats data:

- **Cells.** Text columns show text as written, numbers like `1,200.5` and true/false as Yes/No. `number` and `money` columns (US dollars, as `money()`) show only numbers, right-aligned; text like `"12"` is never read as a number. Missing fields, `null`, lists, records and values a column can't show appear as `—`. `0` and `false` are values, not missing. Very large or small numbers use scientific form (`1E300`) instead of being cut short.
- **Sorting.** The list itself is never reordered: the table shows a sorted copy. Ascending puts numbers by value, then text alphabetically (ignoring case, with numbers in text compared as numbers, so "Item 2" comes before "Item 10"), then false and true; descending reverses that. Missing values always go last, and equal values keep their list order. A sort state naming no column leaves the list in order.
- **Selection.** `bind=` holds the selected row's `key=` value, text or a number (0 included), so the selection stays with its record when the table is sorted or the list changes. Rows with no key, or a key an earlier row already has, can't be selected. A selected key no row has selects nothing; the state keeps its value until something changes it.
- **Space.** Columns get their natural width, and spare room goes to text columns. When space is short, text columns are narrowed with an ellipsis, but never below a minimum, and numbers are never cut. If the columns still don't fit, the table scrolls sideways: every column keeps a readable width, the first column stays pinned at the left, and a scrollbar shows under the rows. It scrolls with a sideways swipe or Shift and the wheel, by dragging the rows or the scrollbar, and with the arrow keys, Home and End once the scrollbar has focus. More than 200 rows (or 64 columns) shows a message saying so instead of a cut-down table. Show a page of a long list with `take()` or `pagination`.
- **Keyboard.** Pressable headers and rows are each a Tab stop and work with Enter and Space. A table with no `sort=` or `bind=` adds no Tab stops.
- Problems a model can fix (items that aren't a list, missing or repeated keys, cells their column can't show, too many rows or columns, too little room) are reported once through `onWarning`. While a spec streams in, a table whose columns haven't arrived shows "No columns yet".

## Screens

A spec can hold several screens. Only one shows at a time: the first, until a button moves to another with `go:name`. `back` returns to the previous one, and the visible screen's name is in `{screen}`.

```
state qty=1
screen name=product title="Trail socks"
  stepper "Quantity" bind=qty min=1
  button "Add to cart" on=go:cart
screen name=cart title="Your cart"
  text "{qty} pairs"
  button "Keep shopping" variant=secondary on=back
```

State is shared by every screen. Screens only go at the top level, and their names are plain words (letters, digits and `_`). `go:` to a screen that doesn't exist does nothing. A screen written without `name=` gets a warning but still shows when it's the first, so a lone `screen title="Team hours"` isn't left blank; it can't be the target of `go:`. Your app can move between screens too, with `ui.go("cart")` and `ui.back()`, and hears every move through the `navigate` event.

## Conditions

Every element accepts `if=`. The element (and everything inside it) is shown only while the condition is true.

```
state water=true read=false walk=true drink=true
text "Packed!" tone=good if=water
text "All done" if={read && walk && drink}
```

To show several lines under one condition, put them under a line holding only `if=`. Like `each`, it has no look of its own:

```
if={count(todos, 'done') == len(todos)}
  text "All done!" tone=good
  button "Start over" on=clear:todos
```

Right after an `if=` line (a block or an element with `if=`), at the same indent, `else` shows its lines when the condition doesn't hold, and `else if={…}` adds another case. Like `if`, it needs nothing to close it, so a spec still streams line by line:

```
state view="Week"
segmented bind=view options="Week,Month,Year"
if={view == 'Week'}
  text "This week"
else if={view == 'Month'}
  text "This month"
else
  text "This year"
```

An `else` with no `if=` line just before it is an error, and it and its lines are skipped.

## Tips

Every element accepts `tip=`: a short explanation shown in a small bubble over it on hover, on keyboard focus, or on a tap on a touch screen, and hidden with Escape. An element that isn't pressable becomes a Tab stop when it has a tip, and screen readers read the tip after the element's name. Tips are for what a label or a number means, not for anything people must read to use the screen.

```
state open=14
stat label="Open orders" value={open} tip="Paid, not yet handed to the carrier"
button "Ship all" on=set:open:0 tip="Marks every open order shipped"
```

## Not JavaScript

Models often reach for code when a spec needs logic. Each kind of code line gets an error saying what to write instead, so one repair can fix it: `let`, `const` and `var` (use `derive name={…}` or `state`), `function` and `return` (use `derive`), `for` and `while` (use `each`), `elif` (use `else if={…}`), `if (…) {` and closing braces (use `if={…}` lines and indentation), `//` comments (use `#`), and sentences of prose.

## Comments

Lines starting with `#` are ignored.

## Errors

SayShape never stops on a mistake. Each problem becomes a diagnostic with a line number:

- **Errors** (unknown element, element in the wrong place, nesting more than 100 levels deep): that line and anything nested under it are skipped.
- **Warnings** (unknown prop, bad value, broken expression, a name nothing defines, a loop variable outside its `each`): the element still renders, and the bad part is ignored.

```
L10  Unknown element "sparkle". It was skipped, along with anything inside it
L4   "button" has no prop "colour". Known props: on, variant, disabled, if
L7   variant should be one of primary, secondary, danger; got "huge"
```
