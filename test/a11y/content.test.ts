import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";

const tree = (spec: string) => render(spec).accessibility().children ?? [];

describe("content and structure to a screen reader", () => {
  it("text: headings for display and title, plain text otherwise, nothing when empty", () => {
    expect(tree(`text "Your trip" style=display
text "Gear" style=title
text "Pack light." style=lead
text "{''}"`)).toEqual([
      { role: "heading", name: "Your trip", state: ["level 1"] },
      { role: "heading", name: "Gear", state: ["level 2"] },
      { role: "text", name: "Pack light." },
    ]);
  });

  it("layout containers add nothing; dividers and spacers are hidden", () => {
    expect(tree(`column
  row
    text "A"
    divider
    text "B"
  spacer
  grid
    text "C"`)).toEqual([
      { role: "text", name: "A" },
      { role: "text", name: "B" },
      { role: "text", name: "C" },
    ]);
  });

  it("image by its description; icons hidden; code as code", () => {
    expect(tree(`image "Blue trail runners from the side" src=/shoe.png
icon name=truck
code "npm install sayshape"`)).toEqual([
      { role: "img", name: "Blue trail runners from the side" },
      { role: "code", name: "npm install sayshape" },
    ]);
  });

  it("badge, avatar and stat read as text with their parts", () => {
    expect(tree(`state revenue=1200
badge "New"
avatar "Ada Lovelace" detail="Engineer"
stat label="Revenue" value="\${revenue}" change="+12%"`)).toEqual([
      { role: "text", name: "New" },
      { role: "text", name: "Ada Lovelace, Engineer" },
      { role: "text", name: "Revenue: $1200, +12%" },
    ]);
  });

  it("callout is a note with its detail", () => {
    const ui = render(`callout "Sales are up 12%" detail="Compared with last month" tone=good`);
    expect(ui.accessibility({ full: true }).children[0]).toMatchObject({ role: "note", name: "Sales are up 12%", description: "Compared with last month" });
  });

  it("progress and meter: their label and value on their range", () => {
    expect(tree(`state done=3 score=72
progress value={done} max=5 label="{done} of 5 steps"
meter "Health score" kind=gauge value=score max=100
text "Budget used"
meter value=40 max=200 format=money`)).toEqual([
      { role: "progressbar", name: "3 of 5 steps", state: ["value 3", "range 0 to 5"] },
      { role: "meter", name: "Health score", state: ["value 72", "range 0 to 100"] },
      { role: "text", name: "Budget used" },
      { role: "meter", name: "Budget used", state: ["value $40", "range 0 to 200"] },
    ]);
  });

  it("a list of list-items is a list; a pressable row is a button inside its item", () => {
    expect(tree(`list
  list-item "Rain shell" detail="Packs small" trailing="$129"
  list-item "Fleece" trailing="$80" on=emit:open`)).toEqual([
      {
        role: "list",
        children: [
          { role: "listitem", name: "Rain shell, Packs small, $129" },
          { role: "listitem", children: [{ role: "button", name: "Fleece, $80", state: ["focusable"] }] },
        ],
      },
    ]);
  });

  it("presses a pressable list-item through its button node", () => {
    const ui = render(`state n=0\nlist\n  list-item "Fleece" on=inc:n`);
    ui.mirror.activate(ui.find("list-item").node.id);
    expect(ui.state.n).toBe(1);
  });

  it("a list with other things in it isn't announced as a list", () => {
    expect(tree(`list\n  list-item "One"\n  text "Note"`).map((n) => n.role)).toEqual(["listitem", "text"]);
  });

  it("a timeline is a list of steps, the current one marked", () => {
    expect(tree(`timeline
  step "Ordered" status=done time="Oct 18"
  step "Out for delivery" status=current
  step "Delivered" status=upcoming`)).toEqual([
      {
        role: "list",
        children: [
          { role: "listitem", name: "Ordered, done, Oct 18" },
          { role: "listitem", name: "Out for delivery, current", state: ["current step"] },
          { role: "listitem", name: "Delivered, upcoming" },
        ],
      },
    ]);
  });

  it("details: a group named by its title, a row per field", () => {
    expect(tree(`details "Order 1042"
  detail "Plan" value="Pro"
  detail "Seats" value=""`)).toEqual([
      { role: "group", name: "Order 1042", children: [{ role: "text", name: "Plan: Pro" }, { role: "text", name: "Seats: —" }] },
    ]);
  });

  it("accordion: a button that says whether it's open, with its content inside when open", () => {
    const ui = render(`state open=false\naccordion "Returns" bind=open\n  text "30 days, free."`);
    expect(ui.accessibility().children).toEqual([
      { role: "group", children: [{ role: "button", name: "Returns", state: ["not expanded", "focusable"] }] },
    ]);
    ui.press("accordion");
    expect(ui.accessibility().children).toEqual([
      { role: "group", children: [{ role: "button", name: "Returns", state: ["expanded", "focusable"] }, { role: "text", name: "30 days, free." }] },
    ]);
  });

  it("carousel: a region with its page and previous and next buttons", () => {
    const ui = render(`state page=0
text "Picks"
carousel bind=page min=300
  card
    text "One"
  card
    text "Two"
  card
    text "Three"`, { width: 400 });
    const c = ui.accessibility({ full: true }).children[1]!;
    expect(c).toMatchObject({ role: "region", roleDescription: "carousel", name: "Picks", description: "Page 1 of 3" });
    const [prev, next] = c.children;
    expect([prev!.name, prev!.disabled, next!.name, next!.focusable]).toEqual(["Previous page", true, "Next page", true]);
    ui.mirror.activate(next!.key);
    expect(ui.state.page).toBe(1);
    expect(ui.accessibility({ full: true }).children[1]!.description).toBe("Page 2 of 3");
  });

  it("skeletons are hidden while the interface is busy; empty states say what to do next", () => {
    const ui = render(`state n=0
skeleton
empty "No orders yet" detail="Your orders will show here" action="Shop now" on=inc:n`);
    const [empty] = ui.accessibility({ full: true }).children;
    expect(empty).toMatchObject({ role: "group", name: "No orders yet", description: "Your orders will show here" });
    expect(empty!.children.map((c) => c.name)).toEqual(["Shop now"]);
    ui.mirror.activate(empty!.children[0]!.key);
    expect(ui.state.n).toBe(1);
  });
});
