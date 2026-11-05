import { describe, expect, it } from "vitest";
import { playgroundGuide } from "../playground/model-guide";
import { coreComponents } from "../src/components";
import { Registry } from "../src/registry";
import { languageGuide, WORKED_EXAMPLES } from "../src/prompt";
import { render } from "../src/testing";

describe("playground guide", () => {
  it("includes the connected example while staying smaller than the full guide", () => {
    const registry = new Registry(coreComponents);
    const guide = languageGuide(registry, playgroundGuide([]));
    expect(guide).toContain(WORKED_EXAMPLES.equipment);
    expect(guide).toContain(WORKED_EXAMPLES.calculator);
    expect(guide).toContain(WORKED_EXAMPLES.shopping);
    expect(guide.length).toBeLessThan(languageGuide(registry).length * 0.5);
  });
  it("shows a valid editable grocery list example with removable rows", () => {
    const ui = render(WORKED_EXAMPLES.shopping);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.sayshape.state.get("remaining")).toBe(3);
    ui.sayshape.state.set("groceries", [{ name: "Milk", purchased: true }, { name: "Eggs", purchased: false }, { name: "Bread", purchased: false }]);
    expect(ui.sayshape.state.get("remaining")).toBe(2);
    ui.sayshape.destroy();
  });
  it("keeps numeric controls writable and recalculates the calculator", () => {
    const ui = render(WORKED_EXAMPLES.calculator);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.sayshape.state.get("tip")).toBe(7.5);
    expect(ui.sayshape.state.get("total")).toBe(57.5);
    ui.sayshape.state.set("percent", 20);
    ui.sayshape.state.set("people", 2);
    expect(ui.sayshape.state.get("perPerson")).toBe(30);
    ui.sayshape.state.set("bill", 0);
    expect(ui.sayshape.state.get("perPerson")).toBe(0);
    ui.sayshape.destroy();
  });
  it("has a valid example with reactive totals and selection independent of filtering", () => {
    const ui = render(WORKED_EXAMPLES.equipment);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.sayshape.state.get("total")).toBe(1296);
    ui.sayshape.state.set("department", "Sales");
    expect(ui.sayshape.state.get("selected")).toBe("laptop");
    ui.sayshape.state.set("selected", "headset");
    ui.sayshape.state.set("quantity", 2);
    expect(ui.sayshape.state.get("total")).toBe(259.2);
    ui.sayshape.destroy();
  });
});
