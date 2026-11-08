# flow: boxes joined by arrows, laid out automatically

## What it's for

Processes and journeys: an approval process, a customer journey, a decision tree, "how it works". A model lists the steps and where each leads; the element places every box and routes every arrow. The model never gives positions.

## Syntax

```
flow items=steps id=id label=label next=next
flow "Claim approval" items=steps label=label next=next kind=kind edges=edges
flow "Onboarding" items=steps label=label next=next direction=right bind=picked
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| text | string | | Title above the flow. |
| items | expression | required | The steps. At most `MAX_FLOW_NODES` (40). |
| id | name | id | Field that identifies each step. |
| label | name | label | Field with what the box says. |
| next | name | next | Field with where it leads: one id, a list of ids, or ids separated by commas. |
| kind | name | kind | Field with each step's shape: `step` (a box, the default), `decision` (a diamond), `start` or `end` (a pill). |
| edges | expression | | A list of `{from, to, label}` naming arrows, like "Yes" and "No" out of a decision. |
| direction | down, right | down | Which way it runs. On a narrow screen a flow that runs right turns to run down when it doesn't fit. |
| bind | state | | Holds the selected step's id. |
| on | action | | Runs after a step is selected. |

## Layout (written here, no dependencies)

1. Arrows that go back to an earlier step (loops, like "send back for changes") are found with a depth-first walk and kept out of the layering.
2. Layers: each step one layer after the furthest step that leads to it (longest path), so every forward arrow points down (or right).
3. Order within a layer: a few sweeps that place each step at the average position of its neighbours in the layer before, to cut crossings.
4. Positions: layers stacked with even gaps; each layer centred; box sizes from their words (two lines at most).
5. Arrows: straight when the ends line up, otherwise an elbow (down, across, down). Arrows leave a step in the order their targets sit, so they don't cross each other, and each step turns its arrows on its own line across the gap, so arrows from different steps never share a line. A label sits beside a straight arrow's middle, or on an elbow's first turn.
6. Back arrows (dashed) leave and arrive on the far side of their steps, never where forward arrows do: the outermost step of a layer goes straight out to a lane beyond the flow; others go out through the gap after their layer. Each back arrow has its own lane, and room is kept before the first layer for one that comes back to it, so it never runs over the title.

Too wide for its space, it scrolls sideways (engine-held view state, as `table` does) and opens on its first step. `direction=right` that doesn't fit runs down instead when that's narrower.

Warnings, each saying how to fix it: items that aren't records, two steps with one id, unknown kinds (drawn as plain steps), `next` naming steps that aren't there, `edges=` labelling arrows that aren't drawn.

## Accessibility and Copy text

A list of steps in layer order, each named by its label and where it leads, in words: "Review claim leads to Approve (Yes), Reject (No)" (an arrow sign is read out as "right arrow"). Copy text uses the same names, one line per step.

## Left out of version 1

Positions given by the model, swimlanes, curved arrows, editing or dragging boxes, more than 40 steps, and arrow labels drawn mid-segment for long elbows.
