import { describe, expect, it } from "vitest";
import { render, type Query, type Rendered } from "../../src/testing";
import type { AccessibleNode } from "../../src";

/** The node keys of an element's parts, by detail. */
function partKeys(ui: Rendered, query: Query): Record<string, string> {
  const id = ui.find(query).node.id;
  const out: Record<string, string> = {};
  const walk = (n: AccessibleNode) => {
    if (n.node.id === id && n.detail !== undefined) out[String(n.detail)] = n.key;
    n.children.forEach(walk);
  };
  walk(ui.accessibility({ full: true }));
  return out;
}

const only = (ui: Rendered) => ui.accessibility().children!;

describe("controls to a screen reader", () => {
  it("button: its label, and disabled when it can't be pressed", () => {
    const ui = render(`state busy=true\nbutton "Save" on=notify:Saved\nbutton "Send" on=notify:Sent disabled=busy`);
    expect(only(ui)).toEqual([
      { role: "button", name: "Save", state: ["focusable"] },
      { role: "button", name: "Send", state: ["disabled"] },
    ]);
  });

  it("link", () => {
    const ui = render(`link "Size guide" on=emit:size_guide`);
    expect(only(ui)).toEqual([{ role: "link", name: "Size guide", state: ["focusable"] }]);
  });

  it("check and switch: their label and whether they're on, following presses", () => {
    const ui = render(`state agreed=false updates=true\ncheck "I agree" bind=agreed\nswitch "Updates" bind=updates`);
    expect(only(ui)).toEqual([
      { role: "checkbox", name: "I agree", state: ["not checked", "focusable"] },
      { role: "switch", name: "Updates", state: ["checked", "focusable"] },
    ]);
    ui.mirror.activate(ui.mirror.keyOf("check"));
    expect(ui.state.agreed).toBe(true);
    expect(only(ui)[0]!.state).toEqual(["checked", "focusable"]);
  });

  it("radios sharing a bind= are one group, named by the text above them", () => {
    const ui = render(`state size=m
text "Size"
radio "Small" bind=size value=s
radio "Medium" bind=size value=m
text "Gift wrap"
radio "Yes" bind=wrap value=yes
radio "No" bind=wrap value=no`);
    expect(only(ui)).toEqual([
      { role: "text", name: "Size" },
      {
        role: "radiogroup",
        name: "Size",
        children: [
          { role: "radio", name: "Small", state: ["not checked", "focusable"] },
          { role: "radio", name: "Medium", state: ["checked", "focusable"] },
        ],
      },
      { role: "text", name: "Gift wrap" },
      {
        role: "radiogroup",
        name: "Gift wrap",
        children: [
          { role: "radio", name: "Yes", state: ["not checked", "focusable"] },
          { role: "radio", name: "No", state: ["not checked", "focusable"] },
        ],
      },
    ]);
  });

  it("radio groups keep their key as the choice changes", () => {
    const ui = render(`state size=m\nradio "Small" bind=size value=s\nradio "Medium" bind=size value=m`);
    const key = ui.accessibility({ full: true }).children[0]!.key;
    ui.press({ type: "radio", text: "Small" });
    expect(ui.accessibility({ full: true }).children[0]!.key).toBe(key);
  });

  it("segmented: a radio group of its options", () => {
    const ui = render(`state view=Table\ntext "Show as"\nsegmented bind=view options="Chart,Table"`);
    expect(only(ui)[1]).toEqual({
      role: "radiogroup",
      name: "Show as",
      children: [
        { role: "radio", name: "Chart", state: ["not checked", "focusable"] },
        { role: "radio", name: "Table", state: ["checked", "focusable"] },
      ],
    });
    ui.mirror.activate(partKeys(ui, "segmented").Chart!);
    expect(ui.state.view).toBe("Chart");
  });

  it("stepper: decrease and increase buttons around a value that's read out as it changes", () => {
    const ui = render(`state qty=1\nstepper "Quantity" bind=qty min=1 max=3`);
    expect(only(ui)).toEqual([
      {
        role: "group",
        name: "Quantity",
        children: [
          { role: "button", name: "Decrease Quantity", state: ["disabled"] },
          { role: "status", name: "1" },
          { role: "button", name: "Increase Quantity", state: ["focusable"] },
        ],
      },
    ]);
    const parts = partKeys(ui, "stepper");
    ui.mirror.activate(parts.inc!);
    ui.mirror.activate(parts.inc!);
    expect(ui.state.qty).toBe(3);
    expect(only(ui)[0]!.children!.map((c) => c.state ?? c.name)).toEqual([["focusable"], "3", ["disabled"]]);
  });

  it("slider: its label and value on its range", () => {
    const ui = render(`state price=120\nslider "Up to {price}" bind=price min=20 max=300 step=10`);
    expect(only(ui)).toEqual([{ role: "slider", name: "Up to 120", state: ["value 120", "range 20 to 300", "focusable"] }]);
    ui.mirror.step(ui.mirror.keyOf("slider"), 1);
    expect(only(ui)[0]).toMatchObject({ name: "Up to 130", state: ["value 130", "range 20 to 300", "focusable"] });
  });

  it("slider without a label takes the text above it", () => {
    const ui = render(`state km=5\ntext "Distance"\nslider bind=km min=1 max=20`);
    expect(only(ui)[1]!.name).toBe("Distance");
  });

  it("rating: a picture of the score, or a radio group of stars to pick from", () => {
    const ui = render(`state stars=2\nrating value=4.5\nrating bind=stars max=3`);
    expect(only(ui)).toEqual([
      { role: "img", name: "4.5 out of 5 stars" },
      {
        role: "radiogroup",
        name: "Rating",
        children: [
          { role: "radio", name: "1 star", state: ["not checked", "focusable"] },
          { role: "radio", name: "2 stars", state: ["checked", "focusable"] },
          { role: "radio", name: "3 stars", state: ["not checked", "focusable"] },
        ],
      },
    ]);
    ui.mirror.activate(partKeys(ui, { type: "rating", line: 3 })["3"]!);
    expect(ui.state.stars).toBe(3);
  });

  it("input: a text box with its label, hint and what's typed, never a password", () => {
    const ui = render(`state q="" pw=""
input "Search trails" bind=q kind=search placeholder="Trail name"
input "Password" bind=pw kind=password
input bind=q placeholder="Anything"`);
    ui.type({ type: "input", line: 2 }, "Flat");
    ui.type({ type: "input", line: 3 }, "secret");
    const [search, password, bare] = only(ui);
    expect(search).toEqual({ role: "searchbox", name: "Search trails", state: ["value Flat", "focusable"] });
    expect(ui.accessibility({ full: true }).children[0]!.placeholder).toBe("Trail name");
    expect(password).toEqual({ role: "textbox", name: "Password", state: ["focusable"] });
    expect(bare!.name).toBe("Anything");
  });

  it("a pressable card is a button named by what's in it; a plain card is only a surface", () => {
    const ui = render(`card on=emit:open
  text "Trail socks"
  text "$18"
card
  text "Notes"`);
    expect(only(ui)).toEqual([
      { role: "button", name: "Trail socks $18", state: ["focusable"] },
      { role: "text", name: "Notes" },
    ]);
  });
});
