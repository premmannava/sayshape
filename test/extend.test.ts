/**
 * extend() and rank(): a value worked out for every item of a list. extend() has its own syntax
 * (the record is evaluated once per item, with the item named), so the checks here are about
 * what that name can reach, what the derive reads, and that it stays inside SayShape data.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { evaluate, identifiers, itemNames } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const store = new Store();
store.set("quotes", [
  { carrier: "Acme", premium: 1000, deductible: 250 },
  { carrier: "Bolt", premium: 900, deductible: 1000 },
  { carrier: "Core", premium: 1200, deductible: 500 },
] as unknown as Value);
store.set("claims", 2);
store.set("claimSize", 600);
store.set("empty", [] as unknown as Value);
store.set("scores", [{ n: "a", s: 50 }, { n: "b", s: 90 }, { n: "c", s: 50 }, { n: "d", s: null }, { n: "e", s: "high" }, { n: "f" }, { n: "g", s: 10 }] as unknown as Value);
store.set("mixed", [{ a: 1 }, 5] as unknown as Value);
store.set("q", 7);
const run = (src: string) => evaluate(src, store.scope);
/** The value itself (val() goes through JSON, which turns the NaN of "not a list" into null). */
const isNothing = (src: string) => { const r = run(src); return r.ok && typeof r.value === "number" && Number.isNaN(r.value); };
const val = (src: string) => {
  const r = run(src);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return JSON.parse(JSON.stringify(r.value)) as unknown;
};
const err = (src: string) => {
  const r = run(src);
  if (r.ok) throw new Error(`${src} should fail but gave ${JSON.stringify(r.value)}`);
  return r.error;
};
const messages = (spec: string) => parse(spec, registry).diagnostics.map((d) => `${d.line}: ${d.message}`);

describe("extend()", () => {
  it("adds fields worked out per item, keeping the item's own", () => {
    expect(val("extend(quotes, 'x', {expected: x.premium + claims * min(x.deductible, claimSize)})")).toEqual([
      { carrier: "Acme", premium: 1000, deductible: 250, expected: 1500 },
      { carrier: "Bolt", premium: 900, deductible: 1000, expected: 2100 },
      { carrier: "Core", premium: 1200, deductible: 500, expected: 2200 },
    ]);
  });

  it("replaces a field that has the same name, where it was", () => {
    const [first] = val("extend(quotes, 'x', {premium: x.premium * 2, note: 'new'})") as Array<Record<string, unknown>>;
    expect(Object.keys(first!)).toEqual(["carrier", "premium", "deductible", "note"]);
    expect(first!.premium).toBe(2000);
  });

  it("gives an empty list for an empty list, and nothing for what isn't a list", () => {
    expect(val("extend(empty, 'x', {a: 1})")).toEqual([]);
    expect(isNothing("extend(claims, 'x', {a: 1})")).toBe(true);
    expect(isNothing("extend(null, 'x', {a: 1})")).toBe(true);
  });

  it("says which item isn't a record, and which item's expression failed", () => {
    expect(err("extend(mixed, 'x', {a: 1})")).toBe("extend(): item 1 is a number, not a record");
    expect(err("extend(mixed, 'x', {b: x.a + 1})")).toBe(`extend(): item 1 is a number, not a record`);
    expect(err("extend(quotes, 'x', {b: x.missing})")).toBe(`extend(): item 0: No field "missing"`);
  });

  it("nests: an extend on the result, and one inside the record", () => {
    expect(val("extend(extend(quotes, 'a', {double: a.premium * 2}), 'b', {quad: b.double * 2})[1].quad")).toBe(3600);
    store.set("orders", [{ id: 1, lines: [{ p: 2 }, { p: 3 }] }] as unknown as Value);
    expect(val("extend(orders, 'o', {total: sum(extend(o.lines, 'l', {t: l.p * 10}), 't')})[0].total")).toBe(50);
  });

  it("reads outer names and other lists, never the item name outside it", () => {
    expect(val("extend(quotes, 'x', {n: len(quotes) + claims})[0].n")).toBe(5);
    expect(err("extend(quotes, 'x', {a: 1})[0].a + x")).toBe(`Unknown state "x"`);
  });

  it("won't use a name that is already state, or an outer item's name", () => {
    expect(err("extend(quotes, 'q', {a: 1})")).toMatch(/names its item "q", but "q" is already a name here/);
    expect(err("extend(quotes, 'x', {a: sum(extend(quotes, 'x', {b: 1}), 'b')})")).toMatch(/names its item "x"/);
  });

  it("gives new records that are frozen data, and can't be used to reach a prototype", () => {
    const r = run("extend(quotes, 'x', {__proto__: 1, constructor: 2})");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const rec = (r.value as unknown as Value[])[0] as unknown as object;
      expect(Object.getPrototypeOf(rec)).toBeNull();
      expect(Object.isFrozen(rec)).toBe(true);
      expect(Object.isFrozen(r.value)).toBe(true);
    }
    expect(err("extend(quotes, 'x', {a: x.__proto__})")).toMatch(/can't be read/);
    expect(err("extend(quotes, 'x', {a: x.constructor})")).toMatch(/can't be read/);
    expect(val("extend(quotes, '__proto__', {a: 1})[0].a")).toBe(1);
  });

  it("is checked as it is written", () => {
    expect(err("extend(quotes)")).toMatch(/takes a list, a name for each item in quotes/);
    expect(err("extend(quotes, x, {a: 1})")).toMatch(/names each item, like 'q' in quotes/);
    expect(err("extend(quotes, 'two words', {a: 1})")).toMatch(/names each item/);
    expect(err("extend(quotes, 'null', {a: 1})")).toMatch(/names each item/);
    expect(err("extend(quotes, 'x', 5)")).toMatch(/third argument must be the new fields written out in braces/);
    expect(err("extend(quotes, 'x', {a: 1}, 3)")).toMatch(/extend\(\) takes at most 3 arguments, not 4/);
    expect(err("quotes.extend('x', {a: 1})")).toMatch(/no methods like \.extend\(\)/);
    expect(err("extend(quotes, 'x', x => x.a)")).toMatch(/no arrow functions.*extend\(list, 'x'/);
  });

  it("suggests extend() to models that write map", () => {
    expect(err("map(quotes, 'x')")).toMatch(/Use extend\(list, 'q', \{field: q\.price \* 2\}\) for a computed field/);
    expect(err("mutate(quotes)")).toMatch(/Use extend\(/);
  });

  it("handles thousands of items", () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ id: i, price: i % 97 }));
    const s = new Store();
    s.set("big", big as unknown as Value);
    s.set("k", 3);
    const t = performance.now();
    const r = evaluate("rank(extend(big, 'x', {cost: x.price * k}), 'cost', 'desc')", s.scope);
    expect(r.ok).toBe(true);
    expect(performance.now() - t).toBeLessThan(1000);
    if (r.ok) expect((r.value as unknown as Value[]).length).toBe(5000);
  });
});

describe("name tracking", () => {
  it("leaves the item name out of what an expression reads", () => {
    expect(identifiers("extend(quotes, 'x', {a: x.premium * claims})").sort()).toEqual(["claims", "quotes"]);
    expect(identifiers("extend(extend(quotes, 'a', {d: a.p}), 'b', {e: b.d + k})").sort()).toEqual(["k", "quotes"]);
    // The first argument is outside the braces: there x is an ordinary name.
    expect(identifiers("extend(x, 'x', {a: x.p})")).toEqual(["x"]);
    expect(itemNames("extend(extend(quotes, 'a', {d: 1}), 'b', {e: 2})").sort()).toEqual(["a", "b"]);
  });
});

describe("rank()", () => {
  it("ranks from the best, with ties sharing a rank and the list's order kept", () => {
    expect((val("rank(scores, 's', 'desc')") as Array<{ n: string; rank: number | null }>).map((r) => [r.n, r.rank])).toEqual([
      ["a", 2], ["b", 1], ["c", 2], ["d", null], ["e", null], ["f", null], ["g", 4],
    ]);
  });

  it("goes from the smallest when asked 'asc' or not asked", () => {
    const ranks = (src: string) => (val(src) as Array<{ rank: number | null }>).map((r) => r.rank);
    expect(ranks("rank(scores, 's')")).toEqual([2, 4, 2, null, null, null, 1]);
    expect(ranks("rank(scores, 's', 'asc')")).toEqual([2, 4, 2, null, null, null, 1]);
  });

  it("replaces a rank field the items already have, and takes empty lists", () => {
    expect(val("rank(extend(scores, 'x', {rank: 99}), 's', 'desc')[1].rank")).toBe(1);
    expect(val("rank(empty, 's')")).toEqual([]);
  });

  it("matches the hand-built ranking it replaces", () => {
    store.set("nums", [{ s: 5 }, { s: 9 }, { s: 5 }, { s: 1 }] as unknown as Value);
    const byHand = val("extend(nums, 'r', {rank: 1 + len(filter(nums, 's', {from: r.s + 1}))})") as Array<{ rank: number }>;
    expect((val("rank(nums, 's', 'desc')") as Array<{ rank: number }>).map((r) => r.rank)).toEqual(byHand.map((r) => r.rank));
  });

  it("explains misuse", () => {
    expect(err("rank(scores, 's', 'best')")).toMatch(/orders 'asc' or 'desc', not 'best'/);
    expect(err("rank(mixed, 'a')")).toBe("rank(): item 1 is a number, not a record");
    expect(isNothing("rank(claims, 's')")).toBe(true);
    expect(err("rank(scores, 's', 'desc', 1)")).toMatch(/takes at most 3 arguments/);
  });
});

describe("in a spec", () => {
  const spec = `state claims=2 claimSize=600 quotes=[{carrier: "Acme", premium: 1000, deductible: 250}, {carrier: "Bolt", premium: 900, deductible: 1000}]
derive rows={extend(quotes, 'q', {expected: q.premium + claims * min(q.deductible, claimSize)})}
derive ranked=rank(rows, 'expected')
table "Quotes" items=ranked
  table-column field=carrier
  table-column field=expected
  table-column field=rank
button "More claims" on=inc:claims
`;
  const derived = (ui: ReturnType<typeof render>) => JSON.parse(JSON.stringify(ui.sayshape.state.derivedSnapshot())) as Record<string, Array<Record<string, unknown>>>;

  it("parses with no diagnostics, and the derive reads what the record reads", () => {
    const r = parse(spec, registry);
    expect(r.diagnostics).toEqual([]);
    expect(r.derived.find((d) => d.name === "rows")!.reads.sort()).toEqual(["claimSize", "claims", "quotes"]);
  });

  it("recomputes when a name read inside the record changes, not only the list", () => {
    const ui = render(spec);
    expect(derived(ui).rows!.map((r) => r.expected)).toEqual([1500, 2100]);
    ui.press({ type: "button", text: "More claims" });
    expect(ui.state.claims).toBe(3);
    expect(derived(ui).rows!.map((r) => r.expected)).toEqual([1750, 2700]);
    ui.sayshape.state.set("claimSize", 100);
    expect(derived(ui).rows!.map((r) => r.expected)).toEqual([1300, 1200]);
    expect(derived(ui).ranked!.map((r) => r.rank)).toEqual([2, 1]);
    ui.sayshape.state.set("quotes", [{ carrier: "Zed", premium: 5, deductible: 1 }] as unknown as Value);
    expect(derived(ui).ranked).toEqual([{ carrier: "Zed", premium: 5, deductible: 1, expected: 8, rank: 1 }]);
  });

  it("draws a table of the extended list", () => {
    const ui = render(spec);
    expect(ui.text()).toEqual(expect.arrayContaining(["Acme", "Bolt", "1,500", "2,100", "1", "2"]));
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
  });

  it("reports an item name that is state, derived or a loop variable", () => {
    expect(messages(`state q=1 quotes=[{a: 1}]\nderive rows={extend(quotes, 'q', {b: 1})}\n`)).toEqual([
      `2: extend() names its item "q", but "q" is already state, so it would mean two things. Give the item another name, like 'q_'`,
    ]);
    expect(messages(`state quotes=[{a: 1}]\nderive rows={extend(quotes, 'rows', {b: 1})}\n`)).toEqual([
      `2: extend() names its item "rows", but "rows" is already derived, so it would mean two things. Give the item another name, like 'rows_'`,
    ]);
    expect(messages(`state quotes=[{a: 1}]\neach items=quotes as=t\n  text "{extend(quotes, 't', {b: 1})[0].b}"\n`)[0]).toMatch(/^3: extend\(\) names its item "t", which is already a loop variable here/);
  });

  it("accepts the item name only inside extend", () => {
    expect(messages(`state quotes=[{a: 1}]\nderive rows={extend(quotes, 'q', {b: q.a})}\ntext "{q.a}"\n`)).toEqual([
      `3: "q" isn't state or a loop variable, so it shows as nothing. To show it as text, quote it: 'q'. To use state, declare it: state q=…`,
    ]);
    expect(messages(`state quotes=[{a: 1}]\ntext "{sum(extend(quotes, 'q', {b: q.a}), 'b')}"\n`)).toEqual([]);
  });

  it("explains a write into an item of an extended list, which isn't in state", () => {
    const ui = render(`state quotes=[{on: false}]
derive rows={extend(quotes, 'q', {n: 1})}
each items=rows as=r
  check "x" bind=r.on
`);
    ui.press("check");
    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0]).toMatch(/^Can't change r\.on: rows is derived \(derive rows on line 2\).*Its items were built by the expression/);
    expect(ui.state.quotes).toEqual(expect.anything());
  });

  it("parses every prefix of a spec that uses it", () => {
    const lines = spec.split("\n");
    for (let n = 1; n <= lines.length; n++) expect(() => parse(lines.slice(0, n).join("\n") + "\n", registry)).not.toThrow();
  });
});
