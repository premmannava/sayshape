/**
 * Reading messy values: num(), date(), month(), quarter(), year() and tidy(),
 * and totals and charts that read text num() can read. Ambiguous values are
 * never guessed: a decimal comma needs num(v, 'comma'), a slash date whose
 * parts could both be the month needs date(v, 'mdy') or date(v, 'dmy').
 */
import { describe, expect, it } from "vitest";
import { collectDataNotes, evaluate } from "../src/expr";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const store = new Store();
store.set("v", null);
store.set("money", [{ amount: "$390" }, { amount: "USD 8309" }, { amount: 100 }, { amount: "" }, { amount: "n/a" }] as unknown as Value);
store.set("plain", ["11703", "37,970.00", "x"] as unknown as Value);
const val = (src: string) => {
  const r = evaluate(src, store.scope);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};
const err = (src: string) => {
  const r = evaluate(src, store.scope);
  if (r.ok) throw new Error(`${src} should fail, gave ${String(r.value)}`);
  return r.error;
};

describe("num()", () => {
  const cases: Array<[string, number]> = [
    ["$36,626", 36626], ["USD 8309", 8309], ["37,970.00", 37970], ["11703", 11703], ["45%", 45],
    ["76 min", 76], ["53.2 km", 53.2], ["(1,200)", -1200], ["-12.5", -12.5], ["€1,250.50", 1250.5],
    ["  42  ", 42], ["8309 USD", 8309], ["-$84.10", -84.1], ["($15.00)", -15],
  ];
  for (const [text, n] of cases) it(`reads ${JSON.stringify(text)} as ${n}`, () => expect(val(`num('${text}')`)).toBe(n));

  it("keeps numbers as they are", () => {
    expect(val("num(12)")).toBe(12);
    expect(val("num(-0.5)")).toBe(-0.5);
  });

  it("gives blank for blank or anything it can't read, never a guess", () => {
    for (const text of ["", "   ", "abc", "12,5", "1.2.3", "12 34", "two", "$", "%", "1,23,456"]) expect(val(`num('${text}')`), text).toBeNull();
    expect(val("num(null)")).toBeNull();
    expect(val("num(true)")).toBeNull();
    expect(val("num([1])")).toBeNull();
  });

  it("reads a decimal comma only when asked", () => {
    expect(val("num('12,5', 'comma')")).toBe(12.5);
    expect(val("num('1.234,56', 'comma')")).toBe(1234.56);
    expect(val("num('€ 1.234,5', 'comma')")).toBe(1234.5);
    expect(val("num('1 234,5', 'comma')")).toBe(1234.5);
    expect(err("num('12,5', 'dot')")).toMatch(/'comma'/);
  });
});

describe("date()", () => {
  const cases: Array<[string, string]> = [
    ["2026-08-11", "2026-08-11"], ["9 Jan 2026", "2026-01-09"], ["Jan 9, 2026", "2026-01-09"], ["2026/8/11", "2026-08-11"],
    ["01/14/2026", "2026-01-14"], ["14/01/2026", "2026-01-14"], ["9 January 2026", "2026-01-09"], ["Sept 3 2026", "2026-09-03"],
    ["2026-8-1", "2026-08-01"], ["2026-08-11T10:30:00Z", "2026-08-11"], ["05/05/2026", "2026-05-05"],
  ];
  for (const [text, iso] of cases) it(`reads ${JSON.stringify(text)} as ${iso}`, () => expect(val(`date('${text}')`)).toBe(iso));

  it("never guesses an ambiguous slash date, and says which argument settles it", () => {
    const { value, notes } = collectDataNotes(() => evaluate("date('03/04/2026')", store.scope));
    expect(value).toEqual({ ok: true, value: null });
    expect(notes.join(" ")).toMatch(/'mdy'/);
    expect(notes.join(" ")).toMatch(/'dmy'/);
  });

  it("reads the order it's told", () => {
    expect(val("date('03/04/2026', 'mdy')")).toBe("2026-03-04");
    expect(val("date('03/04/2026', 'dmy')")).toBe("2026-04-03");
    // Told the wrong order for a date that can only be read one way: not a date.
    expect(val("date('14/01/2026', 'mdy')")).toBeNull();
    expect(err("date('03/04/2026', 'ymd')")).toMatch(/'mdy' or 'dmy'/);
  });

  it("gives blank for anything that isn't a real date", () => {
    for (const text of ["", "2026-02-30", "soon", "13/13/2026", "Foo 9, 2026", "2026-13-01"]) expect(val(`date('${text}')`), text).toBeNull();
    expect(val("date(45000)")).toBeNull();
    expect(val("date(null)")).toBeNull();
  });
});

describe("month(), quarter() and year()", () => {
  it("work on anything date() reads", () => {
    expect(val("month('9 Jan 2026')")).toBe("2026-01");
    expect(val("quarter('2026-08-11')")).toBe("2026 Q3");
    expect(val("year('Jan 9, 2026')")).toBe(2026);
    expect(val("month('03/04/2026')")).toBeNull();
    expect(val("year('soon')")).toBeNull();
  });
});

describe("tidy()", () => {
  it("trims, collapses spaces and title-cases, so names group", () => {
    expect(val("tidy('Zurich ')")).toBe("Zurich");
    expect(val("tidy('liberty   mutual')")).toBe("Liberty Mutual");
    expect(val("tidy('LIBERTY MUTUAL')")).toBe("Liberty Mutual");
    expect(val("tidy(null)")).toBe("");
  });
});

describe("totals and charts read text num() can read", () => {
  it("sum, avg, min, max and group read money text and skip what they can't read", () => {
    expect(val("sum(money, 'amount')")).toBe(8799);
    expect(val("avg(money, 'amount')")).toBe(2933);
    expect(val("max(money, 'amount')")).toBe(8309);
    expect(val("min(plain)")).toBe(11703);
    expect(val("sum(plain)")).toBe(49673);
    const g = val("group(money, 'x', 'amount')") as unknown as Array<{ amount: number }>;
    expect(g[0]!.amount).toBe(8799);
  });

  it("notes the values it skipped", () => {
    const { notes } = collectDataNotes(() => evaluate("sum(money, 'amount')", store.scope));
    expect(notes).toEqual(['1 of 5 "amount" values isn\'t a number']);
  });

  it("a chart reads money text", () => {
    const ui = render(`state sales=[{m: "Jan", amount: "$1,200"}, {m: "Feb", amount: "$800"}]\nchart kind=bar items=sales x=m y=amount\n`);
    expect(ui.copyText()).not.toContain("No data to chart");
    expect(ui.copyText()).toMatch(/1,200|1\.2K/);
  });
});

describe("the new functions have no route to JavaScript", () => {
  it("return only plain values, whatever they're given", () => {
    for (const fn of ["num", "date", "month", "quarter", "year", "tidy"]) {
      for (const arg of ["{a: 1}", "[1, 2]", "'constructor'", "'__proto__'", "'toString'", "null", "true"]) {
        const v = val(`${fn}(${arg})`);
        expect(v === null || ["string", "number"].includes(typeof v), `${fn}(${arg})`).toBe(true);
      }
    }
  });

  it("can't be reached through fields or used as values", () => {
    expect(evaluate("num.constructor", store.scope).ok).toBe(false);
    expect(evaluate("date['constructor']", store.scope).ok).toBe(false);
    const r = evaluate("tidy('a').constructor", store.scope);
    expect(r.ok ? typeof r.value : "refused").not.toBe("function");
  });
});
