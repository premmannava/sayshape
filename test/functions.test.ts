/**
 * List functions and formatting: filter, find, search, sort, take, count and
 * min/max with fields, money, number, plural, lower, upper, trim. These came
 * from writing 21 real-world screens and wanting them in most of them.
 */
import { describe, expect, it } from "vitest";
import { isData } from "../src/data";
import { evaluate, interpolate } from "../src/expr";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const store = new Store();
store.set("tx", [
  { name: "Whole Foods", cat: "Groceries", amount: -84.12 },
  { name: "Shell", cat: "Gas", amount: -46.5 },
  { name: "Payroll", cat: "Income", amount: 2400 },
  { name: "Trader Joe's", cat: "Groceries", amount: -38.9 },
] as unknown as Value);
store.set("rooms", [{ id: "q", rate: 189 }, { id: "k", rate: 249 }] as unknown as Value);
store.set("items", [{ name: "Socks", price: 24, ret: true }, { name: "Shell", price: 149, ret: false }, { name: "Boots", price: 129, ret: true }] as unknown as Value);
store.set("nums", [3, 9, 4] as unknown as Value);
store.set("cat", "Groceries");
const val = (src: string) => {
  const r = evaluate(src, store.scope);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("filtering", () => {
  it("filters by a true field or an equal field, and composes with sum and len", () => {
    expect(json(val("filter(items, 'ret')")).map((i: { name: string }) => i.name)).toEqual(["Socks", "Boots"]);
    expect(val("sum(filter(items, 'ret'), 'price')")).toBe(153);
    expect(val("sum(filter(tx, 'cat', cat), 'amount')")).toBeCloseTo(-123.02);
    expect(val("len(filter(tx, 'cat', 'Gas'))")).toBe(1);
    expect(json(val("filter([0, 1, '', 'x'])"))).toEqual([1, "x"]);
  });

  it("counts items whose field equals a value", () => {
    expect(val("count(tx, 'cat', 'Groceries')")).toBe(2);
    expect(val("count(items, 'ret')")).toBe(2);
  });

  it("finds one item, or null", () => {
    expect(val("find(rooms, 'id', 'k').rate")).toBe(249);
    expect(val("find(rooms, 'id', 'x')")).toBeNull();
    expect(interpolate("{find(rooms, 'id', 'x').rate}", store.scope)).toBe("—");
  });

  it("searches a field for text, ignoring case, with empty text matching all", () => {
    expect(json(val("search(tx, 'name', 'SHE')")).map((t: { name: string }) => t.name)).toEqual(["Shell"]);
    expect(val("len(search(tx, 'name', ''))")).toBe(4);
    expect(val("len(search(tx, 'name', '  joe '))")).toBe(1);
  });
});

describe("sorting and taking", () => {
  it("sorts by a field either way, and plain values", () => {
    expect(json(val("sort(rooms, 'rate', 'desc')")).map((r: { id: string }) => r.id)).toEqual(["k", "q"]);
    expect(json(val("sort(tx, 'name')")).map((t: { name: string }) => t.name)).toEqual(["Payroll", "Shell", "Trader Joe's", "Whole Foods"]);
    expect(json(val("sort(nums)"))).toEqual([3, 4, 9]);
    expect(json(val("sort(nums, 'desc')"))).toEqual([9, 4, 3]);
    expect(json(val("sort([{a: 2}, {b: 1}, {a: 1}], 'a')"))).toEqual([{ a: 1 }, { a: 2 }, { b: 1 }]);
  });

  it("takes the first items, and leaves the original list alone", () => {
    expect(json(val("take(sort(items, 'price', 'desc'), 2)")).map((i: { name: string }) => i.name)).toEqual(["Shell", "Boots"]);
    expect(json(val("take(nums, 0)"))).toEqual([]);
    expect(json(val("nums"))).toEqual([3, 9, 4]);
  });

  it("picks the first and last item, so the best row is first(sort(...))", () => {
    expect(val("first(sort(items, 'price', 'desc')).name")).toBe("Shell");
    expect(val("last(sort(rooms, 'rate')).id")).toBe("k");
    expect(val("first(nums)")).toBe(3);
    expect(val("last(nums)")).toBe(4);
    expect(val("first([])")).toBe(null);
    expect(interpolate("{first([]).name}", store.scope)).toBe("—");
  });

  it("names the right function when a model reaches for one from another language", () => {
    const err = (src: string) => { const r = evaluate(src, store.scope); return r.ok ? "" : r.error; };
    expect(err("length(items)")).toMatch(/Unknown function "length"\. Use len\(list\)\. Functions: .*first/);
    expect(err("argmax(items)")).toMatch(/Use first\(sort\(list, 'field', 'desc'\)\)/);
    expect(err("SUM(nums)")).toMatch(/Did you mean sum\?/);
    expect(err("constructor(nums)")).not.toMatch(/Use /);
  });

  it("finds the smallest and largest of a field", () => {
    expect(val("max(tx, 'amount')")).toBe(2400);
    expect(val("min(rooms, 'rate')")).toBe(189);
    expect(val("max(nums)")).toBe(9);
    expect(interpolate("{max([], 'x')}", store.scope)).toBe("—");
  });
});

describe("grouping", () => {
  it("counts each group, in the order groups first appear", () => {
    expect(json(val("group(tx, 'cat')"))).toEqual([
      { cat: "Groceries", count: 2 },
      { cat: "Gas", count: 1 },
      { cat: "Income", count: 1 },
    ]);
  });

  it("totals a field per group under the field's own name, and composes with sort and take", () => {
    expect(json(val("group(tx, 'cat', 'amount')"))).toEqual([
      { cat: "Groceries", count: 2, amount: -84.12 + -38.9 },
      { cat: "Gas", count: 1, amount: -46.5 },
      { cat: "Income", count: 1, amount: 2400 },
    ]);
    expect(json(val("take(sort(group(tx, 'cat', 'amount'), 'amount'), 1)"))).toEqual([{ cat: "Groceries", count: 2, amount: -84.12 + -38.9 }]);
    expect(val("first(sort(group(tx, 'cat', 'amount'), 'count', 'desc')).cat")).toBe("Groceries");
    expect(val("len(group(tx, 'cat'))")).toBe(3);
  });

  it("works out avg, min or max instead of the sum", () => {
    const by = (how: string) => json(val(`group(tx, 'cat', 'amount', '${how}')`))[0].amount;
    expect(by("sum")).toBeCloseTo(-123.02);
    expect(by("avg")).toBeCloseTo(-61.51);
    expect(by("min")).toBe(-84.12);
    expect(by("max")).toBe(-38.9);
  });

  it("follows sum()'s rules: text, null or a missing field makes that group's total nothing", () => {
    const s = new Store();
    s.set("rows", [{ c: "A", v: 1 }, { c: "A", v: "2" }, { c: "B", v: 3 }, { c: "B" }, { c: "C", v: 4 }] as unknown as Value);
    const r = evaluate("group(rows, 'c', 'v')", s.scope);
    if (!r.ok) throw new Error(r.error);
    const out = json(r.value) as Array<{ c: string; count: number; v: number | null }>;
    expect(out.map((g) => [g.c, g.count])).toEqual([["A", 2], ["B", 2], ["C", 1]]);
    // NaN is shown as —; JSON writes it as null.
    expect(out.map((g) => g.v)).toEqual([null, null, 4]);
  });

  it("groups items without the field, or with a list or record in it, together under null", () => {
    const s = new Store();
    s.set("rows", [{ c: "A" }, { x: 1 }, { c: [1] }, { c: { d: 1 } }, { c: null }] as unknown as Value);
    const r = evaluate("group(rows, 'c')", s.scope);
    if (!r.ok) throw new Error(r.error);
    expect(json(r.value)).toEqual([{ c: "A", count: 1 }, { c: null, count: 4 }]);
  });

  it("keeps values as they are: 1 and '1', or US and USA, are different groups", () => {
    const s = new Store();
    s.set("rows", [{ c: 1 }, { c: "1" }, { c: "US" }, { c: "USA" }, { c: "US" }] as unknown as Value);
    const r = evaluate("group(rows, 'c')", s.scope);
    if (!r.ok) throw new Error(r.error);
    expect(json(r.value)).toEqual([{ c: 1, count: 1 }, { c: "1", count: 1 }, { c: "US", count: 2 }, { c: "USA", count: 1 }]);
  });

  it("explains a wrong call instead of guessing", () => {
    const err = (src: string) => {
      const r = evaluate(src, store.scope);
      return r.ok ? null : r.error;
    };
    expect(err("group(tx, 'cat', 'amount', 'median')")).toMatch(/'sum', 'avg', 'min' or 'max'.*not 'median'/);
    expect(err("group(tx, 'cat', 'cat')")).toMatch(/can't total the field it groups by/);
    expect(err("group(tx, 'cat', 'count')")).toMatch(/already counts/);
    expect(Number.isNaN(val("group(5, 'cat')"))).toBe(true);
    expect(Number.isNaN(val("group(tx, 3)"))).toBe(true);
    expect(json(val("group(filter(tx, 'cat', 'Nothing'), 'cat', 'amount')"))).toEqual([]);
  });

  it("points a model at group() when it reaches for groupBy", () => {
    for (const name of ["groupBy", "group_by", "aggregate"]) {
      const r = evaluate(`${name}(tx, 'cat')`, store.scope);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Use group\(list, 'field', 'amount'\)/);
    }
  });

  it("charts and tables the groups in a screen, and updates when the list changes", () => {
    const ui = render(`state spend=[{cat: "Food", amt: 12}, {cat: "Fun", amt: 30}, {cat: "Food", amt: 8}]
derive byCat={sort(group(spend, 'cat', 'amt'), 'amt', 'desc')}
chart "By category" kind=hbar items=byCat x=cat y=amt format=money
table items=byCat
  table-column "Category" field=cat
  table-column "Items" field=count
  table-column "Spent" field=amt format=money
button "More fun" on="add:spend:{cat: 'Fun', amt: 5}"`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Fun", "$30.00", "Food", "$20.00"]));
    ui.press("button");
    expect(ui.text()).toContain("$35.00");
  });
});

describe("big lists from the host", () => {
  it("finds the smallest and largest of 400,000 items without overflowing the stack", () => {
    const s = new Store();
    s.set("big", Array.from({ length: 400_000 }, (_, i) => ({ v: (i * 7919) % 100_003 })) as unknown as Value);
    s.set("nums", Array.from({ length: 300_000 }, (_, i) => i - 5) as unknown as Value);
    const at = (src: string) => {
      const r = evaluate(src, s.scope);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    expect(at("min(big, 'v')")).toBe(0);
    expect(at("max(big, 'v')")).toBe(100_002);
    expect(at("min(nums)")).toBe(-5);
    expect(at("max(nums)")).toBe(299_994);
    expect(json(at("take(sort(group(big, 'v'), 'count', 'desc'), 1)"))[0].count).toBeGreaterThan(1);
  });
});

describe("formatting", () => {
  it("formats money, numbers and plurals", () => {
    expect(val("money(2400)")).toBe("$2,400.00");
    expect(val("money(-84.1)")).toBe("-$84.10");
    expect(val("money(12.5, 'EUR')")).toBe("€12.50");
    expect(interpolate("{money(1, 'nope')}", store.scope)).toBe("—");
    expect(val("number(37000)")).toBe("37,000");
    expect(val("number(1234.567)")).toBe("1,234.57");
    expect(val("number(5, 2)")).toBe("5.00");
    expect(val("plural(1, 'item')")).toBe("1 item");
    expect(val("plural(3, 'item')")).toBe("3 items");
    expect(val("plural(2, 'child', 'children')")).toBe("2 children");
    expect(val("plural(1200, 'runner')")).toBe("1,200 runners");
  });

  it("shortens big numbers with compact()", () => {
    expect(val("compact(12345678)")).toBe("12.3M");
    expect(val("compact(4500)")).toBe("4.5K");
    expect(val("compact(950)")).toBe("950");
    expect(val("compact(-2500000)")).toBe("-2.5M");
    expect(val("compact(1200000000, 'USD')")).toBe("$1.2B");
    // 3 significant digits or 1 decimal, whichever says more: a KPI given as $1.24M stays $1.24M.
    expect(val("compact(1240000, 'USD')")).toBe("$1.24M");
    expect(val("compact(121700, 'USD')")).toBe("$121.7K");
    expect(val("compact(48210)")).toBe("48.2K");
    expect(interpolate("{compact('lots')}", store.scope)).toBe("—");
    expect(interpolate("{compact(5, 'nope')}", store.scope)).toBe("—");
  });

  it("changes case and trims text", () => {
    expect(val("lower('Sunny')")).toBe("sunny");
    expect(val("upper('ok')")).toBe("OK");
    expect(val("trim('  hi ')")).toBe("hi");
    expect(val("lower(null)")).toBe("");
    expect(val("upper(12)")).toBe("12");
  });
});

describe("the sandbox", () => {
  const attempts = [
    "filter(tx, '__proto__')",
    "filter(tx, 'constructor', 1)",
    "find(rooms, '__proto__', null)",
    "find(rooms, 'constructor')",
    "sort(rooms, 'constructor')",
    "search(rooms, '__proto__', 'o')",
    "max(rooms, '__proto__')",
    "count(rooms, 'toString')",
    "money(1, 'constructor')",
    "take(rooms, '__proto__')",
    "group(tx, '__proto__')",
    "group(tx, 'constructor', 'amount')",
    "group(tx, 'cat', '__proto__')",
    "group(tx, 'cat', 'amount', 'constructor')",
    "group(tx, 'toString', 'amount', '__proto__')",
  ];
  for (const src of attempts) {
    it(`gives only SayShape data for ${src}`, () => {
      const r = evaluate(src, store.scope);
      if (r.ok) expect(isData(r.value) || typeof r.value === "number").toBe(true);
    });
  }

  it("never returns host objects or functions", () => {
    for (const src of ["group(tx, 'cat', 'amount')", "group(tx, '__proto__')", "filter(tx, 'cat', 'Gas')", "sort(tx, 'amount')", "take(tx, 2)", "search(tx, 'name', 'a')", "find(tx, 'cat', 'Gas')"]) {
      expect(isData(val(src)), src).toBe(true);
    }
  });
});

describe("in screens", () => {
  it("make the screens from the use-case run correct", () => {
    const ui = render(`state cat="All" tx=[{name: "Whole Foods", cat: "Groceries", amount: -84.12}, {name: "Payroll", cat: "Income", amount: 2400}, {name: "Shell", cat: "Gas", amount: -46.5}]
card
  tabs bind=cat
    tab "All"
    tab "Groceries"
  each items={cat == 'All' ? tx : filter(tx, 'cat', cat)} as=t
    text "{t.name} {money(t.amount)}"
  text "Spent {money(abs(sum(filter(sort(tx, 'amount'), 'cat', 'Groceries'), 'amount')))}"
  text "{plural(len(tx), 'transaction')}"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Payroll $2,400.00", "Spent $84.12", "3 transactions"]));
    ui.set("cat", "Groceries");
    expect(ui.text()).not.toContain("Payroll $2,400.00");
  });
});
