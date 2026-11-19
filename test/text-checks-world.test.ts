/**
 * is() outside the US: postal codes by country (is(v, 'postcode', 'GB'), or any known country),
 * 'us-zip' (and 'zip', kept), and numbers as people type them (1,234.5, 12,5, 1.234,5), which
 * input kind=number reads the same way.
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/expr";
import { numberFromText } from "../src/text-checks";
import { render } from "../src/testing";

const is = (expr: string) => {
  const r = evaluate(expr, () => undefined);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const fails = (expr: string) => {
  const r = evaluate(expr, () => undefined);
  return r.ok ? null : r.error;
};

describe("postal codes", () => {
  it.each([
    ["US", "85004"], ["US", "85004-1234"], ["CA", "K1A 0B1"], ["GB", "SW1A 1AA"], ["GB", "M1 1AE"], ["IE", "D02 X285"],
    ["DE", "10115"], ["FR", "75008"], ["NL", "1012 AB"], ["IN", "560001"], ["IN", "560 001"], ["AU", "2000"],
    ["JP", "100-0001"], ["CN", "100000"], ["SG", "018956"], ["BR", "01310-100"], ["MX", "06600"],
  ])("knows %s %s, by country and with none", (country, code) => {
    expect(is(`is('${code}', 'postcode', '${country}')`)).toBe(true);
    expect(is(`is('${code}', 'postcode', '${country.toLowerCase()}')`)).toBe(true);
    expect(is(`is('${code}', 'postcode')`)).toBe(true);
  });

  it("says no to another country's code and to things that aren't codes", () => {
    expect(is("is('SW1A 1AA', 'postcode', 'US')")).toBe(false);
    expect(is("is('8500', 'postcode', 'US')")).toBe(false);
    expect(is("is('hello', 'postcode')")).toBe(false);
    expect(is("is('', 'postcode', 'GB')")).toBe(false);
  });

  it("keeps 'zip' as the US check, and names it us-zip", () => {
    for (const kind of ["zip", "us-zip"]) {
      expect(is(`is('85004', '${kind}')`)).toBe(true);
      expect(is(`is('SW1A 1AA', '${kind}')`)).toBe(false);
    }
  });

  it("reports an unknown country, and a country on any other check", () => {
    expect(fails("is('12345', 'postcode', 'XX')")).toMatch(/knows 'US', 'CA', 'GB'/);
    expect(fails("is('a@b.co', 'email', 'GB')")).toMatch(/only is\(text, 'postcode', 'GB'\) takes a country/);
  });

  it("reports an unknown country on its line when the spec is read", () => {
    const ui = render(`state code=""\ntext "{is(code, 'postcode', 'ZZ') ? 'ok' : 'no'}"`, { width: 400 });
    expect(ui.diagnostics.some((d) => d.line === 2 && /knows 'US'/.test(d.message))).toBe(true);
  });
});

describe("numbers as people type them", () => {
  it.each([
    ["12.5", 12.5], ["-3", -3], ["1e3", 1000], ["1,234.5", 1234.5], ["1,234,567", 1234567], ["1,234", 1234],
    ["12,5", 12.5], ["0,75", 0.75], ["1.234,5", 1234.5], ["1.234.567,89", 1234567.89], [" 42 ", 42],
  ])("reads %s as %s", (text, n) => {
    expect(numberFromText(text)).toBe(n);
    expect(is(`is('${text}', 'number')`)).toBe(true);
  });

  it.each(["12a", "1,2,3", "1..2", ",5", "1,", "abc", ""])("says %j isn't one", (text) => {
    expect(numberFromText(text)).toBe(null);
    expect(is(`is('${text}', 'number')`)).toBe(false);
  });

  it("writes them as numbers from input kind=number", () => {
    const ui = render(`state amt=null\ninput "Amount" bind=amt kind=number`, { width: 400 });
    ui.type({ type: "input", text: "Amount" }, "1,234.5");
    expect(ui.state.amt).toBe(1234.5);
    ui.type({ type: "input", text: "Amount" }, "12,5", { replace: true });
    expect(ui.state.amt).toBe(12.5);
  });
});
