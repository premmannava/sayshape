import { describe, expect, it } from "vitest";
import { samples } from "../playground/samples";
import { MOTION } from "../src/design";
import { render } from "../src/testing";
import { darkTheme, lightTheme, type Theme } from "../src/theme";
import { textOverflows } from "./overflow";

const spec = samples.designShowcase!.spec;
const themes: Theme[] = [lightTheme, darkTheme];

function clickDetail(ui: ReturnType<typeof render>, type: string, detail: string): void {
  const hit = ui.hits.find((h) => h.box.node.type === type && h.detail === detail);
  expect(hit, "hit " + type + ":" + detail).toBeDefined();
  ui.click(hit!.box.x + hit!.box.w / 2, hit!.box.y + hit!.box.h / 2);
}

describe("one design system", () => {
  it("uses one shared rhythm, with press fastest and data slower than navigation", () => {
    expect(MOTION.press).toBeLessThan(MOTION.hover);
    expect(MOTION.hover).toBeLessThan(MOTION.selection);
    expect(MOTION.selection).toBeLessThan(MOTION.navigation);
    expect(MOTION.navigation).toBeLessThan(MOTION.data);
    expect(Object.values(MOTION).every((ms) => ms > 0 && ms <= 550)).toBe(true);
  });
});

describe("design showcase", () => {
  it.each(themes.flatMap((theme) => [320, 375, 768, 1280].map((width) => [theme, width] as const)))(
    "renders cleanly and keeps text inside elements in %s at %ipx",
    (theme, width) => {
      const ui = render(spec, { width, theme, today: "2026-11-04" });
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
      expect(textOverflows(ui.loom.boxes!, ui.drawOps)).toEqual([]);
      expect(ui.findAll("stat")).toHaveLength(4);
      expect(ui.findAll("chart")).toHaveLength(2);
      ui.destroy();
    },
  );

  it("reacts to revenue changes and segmented time periods without changing spec", () => {
    const ui = render(spec, { width: 900 });
    expect(ui.state.boost).toBe(0);
    ui.press({ type: "button", text: "Increase revenue" });
    expect(ui.state.boost).toBe(1);
    expect(ui.text().join(" ")).toContain("$126,000");
    clickDetail(ui, "segmented", "Quarter");
    expect(ui.state.period).toBe("Quarter");
    expect(ui.text().join(" ")).toContain("$378,000");
    ui.press({ type: "button", text: "Reset" });
    expect(ui.state.boost).toBe(0);
    ui.destroy();
  });

  it("exercises customer filters, sortable table, and row selection", () => {
    const ui = render(spec, { width: 900 });
    clickDetail(ui, "tabs", "Customers");
    expect(ui.state.view).toBe("Customers");
    expect(ui.findAll("table")).toHaveLength(1);
    expect(ui.text().join(" ")).toContain("5 customers");
    ui.type({ type: "input", text: "Find customer" }, "Atlas");
    expect(ui.text().join(" ")).toContain("1 customer");
    expect(ui.text().join(" ")).not.toContain("Acme Co");
    ui.press({ type: "button", text: "Clear filters" });
    expect(ui.state.query).toBe("");
    clickDetail(ui, "table", "sort:revenue");
    expect(ui.state.by).toBe("revenue");
    clickDetail(ui, "table", "row:s:lumen");
    expect(ui.state.selected).toBe("lumen");
    ui.destroy();
  });

  it("keeps the controls gallery interactive and keyboard-safe", () => {
    const ui = render(spec, { width: 900 });
    clickDetail(ui, "tabs", "Controls");
    expect(ui.findAll("slider")).toHaveLength(1);
    expect(ui.findAll("date-picker")).toHaveLength(1);
    ui.press({ type: "button", text: "Reset settings" });
    expect(ui.state.target).toBe(72);
    expect(ui.state.alerts).toBe(true);
    expect(ui.state.channel).toBe("email");
    ui.destroy();
  });
});
