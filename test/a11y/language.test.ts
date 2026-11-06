import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";

describe("label= for screen readers", () => {
  it("names a segmented control, before the text above it", () => {
    const ui = render(`state v=Week\ntext "Show"\nsegmented bind=v options="Week,Month" label="Period"`);
    expect(ui.accessibility().children![1]).toMatchObject({ role: "radiogroup", name: "Period" });
    expect(ui.diagnostics).toEqual([]);
  });

  it("names what a rating rates, picked or shown", () => {
    const ui = render(`state s=3\nrating bind=s label="Your rating"\nrating value=4 label="Average"`);
    const [pick, shown] = ui.accessibility().children!;
    expect(pick).toMatchObject({ role: "radiogroup", name: "Your rating" });
    expect(shown).toEqual({ role: "img", name: "Average: 4 out of 5 stars" });
  });

  it("gives an icon a meaning of its own; without one it stays decoration", () => {
    const ui = render(`icon name=sun label="Sunny"\nicon name=check-circle`);
    expect(ui.accessibility().children).toEqual([{ role: "img", name: "Sunny" }]);
    expect(ui.diagnostics).toEqual([]);
  });
});

describe("the model guide", () => {
  const registry = new Registry(coreComponents);
  for (const mode of ["full", "compact"] as const) {
    it(`asks for labels and chart titles, in ${mode} mode`, () => {
      expect(languageGuide(registry, { mode })).toMatch(/Screen readers|screen readers/);
      expect(languageGuide(registry, { mode })).toMatch(/title every chart|every chart a title/);
    });
  }
});
