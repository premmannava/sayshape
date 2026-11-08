import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const SPEC = `state open=3
card
  row
    stat label="Open orders" value={open} tip="Paid, not yet shipped. Updated every 5 minutes."
    icon name=info tip="Refunds count from the day they're approved"
  button "Ship all" on=set:open:0 tip="Marks every open order shipped"
  text "No tip here"
`;

type UI = ReturnType<typeof render>;
const center = (ui: UI, q: Parameters<UI["find"]>[0]) => { const b = ui.find(q).box!; return [b.x + b.w / 2, b.y + b.h / 2] as const; };
const move = (ui: UI, x: number, y: number) => { ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 }); ui.sayshape.renderNow(); };
/** The tip bubble's words in the last frame: drawn in the theme's surface color on ink. */
const isTip = (o: UI["drawOps"][number]) => o.op === "fillText" && o.fillStyle === lightTheme.colors.surface && /^500 13px/.test(o.font ?? "");
const tipText = (ui: UI) => ui.drawOps.filter(isTip).map((o) => String(o.args[0])).join(" ");

describe("tip=", () => {
  it("is a prop every element takes, with no problems", () => {
    expect(render(SPEC).diagnostics).toEqual([]);
  });

  it("shows on hover, over what's around it, and hides when the pointer leaves", () => {
    const ui = render(SPEC, { width: 600 });
    expect(tipText(ui)).toBe("");
    const [x, y] = center(ui, "stat");
    move(ui, x, y);
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
    move(ui, 2, 2);
    expect(tipText(ui)).toBe("");
  });

  it("stays while the pointer moves onto the tip itself", () => {
    const ui = render(SPEC, { width: 600 });
    const b = ui.find("stat").box!;
    move(ui, b.x + b.w / 2, b.y + 4);
    const tip = ui.drawOps.find(isTip)!;
    // Just above the stat, on the bubble's text.
    move(ui, Number(tip.args[1]) + 4, Number(tip.args[2]));
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
  });

  it("makes an element that isn't pressable a Tab stop, and shows on keyboard focus", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("stat");
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
    ui.tab();
    expect(ui.focused?.type).toBe("icon");
    expect(tipText(ui)).toContain("Refunds count");
    ui.tab();
    expect(ui.focused?.type).toBe("button");
    expect(tipText(ui)).toContain("Marks every open order shipped");
    ui.tab();
    expect(ui.focused).toBeNull(); // the text without a tip isn't a stop
  });

  it("hides with Escape without moving focus, and shows again on the next element", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    ui.key("Escape");
    expect(tipText(ui)).toBe("");
    expect(ui.focused?.type).toBe("stat");
    ui.tab();
    expect(tipText(ui)).toContain("Refunds count");
  });

  it("shows on a tap (touch has no hover), and a second tap or a press elsewhere hides it", () => {
    const ui = render(SPEC, { width: 600 });
    const [x, y] = center(ui, "icon");
    ui.click(x, y);
    move(ui, 2, 2); // a touch leaves no pointer behind; the pinned tip stays
    expect(tipText(ui)).toContain("Refunds count");
    ui.click(2, 2);
    expect(tipText(ui)).toBe("");
  });

  it("doesn't take presses from a pressable element: its own on= still runs", () => {
    const ui = render(SPEC, { width: 600 });
    ui.press({ type: "button" });
    expect(ui.state.open).toBe(0);
  });

  it("doesn't take presses from the children of an element with a tip", () => {
    const ui = render(`state n=0\ncard tip="All orders"\n  button "Add" on=inc:n\n`, { width: 600 });
    ui.press("button");
    expect(ui.state.n).toBe(1);
  });

  it("is read after the element's name, and the Tab stop is a named node", () => {
    const ui = render(SPEC, { width: 600 });
    const tree = ui.accessibility({ full: true });
    const all: Array<{ name?: string; description?: string; focusable: boolean; role: string }> = [];
    const walk = (n: typeof tree) => { all.push(n); n.children.forEach(walk); };
    walk(tree);
    const button = all.find((n) => n.role === "button")!;
    expect(button.description).toBe("Marks every open order shipped");
    const icon = all.find((n) => n.name?.startsWith("Refunds count"))!;
    expect(icon.focusable).toBe(true);
    expect(icon.name?.trim()).toBeTruthy();
  });

  it("fills in state, and an empty tip is no tip", () => {
    const ui = render(`state n=2\ntext "Orders" tip="{n} waiting"\ntext "Other" tip="{''}"\n`, { width: 600 });
    ui.tab();
    expect(tipText(ui)).toBe("2 waiting");
    ui.tab();
    expect(ui.focused).toBeNull();
  });

  it("stays inside the canvas at 240px, wrapping long tips", () => {
    const long = "This number counts every order that has been paid for but not yet handed to the carrier, across all stores";
    const ui = render(`text "Open" tip="${long}"\n`, { width: 240 });
    ui.tab();
    const ops = ui.drawOps.filter(isTip);
    expect(ops.length).toBeGreaterThan(2);
    for (const o of ops) expect(Number(o.args[1])).toBeGreaterThanOrEqual(0);
  });
});
