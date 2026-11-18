/**
 * The guide's rules for what the person reads: no notes about how the answer
 * was made, no heading repeated as a chart's title, numbers written for
 * people, the right control for a fixed choice, empty "add" forms, and
 * restyle requests kept out of the interface. Generated in prompt.ts, so
 * every mode and profile gets them, sized to the elements it exposes.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";

const registry = new Registry(coreComponents);
const rules = (opts: Parameters<typeof languageGuide>[1] = {}) => {
  const g = languageGuide(registry, opts);
  const at = g.indexOf("RULES\n");
  return g.slice(at, g.indexOf("\n\n", at));
};

describe.each(["full", "compact"] as const)("%s guide rules", (mode) => {
  const r = rules({ mode });
  it("keep implementation details out of what people read", () => {
    for (const leak of ["computed in Python", "widget state", "edge case:"]) expect(r).toContain(leak);
  });
  it("say not to repeat a heading as the chart's or table's title", () => {
    expect(r).toMatch(/repeat (the|a) heading/);
  });
  it("ask for numbers written for people", () => {
    expect(r).toMatch(/1\.41B/);
    expect(r).toMatch(/1411M/);
    expect(r).toMatch(/plural\(n, 'cup'\)/);
    expect(r).toMatch(/no cents|whole dollars/);
  });
  it("name the controls for fixed choices, add forms and habits by day", () => {
    expect(r).toMatch(/Fixed choices \(Left.*segmented or select/);
    expect(r).toMatch(/placeholder=/);
    expect(r).toMatch(/grid/);
  });
  it("keep restyle requests out of the interface", () => {
    expect(r).toMatch(/dark mode, bigger text/);
    expect(r).toMatch(/[Nn]ever write (the request|them) into it/);
  });
});

it("leaves out rules for elements a profile doesn't expose", () => {
  const forms = rules({ profile: "forms" });
  expect(forms).not.toMatch(/chart or table/);
  expect(forms).toContain("computed in Python");
});
