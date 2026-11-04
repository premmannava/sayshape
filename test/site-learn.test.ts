/**
 * The build-along on /learn/: every chapter is valid SayShape, streams line
 * by line, and its "Try it" does what the chapter says.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { chapters, newLines } from "../site/learn/chapters";

const shown = (ui: ReturnType<typeof render>) => ui.text().join("\n");

describe("build-along chapters", () => {
  it("has five chapters with unique ids, each adding something", () => {
    expect(chapters).toHaveLength(5);
    expect(new Set(chapters.map((c) => c.id)).size).toBe(5);
    chapters.forEach((_, i) => expect(newLines(i).size).toBeGreaterThan(0));
  });

  for (const c of chapters) {
    it(`${c.id}: renders cleanly at phone and desktop widths`, () => {
      for (const width of [340, 560]) {
        const ui = render(c.spec, { width });
        expect(ui.diagnostics).toEqual([]);
        expect(ui.warnings).toEqual([]);
        ui.destroy();
      }
    });
    it(`${c.id}: every prefix parses while streaming`, () => {
      const lines = c.spec.split("\n");
      for (let n = 1; n <= lines.length; n++) {
        const ui = render(lines.slice(0, n).join("\n"));
        expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        ui.destroy();
      }
    });
  }

  it("state: pressing + raises qty, and - lowers it", () => {
    const ui = render(chapters[0]!.spec);
    const part = (name: string) => {
      const hit = ui.hits.find((h) => h.box.node.type === "stepper" && h.detail === name)!.box;
      ui.click(hit.x + hit.w / 2, hit.y + hit.h / 2);
    };
    part("inc");
    expect(ui.state.qty).toBe(2);
    part("dec");
    part("dec");
    expect(ui.state.qty).toBe(0);
  });

  it("derive: the total follows the quantity", () => {
    const ui = render(chapters[1]!.spec);
    expect(shown(ui)).toContain("$24.00");
    ui.set("qty", 3);
    expect(shown(ui)).toContain("$72.00");
  });

  it("lists: the total covers every item", () => {
    const ui = render(chapters[2]!.spec);
    expect(shown(ui)).toContain("$153.00");
  });

  it("actions: adding the headlamp adds it once and switches the button off", () => {
    const ui = render(chapters[3]!.spec);
    ui.press({ type: "button", text: /Add headlamp/ });
    expect((ui.state.cart as unknown[]).length).toBe(3);
    expect(shown(ui)).toContain("$183.00");
    expect(shown(ui)).toContain("Headlamp added");
    expect(() => ui.press({ type: "button", text: /Add headlamp/ })).toThrow(/isn't pressable/);
    expect((ui.state.cart as unknown[]).length).toBe(3);
  });

  it("screens: checkout shows the cart's total, and back returns", () => {
    const ui = render(chapters[4]!.spec);
    ui.press({ type: "button", text: "Checkout" });
    expect(shown(ui)).toContain("You pay $153.00");
    ui.press({ type: "button", text: "Back to cart" });
    expect(shown(ui)).toContain("Your cart");
  });
});
