/**
 * Blank values in totals: null, a missing field or empty text are skipped by
 * sum, avg, min, max, group and the report's figures, so one blank row no
 * longer turns the whole result into "—". All blank still shows "—".
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/expr";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const store = new Store();
store.set("rows", [{ km: 13.2 }, { km: null }, { km: 60.8 }, {}, { km: "" }, { km: "  " }] as unknown as Value);
store.set("none", [{ km: null }, {}, { km: "" }] as unknown as Value);
store.set("nums", [4, null, 10, ""] as unknown as Value);
store.set("lines", [{ price: 2, qty: 3 }, { price: 5, qty: null }, { price: null, qty: 1 }, { price: 1, qty: 4 }] as unknown as Value);
store.set("work", [
  { kind: "Run", km: 5 }, { kind: "Strength", km: null }, { kind: "Run", km: 7 }, { kind: "Strength" },
] as unknown as Value);
const val = (src: string) => {
  const r = evaluate(src, store.scope);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};

describe("blank values are skipped", () => {
  it("sum adds the values that are there", () => {
    expect(val("sum(rows, 'km')")).toBeCloseTo(74);
    expect(val("sum(nums)")).toBe(14);
    expect(val("sum(lines, 'price', 'qty')")).toBe(10);
  });

  it("avg divides by the values counted, not the rows", () => {
    expect(val("avg(rows, 'km')")).toBeCloseTo(37);
    expect(val("avg(nums)")).toBe(7);
  });

  it("min and max skip blanks", () => {
    expect(val("min(rows, 'km')")).toBe(13.2);
    expect(val("max(rows, 'km')")).toBe(60.8);
    expect(val("min(nums)")).toBe(4);
    expect(val("max(nums)")).toBe(10);
  });

  it("all blank is still nothing (—), and an empty list still sums to 0", () => {
    expect(val("sum(none, 'km')")).toBeNaN();
    expect(val("avg(none, 'km')")).toBeNaN();
    expect(val("max(none, 'km')")).toBeNaN();
    expect(val("min(none, 'km')")).toBeNaN();
    expect(val("sum([])")).toBe(0);
  });

  it("group totals skip blanks, and a group with no values gets nothing", () => {
    expect(JSON.parse(JSON.stringify(val("group(work, 'kind', 'km')")))).toEqual([
      { kind: "Run", count: 2, km: 12 },
      { kind: "Strength", count: 2, km: null },
    ]);
    const avg = val("group(work, 'kind', 'km', 'avg')") as unknown as Array<{ km: number }>;
    expect(avg[0]!.km).toBe(6);
    expect(avg[1]!.km).toBeNaN();
  });

  it("the example from the bug: one blank no longer hides the total", () => {
    const ui = render(`state rows=[{km: 13.2}, {km: null}, {km: 60.8}]\ntext "Total {sum(rows, 'km')}"\n`);
    expect(ui.copyText()).toContain("Total 74");
  });

  it("report figures skip blanks", () => {
    const ui = render("", { presets: true });
    ui.set("work", [{ kind: "Run", km: 5 }, { kind: "Strength", km: null }, { kind: "Run", km: 7 }] as unknown as Value);
    ui.setSpec(`report "Workouts" data=work\n  sum km\n  avg km\n  max km\n`);
    ui.sayshape.renderNow();
    const text = ui.copyText();
    expect(text).toMatch(/Total km\D*12/);
    expect(text).toMatch(/Average km\D*6/);
    expect(text).toMatch(/Highest km\D*7/);
    expect(text).not.toContain("—");
  });
});
