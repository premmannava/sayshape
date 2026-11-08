# board: columns of cards by stage

## What it's for

Anything that moves through stages: a sales pipeline, a task board, hiring stages, support tickets, order status. A model gives a list of records, the field that holds each one's stage, and the stages in order. The board draws a column per stage with a count (and a total), and a card per record.

## Syntax

```
board items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name detail=company value=amount format=money sum=amount
board "Hiring" items=candidates stage=step stages="Applied,Screen,Interview,Offer" title=name detail=role tone=priority bind=picked
board items=tickets stage=state stages="New,Open,Waiting,Solved" title=subject detail=customer move=true on=emit:moved
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| text | string | | Title above the board. |
| items | expression | required | The list of records. At most `MAX_BOARD_CARDS` (500). |
| stage | name | required | Field with each record's stage. |
| stages | string | the stages found, in order | The columns, in order, separated by commas. At most `MAX_BOARD_STAGES` (12). A record whose stage isn't one of them isn't shown, with a warning. |
| title | name | title | Field with the card's title. |
| detail | name | | Field with a quieter line under the title. |
| value | name | | Field with a short value on the right, such as an amount. |
| format | text, number, money | text | How value and sum are written. |
| sum | name | | Field to total in each column's header, written with format. |
| tone | name | | Field that colors each card's edge: a tone name uses that tone, other values get a series color. |
| key | name | id | Field that identifies a record, for bind=. |
| bind | state | | Holds the selected card's key. Pressing a card sets it. |
| move | boolean | false | Let people move a card to another stage: drag it to another column, or focus it and press Left or Right. Writes the record's stage field, then runs on=. |
| on | action | | Runs after a card is selected or moved. |

## Data, limits and layout

- Columns are as wide as the space allows, at least `MIN_COLUMN_W` (180 px); past that the board scrolls sideways (engine-held `ctx.view`, wheel, drag on the background, arrow keys while nothing moves, Home and End).
- On a narrow screen (under 560 px) the columns don't stack: each is most of the screen wide and the board scrolls sideways, so the next stage peeks in. Stacking would turn a board into a long list and lose the stage-by-stage comparison, which is the point of a board.
- Moving writes the stage through the record's place in state (found by identity, as `bind=` on an item inside `each` is), so it works when `items=` is a list in state or worked out from one (filter, sort). Otherwise the engine says it can't change it.
- Limits: `MAX_BOARD_CARDS` (500) and `MAX_BOARD_STAGES` (12), each with a message instead of the board.

## Accessibility and Copy text

The title is a heading; each column a heading (its stage, count and total) and a `list` of `listitem` cards named by title and value, with the detail read after. With bind=, on= or move= each card is a Tab stop with its selected state. With move=true a card's description says "Left and Right arrows move it to another stage". Copy text: each stage as a heading line with its count and total (`Lead (2) · $70K`), then its cards as `- title, value`. Card values are written in full ($125,000); column totals shortened from ten thousand up ($216K).

## Version 1 notes

- Cards are named by their key (key=) when they have one, so after a move focus stays on the same record.
- A dragged card moves only when it's dropped over the columns; dropped elsewhere, or when the browser takes the gesture over (a page scroll), it goes back and nothing is pressed.
- A list that isn't in state can't have cards moved; the board says so plainly.
- A card's tone is also in words in its screen-reader name and Copy text ("risk: bad").
- On touch screens a sideways swipe that starts on a card picks the card up rather than scrolling (scroll from the column headers or gaps). Lifting a card only after a long press needs timing support in the engine, left for later.

## Left out of version 1

Reordering cards within a column, auto-scrolling while dragging near an edge, collapsing columns, limits per column (WIP limits), swimlanes, adding or editing cards on the board, and vertical scrolling inside a column.
