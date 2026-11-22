/**
 * No more silent failures: a chart with nothing to draw, or a total or chart
 * that skipped values it couldn't read, says so as a warning on its line,
 * among the screen's diagnostics. The screen still draws.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import type { Diagnostic, Value } from "../src/types";

const warnings = (ds: readonly Diagnostic[]) => ds.filter((d) => d.severity === "warning").map((d) => `${d.line}: ${d.message}`);

describe("data warnings", () => {
  it("a total that skipped values it couldn't read says how many, on its line", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ amount: i < 12 ? "n/a" : 10 }));
    const ui = render("");
    ui.set("rows", rows as unknown as Value);
    ui.setSpec(`text "Total"\ntext "{sum(rows, 'amount')}"\n`);
    ui.sayshape.renderNow();
    expect(warnings(ui.diagnostics)).toEqual(['2: 12 of 200 "amount" values aren\'t numbers']);
    expect(ui.copyText()).toContain("1880");
  });

  it("a derive line's notes are on the derive line, and go when the data is fixed", () => {
    const ui = render(`state rows=[{a: 1}, {a: "x"}]\nderive t={sum(rows, 'a')}\ntext "{t}"\n`);
    expect(warnings(ui.diagnostics)).toEqual(['2: 1 of 2 "a" values isn\'t a number']);
    ui.set("rows", [{ a: 1 }, { a: 2 }] as unknown as Value);
    ui.sayshape.renderNow();
    expect(warnings(ui.diagnostics)).toEqual([]);
  });

  it("an ambiguous date says which argument settles it", () => {
    const ui = render(`text "{date('03/04/2026')}"\n`);
    expect(warnings(ui.diagnostics)[0]).toMatch(/^1: .*date\(v, 'mdy'\) or date\(v, 'dmy'\)/);
  });

  it("a chart with no numbers says which field had none", () => {
    const ui = render(`state t=[{p: "A", open: "five"}, {p: "B", open: null}]\nchart kind=bar items=t x=p y=open\n`);
    expect(warnings(ui.diagnostics)).toEqual([`2: This chart has no numbers to draw: none of its 2 items has a number in "open". Read text with num(), or check y= names the field with the numbers.`]);
  });

  it("names a field the items don't have", () => {
    const ui = render(`state t=[{p: "A", n: 5}]\nchart kind=donut items=t x=p y=count\n`);
    expect(warnings(ui.diagnostics)[0]).toMatch(/no field "count"; their fields: p, n/);
  });

  it("a chart whose items can't be worked out says why", () => {
    const ui = render(`state t=[{p: "A", count: 5}]\nchart kind=donut items={group(t, 'p', 'count')} x=p y=count\n`);
    expect(warnings(ui.diagnostics)[0]).toMatch(/^2: This chart has nothing to draw: items= can't be worked out\. group\(\) already counts/);
  });

  it("a chart that left values out says how many", () => {
    const ui = render(`state t=[{p: "A", v: 5}, {p: "B", v: "lots"}, {p: "C", v: "$7"}]\nchart kind=bar items=t x=p y=v\n`);
    expect(warnings(ui.diagnostics)).toEqual([`2: 1 of 3 "v" values isn't a number, so the chart leaves it out`]);
  });

  it("stays quiet about clean data, blanks and an empty list", () => {
    const ui = render(`state t=[{p: "A", v: 5}, {p: "B", v: null}] e=[]\ntext "{sum(t, 'v')}"\nchart kind=bar items=t x=p y=v\nchart kind=bar items=e x=p y=v\n`);
    expect(ui.diagnostics).toEqual([]);
  });

  it("are warnings: the screen still draws, and the diagnostics event carries them", () => {
    const ui = render(`state t=[{a: 1}, {a: "x"}]\ntext "{sum(t, 'a')}"\n`);
    let heard: Diagnostic[] = [];
    ui.sayshape.on("diagnostics", (d) => { heard = d; });
    ui.set("t", [{ a: 1 }, { a: "y" }, { a: "z" }] as unknown as Value);
    ui.sayshape.renderNow();
    expect(heard.map((d) => d.message)).toEqual(['2 of 3 "a" values aren\'t numbers']);
    expect(ui.copyText()).toContain("1");
  });
});
