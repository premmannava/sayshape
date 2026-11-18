/**
 * Compact patterns: icon-only buttons (button icon= label=) and label-less fields in a row,
 * with test/fixtures/expenses.sayshape, an expense tracker's add row and list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccessibleNode } from "../src/a11y/semantics";
import { ICON_TAP } from "../src/components/input";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";
import type { Box } from "../src/types";
import { textOverflows } from "./overflow";

const EXPENSES = readFileSync(new URL("./fixtures/expenses.sayshape", import.meta.url), "utf8");

type UI = ReturnType<typeof render>;
const all = (n: AccessibleNode): AccessibleNode[] => [n, ...n.children.flatMap(all)];
const nodes = (ui: UI, role: string) => all(ui.accessibility({ full: true })).filter((n) => n.role === role);
const problems = (ui: UI) => ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.bad).map((o) => String(o.args[0]));
const isTip = (o: UI["drawOps"][number]) => o.op === "fillText" && o.fillStyle === lightTheme.colors.surface && /^500 13px/.test(o.font ?? "");
const tipText = (ui: UI) => ui.drawOps.filter(isTip).map((o) => String(o.args[0])).join(" ");
/** The add row's fields and button (spec lines 4 to 8). */
const addRow = (ui: UI): Box[] => ui.findAll({}).filter((f) => f.box && f.node.line >= 4 && f.node.line <= 8).map((f) => f.box!);
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

describe("the expense tracker", () => {
  it("parses with no problems", () => {
    expect(render(EXPENSES).diagnostics).toEqual([]);
  });

  it.each([600, 800, 1000])("fits its add form on one row at %i px", (width) => {
    const ui = render(EXPENSES, { width });
    const row = addRow(ui);
    expect(row).toHaveLength(5);
    // One line, every field and the button level with each other.
    expect(new Set(row.map((b) => b.y)).size).toBe(1);
    expect(new Set(row.map((b) => b.h)).size).toBe(1);
    expect(textOverflows(ui.sayshape.boxes!, ui.drawOps)).toEqual([]);
  });

  it.each([320, 390, 480])("wraps the add form cleanly at %i px", (width) => {
    const ui = render(EXPENSES, { width });
    const row = addRow(ui);
    expect(new Set(row.map((b) => b.y)).size).toBeGreaterThan(1);
    for (const [i, a] of row.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(width);
      for (const b of row.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    expect(textOverflows(ui.sayshape.boxes!, ui.drawOps)).toEqual([]);
  });

  it("names label-less fields by their placeholders, and icon-only buttons by label=", () => {
    const ui = render(EXPENSES, { width: 600 });
    expect(nodes(ui, "textbox").map((n) => n.name)).toEqual(["Description", "Amount"]);
    expect(nodes(ui, "combobox").map((n) => n.name)).toEqual(["Category", "Date"]);
    expect(nodes(ui, "button").map((n) => n.name)).toEqual(["Add", "Remove Coffee beans", "Remove Train to Flagstaff"]);
  });

  it("removes the item an icon-only button stands for", () => {
    const ui = render(EXPENSES, { width: 600 });
    const second = ui.findAll({ type: "button" })[2]!;
    ui.press({ id: second.node.id });
    expect((ui.state.expenses as readonly { name: string }[]).map((e) => e.name)).toEqual(["Coffee beans"]);
  });

  it("adds an expense once the row is filled in, and says what's missing until then", () => {
    const ui = render(EXPENSES, { width: 600 });
    ui.press({ type: "button", text: "Add" });
    expect((ui.state.expenses as readonly unknown[]).length).toBe(2);
    expect(problems(ui)).toEqual(["Required", "Required"]);
    // The messages go under the fields; the button stays level with them.
    const [desc, , , , add] = addRow(ui);
    expect(add!.y).toBe(desc!.y);
    expect(textOverflows(ui.sayshape.boxes!, ui.drawOps)).toEqual([]);
    ui.type({ type: "input", line: 4 }, "Lunch");
    ui.type({ type: "input", line: 5 }, "12.5");
    ui.key("Escape");
    ui.press({ type: "button", text: "Add" });
    expect((ui.state.expenses as readonly { name: string; amount: number }[]).at(-1)).toMatchObject({ name: "Lunch", amount: 12.5, category: "Food" });
    expect(problems(ui)).toEqual([]);
  });

  it("tells screen readers what's wrong with a label-less field", () => {
    const ui = render(EXPENSES, { width: 600 });
    ui.press({ type: "button", text: "Add" });
    expect(nodes(ui, "textbox")[0]).toMatchObject({ name: "Description", invalid: true, description: "Required" });
  });
});

describe("icon-only buttons", () => {
  const SPEC = `state n=0\nrow\n  text "Milk"\n  button icon=trash label="Remove" variant=secondary on=inc:n\n`;

  it("are square at the control height on wider screens", () => {
    const b = render(SPEC, { width: 800 }).find("button").box!;
    expect(b.w).toBe(lightTheme.control.height);
    expect(b.h).toBe(lightTheme.control.height);
  });

  it(`are at least ${ICON_TAP} px square on a phone, small or not, and never full width`, () => {
    for (const size of ["md", "sm"]) {
      const b = render(SPEC.replace("variant=", `size=${size} variant=`), { width: 390 }).find("button").box!;
      expect(b.w).toBe(ICON_TAP);
      expect(b.h).toBe(ICON_TAP);
    }
    expect(render(`button icon=trash label="Remove" on=emit:x\n`, { width: 320 }).find("button").box!.w).toBe(ICON_TAP);
  });

  it("draw the icon and no text", () => {
    const ui = render(SPEC, { width: 800 });
    const b = ui.find("button").box!;
    const words = ui.drawOps.filter((o) => o.op === "fillText" && Number(o.args[1]) >= b.x && Number(o.args[1]) <= b.x + b.w);
    expect(words).toEqual([]);
  });

  it("show label= as their tip on hover and keyboard focus, and say it once to screen readers", () => {
    const ui = render(SPEC, { width: 800 });
    const b = ui.find("button").box!;
    ui.canvas.dispatch("pointermove", { clientX: b.x + b.w / 2, clientY: b.y + b.h / 2, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 });
    ui.sayshape.renderNow();
    expect(tipText(ui)).toBe("Remove");
    ui.canvas.dispatch("pointermove", { clientX: 2, clientY: 200, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 });
    ui.sayshape.renderNow();
    expect(tipText(ui)).toBe("");
    ui.tab();
    expect(ui.focused?.type).toBe("button");
    expect(tipText(ui)).toBe("Remove");
    const node = nodes(ui, "button")[0]!;
    expect(node.name).toBe("Remove");
    expect(node.description).toBeUndefined();
    ui.key("Enter");
    expect(ui.state.n).toBe(1);
  });

  it("keep tip= when they have one", () => {
    const ui = render(`button icon=trash label="Remove" tip="Removes it for good" on=emit:x\n`, { width: 800 });
    ui.tab();
    expect(tipText(ui)).toBe("Removes it for good");
  });

  it("need label=, with a line-numbered warning", () => {
    const d = render(`state n=0\nbutton icon=trash on=inc:n\n`).diagnostics;
    expect(d).toEqual([{ line: 2, severity: "warning", message: expect.stringMatching(/icon-only button needs label=/) }]);
    // The button still draws and works; a screen reader falls back to nothing better than its role.
    const plain = render(`button on=emit:x\n`).diagnostics;
    expect(plain.map((x) => x.message).join(" ")).toMatch(/needs quoted text, like button "Save", or icon= and label=/);
  });
});

describe("label= on a button with text", () => {
  it("is what screen readers say, and isn't a tip", () => {
    const ui = render(`button "Remove" label="Remove Milk" on=emit:x\n`, { width: 800 });
    expect(ui.diagnostics).toEqual([]);
    expect(nodes(ui, "button")[0]!.name).toBe("Remove Milk");
    ui.tab();
    expect(tipText(ui)).toBe("");
  });

  it("warns when it leaves out the visible text (speech users say what they see)", () => {
    const d = render(`button "Remove" label="Delete Milk" on=emit:x\n`).diagnostics;
    expect(d.map((x) => x.message).join(" ")).toMatch(/doesn't include the button's text "Remove"/);
  });
});

describe("rows without fields or messages", () => {
  it("lay out exactly as before (a message centres by its field, nothing else moves)", () => {
    const spec = `row\n  text "Total"\n  stat label="Open" value=3\n  button "Go" on=emit:go\n`;
    const ui = render(spec, { width: 600 });
    const ys = ui.findAll({}).filter((f) => f.box && f.node.line > 1).map((f) => f.box!.y + f.box!.h / 2);
    const tallest = Math.max(...ui.findAll({}).filter((f) => f.box && f.node.line > 1).map((f) => f.box!.h));
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(1);
    expect(ui.find("row").box!.h).toBe(tallest);
  });
});
