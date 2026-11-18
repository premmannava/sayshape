/**
 * range() and map(): lists worked out from a formula. range() counts; map() works one value out per
 * item, with the item named, like extend(). Both are capped (MAX_MADE_ITEMS per list, MAX_DATA_VALUES
 * in one expression), never recurse, and only ever make SayShape data. The fixtures are the two
 * examples from the brief: a mortgage schedule from three derive lines and a sales dashboard whose
 * attainment comes from one extend().
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { SCENE_FUNCTIONS, sceneComponents } from "../src/components/scene";
import { isData } from "../src/data";
import { evaluate, identifiers, itemNames, MAX_MADE_ITEMS } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const store = new Store();
store.set("loan", 1000);
store.set("r", 0.1);
store.set("years", 3);
store.set("empty", [] as unknown as Value);
store.set("big", Array.from({ length: MAX_MADE_ITEMS + 1 }, (_, i) => i) as unknown as Value);
store.set("people", [{ name: "Ada", age: 36 }, { name: "Lin", age: 41 }] as unknown as Value);
const run = (src: string) => evaluate(src, store.scope);
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
const isNothing = (src: string) => { const r = run(src); return r.ok && typeof r.value === "number" && Number.isNaN(r.value); };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.sayshape`, import.meta.url), "utf8");

describe("range()", () => {
  it("counts from 0 up to, not including, the end, like slice()", () => {
    expect(val("range(4)")).toEqual([0, 1, 2, 3]);
    expect(val("range(1, 4)")).toEqual([1, 2, 3]);
    expect(val("range(1, years + 1)")).toEqual([1, 2, 3]);
    expect(val("range(-2, 1)")).toEqual([-2, -1, 0]);
    expect(val("range(2.7)")).toEqual([0, 1]);
  });

  it("gives an empty list for no count, or an end before the start", () => {
    expect(val("range(0)")).toEqual([]);
    expect(val("range(-3)")).toEqual([]);
    expect(val("range(5, 2)")).toEqual([]);
  });

  it("counts only with numbers, and says how to call it", () => {
    for (const src of ["range('5')", "range(true)", "range(null)", "range(1, 'x')", "range(people)", "range(1 / 0)"]) {
      expect(err(src), src).toMatch(/^range\(\) counts with numbers, not .*range\(5\) is 0 to 4/);
    }
    expect(err("range()")).toMatch(/range\(\) needs a count/);
    expect(err("range(1, 2, 3)")).toMatch(/range\(\) takes at most 2 arguments, not 3\. Write range\(n\)/);
  });

  it(`makes at most ${MAX_MADE_ITEMS} items`, () => {
    expect((val(`range(${MAX_MADE_ITEMS})`) as number[]).length).toBe(MAX_MADE_ITEMS);
    expect(err(`range(${MAX_MADE_ITEMS + 1})`)).toBe("range() makes at most 2,000 items, not 2,001");
    expect(err("range(1000000000)")).toMatch(/at most 2,000 items, not 1,000,000,000/);
    expect(err("range(-5, 1999)")).toMatch(/not 2,004/);
  });

  it("works with the list functions", () => {
    expect(val("sum(range(1, 11))")).toBe(55);
    expect(val("join(take(sort(range(5), 'desc'), 2))")).toBe("4, 3");
    expect(val("len(filter(map(range(10), 'n', n % 2 == 0)))")).toBe(5);
  });
});

describe("map()", () => {
  it("works out one value per item, a record or anything else", () => {
    expect(val("map(range(1, years + 1), 'y', {year: y, balance: round(loan * pow(1 + r, y))})")).toEqual([
      { year: 1, balance: 1100 }, { year: 2, balance: 1210 }, { year: 3, balance: 1331 },
    ]);
    expect(val("map(range(4), 'n', n * n)")).toEqual([0, 1, 4, 9]);
    expect(val("map(people, 'p', upper(p.name))")).toEqual(["ADA", "LIN"]);
    expect(val("map(people, 'p', p.age > 40 ? 'over' : 'under')")).toEqual(["under", "over"]);
  });

  it("nests, reading the outer item inside the inner one", () => {
    expect(val("map(range(3), 'i', map(range(3), 'j', i * j))")).toEqual([[0, 0, 0], [0, 1, 2], [0, 2, 4]]);
    expect(val("map(range(2), 'i', {row: i, total: sum(map(range(3), 'j', i + j))})")).toEqual([{ row: 0, total: 3 }, { row: 1, total: 6 }]);
    expect(val("extend(map(range(2), 'i', {n: i}), 'x', {twice: x.n * 2})")).toEqual([{ n: 0, twice: 0 }, { n: 1, twice: 2 }]);
  });

  it("gives an empty list for an empty list, and nothing for what isn't a list", () => {
    expect(val("map(empty, 'x', x)")).toEqual([]);
    expect(val("map(range(0), 'x', 1 / 0)")).toEqual([]);
    expect(isNothing("map(loan, 'x', x)")).toBe(true);
    expect(isNothing("map(null, 'x', x)")).toBe(true);
    expect(isNothing("map('text', 'x', x)")).toBe(true);
  });

  it("says which item failed", () => {
    expect(err("map(people, 'p', p.missing)")).toBe(`map(): item 0: No field "missing"`);
    expect(err("map(range(3), 'i', range(i == 2 ? 'x' : 1))")).toMatch(/^map\(\): item 2: range\(\) counts with numbers/);
  });

  it(`works through at most ${MAX_MADE_ITEMS} items, and caps what one expression makes`, () => {
    expect(err("map(big, 'x', x)")).toBe("map() works through at most 2,000 items, and this list has 2,001; filter() or take() it first");
    expect((val(`map(take(big, ${MAX_MADE_ITEMS}), 'x', x)`) as number[]).length).toBe(MAX_MADE_ITEMS);
    // Nesting can't multiply the cap: 2,000 lists of 2,000 would be four million items.
    expect(err("map(range(2000), 'i', range(2000))")).toMatch(/would make more than 10,000 items in one expression/);
    // The count starts again for every expression.
    for (let k = 0; k < 3; k++) expect(val("len(map(range(2000), 'i', i))")).toBe(2000);
  });

  it("names the item only inside its last argument, never state or an outer item's name", () => {
    expect(err("map(range(2), 'loan', loan)")).toMatch(/map\(\) names its item "loan", but "loan" is already a name here/);
    expect(err("map(range(2), 'i', map(range(2), 'i', i))")).toMatch(/names its item "i"/);
    expect(err("len(map(range(2), 'i', i)) + i")).toBe(`Unknown state "i"`);
    expect(identifiers("map(range(years), 'y', y * loan)").sort()).toEqual(["loan", "years"]);
    expect(identifiers("map(y, 'y', y)")).toEqual(["y"]);
    expect(itemNames("map(map(range(2), 'a', a), 'b', b)").sort()).toEqual(["a", "b"]);
  });

  it("is checked as it is written", () => {
    expect(err("map(people)")).toMatch(/map\(\) takes a list, a name for each item in quotes, and what to make of each/);
    expect(err("map(people, p, p.name)")).toMatch(/map\(\)'s second argument names each item/);
    expect(err("map(people, 'name')")).toBe("map() needs what to make of each item as its third argument, like map(list, 'q', q.price * 2); for one field of every item, use pluck(list, 'field')");
    expect(err("map(people, 'p', p.name, 2)")).toMatch(/map\(\) takes at most 3 arguments, not 4/);
    expect(err("people.map('p', p.name)")).toMatch(/no methods like \.map\(\): pass the list or text first/);
    expect(err("map(people, p => p.name)")).toMatch(/no arrow functions/);
  });
});

describe("range() and map() can't reach JavaScript", () => {
  it("gives only frozen SayShape data, with records that have no prototype to climb", () => {
    for (const src of ["range(3)", "map(range(2), 'x', {a: x})", "map(range(2), 'x', [x])"]) {
      const r = run(src);
      expect(r.ok && isData(r.value) && Object.isFrozen(r.value), src).toBe(true);
    }
    const rec = run("map(range(1), 'x', {__proto__: 1, constructor: 2})[0]");
    expect(rec.ok && Object.getPrototypeOf(rec.value as object)).toBeNull();
  });

  it("refuses names and fields that lead out of the data", () => {
    const attempts = [
      "range(3).constructor", "range(3)['constructor']", "range(3).__proto__", "range.constructor", "range",
      "map(range(1), 'x', x.constructor)", "map(range(1), 'x', x.__proto__)", "map(range(1), 'x', constructor)",
      "map(range(1), 'constructor', constructor)", "map(range(1), '__proto__', __proto__)", "map(range(1), 'x', toString())",
      "map(range(1), 'x', range(1).constructor.constructor('return 1')())", "map(people, 'p', p['__proto__'])",
      "map(range(1), 'x', map)", "map(range(1), 'x', x)(1)", "map(range(1), 'x', globalThis)", "map(range(1), 'x', this)",
    ];
    for (const src of attempts) {
      const r = run(src);
      expect(r.ok && !isData(r.value), src).toBe(false);
    }
    // An item called like a name of Object's still means only the item.
    expect(val("map(range(2), 'constructor', constructor + 1)")).toEqual([1, 2]);
  });
});

describe("in specs", () => {
  it("are read-only derived lists that every list reader takes", () => {
    const ui = render(`state n=4
derive squares={map(range(1, n + 1), 'k', {k: k, sq: k * k})}
text "Total {sum(squares, 'sq')}"
each items=squares as=s
  text "{s.k}² = {s.sq}"
chart "Squares" kind=bar items=squares x=k y=sq`, { width: 600 });
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toContain("Total 30");
    expect(ui.text()).toContain("4² = 16");
    ui.set("n", 2);
    expect(ui.text()).toContain("Total 5");
  });

  it("are worked out once per change, not per read", () => {
    const ui = render(`state n=3\nderive xs={map(range(n), 'i', {i: i})}\ntext "{len(xs)} {sum(xs, 'i')}"`);
    const first = ui.sayshape.state.derivedSnapshot().xs;
    expect(ui.sayshape.state.derivedSnapshot().xs).toBe(first);
    ui.set("n", 4);
    expect(ui.sayshape.state.derivedSnapshot().xs).not.toBe(first);
    expect(ui.text()).toContain("4 6");
  });

  it("report a list over the cap on the derive's line, as any failing derive", () => {
    const ui = render(`state n=5000\nderive xs={range(n)}\ntext "Count {len(xs)}"`);
    expect(ui.warnings).toEqual([expect.stringMatching(/^derive xs on line 2 couldn't be worked out, so it shows as nothing: range\(\) makes at most 2,000 items, not 5,000/)]);
    expect(ui.text()).toContain("Count —");
  });

  it("warn when map()'s item name is already state or derived", () => {
    const messages = parse(`state y=1 ys=[]\nderive a={map(ys, 'y', y)}\ntext "{len(map(ys, 'a', a))}"`, registry).diagnostics.map((d) => `${d.line}: ${d.message}`);
    expect(messages).toEqual([
      `2: map() names its item "y", but "y" is already state, so it would mean two things. Give the item another name, like 'y_'`,
      `3: map() names its item "a", but "a" is already derived, so it would mean two things. Give the item another name, like 'a_'`,
    ]);
    expect(parse(`state xs=[1]\neach items=xs as=t\n  text "{len(map(xs, 't', t))}"`, registry).diagnostics[0]?.message).toMatch(/^map\(\) names its item "t", which is already a loop variable here/);
  });

  it("keep a scene's own range(): cut to 500, never an error", () => {
    const scenes = new Registry([...coreComponents, ...sceneComponents]);
    const spec = `scene "Dots" w=100 h=100\n  each items={range(9999)} as=i\n    rect x={i % 10} y=0 w=1 h=1 fill="#000000"`;
    expect(parse(spec, scenes).diagnostics).toEqual([]);
    const ui = render(spec, { components: [...coreComponents, ...sceneComponents] });
    expect(ui.warnings.filter((w) => /range/.test(w))).toEqual([]);
    ui.destroy();
    const inScene = (src: string) => { const r = evaluate(src, () => undefined, SCENE_FUNCTIONS); return r.ok ? JSON.parse(JSON.stringify(r.value)) as unknown : r.error; };
    expect(inScene("range(2, 5)")).toEqual([2, 3, 4]);
    expect(inScene("len(range(9999))")).toBe(500);
    expect(inScene("range('x')")).toEqual([]);
  });
});

describe("the mortgage calculator", () => {
  const spec = fixture("mortgage");
  /** The balance and interest paid so far after each year of monthly payments, plainly. */
  function reference(loan: number, rate: number, years: number) {
    const i = rate / 1200, pay = loan * i / (1 - Math.pow(1 + i, -years * 12));
    const rows: Array<{ year: number; balance: number; interest: number }> = [];
    let balance = loan, interest = 0;
    for (let m = 1; m <= years * 12; m++) {
      const owed = balance * i;
      interest += owed;
      balance += owed - pay;
      if (m % 12 === 0) rows.push({ year: m / 12, balance: Math.max(0, Math.round(balance)), interest: Math.round(interest) });
    }
    return rows;
  }
  const near = (got: Array<{ year: number; balance: number; interest: number }>, want: ReturnType<typeof reference>) => {
    expect(got.map((r) => r.year)).toEqual(want.map((r) => r.year));
    got.forEach((r, k) => {
      expect(Math.abs(r.balance - want[k]!.balance), `balance, year ${r.year}`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.interest - want[k]!.interest), `interest, year ${r.year}`).toBeLessThanOrEqual(1);
    });
  };

  it("works the schedule out in three derive lines and parses cleanly", () => {
    expect(spec.split("\n").filter((l) => l.startsWith("derive ")).length).toBeLessThanOrEqual(3);
    expect(parse(spec, registry).diagnostics).toEqual([]);
  });

  it("gives the year-by-year balance and interest, and follows the inputs", () => {
    const ui = render(spec, { width: 900 });
    const schedule = () => JSON.parse(JSON.stringify(ui.sayshape.state.derivedSnapshot().schedule)) as Array<{ year: number; balance: number; interest: number }>;
    near(schedule(), reference(300000, 6, 30));
    expect(schedule()[29]!.balance).toBe(0);
    expect(ui.text()).toContain("$1,798.65");
    ui.set("years", 15);
    ui.set("rate", 4.5);
    near(schedule(), reference(300000, 4.5, 15));
    expect(ui.text()).toContain("Schedule");
    expect(ui.warnings).toEqual([]);
  });
});

describe("the sales dashboard", () => {
  const spec = fixture("sales-dashboard");

  it("works attainment out with one extend()", () => {
    expect(spec.split("\n").filter((l) => !l.startsWith("#")).join("\n").match(/extend\(/g)).toHaveLength(1);
    expect(parse(spec, registry).diagnostics).toEqual([]);
    const ui = render(spec, { width: 900 });
    const board = ui.sayshape.state.derivedSnapshot().board as unknown as Array<{ name: string; att: number }>;
    expect(board.map((r) => [r.name, r.att])).toEqual([["Ana", 121], ["Emi", 121], ["Chloé", 100], ["Ben", 80], ["Dev", 61]]);
    expect(ui.text()).toContain("99%");
    expect(ui.warnings).toEqual([]);
  });
});

describe("streaming", () => {
  const prefixes = (spec: string) => spec.split("\n").map((_, k, lines) => lines.slice(0, k).join("\n") + (k ? "\n" : ""));
  for (const name of ["mortgage", "sales-dashboard"]) {
    it(`every line prefix of the ${name} parses with no problems`, () => {
      const spec = fixture(name);
      for (const prefix of prefixes(spec)) {
        expect(parse(prefix, registry).diagnostics, prefix).toEqual([]);
        expect(parse(prefix + spec.slice(prefix.length, prefix.length + 40), registry, { partial: true }).diagnostics).toEqual([]);
      }
    });
  }
});
