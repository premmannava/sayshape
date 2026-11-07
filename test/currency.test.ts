/**
 * Currency shows exactly one sign. Models naturally write "${money(x)}", and
 * money() adds the sign itself, which showed $$1,250.00. Data also arrives
 * already formatted ("$1,250.00"), which money() showed as a dash.
 */
import { describe, expect, it } from "vitest";
import { evaluate, interpolate } from "../src/expr";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const registry = new Registry();
for (const c of coreComponents) registry.register(c);

const store = new Store();
store.set("n", 1250);
store.set("neg", -84.1);
store.set("big", 250000);
store.set("text", "$1,250.00");
store.set("plain", "1,000");
store.set("eur", 12.5);
store.set("none", null as unknown as Value);
const show = (s: string) => interpolate(s, store.scope);
const val = (src: string) => {
  const r = evaluate(src, store.scope);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("one currency sign", () => {
  it("drops a $ written before money()", () => {
    expect(show("${money(n)}")).toBe("$1,250.00");
    expect(show("Total: ${money(big)}")).toBe("Total: $250,000.00");
    expect(show("${money(neg)}")).toBe("-$84.10");
  });

  it("leaves correct specs alone", () => {
    expect(show("{money(n)}")).toBe("$1,250.00");
    expect(show("${n}")).toBe("$1250");
    expect(show("${number(n)}")).toBe("$1,250");
    expect(show("Cost $5")).toBe("Cost $5");
  });

  it("only drops a matching sign", () => {
    expect(show("€{money(eur, 'EUR')}")).toBe("€12.50");
    expect(show("${money(eur, 'EUR')}")).toBe("$€12.50");
  });

  it("drops it before compact with a currency too", () => {
    expect(show("${compact(big, 'USD')}")).toBe("$250K");
  });

  it("reads amounts that are already formatted", () => {
    expect(val("money(text)")).toBe("$1,250.00");
    expect(val("money(plain)")).toBe("$1,000.00");
    expect(val("money('-$84.10')")).toBe("-$84.10");
    expect(val("number('$2,400')")).toBe("2,400");
    expect(val("compact('$250,000', 'USD')")).toBe("$250K");
  });

  it("still shows a dash for what isn't an amount", () => {
    expect(show("{money(none)}")).toBe("$0.00");
    expect(show("{money('abc')}")).toBe("—");
    expect(show("{money('1,2,3')}")).toBe("—");
  });

  it("shows one sign in a stat and a table", () => {
    const r = render(`state rev=1250 rows=[{name: "Laptop", price: 1200}]
stat label="Revenue" value="\${money(rev)}"
each items=rows as=r
  text "{r.name} \${money(r.price)}"`, { width: 400 });
    const texts = r.text();
    expect(texts).toContain("$1,250.00");
    expect(texts).toContain("Laptop $1,200.00");
    expect(texts.join(" ")).not.toContain("$$");
  });
});

describe("nothing to fix", () => {
  // The sign shows once (see above), so a sign before money() is accepted as written.
  it("accepts a sign before money() in text and props, as models often write it", () => {
    expect(parse(`state a=1
text "Total \${money(a)}"
stat label="Rev" value="\${money(a)}"`, registry).diagnostics).toEqual([]);
  });
});
