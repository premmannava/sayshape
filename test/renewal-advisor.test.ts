/**
 * The renewal advisor, written with extend() and rank() (test/fixtures/renewal-advisor.sayshape):
 * one computed field per quote, a score from it, and a ranking, for any number of quotes. It has to
 * give the numbers the formula gives, written out here in plain TypeScript, for 6 quotes and for 7
 * (the number the numbered-slots version it replaces could not hold).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const spec = readFileSync(new URL("./fixtures/renewal-advisor.sayshape", import.meta.url), "utf8");
const names = ["Acme", "Bolt", "Core", "Delta", "Echo", "Foxtrot", "Gamma"];
const quote = (i: number) => ({
  carrierId: `c${i}`, carrier: names[i]!, premium: 9000 + i * 650 - (i % 3) * 400, deductible: 500 + (i % 4) * 750,
  coverageLimit: 1_000_000 + (i % 5) * 250_000, changePct: i - 3, status: i % 2 ? "quoted" : "bound", note: `Quote ${i}`,
});

type Row = ReturnType<typeof quote> & { expected: number; score: number; rank: number };

/** The formula from the brief, plainly. */
function reference(quotes: Array<ReturnType<typeof quote>>, claims: number, claimSize: number, priceWeight: number): Row[] {
  const expected = quotes.map((q) => q.premium + claims * Math.min(q.deductible, claimSize));
  const costLo = Math.min(...expected), costHi = Math.max(...expected);
  const covs = quotes.map((q) => q.coverageLimit);
  const covLo = Math.min(...covs), covHi = Math.max(...covs);
  const w = priceWeight / 100;
  const scores = quotes.map((q, i) => Math.round(100 * (w * (costHi - expected[i]!) / (costHi - costLo + 0.0001) + (1 - w) * (q.coverageLimit - covLo) / (covHi - covLo + 0.0001))));
  const rows = quotes.map((q, i) => ({ ...q, expected: expected[i]!, score: scores[i]!, rank: 1 + scores.filter((s) => s > scores[i]!).length }));
  return rows.sort((a, b) => a.rank - b.rank);
}

describe("renewal advisor", () => {
  it("parses with no diagnostics", () => {
    expect(parse(spec, new Registry(coreComponents)).diagnostics).toEqual([]);
  });

  for (const count of [6, 7]) {
    it(`gives the formula's numbers for ${count} quotes, and follows the inputs`, () => {
      const quotes = Array.from({ length: count }, (_, i) => quote(i));
      const ui = render(spec, { width: 900 });
      ui.set("quotes", quotes as unknown as Value);
      const ranked = () => JSON.parse(JSON.stringify(ui.sayshape.state.derivedSnapshot().ranked)) as Row[];
      const pick = (rows: Row[]) => rows.map((r) => [r.carrier, r.expected, r.score, r.rank]);

      expect(ranked()).toHaveLength(count);
      expect(pick(ranked())).toEqual(pick(reference(quotes, 2, 1500, 60)));

      ui.set("claims", 5);
      ui.set("claimSize", 600);
      ui.set("priceWeight", 20);
      expect(pick(ranked())).toEqual(pick(reference(quotes, 5, 600, 20)));

      expect(ui.text()).toContain(names[count - 1]);
      expect(ui.warnings).toEqual([]);
    });
  }
});
