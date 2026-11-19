/**
 * Text checks: has(), is(), contains(), starts() and ends(). Named checks only (the patterns are
 * fixed in src/text-checks.ts), Unicode-aware, and false, never an error, for null or empty text.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { evaluate } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const store = new Store();
store.set("nothing", null);
store.set("tags", ["a", "b"]);
const run = (src: string) => evaluate(src, store.scope);
const val = (src: string) => {
  const r = run(src);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.value;
};
const err = (src: string) => {
  const r = run(src);
  if (r.ok) throw new Error(`${src} should fail but gave ${JSON.stringify(r.value)}`);
  return r.error;
};
const all = (srcs: string[], want: boolean) => srcs.forEach((src) => expect(val(src), src).toBe(want));

describe("has()", () => {
  it("finds digits in any script", () => {
    all(["has('a1', 'digit')", "has('abc٣', 'digit')", "has('१२', 'digit')", "has(42, 'digit')"], true);
    all(["has('abc', 'digit')", "has('½', 'digit')", "has('', 'digit')"], false);
  });

  it("finds upper and lower case letters in any script", () => {
    all(["has('Émile', 'upper')", "has('Ωmega', 'upper')", "has('aB', 'upper')", "has('ǅ', 'upper')"], true);
    all(["has('straße', 'upper')", "has('abc1!', 'upper')", "has('مرحبا', 'upper')"], false);
    all(["has('straße', 'lower')", "has('ω', 'lower')", "has('é', 'lower')"], true);
    all(["has('ABC', 'lower')", "has('123', 'lower')", "has('مرحبا', 'lower')"], false);
  });

  it("finds symbols and spaces", () => {
    all(["has('a!', 'symbol')", "has('€5', 'symbol')", "has('a-b', 'symbol')", "has('«a»', 'symbol')", "has('a b', 'space')", "has('a b', 'space')"], true);
    all(["has('abc123', 'symbol')", "has('Émile', 'symbol')", "has('ab', 'space')"], false);
  });

  it("is false for null, empty text, true/false and lists, never an error", () => {
    for (const kind of ["digit", "upper", "lower", "symbol", "space"]) {
      all([`has(nothing, '${kind}')`, `has('', '${kind}')`, `has(true, '${kind}')`, `has(tags, '${kind}')`, `has(null, '${kind}')`], false);
    }
  });

  it("names the checks there are", () => {
    expect(err("has('a', 'emoji')")).toBe("has() checks 'digit', 'upper', 'lower', 'symbol', 'space', not 'emoji'");
    expect(err("has(nothing, kind)")).toBe(`Unknown state "kind"`);
    store.set("kind", 3);
    expect(err("has('a', kind)")).toMatch(/has\(\) checks .*, not a number/);
    expect(err("has('a', 'constructor')")).toMatch(/not 'constructor'/);
    expect(err("has('a', '__proto__')")).toMatch(/not '__proto__'/);
    expect(err("has('a')")).toMatch(/not null/);
  });
});

describe("is()", () => {
  it("checks emails by input kind=email's rule", () => {
    all(["is('ana@example.com', 'email')", "is(' ana@example.com ', 'email')", "is('élodie@exemple.fr', 'email')"], true);
    all(["is('ana@example', 'email')", "is('ana example.com', 'email')", "is('@example.com', 'email')", "is('', 'email')"], false);
  });

  it("checks web addresses", () => {
    all(["is('https://example.com', 'url')", "is('http://a.b.co:8080/path?q=1#x', 'url')", "is('HTTPS://Example.COM/', 'url')"], true);
    all(["is('example.com', 'url')", "is('ftp://example.com', 'url')", "is('https://localhost', 'url')", "is('https://exa mple.com', 'url')", "is('javascript:alert(1)', 'url')"], false);
  });

  it("checks phone numbers, ZIP codes and numbers", () => {
    all(["is('+1 (555) 123-4567', 'phone')", "is('555.123.4567', 'phone')", "is('٠١٢٣٤٥٦٧', 'phone')"], true);
    all(["is('123', 'phone')", "is('555-CALL-NOW', 'phone')", "is('1234567890123456', 'phone')"], false);
    all(["is('85004', 'zip')", "is('85004-1234', 'zip')"], true);
    all(["is('8500', 'zip')", "is('SW1A 1AA', 'zip')", "is('85004-12', 'zip')"], false);
    all(["is('12', 'number')", "is(' -3.5 ', 'number')", "is('1e3', 'number')", "is(42, 'number')"], true);
    all(["is('12a', 'number')", "is('', 'number')", "is('  ', 'number')", "is('1,2,50', 'number')"], false);
    // Grouped and decimal-comma numbers are numbers too (test/text-checks-world.test.ts has the rest).
    all(["is('1,250', 'number')", "is('12,5', 'number')"], true);
  });

  it("checks dates as date pickers write them", () => {
    all(["is('2026-11-18', 'date')", "is('2024-02-29', 'date')"], true);
    all(["is('2026-02-30', 'date')", "is('11/18/2026', 'date')", "is('2026-1-5', 'date')", "is(20261118, 'date')"], false);
  });

  it("is false for null and empty text, and names the checks there are", () => {
    for (const kind of ["email", "url", "phone", "zip", "number", "date"]) all([`is(nothing, '${kind}')`, `is('', '${kind}')`, `is(tags, '${kind}')`], false);
    expect(err("is('x', 'ssn')")).toBe("is() checks 'email', 'url', 'phone', 'us-zip', 'zip', 'postcode', 'number', 'date', not 'ssn'");
  });
});

describe("contains(), starts() and ends()", () => {
  it("ignore case unless asked to match it", () => {
    all(["contains('Grand Canyon', 'canyon')", "starts('Dr. Who', 'dr')", "ends('REPORT.PDF', '.pdf')", "contains('STRASSE', 'strasse')", "contains('Émile', 'émi')", "contains(12345, 23)"], true);
    all(["contains('Grand Canyon', 'canyon', 'case')", "starts('Dr. Who', 'dr', 'case')", "ends('REPORT.PDF', '.pdf', 'case')"], false);
    all(["contains('Grand Canyon', 'Canyon', 'case')", "starts('Dr. Who', 'Dr', 'case')"], true);
  });

  it("are false for null or empty text, and an empty part is found in any text", () => {
    all(["contains(nothing, 'a')", "starts(nothing, 'a')", "ends(nothing, '')", "contains('', '')", "contains('abc', nothing)", "contains(true, 'true')"], false);
    all(["contains('abc', '')", "starts('abc', '')"], true);
  });

  it("say what to write instead of a list or another third argument", () => {
    expect(err("contains(tags, 'a')")).toBe("contains() checks text, not a list: for a list use includes(list, value)");
    expect(err("contains('a', 'b', 'nocase')")).toMatch(/with 'case' as its third argument/);
    expect(err("starts('a', 'b', 'c', 'd')")).toMatch(/starts\(\) takes at most 3 arguments/);
  });

  it("leave includes() on text as it was: matching case", () => {
    all(["includes('Grand Canyon', 'Canyon')"], true);
    all(["includes('Grand Canyon', 'canyon')"], false);
  });

  it("point models that write JavaScript's names at them", () => {
    expect(err("startsWith('a', 'b')")).toMatch(/Use starts\(text, part\)/);
    expect(err("ends_with('a', 'b')")).toMatch(/Use ends\(text, part\)/);
    expect(err("regex('a', '[0-9]')")).toMatch(/named checks, not patterns/);
    expect(err("pw.match('[0-9]')")).toMatch(/no methods like \.match\(\)/);
  });
});

describe("can't reach JavaScript", () => {
  it("give only true or false, and no route to a function or prototype", () => {
    for (const src of ["has('a', 'digit').constructor", "is('a', 'email')['constructor']", "contains.constructor", "has", "is('a', 'toString')", "has('a', 'hasOwnProperty')", "is('a', 'valueOf')", "contains('a', 'b', '__proto__')"]) {
      const r = run(src);
      expect(r.ok && typeof r.value !== "boolean", src).toBe(false);
    }
  });

  it("take no pattern from a spec, and stay fast on long text", () => {
    const long = "a".repeat(100_000) + "!";
    store.set("long", long);
    const t = performance.now();
    for (const src of ["has(long, 'symbol')", "is(long, 'email')", "is(long, 'url')", "is(long, 'phone')", "contains(long, '!')"]) run(src);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("in a sign-up form", () => {
  const FORM = `state pw="" method="email" phone="" sent=0
derive strong={len(pw) >= 8 && has(pw, 'upper') && has(pw, 'digit')}
input "Password" bind=pw kind=password error="{strong ? '' : 'At least 8 characters, a capital and a digit'}"
input "Phone" bind=phone required={contains(method, 'phone')}
button "Sign up" disabled={!(len(pw) >= 8 && has(pw, 'upper') && has(pw, 'digit'))} on=inc:sent`;
  const problems = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.bad).map((o) => String(o.args[0]));

  it("parses cleanly", () => {
    expect(parse(FORM, registry).diagnostics).toEqual([]);
  });

  it("checks the password rule in error= and disabled=", () => {
    const ui = render(FORM, { width: 600 });
    expect(() => ui.press({ type: "button", text: "Sign up" })).toThrow(/isn't pressable/);
    expect(ui.state.sent).toBe(0);
    ui.type({ type: "input", text: "Password" }, "abcdefgh");
    ui.key("Escape");
    expect(problems(ui)).toEqual(["At least 8 characters, a capital and a digit"]);
    ui.type({ type: "input", text: "Password" }, "Ábcdefg٣", { replace: true });
    ui.key("Escape");
    expect(problems(ui)).toEqual([]);
    ui.press({ type: "button", text: "Sign up" });
    expect(ui.state.sent).toBe(1);
    expect(ui.warnings).toEqual([]);
  });

  it("works in required=", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Phone" }, "5", { replace: true });
    ui.type({ type: "input", text: "Phone" }, "", { replace: true });
    ui.key("Escape");
    expect(problems(ui)).toEqual([]);
    ui.set("method", "Phone call");
    ui.type({ type: "input", text: "Phone" }, "5", { replace: true });
    ui.type({ type: "input", text: "Phone" }, "", { replace: true });
    ui.key("Escape");
    expect(problems(ui)).toEqual(["Required"]);
  });

  it("reports a check that doesn't exist on its line", () => {
    expect(parse(`state pw=""\nbutton "Go" disabled={!has(pw, 'number')}`, registry).diagnostics).toEqual([
      { line: 2, severity: "warning", message: "In disabled: has() checks 'digit', 'upper', 'lower', 'symbol', 'space', not 'number'" },
    ]);
  });
});
