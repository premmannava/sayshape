import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";

const form = `state n=0 price=120 name=""
button "Add" on=inc:n
slider "Up to {price}" bind=price min=20 max=300 step=10
input "Name" bind=name
button "Save" on=notify:Saved`;

describe("the mirror and the engine", () => {
  it("asks the mirror to hold DOM focus where Tab puts keyboard focus", () => {
    const ui = render(form);
    ui.tab();
    expect(ui.mirror.focused).toBe(ui.mirror.keyOf({ type: "button", text: "Add" }));
    ui.tab();
    expect(ui.mirror.focused).toBe(ui.mirror.keyOf("slider"));
  });

  it("doesn't move DOM focus for a mouse press", () => {
    const ui = render(form);
    ui.press({ type: "button", text: "Add" });
    expect(ui.mirror.focused).toBeNull();
  });

  it("presses an element a screen reader activates", () => {
    const ui = render(form);
    ui.mirror.activate(ui.mirror.keyOf({ type: "button", text: "Add" }));
    expect(ui.state.n).toBe(1);
    expect(ui.focused?.text).toBe("Add");
  });

  it("follows a screen reader moving to an element", () => {
    const ui = render(form);
    ui.mirror.focus(ui.mirror.keyOf({ type: "button", text: "Save" }));
    expect(ui.focused?.text).toBe("Save");
    // Keys pressed on that node act on it.
    expect(ui.mirror.key("Enter")).toBe(true);
    expect(ui.announcements.map((a) => a.text)).toEqual(["Saved"]);
  });

  it("opens the text box when a screen reader moves to a field", () => {
    const ui = render(form);
    ui.mirror.focus(ui.mirror.keyOf("input"));
    expect(ui.editor?.label).toBe("Name");
  });

  it("sends arrow keys on a mirror node to the focused element", () => {
    const ui = render(form);
    const slider = ui.mirror.keyOf("slider");
    ui.mirror.focus(slider);
    expect(ui.mirror.key("ArrowRight")).toBe(true);
    expect(ui.state.price).toBe(130);
  });

  it("nudges a slider a step when a phone's screen reader adjusts it", () => {
    const ui = render(form);
    const slider = ui.mirror.keyOf("slider");
    ui.mirror.step(slider, 1);
    expect(ui.state.price).toBe(130);
    ui.mirror.step(slider, -1);
    ui.mirror.step(slider, -1);
    expect(ui.state.price).toBe(110);
  });

  it("tabs through mirror nodes and lets the browser leave after the last one", () => {
    const ui = render(`button "One" on=notify:1\nbutton "Two" on=notify:2`);
    ui.mirror.focus(ui.mirror.keyOf({ type: "button", text: "One" }));
    expect(ui.mirror.key("Tab")).toBe(true);
    expect(ui.mirror.focused).toBe(ui.mirror.keyOf({ type: "button", text: "Two" }));
    expect(ui.mirror.key("Tab")).toBe(false);
    expect(ui.focused).toBeNull();
  });

  it("ignores keys for nodes that are gone", () => {
    const ui = render(`state open=true\nbutton "Hide" on=toggle:open if=open`);
    const key = ui.mirror.keyOf("button");
    ui.press("button");
    expect(() => ui.mirror.activate(key)).not.toThrow();
    expect(ui.state.open).toBe(false);
  });

  it("is busy while a spec streams in, then says Ready", () => {
    const ui = render(``);
    const busy: boolean[] = [];
    ui.sayshape.on("render", () => busy.push(ui.mirror.busy));
    ui.stream([`text "Hel`, `lo"\n`, `button "Go" on=notify:Go\n`]);
    expect(busy.slice(0, -1).every(Boolean)).toBe(true);
    expect(ui.mirror.busy).toBe(false);
    expect(ui.announcements.map((a) => a.text)).toEqual(["Ready"]);
  });

  it("is busy while data the screen reads is loading", () => {
    const ui = render(`text "{total}"`);
    ui.sayshape.setLoading(["total"]);
    ui.sayshape.renderNow();
    expect(ui.mirror.busy).toBe(true);
    ui.sayshape.setLoading([]);
    ui.set("total", 4);
    expect(ui.mirror.busy).toBe(false);
  });

  it("is rebuilt when layout runs, not when only the pointer moves", () => {
    const ui = render(`button "Go" on=notify:Go`);
    const before = ui.mirror.updates;
    const b = ui.find("button").box!;
    ui.canvas.dispatch("pointermove", { clientX: b.x + 5, clientY: b.y + 5, pointerId: 1 });
    ui.sayshape.renderNow();
    expect(ui.mirror.updates).toBe(before);
    ui.set("x", 1);
    expect(ui.mirror.updates).toBe(before + 1);
  });
});
