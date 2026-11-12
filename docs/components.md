# Components

<!-- CATEGORIES:START (generated from src/components) -->
| Category | Components |
|---|---|
| Layout | [`column`](#column), [`row`](#row), [`overlap`](#overlap), [`grid`](#grid), [`card`](#card), [`list`](#list), [`list-item`](#list-item), [`accordion`](#accordion), [`divider`](#divider), [`spacer`](#spacer), [`each`](#each), [`timeline`](#timeline), [`step`](#step), [`carousel`](#carousel), [`scroll`](#scroll) |
| Content | [`text`](#text), [`image`](#image), [`code`](#code), [`badge`](#badge), [`avatar`](#avatar), [`callout`](#callout), [`icon`](#icon), [`tile`](#tile) |
| Data | [`stat`](#stat), [`rating`](#rating), [`chart`](#chart), [`chart-line`](#chart-line), [`chart-rule`](#chart-rule), [`chart-note`](#chart-note), [`meter`](#meter), [`table`](#table), [`table-column`](#table-column), [`compare`](#compare), [`compare-row`](#compare-row), [`details`](#details), [`detail`](#detail), [`schedule`](#schedule), [`board`](#board), [`tree`](#tree), [`flow`](#flow), [`map`](#map), [`pin`](#pin) |
| Input | [`button`](#button), [`link`](#link), [`check`](#check), [`switch`](#switch), [`radio`](#radio), [`select`](#select), [`date-picker`](#date-picker), [`stepper`](#stepper), [`slider`](#slider), [`input`](#input), [`segmented`](#segmented), [`menu`](#menu), [`menu-item`](#menu-item) |
| Navigation | [`screen`](#screen), [`tabs`](#tabs), [`tab`](#tab), [`breadcrumb`](#breadcrumb), [`pagination`](#pagination) |
| Feedback | [`progress`](#progress), [`skeleton`](#skeleton), [`empty`](#empty), [`dialog`](#dialog) |
<!-- CATEGORIES:END -->

All components also accept `if=` ([Conditions](language.md#conditions)). `map` and `pin` ship in a separate entry point, `sayshape/map`, because the country outlines add about 76 KB.

<!-- COMPONENTS:START (generated from src/components) -->
### `column`

Stacks its children vertically.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 8). |
| `pad` | number | Inner padding in pixels (default 0). |

Children: any elements.

```
column gap=6
  text "First"
  text "Second"
```

### `row`

Places children side by side, splitting the width equally. On narrow screens they wrap; sibling cards share a height per line by default.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 10). |
| `pad` | number | Inner padding in pixels (default 0). |
| `align` | `top` / `center` / `bottom` | Vertical alignment of children: top, center or bottom. |
| `wrap` | boolean | Move children onto more lines when they don't fit side by side (default true). Set false to always keep them on one line. |

Children: any elements.

```
row gap=10
  button "Cancel" variant=secondary
  button "Save"
```

### `overlap`

Puts its later children on top of its first one, at a corner, an edge or the middle: a Sale badge on a picture, a count on an icon, a label over a card. The first child sets the size.

| Prop | Type | Description |
|---|---|---|
| `at` | `top-left` / `top` / `top-right` / `left` / `center` / `right` / `bottom-left` / `bottom` / `bottom-right` | Where the children on top sit: top-left, top, top-right, left, center, right, bottom-left, bottom or bottom-right. |
| `inset` | number | How far in from the edges they sit, in pixels (default 8). |

Children: any elements.

```
overlap at=top-right
  card
    text "Trail runner socks" weight=semibold
    text "Three pairs" tone=muted
  badge "Sale" tone=bad
```

### `grid`

Places children in responsive equal columns. Cards in the same grid row automatically share a height, keeping dashboard panels aligned.

| Prop | Type | Description |
|---|---|---|
| `min` | number | Narrowest a column may be, in pixels (default 200). |
| `gap` | number | Space between children in pixels (default 14). |

Children: any elements.

```
grid min=140 gap=10
  stat label="Orders" value=12
  stat label="Returns" value=1
  stat label="Rating" value=4.8
```

### `card`

A surface that groups related content, stacked vertically. Give it on= to make the whole card pressable.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 14). |
| `pad` | number | Inner padding in pixels (default 22). |
| `variant` | `raised` / `hero` / `tinted` / `outline` | raised (default), hero (an accent wash for the one card that leads the screen), tinted (a quiet accent fill for a side group) or outline (a border only). |
| `on` | action | Actions to run when the card is pressed, e.g. emit:changed. Separate several with ; |

Children: any elements.

```
card variant=hero
  text "Order summary" style=title
  text "2 items" tone=muted
card on=emit:open_order
  text "Trail runner socks" weight=semibold
  text "Arrives Thursday" tone=muted
```

### `list`

A bordered list of rows, separated by lines. Use list-item children; any other element (a row, a check) becomes a row of its own.

Children: any elements.

```
list
  list-item "Trail runner socks" detail="Merino blend" trailing="$24"
  list-item "Rain shell" detail="Packs into its pocket" trailing="$129" on=emit:open_shell
```

### `list-item`

One row of a list: a title, an optional detail line and value on the right, and anything inside it (a badge, a check, a row) under the title. Give it on= to make it pressable.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The row's title. |
| `detail` | string | A second, quieter line under the title. |
| `trailing` | string | A short value on the right, like a price or a count. |
| `icon` | string | An icon before the text, by name from icon's list, e.g. icon=check-circle. |
| `on` | action | Actions to run when the row is pressed, e.g. emit:changed. Separate several with ; |

Children: any elements.

Only inside: `list`.

```
list-item "Rain shell" detail="Packs into its pocket" trailing="$129" icon=package on=emit:open_shell
```

### `accordion`

A heading that shows or hides the content under it when pressed. Stack several for an FAQ.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The heading. |
| `bind` | state, required | A true/false state name: true while open. |
| `gap` | number | Space between children in pixels (default 10). |
| `on` | action | Actions to run after it opens or closes, e.g. emit:changed. Separate several with ; |

Children: any elements.

```
state returns=true
accordion "Returns" bind=returns
  text "Free returns within 30 days, unworn."
accordion "Shipping" bind=shipping
  text "Ships in two business days."
```

### `divider`

A thin horizontal line separating sections.

```
divider
```

### `spacer`

Empty vertical space.

| Prop | Type | Description |
|---|---|---|
| `size` | number | Height in pixels (default 8). |

```
spacer size=16
```

### `each`

Repeats what's inside it once per item of a list, in place, with no look of its own; inside, the current item is called item (or the name given by as=). if= on each keeps only the items it's true for: each items=tasks as=t if={owner == 'All' || t.owner == owner}.

| Prop | Type | Description |
|---|---|---|
| `items` | expression, required | The list to repeat over, like todos or {cart}. |
| `as` | name | Name for the current item, used inside: as=t makes {t.text} work. |
| `index` | name | Name for the item's position, counting from 0. |
| `key` | expression | A value unique to each item, like {t.id}, so focus stays with the item when the list changes. Defaults to the position. |

Children: any elements.

```
state gear=[{name: "Tent", kg: 2.1}, {name: "Stove", kg: 0.4}, {name: "Headlamp", kg: 0.1}]
column gap=6
  each items=gear as=g index=i key={g.name}
    text "{i + 1}. {g.name}, {g.kg} kg"
```

### `timeline`

Steps in order with a line joining them: itineraries, how-to guides, order tracking, project history. Give steps a status only to show progress, like where an order is or which step the person has reached.

| Prop | Type | Description |
|---|---|---|
| `gap` | number | Space between children in pixels (default 20). |

Children: `step`.

```
timeline
  step "Day 1: Sedona" detail="Cathedral Rock at sunrise"
  step "Day 2: Flagstaff" detail="Lowell Observatory at night"
  step "Day 3: Grand Canyon" detail="South Rim, Mather Point"
# Showing progress: a status on every step
timeline
  step "Ordered" time="Oct 18" status=done
  step "Out for delivery" detail="Arrives by 8 PM" status=current
  step "Delivered" status=upcoming
```

### `step`

One step of a timeline: a title, an optional detail line and time, and whether it's done, current or upcoming.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The step's title, e.g. Shipped. |
| `status` | `done` / `current` / `upcoming` | Only to show progress: done for finished steps, current for where the person is now, upcoming for what's left (muted). Leave it out on every step for a plan, itinerary or how-to that hasn't started. |
| `detail` | string | A quieter line under the title, like a place or a note. |
| `time` | string | A short date or time on the right, e.g. Oct 18 or 9:12 AM. |
| `icon` | string | An icon in the step's marker instead of the check or dot, by name from icon's list, e.g. icon=truck. |

Only inside: `timeline`.

```
step "Shipped" detail="Left the Phoenix warehouse" time="Oct 19" status=done icon=truck
```

### `carousel`

Cards side by side, a page at a time, with arrows and dots: a few options to browse, like products, hotels or recipes. Put a card per option inside it (or each over a list).

| Prop | Type | Description |
|---|---|---|
| `bind` | state, required | The state name holding the page shown, starting at 0. |
| `min` | number | The narrowest a card may be (default 220); as many fit side by side as the width allows. |
| `gap` | number | Space between children in pixels (default 12). |
| `on` | action | Actions to run after the page changes, e.g. emit:changed. Separate several with ; |

Children: any elements.

```
state page=0
carousel bind=page
  card
    text "Desert Rose Inn" style=lead weight=semibold
    text "$189 a night · 4.6 stars" tone=muted
  card
    text "Saguaro Lodge" style=lead weight=semibold
    text "$149 a night · 4.3 stars" tone=muted
  card
    text "Camelback Suites" style=lead weight=semibold
    text "$229 a night · 4.8 stars" tone=muted
```

### `text`

A paragraph or heading that wraps to the available width. Use {expressions} to show state.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The words to show. May include {expressions}. |
| `style` | `display` / `title` / `lead` / `body` / `caption` | display, title, lead, body or caption. |
| `weight` | `regular` / `semibold` / `bold` | regular, semibold or bold. Titles default to semibold. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |
| `align` | `left` / `center` / `right` | left, center or right. |
| `strike` | boolean | Draw a line through the text, e.g. for an old price. |
| `icon` | string | An icon before the text, by name from icon's list, e.g. icon=check-circle. |
| `rich` | boolean | true reads inline formatting in the words: **bold**, *italic*, `code` and links [words](https://…). A link is pressed by the person and sent to you as emit:link with its address; SayShape never opens it. One paragraph per text line. |

```
state guests=2 nights=3
text "Weekend in Yosemite" style=title
text "{guests} guests, {nights} nights" tone=muted
text "$160" tone=muted strike=true
text "Payment received" icon=check-circle tone=good
text "**Free** cancellation until *2 days* before; see [the terms](https://northwind.example/terms)." rich=true
```

### `image`

A picture, such as a product photo. The quoted text says what it shows, and is displayed if the image can't load.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | What the image shows, e.g. Blue trail runners from the side. |
| `src` | string, required | The image URL. Only the app's own site and hosts it allows will load. |
| `ratio` | `16:9` / `4:3` / `3:2` / `1:1` / `2:3` / `3:4` | Width to height: 16:9, 4:3, 3:2, 1:1, 2:3 or 3:4. The space is kept while the image loads. |
| `fit` | `cover` / `contain` | cover fills the space and crops the edges; contain shows the whole image. |

```
image "Ridgeline trail runners, side view" src="/images/ridgeline.jpg" ratio=4:3
```

### `code`

A short piece of code or a command, in a monospaced font on a tinted block.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The code. Long lines wrap. |

```
code "npm install sayshape"
```

### `badge`

A small rounded label for a status or a short tag, like Shipped or New.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The label, one or two words. |
| `tone` | `accent` / `good` / `warn` / `bad` / `muted` | Color role: accent, good, warn, bad or muted. |

```
badge "Shipped" tone=good
```

### `avatar`

A person's initials in a circle, with their name and an optional detail line beside it.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The person's name. The initials come from it. |
| `detail` | string | A second line under the name, like a role. |
| `size` | `sm` / `md` / `lg` | sm, md or lg. |
| `tone` | `accent` / `good` / `warn` / `bad` / `muted` | Circle color role: accent, good, warn, bad or muted. |
| `name` | boolean | Show the name beside the circle (default true). |

```
avatar "Ada Lovelace" detail="Trip organizer"
```

### `callout`

The one thing to notice in an answer: a key finding, a warning or a next step.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The takeaway, in one short sentence. May include {expressions}. Long text wraps. |
| `detail` | string | An optional second line in muted text, e.g. what the finding is based on. |
| `tone` | `info` / `accent` / `good` / `warn` / `bad` | info (default, the accent color) for a finding, good for good news, warn for something to watch, bad for a problem. accent is the same as info. |
| `icon` | boolean | Show a small icon matching the tone: i, a tick, ! or ×. |

```
callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true
```

### `icon`

A small symbol on its own, like a status mark or a weather sign. To start a line of text or a list row with one, use icon= on text or list-item instead.

| Prop | Type | Description |
|---|---|---|
| `name` | string, required | Which icon: check, check-circle, x, x-circle, warning, info, help, clock, arrow-up, arrow-down, arrow-left, arrow-right, trend-up, trend-down, plus, minus, refresh, sun, moon, cloud, rain, snow, storm, wind, thermometer, droplet, pin, globe, plane, car, truck, home, building, dollar, card, cart, package, bar-chart, pie-chart, percent, tag, briefcase, file, target, bolt, idea, lock, user, users, calendar, mail, phone, chat, star, heart, spade, club, diamond, bell, search, filter, download, copy, share, link, sliders. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |
| `size` | `sm` / `md` / `lg` | sm, md or lg. |
| `label` | string | What the icon means, read by screen readers, when nothing beside it says so, e.g. label="Sunny". Leave it out for decoration. |

```
icon name=sun tone=warn size=lg
icon name=check-circle tone=good
```

### `stat`

A labelled number, for key figures like totals or counts. Add change= to show how it moved, and spark= for a small line of its recent values.

| Prop | Type | Description |
|---|---|---|
| `label` | string, required | Short caption above the value. |
| `value` | string, required | The figure to show, usually an {expression}. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |
| `align` | `left` / `center` | left or center. |
| `change` | string | How the figure moved, shown small beside or under it with ▲ or ▼, e.g. change="+12%" or change="{round(growth, 1)}%". Write the sign; don't add an arrow. |
| `trend` | `up` / `down` / `flat` | up, down or flat: which way the change went, for its arrow and color. Leave it out to take it from change's sign. |
| `good` | `up` / `down` | Which way is good news: up (default, colored good) or down, for figures like costs or churn where falling is good. |
| `spark` | expression | A list of numbers, oldest first, drawn as a small line under the value, e.g. spark={[12, 15, 14, 19]}, spark=weekly, or from a list of records spark={pluck(sales, 'revenue')}. |

```
state price=24 qty=2
stat label="Total" value="${price*qty}"
```

### `rating`

A star rating. Shows value= as stars, or with bind= lets the user pick a rating.

| Prop | Type | Description |
|---|---|---|
| `value` | number | The rating to show, e.g. 4.5. Ignored when bind= is set. |
| `max` | number | How many stars (default 5). |
| `bind` | state | A number state the user sets by pressing a star. |
| `label` | string | What's being rated, read by screen readers, e.g. label="Your rating". Default: the text just above it. |
| `on` | action | Actions to run after the user picks a rating, e.g. emit:changed. Separate several with ; |

```
state stars=4
rating value=4.5
rating bind=stars
```

### `chart`

A chart of a list of records: bar or line for one or more numbers per item, such as revenue and last year's revenue by month, stacked for each item's total split into parts, such as revenue by product per month, area for an amount over time, hbar for a ranking with long names, such as top customers, pie or donut for how one number splits across items, such as sales by region, funnel for how many get through each stage, such as leads to won deals, waterfall for how changes add up to a total, such as revenue minus costs, bullet for each KPI against its target, such as quarterly goals, heatmap for one number across two dimensions, such as retention by cohort, scatter for how two numbers relate, such as price against rating, treemap for how a total splits across many parts, such as costs by line item, or sankey for how amounts flow from sources to where they end up, such as budget to departments to projects. It redraws when the list changes, and shows at most 200 items, 6 series and 6 slices (smaller slices are summed into Other).

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | A title above the chart. |
| `kind` | `bar` / `hbar` / `line` / `area` / `stacked` / `pie` / `donut` / `funnel` / `waterfall` / `bullet` / `heatmap` / `scatter` / `treemap` / `sankey` | bar compares categories and always starts at 0; hbar draws the bars across, one row per item with its name on the left and its value at the end, for rankings and long names (top 10 artists or customers): sort the list and take() the top items, since rows are drawn in list order; line shows a trend in list order, scaled to the values; area is a line with the space under it filled down to 0, for amounts over time such as visitors a week; stacked piles each item's y fields into one bar, bottom up in the order written, with its total on top, for parts of a whole such as revenue by product per month; pie and donut show each item's share of the total, and donut puts the total in the middle; funnel shows stages top to bottom in list order, each with its share of the stage before; waterfall shows each item as a change from the running total, rises good and falls bad, with total= adding the final total as a last bar; bullet gives each item a row with its bar against the goal in target=, colored good when on target, warn when close and bad when far off, each row on its own scale so mixed units fit, at most 20 rows; heatmap draws a grid with a row per value of rows= and a column per value of x=, each cell shaded by its y number (darker is more), for patterns such as orders by weekday and hour; scatter puts a dot per item at its x and y numbers, both on number scales, with label= naming each dot, size= sizing it by a number and group= coloring it by category (at most 6), and labels= naming the axes, e.g. labels="Risk,Return"; treemap splits a rectangle into one per item, its area its share of the total, biggest top left in the strongest color, with names where they fit, for when there are too many parts for a pie (up to 60; the smallest are drawn together as one). sankey draws bands between columns of places, each as thick as its amount, from one flow per item: from= and to= name the places and y= the amount; columns are worked out from the flows, and flows that go round in a circle show a message (at most 40 places and 120 flows). pie, donut, funnel, waterfall, bullet, heatmap, scatter, treemap and sankey take one y field; pie, donut, funnel, bullet, treemap and sankey take no negative values. |
| `items` | expression, required | The list of records to chart, e.g. items=sales or items={filter(sales, 'open')}. |
| `x` | name, required | The field holding each item's label (each slice's name in a pie), e.g. x=month. For scatter, the field with each item's x number. Not used by sankey. |
| `y` | names, required | The field holding each item's number, e.g. y=revenue. Bar, hbar and line can compare up to 6 fields on one scale, separated by commas with no spaces, e.g. y=revenue,last_year; each gets its own color and a legend. stacked and area take up to 6 fields too. Items without a number are shown as gaps, not zero. |
| `labels` | string | Bar, hbar, line, area and stacked with several y fields: the legend's names, in the same order, separated by commas, e.g. labels="This year,Last year". Without it the legend shows the field names. Scatter: the two axes' names, x then y, e.g. labels="Risk,Return". |
| `label` | name | Scatter only: the field naming each dot, shown in its tip and the data table, e.g. label=name. |
| `size` | name | Scatter only: the field whose number sizes each dot (its area), for bubbles, e.g. size=assets. |
| `group` | name | Scatter only: the field whose category colors each dot, with a legend, at most 6, e.g. group=type. |
| `from` | name | Sankey only: the field naming where each flow starts, e.g. from=source. |
| `to` | name | Sankey only: the field naming where each flow goes, e.g. to=target. |
| `rows` | name | Heatmap only: the field holding each item's row, e.g. rows=day; x= holds its column and y= its number. |
| `target` | name | Bullet only: the field holding each item's goal, drawn as a dark tick across its bar, e.g. target=goal. |
| `good` | `up` / `down` | Bullet only: up when reaching or passing the target is good (sales, signups), down when staying under it is (costs, churn, response time). |
| `total` | string | Waterfall only: the name of an extra last bar showing the total the changes add up to, e.g. total="Net income". |
| `format` | `number` / `money` / `percent` | How values read on the axis, at the ends of hbar bars, in a pie's legend and in a donut's middle: number (37K), money ($37K) or percent (42%), for values that are already percentages, like a rate of 42 or a retention of 61.5. On a scatter it formats y only; x reads as a plain number. |

Children: `chart-line`, `chart-rule`, `chart-note`.

```
state sales=[{month: "Jan", revenue: 12000, last_year: 10000}, {month: "Feb", revenue: 18000, last_year: 14000}, {month: "Mar", revenue: 15000, last_year: 16000}]
chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year labels="This year,Last year" format=money
```

### `chart-line`

Under a bar or line chart: another field of the same items drawn as a line on top, on the same scale, such as a forecast or last year over this year's bars.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | Its name in the legend. Defaults to the field name. |
| `y` | name, required | The field holding each item's number, e.g. y=forecast. |

Only inside: `chart`.

```
chart-line "Forecast" y=forecast
```

### `chart-rule`

Under a bar or line chart: a level drawn across the plot, such as a target, a budget or an average.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | What the level is, shown at its end, e.g. "Target". |
| `y` | expression, required | The level, a number or a formula, e.g. y=50000 or y={avg(pluck(sales, 'revenue'))}. |

Only inside: `chart`.

```
chart-rule "Target" y=50000
```

### `chart-note`

Under a bar or line chart: a marker at one item with a few words, such as a launch or an outage.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The words, kept short, e.g. "Launch". |
| `at` | string, required | The item it marks: its x value as shown under the chart, e.g. at="Jun". |

Only inside: `chart`.

```
chart-note "Launch" at="Jun"
```

### `meter`

One number against its range, as a ring or a gauge: progress toward a goal, a score, utilization or a budget used. Add bands= to color it bad, warn or good by where the value falls.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | A short label under the meter, e.g. "Goal reached". |
| `value` | expression, required | The number to show, e.g. value=score or value={round(spent / budget * 100)}. |
| `kind` | `ring` / `gauge` | ring is a full circle, for progress toward a goal; gauge is a half circle, for a score or a level, and shows min and max at its ends and its bands. |
| `min` | number | The low end of the range (default 0), a number or an {expression}. |
| `max` | number | The high end of the range (default 100), e.g. max=500 or max={budget}. |
| `bands` | string | One or two values that split the range into bad, warn and good, low to high, e.g. bands="60,85": below 60 is bad, 60 to 85 warn, 85 and above good. One value splits it into bad and good. |
| `good` | `up` / `down` | Which end of bands is good: up (default), or down for costs, risk or load, where low is good. |
| `format` | `number` / `money` / `percent` | How the number reads: number (1,200), money ($1,200) or percent, the value's share of the range (82%). |

```
state score=72
meter "Health score" kind=gauge value=score max=100 bands="60,85"
```

### `table`

Rows of a list of records, one table-column per field, for things like inventory, orders or expenses. With sort= and direction=, pressing a header sorts by it; with bind= and key=, pressing a row selects it; columns too wide for the space scroll sideways, the first one staying in view.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | A title above the table. |
| `items` | expression, required | The list of records, e.g. items=equipment. At most 200 rows; show a page of a longer list with slice() and pagination. |
| `key` | name | The field that identifies each row, e.g. key=id. Needed for bind=. |
| `bind` | state | State that holds the selected row's key. Pressing a row sets it. |
| `sort` | state | State that holds the field to sort by. Pressing a header sets it; missing values sort last. |
| `direction` | state | State that holds asc or desc. Pressing the sorted header again flips it. |
| `on` | action | Actions to run after a row is selected, with bind= already set, e.g. emit:changed. Separate several with ; |

Children: `table-column`.

```
state gear=[{id: "tent", name: "Tent", price: 180}, {id: "stove", name: "Stove", price: 45}] picked="" by="name" dir="asc"
table items=gear key=id bind=picked sort=by direction=dir
  table-column "Item" field=name
  table-column "Price" field=price format=money
```

### `table-column`

One column of a table: its header and the field it shows.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The header. Defaults to the field name. |
| `field` | name, required | The field of each record to show, e.g. field=price. |
| `format` | `text` / `number` / `money` | text, number (1,200.5) or money ($1,200.00, US dollars). number and money show only numbers; other values show —. |
| `align` | `left` / `right` | left or right. Default: right for number and money, left for text. |

Only inside: `table`.

```
table-column "Price" field=price format=money
```

### `compare`

Two to four options side by side with one row per attribute, marking the best value in each row: plans, products or choices to weigh up. Use compare-row children.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | A title above the comparison. |
| `items` | expression, required | The options, a list of records, e.g. items=plans. Two to four. |
| `name` | name | The field holding each option's name, shown at the top of its column (default name). |
| `pick` | string | The name of the option to recommend: its column is highlighted and marked Recommended. |

Children: `compare-row`.

```
state plans=[{name: "Basic", price: 9, storage: 50, support: "Email"}, {name: "Pro", price: 19, storage: 500, support: "Chat"}, {name: "Team", price: 49, storage: 2000, support: "Phone"}]
compare items=plans pick="Pro"
  compare-row "Price a month" field=price format=money best=low
  compare-row "Storage (GB)" field=storage format=number best=high
  compare-row "Support" field=support
```

### `compare-row`

One row of a comparison: an attribute and the field each option's value comes from.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The attribute's name. Defaults to the field name. |
| `field` | name, required | The field of each option to show, e.g. field=price. true and false show as a check and a dash. |
| `format` | `text` / `number` / `money` | text, number (1,200.5) or money ($1,200.00). |
| `best` | `low` / `high` | low or high: mark the lowest or highest number in the row as the best. Leave out when neither is better. |

Only inside: `compare`.

```
compare-row "Price a month" field=price format=money best=low
```

### `details`

One record as label and value rows, for a single customer, order, policy or ticket: its fields one per line, with an optional status badge. Use detail children; for many records use a table.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | A title above the rows, usually the record's name. |
| `subtitle` | string | A muted line under the title, e.g. the company and city. |

Children: `detail`.

```
state renewal="Jan 14, 2027"
details "Ada Lovelace" subtitle="Analytical Engines Ltd · London"
  detail "Plan" value="Enterprise · 240 seats"
  detail "Renewal" value={renewal}
  detail "Status" value="At risk" tone=bad
```

### `detail`

One row of details: a field's name and its value.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The field's name, e.g. "Plan". |
| `value` | string, required | The value to show, usually an {expression}, e.g. value={order.total} or value="{money(total)}". Empty shows —. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Show the value as a colored badge, for a status: good, warn, bad, accent or muted. Leave out for plain text. |

Only inside: `details`.

```
detail "Status" value="At risk" tone=bad
```

### `button`

A pressable button that runs actions. Use emit: to tell the app what the user chose.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The button label. |
| `on` | action | What happens when pressed, e.g. inc:count, set:done:true, emit:book. Separate several with ; |
| `variant` | `primary` / `secondary` / `danger` | primary (filled), secondary (outlined) or danger. |
| `disabled` | condition | Expression; when true the button is greyed out and can't be pressed. |

```
button "Book now" on=emit:book
button "Back" variant=secondary on=dec:step
```

### `link`

Pressable text for a secondary action, lighter than a button.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The link text. |
| `on` | action, required | What happens when pressed, e.g. emit:size_guide. |

```
link "Size guide" on=emit:size_guide
```

### `check`

A checkbox that toggles a true/false state value.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The label next to the box. |
| `bind` | state, required | The state name this checkbox reads and writes. |

```
state agreed=false
check "I agree to the terms" bind=agreed
```

### `switch`

An on/off switch with a label, for settings that take effect right away.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The label for the setting. |
| `bind` | state, required | The true/false state name this switch reads and writes. |
| `on` | action | Actions to run after it is switched, e.g. emit:changed. Separate several with ; |

```
state updates=true
switch "Email me order updates" bind=updates
```

### `radio`

One choice among several. Give each radio in a group the same bind= and its own value=.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The label for this choice. |
| `bind` | state, required | The state name the group shares; it holds the chosen value. |
| `value` | string, required | What bind= is set to when this radio is chosen. |
| `on` | action | Actions to run after it is chosen, e.g. emit:changed. Separate several with ; |

```
state size=m
radio "Small" bind=size value=s
radio "Medium" bind=size value=m
radio "Large" bind=size value=l
```

### `select`

A field that opens a list to pick one option from, for choices like a department, status or filter; compact where radio buttons would take too much room. bind= holds the chosen option's value; with multiple=true, a list of the chosen values, for filters like regions to show.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The label above the field. |
| `items` | expression, required | The options: a list of records, or of text or numbers. At most 200. |
| `value` | name | For records, the field holding each option's value (text or a number), e.g. value=id. Options without one, or repeating one, are left out. |
| `label` | name | For records, the field shown for each option, e.g. label=name. Default: the value. |
| `bind` | state, required | State that holds the chosen value, like department or t.status. |
| `multiple` | boolean | Pick several options: bind= holds a list of their values, starting from a list in state like regions=["West", "East"] (or [] for none), and the list stays open while choosing. filter(sales, 'region', regions) keeps the items whose field is any chosen value; an empty list keeps none, so show everything then: {len(regions) ? filter(sales, 'region', regions) : sales}. |
| `placeholder` | string | Shown while nothing (or a value no option has) is chosen. |
| `unavailable` | name | A field that, when true, greys an option out so it can't be chosen, e.g. unavailable=full. |
| `disabled` | condition | Expression; when true the field is greyed out and doesn't open. |
| `on` | action | Actions to run after an option is chosen, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state teams=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}] team=""
select "Team" items=teams value=id label=name bind=team placeholder="Choose a team"
```

### `date-picker`

A field that opens a month calendar to pick one date, kept in bind= as YYYY-MM-DD text ("" for none), or with range=true a start and an end. For deadlines, bookings or report filters.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The label above the field. |
| `bind` | state, required | State that holds the date as YYYY-MM-DD, like due or t.date. Start it as "" for no date. |
| `min` | string | The earliest date that can be chosen, YYYY-MM-DD, included. |
| `max` | string | The latest date that can be chosen, YYYY-MM-DD, included. |
| `range` | boolean | Pick a start and an end date: bind= holds {from, to} as YYYY-MM-DD, starting from a record in state like period={from: "", to: ""}. The calendar offers Last 7 days and Last 30 days. filter(orders, 'date', period) keeps the items from the start to the end, both included, and all of them while it's empty. |
| `placeholder` | string | Shown while no date is chosen. |
| `required` | boolean | When true, the calendar has no Clear button. |
| `disabled` | condition | Expression; when true the field is greyed out and doesn't open. |
| `on` | action | Actions to run after the date changes, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state due=""
date-picker "Due date" bind=due min="2026-01-01" max="2027-12-31"
```

### `stepper`

A number with minus and plus buttons, for small counts like a quantity.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | An optional label on the left. |
| `bind` | state, required | The number state this stepper reads and writes. |
| `min` | number | Smallest value (default 0). |
| `max` | number | Largest value (no limit if left out). |
| `step` | number | How much each press changes the value (default 1). |
| `on` | action | Actions to run after the value changes, e.g. emit:changed. Separate several with ; |

```
state qty=2
stepper "Quantity" bind=qty min=1 max=10
```

### `slider`

Picks a number in a range by dragging a handle, or with the arrow keys. Good for prices, distances and amounts.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | An optional label above the slider. Show the value with an {expression}. |
| `bind` | state, required | The number state this slider reads and writes. |
| `min` | number | Smallest value (default 0). |
| `max` | number | Largest value (default 100). |
| `step` | number | The value moves in steps of this size (default 1). |
| `on` | action | Actions to run after the user lets go, or after each arrow key, e.g. emit:changed. Separate several with ; |

```
state maxPrice=120
slider "Up to ${maxPrice}" bind=maxPrice min=20 max=300 step=10
```

### `input`

A text field people type into, such as a name, an email, a search, a new item, or with lines= a note or a message. Each keystroke writes its bind= state, and required= and kind=email or number say what's wrong once it's been left.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The label above the field. Leave it out only when the screen makes the purpose obvious. |
| `bind` | state, required | The state name or path it reads and writes, like task or t.title. |
| `placeholder` | string | A hint shown while the field is empty, like e.g. Sunscreen. |
| `kind` | `text` / `email` / `number` / `password` / `search` | text, email, number, password or search. Picks the phone keyboard and autofill; number writes a number, or null while empty. email and number also say when what's typed isn't one. |
| `lines` | number | Rows of text, 1 to 12: more than 1 is a box for a note or a message, where Enter starts a new line (on= then runs only from a button). |
| `required` | condition | When true, an empty field says Required once it's been left. |
| `error` | string | Your own message, shown under the field once it's been left, while it isn't empty, e.g. error="{len(pw) < 8 ? 'At least 8 characters' : ''}". |
| `on` | action | Actions to run when Enter is pressed, after the value is written, e.g. emit:changed. Separate several with ; |
| `disabled` | condition | Expression; when true the field is greyed out and can't be typed in. |
| `max` | number | Longest value in characters (at most 10000; 2000 when lines= is more than 1). |

```
state task="" todos=[]
input "New item" bind=task placeholder="e.g. Sunscreen" on="add:todos:{task};set:task:''"
text "{plural(len(todos), 'item')}" tone=muted
```

### `segmented`

Two to six short options in one track, one chosen, like Week, Month and Year, or Chart and Table. Show different content for each with if=.

| Prop | Type | Description |
|---|---|---|
| `bind` | state, required | The state name holding the chosen option's text. |
| `label` | string | What the choice is about, read by screen readers, e.g. label="Period". Default: the text just above it. |
| `options` | string, required | The options, comma-separated, e.g. options="Week,Month,Year". At most 6, one or two words each. |
| `on` | action | Actions to run after the choice changes, e.g. emit:changed. Separate several with ; |

```
state view="Chart"
segmented bind=view options="Chart,Table"
text "Showing the {lower(view)}" tone=muted
```

### `screen`

One screen of a multi-screen interface. Only one screen shows at a time: the first, until a button runs go:name or back.

| Prop | Type | Description |
|---|---|---|
| `name` | name, required | The screen's name, used by go:name. The visible screen's name is in {screen}. |
| `title` | string | A heading shown at the top of the screen. |
| `gap` | number | Space between children in pixels (default 14). |

Children: any elements.

Only inside: `root`.

```
screen name=cart title="Your cart"
  text "2 items"
  button "Checkout" on=go:checkout
screen name=checkout title="Checkout"
  text "Pay with card"
  button "Back to cart" variant=secondary on=back
```

### `tabs`

A row of tabs that switches between sections. Only the selected tab's content is shown.

| Prop | Type | Description |
|---|---|---|
| `bind` | state, required | The state name holding the selected tab's value. |
| `on` | action | Actions to run after the user switches tabs, e.g. emit:changed. Separate several with ; |

Children: `tab`.

```
state view=overview
tabs bind=view
  tab "Overview" value=overview
    text "Light, quick-drying trail runners."
  tab "Specs" value=specs
    text "280 g, 6 mm drop."
```

### `tab`

One tab inside tabs: its label, and the content shown while it is selected.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The tab's label. |
| `value` | string | What the tabs' bind= holds while this tab is selected (default: the label). |
| `gap` | number | Space between children in pixels (default 12). |

Children: any elements.

Only inside: `tabs`.

```
tab "Reviews" value=reviews
  text "4.8 out of 5 from 212 hikers."
```

### `breadcrumb`

Where the user is, as a path like Shop / Shoes / Trail runners. Earlier steps can be pressed to go back.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The steps, separated by slashes. The last one is the current page. |
| `bind` | state | State that receives the pressed step's text. |
| `on` | action | Actions to run after a step is pressed, e.g. emit:changed. Separate several with ; |

```
state at="Trail runners"
breadcrumb "Shop / Shoes / Trail runners" bind=at
```

### `pagination`

Previous, next and page-number buttons for moving through pages of results. Show the current page's items with slice(rows, (page - 1) * 10, page * 10).

| Prop | Type | Description |
|---|---|---|
| `bind` | state, required | The number state holding the current page, starting at 1. |
| `pages` | number, required | How many pages there are, e.g. pages={ceil(len(rows) / 10)}. |
| `on` | action | Actions to run after the page changes, e.g. emit:changed. Separate several with ; |

```
state page=3
pagination bind=page pages=12
```

### `progress`

A horizontal bar showing how far a value is toward a maximum.

| Prop | Type | Description |
|---|---|---|
| `value` | number, required | Current amount, usually an {expression}. |
| `max` | number | The full amount (default 100). |
| `label` | string | Optional caption above the bar. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color role: default, muted, accent, good, warn or bad. |

```
state done=3
progress value={done} max=5 label="{done} of 5 steps"
```

### `skeleton`

A grey placeholder shown while content loads: lines of text, a block or a circle.

| Prop | Type | Description |
|---|---|---|
| `shape` | `text` / `block` / `circle` | text (lines), block or circle. |
| `lines` | number | How many lines, for shape=text (default 3). |
| `height` | number | Height of a block, or diameter of a circle (default 120 and 48). |

```
skeleton lines=2
skeleton shape=block height=80
```

### `empty`

A friendly message for when there is nothing to show, with an optional button to move on.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The message, e.g. No orders yet. |
| `detail` | string | A line explaining what to do next. |
| `action` | string | Label for a button under the message. |
| `on` | action | Actions to run when the button is pressed, e.g. emit:changed. Separate several with ; |

```
empty "No results" detail="Try a wider price range." action="Clear filters" on=emit:clear_filters
```

### `schedule`

Blocks laid out on time from a list: a week of shifts, the day's room bookings, an itinerary by hour (times as HH:MM), or a project plan across dates (view=timeline, dates as YYYY-MM-DD). Overlapping blocks sit side by side; it scrolls sideways when wide.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The title above it, e.g. Support rota. |
| `items` | expression, required | The list of records, e.g. items=shifts. At most 200. |
| `view` | `day` / `week` / `timeline` | day: one day down a time axis, a column per rows= value. week: a column per day, at most 7. timeline: dates across, a bar per item, with a Today line. |
| `date` | name | Field with each item's day as YYYY-MM-DD. In a timeline, used for an item with no start date (a one-day bar). |
| `start` | name | Field with the start: a time as HH:MM (09:30) in day and week, a date as YYYY-MM-DD in a timeline. |
| `end` | name | Field with the end, written the same way. Missing: an hour after the start, or the same day in a timeline. |
| `label` | name | Field with what each block says, e.g. label=name. |
| `rows` | name | Field that splits blocks into lanes, e.g. rows=room: a column each in day view, a row each in a timeline; shown on the block in week view. |
| `tone` | name | Field that colors each block: a value good, warn, bad, accent or muted uses that tone; other values (a team, a type) each get their own color, with a key. |
| `key` | name | The field that identifies each item, e.g. key=id. Needed for bind=. |
| `bind` | state | State that holds the selected item's key. Pressing a block sets it. |
| `on` | action | Actions to run after a block is pressed, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state picked=0 shifts=[{id: 1, day: "2026-11-09", from: "08:00", to: "16:00", name: "Ana Ruiz", tier: "Tier 1"}, {id: 2, day: "2026-11-09", from: "12:00", to: "20:00", name: "Ben Okafor", tier: "Tier 2"}, {id: 3, day: "2026-11-10", from: "08:00", to: "16:00", name: "Chloe Park", tier: "Tier 1"}]
schedule "Support rota" items=shifts date=day start=from end=to label=name tone=tier view=week bind=picked
```

### `board`

Columns of cards by stage, from a list: a sales pipeline, a task board, hiring stages, support tickets. Each column shows its count and an optional total; move=true lets people drag a card to another stage.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The title above the board, e.g. Sales pipeline. |
| `items` | expression, required | The list of records, e.g. items=deals. At most 500. |
| `stage` | name, required | Field with each record's stage, e.g. stage=status. |
| `stages` | string | The columns in order, separated by commas, e.g. stages="Lead,Qualified,Proposal,Won". At most 12. Default: the stages in the records, in the order they first appear. |
| `title` | name | Field with each card's title, e.g. title=name. |
| `detail` | name | Field with a quieter line under the title, e.g. detail=company. |
| `value` | name | Field with a short value on the card's right, e.g. value=amount. |
| `format` | `text` / `number` / `money` | How value= and sum= read: text as is, number (1,200) or money ($1,200, US dollars). |
| `sum` | name | Field to total in each column's header, e.g. sum=amount, written with format=. |
| `tone` | name | Field that colors each card's edge: a value good, warn, bad, accent or muted uses that tone; other values each get their own color. |
| `key` | name | The field that identifies each record, e.g. key=id. Needed for bind=. |
| `bind` | state | State that holds the selected card's key. Pressing a card sets it. |
| `move` | boolean | true lets people move a card to another stage: drag it to another column, or focus it and press Left or Right. It changes the record's stage field, so items= must be a list in state (or worked out from one). |
| `on` | action | Actions to run after a card is pressed or moved, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state picked=0 deals=[{id: 1, name: "Fleet renewal", company: "Harbor Freight Co", status: "Lead", amount: 48000}, {id: 2, name: "Claims portal", company: "Northwind Mutual", status: "Proposal", amount: 125000}, {id: 3, name: "Warehouse sensors", company: "Larkspur Logistics", status: "Qualified", amount: 36500}]
board "Pipeline" items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name detail=company value=amount format=money sum=amount bind=picked
```

### `tree`

A hierarchy from a flat list where each record names its parent: an org chart, folders, a budget by department. kind=list (default) is indented rows that open and close; kind=org is a top-down chart of boxes.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The title above the tree, e.g. Org chart. |
| `items` | expression, required | The list of records, e.g. items=people. At most 300. |
| `id` | name | The field that identifies each record, e.g. id=id. |
| `parent` | name | The field with the parent's id, e.g. parent=manager. Empty for the top. |
| `label` | name | The field with what each item says, e.g. label=name. |
| `detail` | name | The field with a quieter line, e.g. detail=role. |
| `value` | name | The field with a number on the right, e.g. value=headcount. |
| `format` | `text` / `number` / `money` | How value= reads: text as is, number (1,200) or money ($1,200, US dollars). |
| `kind` | `list` / `org` | list: indented rows that open and close. org: a top-down chart with boxes and lines, which scrolls sideways when wide. |
| `open` | number | How many levels of a list start open; 0 shows only the top. |
| `bind` | state | State that holds the selected item's id. Pressing an item sets it. |
| `on` | action | Actions to run after an item is selected, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state picked="" people=[{id: "e1", name: "Ana Ruiz", role: "COO"}, {id: "e2", name: "Ben Okafor", role: "Head of Claims", manager: "e1"}, {id: "e3", name: "Chloe Park", role: "Head of Operations", manager: "e1"}, {id: "e4", name: "Dev Malhotra", role: "Claims lead", manager: "e2"}]
tree "Northwind Mutual" items=people parent=manager label=name detail=role bind=picked
```

### `flow`

Boxes joined by arrows, laid out automatically from a list of steps and where each leads: an approval process, a customer journey, a decision tree. Never give positions.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The title above the flow, e.g. Claim approval. |
| `items` | expression, required | The list of steps, e.g. items=steps. At most 40. |
| `id` | name | The field that identifies each step. |
| `label` | name | The field with what each box says. |
| `next` | name | The field with where a step leads: one id, a list of ids, or ids separated by commas. Leave it empty on the last step. |
| `kind` | name | The field with each step's shape: step (a box), decision (a diamond), start or end (a pill). |
| `edges` | expression | Labels for arrows, as a list of {from, to, label}, e.g. the Yes and No out of a decision. |
| `direction` | `down` / `right` | Which way it runs: down or right. When right doesn't fit its space, it runs down instead. |
| `bind` | state | State that holds the selected step's id. Pressing a step sets it. |
| `on` | action | Actions to run after a step is selected, with bind= already set, e.g. emit:changed. Separate several with ; |

```
state picked="" steps=[{id: "in", label: "Claim filed", kind: "start", next: "check"}, {id: "check", label: "Under $5,000?", kind: "decision", next: "auto,review"}, {id: "auto", label: "Approve automatically", next: "pay"}, {id: "review", label: "Adjuster review", next: "pay"}, {id: "pay", label: "Pay out", kind: "end"}]
state edges=[{from: "check", to: "auto", label: "Yes"}, {from: "check", to: "review", label: "No"}]
flow "Claim approval" items=steps edges=edges bind=picked
```

### `tile`

A small fixed-size face with a value, an optional icon and a detail line, for playing cards, seats, dice, keys or lottery numbers. Several in a row keep their size and wrap.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The value on its face, e.g. A, 10 or B4. Keep it short. |
| `icon` | string | An icon on its face, by name from icon's list, e.g. icon=club. The suits are club, spade, heart and diamond. |
| `shape` | `card` / `square` | card (portrait, like a playing card) or square (a seat, a key, a die). |
| `size` | `sm` / `md` / `lg` | sm, md or lg. |
| `detail` | string | A small line under the value, e.g. a price or an atomic weight. Keep it to a few characters at size=sm. |
| `tone` | `default` / `muted` / `accent` / `good` / `warn` / `bad` | Color of the value and icon: default, muted, accent, good, warn or bad (red suits use bad). |
| `variant` | `raised` / `outline` | raised (a lifted face) or outline. |
| `selected` | condition | Expression; when true the tile is marked as chosen, e.g. selected={s.picked}. |
| `disabled` | condition | Expression; when true it's greyed out and can't be pressed, e.g. a seat that's taken. |
| `on` | action | Actions to run when pressed, e.g. emit:changed. Separate several with ; |
| `label` | string | What screen readers and Copy text say for it, e.g. label="Seat B4". Default: its value (with its suit, as in Q of hearts) and detail. |

```
row gap=8
  tile "4" icon=club label="4 of clubs"
  tile "Q" icon=heart tone=bad label="Queen of hearts"
  tile "A" icon=spade label="Ace of spades"
  tile "B4" shape=square detail="$14" selected=true on=emit:seat
```

### `scroll`

A region that shows its children up to a fixed height and scrolls the rest, for a long list inside a card: messages, activity, results. Everything inside is still read and copied.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | What it holds, for screen readers, e.g. Recent activity. Not drawn. |
| `size` | `sm` / `md` / `lg` | How tall it gets before it scrolls: sm (about 6 rows of controls), md (about 9) or lg (about 12). |
| `gap` | number | Space between children in pixels (default 8). |
| `pad` | number | Inner padding in pixels (default 0). |

Children: any elements.

```
state events=[{title: "Order NW-2041 shipped", when: "09:12"}, {title: "Refund approved", when: "08:40"}, {title: "New review: 5 stars", when: "Yesterday"}, {title: "Stock low: Ridge 28 L", when: "Yesterday"}, {title: "Invoice sent", when: "Mon"}, {title: "Order NW-2038 delivered", when: "Mon"}, {title: "Price change: Summit pack", when: "Sun"}, {title: "New customer: Lumen Cinema", when: "Sat"}]
scroll "Recent activity" size=sm
  list
    each items=events as=e
      list-item "{e.title}" detail="{e.when}"
```

### `dialog`

A panel over the screen for something that needs an answer or attention first: confirm a delete, a short form, one item's details. It opens when bind= is true, so start that state false and open it from a button, unless it should greet people as the screen opens; its × button, Escape and a press outside it close it.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The title at its top, e.g. Delete order? |
| `bind` | state, required | A true/false state: true shows it, e.g. bind=confirm. Open it with on=set:confirm:true; close it from a button inside with on=set:confirm:false. |
| `size` | `sm` / `md` / `lg` | How wide it gets: sm (a question), md (a short form) or lg (details). |
| `on` | action | Actions to run when it's closed by its × button, Escape or a press outside it, e.g. emit:changed. Separate several with ; |

Children: any elements.

```
state confirm=true
button "Delete order" variant=danger on=set:confirm:true
dialog "Delete order NW-2041?" bind=confirm size=sm
  text "The order and its invoice are removed. This can't be undone." tone=muted
  row
    button "Cancel" variant=secondary on=set:confirm:false
    button "Delete" variant=danger on="emit:delete;set:confirm:false"
```

### `menu`

A button that opens a short list of actions, for what can be done to one item (edit, duplicate, delete) without a row of buttons. Each menu-item runs its own on=.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text | The button's words, e.g. Actions. Leave it out for a small ⋯ button. |
| `label` | string | What a screen reader calls a ⋯ button with no text, e.g. label="Order actions". Default: More actions. |
| `variant` | `secondary` / `primary` | secondary (outlined) or primary (filled). |
| `disabled` | condition | When true, it can't be opened. |
| `align` | `start` / `end` | Where it sits in its room: start, or end (the right). Default: end for a ⋯ menu, start for one with words. |

Children: `menu-item`.

```
menu "Actions"
  menu-item "Edit" icon=file on=emit:edit
  menu-item "Duplicate" icon=copy on=emit:duplicate
  menu-item "Delete" icon=x-circle tone=bad on=emit:delete
```

### `menu-item`

One action in a menu's list.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | What it does, e.g. Duplicate. |
| `on` | action, required | What happens when it's chosen, e.g. emit:duplicate or set:confirm:true. Separate several with ; |
| `icon` | string | An icon before the text, by name from icon's list, e.g. icon=check-circle. |
| `tone` | `default` / `bad` | bad for an action that removes or can't be undone, drawn in the bad color. |
| `disabled` | condition | When true, it's shown but can't be chosen. |

Only inside: `menu`.

```
menu-item "Duplicate" icon=copy on=emit:duplicate
```

### `map`

Canvas map with pin markers, data-driven country choropleths and proportional bubble maps. For data maps, give items plus geographic and numeric field names; Canvas handles colors, sizing and legends.

| Prop | Type | Description |
|---|---|---|
| `kind` | `markers` / `choropleth` / `bubble` | markers uses pin children; choropleth colors countries from dataset rows; bubble plots sized locations from dataset rows. |
| `items` | expression | Data rows for kind=choropleth or kind=bubble, e.g. items=sales. Do not embed individual rows in map specs. |
| `region` | name | Country-name column for choropleth, e.g. region=country. |
| `value` | name | Numeric column used for country shading or proportional bubble area. |
| `lat` | name | Latitude column for bubble maps. |
| `lon` | name | Longitude column for bubble maps. |
| `label` | name | Location-name column for bubble maps. |
| `legend` | boolean | Show a Canvas legend; defaults on for choropleth and bubble, off for markers. |
| `legendTitle` | string | Legend title, e.g. Revenue ($) or Project value. |
| `highlight` | string | Comma-separated country names to tint, e.g. Japan,Brazil. |
| `bind` | state | State name that receives the clicked country or marker label. |
| `fit` | `world` / `pins` | Initial framing: whole world, or zoom to the current pin locations. Re-fits when the pins change. |
| `cluster` | boolean | Group nearby pins into clickable counts. Zooming in separates them. |
| `interactive` | boolean | Enable mouse-wheel zoom and drag pan. |
| `controls` | boolean | Show Canvas zoom in, zoom out and reset controls. Opt in to preserve the original minimal map appearance. |
| `route` | boolean | Join the pins with a line in the order they are written, for a trip or a delivery run. |

Children: `pin`.

```
state selected=""
map bind=selected fit=pins cluster=true controls=true
  pin "Phoenix" lat=33.4484 lon=-112.074 detail="Status: delayed | Contract: 120000" tone=bad size=8
```

### `pin`

A labelled point on a Canvas map. The optional detail is shown in a multiline hover tooltip.

| Prop | Type | Description |
|---|---|---|
| `"text"` | text, required | The place name shown next to the pin. |
| `lat` | number, required | Latitude in degrees (-90 to 90). |
| `lon` | number, required | Longitude in degrees (-180 to 180). |
| `detail` | string | Tooltip details; separate lines with \|. Supports interpolated dataset expressions. |
| `tone` | `ink` / `accent` / `good` / `warn` / `bad` / `muted` | Theme color: ink, accent, good, warn, bad or muted. |
| `size` | number | Marker radius in CSS pixels, clamped to 2..18. Supports expressions. |

Only inside: `map`.

```
pin "Phoenix" lat=33.4484 lon=-112.074 tone=bad size=9 detail="Status: delayed | Value: 120000"
```
<!-- COMPONENTS:END -->
