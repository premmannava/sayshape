/**
 * Mistakes models made in the stress benchmark (eval/compare/stress.ts) that used to pass
 * silently: each now either works or gets a diagnostic, so the repair step can fix it.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { evaluate } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const warnings = (spec: string) => parse(spec, registry).diagnostics.map((d) => d.message);
const store = new Store();
store.set("rows", ["a", "b", "c", "d", "e", "f", "g"] as unknown as Value);
store.set("page", 2);
const value = (src: string) => { const r = evaluate(src, store.scope); return r.ok ? JSON.parse(JSON.stringify(r.value)) as unknown : { error: r.error }; };

describe("slice()", () => {
  it("gives one page of a list, counting from 0 with the end left out", () => {
    expect(value("slice(rows, (page - 1) * 3, page * 3)")).toEqual(["d", "e", "f"]);
    expect(value("slice(rows, 5)")).toEqual(["f", "g"]);
    expect(value("slice(rows, -2)")).toEqual(["f", "g"]);
    expect(value("slice(rows, 6, 100)")).toEqual(["g"]);
  });

  it("works on text, and isn't a route to anything else", () => {
    expect(value("slice('Ada', 0, 1)")).toBe("A");
    expect(value("slice(page, 0, 1)")).toBeNull(); // NaN for a number, which JSON writes as null
  });
});

describe("JavaScript habits get a message that says what to write", () => {
  it("method calls", () => {
    expect(value("rows.slice(0, 2)")).toEqual({ error: expect.stringContaining("as slice(list, …)") });
    expect(value("rows.map(r)")).toEqual({ error: expect.stringContaining("SayShape has no methods like .map()") });
  });

  it("more arguments than a function takes", () => {
    expect(value("take(rows, 3, 5)")).toEqual({ error: expect.stringContaining("take() takes at most 2 arguments, not 3. Write take(list, n) keeps the first n; for a page or an offset use slice") });
    expect(value("filter(rows, 'cat', ['Housing'], false)")).toEqual({ error: expect.stringContaining("filter() takes at most 3 arguments, not 4") });
  });

  it("still allows every argument a function does take", () => {
    expect(value("round(3.14159, 2)")).toBe(3.14);
    expect(value("money(5, 'EUR')")).toContain("5.00");
    expect(value("max(1, 9, 4, 7)")).toBe(9);
    expect(value("fixed(2, 1)")).toBe("2.0");
  });

  it("arrow functions", () => {
    expect(value("count(rows, x => x.priority == 'High')")).toEqual({ error: expect.stringContaining("SayShape has no arrow functions") });
    // Inside quoted text it's just text.
    expect(value("'a => b'")).toBe("a => b");
  });

  it("set:order:o inside each stores text, so it's flagged", () => {
    const spec = `state order=null orders=[{id: "A1"}]
each items=orders as=o
  button "{o.id}" on="set:order:o"`;
    expect(warnings(spec)).toContain(`set:order:o stores the text "o". To store the item, write set:order:{o}`);
    expect(warnings(spec.replace("set:order:o", "set:order:{o}"))).toEqual([]);
  });
});

describe("a bare name in a number prop reads that value", () => {
  it("pagination pages=pages works, with no warning", () => {
    const spec = `state page=1 rows=["a", "b", "c", "d", "e", "f"]
derive pages={ceil(len(rows) / 5)}
pagination bind=page pages=pages`;
    expect(warnings(spec)).toEqual([]);
    const ui = render(spec, { components: coreComponents });
    expect(ui.text()).toContain("2");
    ui.destroy();
  });

  it("an unknown name is still reported", () => {
    expect(warnings(`state page=1\npagination bind=page pages=pagez`).join(" ")).toMatch(/pagez/);
  });
});
