# schedule: blocks laid out on time

## What it's for

One element for answers that are "things at times": a week of support shifts, room bookings for a day, a project plan (Gantt), an itinerary by hour. A model gives a list of records and names the fields; the element works out the axis, places every block, puts overlapping blocks side by side and scrolls sideways when the days or lanes don't fit.

## Syntax

```
schedule "Support rota" items=shifts date=day start=from end=to label=name view=week
schedule "Room bookings, Tue" items=bookings start=from end=to label=title rows=room view=day
schedule "Launch plan" items=tasks start=from end=to label=task rows=team view=timeline
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| text | string | | The title above the schedule. |
| items | expression | required | The list of records. At most `MAX_SCHEDULE_ITEMS` (200). |
| view | enum day, week, timeline | week (day when no item has a date) | day: one day on a time axis, a column per `rows=` value. week: one column per day, earliest to latest (at most 7). timeline: dates across, a bar per item. |
| date | name | date | Field with the day, YYYY-MM-DD. In timeline, used when an item has no start date (a one-day bar). |
| start | name | start | Field with the start: a time HH:MM in day and week, a date YYYY-MM-DD in timeline. |
| end | name | end | Field with the end, the same way. Missing: one hour later, or the same day in timeline. |
| label | name | title | Field with what the block says. |
| rows | name | | Field that splits blocks into lanes: columns in day view, rows in timeline. In week view it's shown on the block. |
| tone | name | | Field whose value colors the block: a tone name (good, warn, bad, accent, muted) uses that tone; any other value gets a series color, the same color for the same value (past six values, the rest share one, keyed as Other). |
| key | name | id | Field that identifies an item, for `bind=`. |
| bind | state | | Holds the selected item's key. Pressing a block sets it. |
| on | action | | Runs after a block is pressed, with `bind=` already set. |

## Data and limits

- Times are `HH:MM` text from 00:00 to 24:00, worked out as minutes; dates are `YYYY-MM-DD` text through `src/dates.ts`. Never `Date`, no time zones.
- A block that ends at or before its start in day or week view is drawn to 24:00 (no overnight blocks in version 1).
- Items with a missing or malformed date or time are left out, and a warning says how many and how to write them.
- `MAX_SCHEDULE_ITEMS` = 200: more shows a message (use `take()` or `filter()`). Week view shows at most `MAX_WEEK_DAYS` = 7 days; timeline at most `MAX_TIMELINE_DAYS` = 732 days; past these a message says to filter.
- Day and week columns are at least `MIN_COLUMN_W` wide (wider when blocks sit side by side: `MIN_BLOCK_W` each) and timeline days at least `MIN_DAY_W`; past the available width the schedule scrolls sideways (engine-held `ctx.view`, as `table` does: wheel, drag, arrow keys, Home and End), with the time axis or lane names pinned.
- Timeline draws a "Today" line from the engine's `today()` when it falls in range.

## Accessibility and Copy text

A `table` named by the title: columns Date, Time, What (and the lane name when `rows=` is set), one row per block in time order. When `bind=` or `on=` is set, each block is a Tab stop (a selectable row, named by its cells, `selected` when it's bound). Copy text is then the title and tab-separated rows: `Mon, Nov 9, 2026	08:00–16:00	Ana Ruiz	Tier 1`.

## Left out of version 1

Dragging or resizing blocks, overnight blocks, time zones, recurring events, a month view, all-day rows, vertical scrolling, zoom, dependencies between timeline bars, and 12-hour clock labels (times show as written, 24-hour).
