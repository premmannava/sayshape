import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIMS_DATA } from "../bench/tokens/claims";
import { composition, measure, tokens, tokensBeforeFirstPaint } from "../bench/tokens/measure";
import { FOLLOW_UPS, REQUESTS, requestById } from "../bench/tokens/requests";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/token-bench/${name}`, import.meta.url), "utf8");

describe("token benchmark", () => {
  it("has the requests and follow-ups it promises", () => {
    expect(REQUESTS.map((r) => r.id)).toEqual(["r1-table", "r2-revenue", "r3-contact", "r4-analytics", "r5-pricing", "r6-settings", "r7-claims-pasted", "r7-claims-ref"]);
    expect(FOLLOW_UPS).toHaveLength(10);
  });

  it("generates the same claims every time, and its summaries agree with them", () => {
    expect(CLAIMS_DATA.claims).toHaveLength(40);
    expect(CLAIMS_DATA.monthly).toHaveLength(12);
    expect(CLAIMS_DATA.byLine).toHaveLength(6);
    expect(CLAIMS_DATA.claims[0]!.id).toBe("CL-1001");
    expect(CLAIMS_DATA.byLine.reduce((n, l) => n + l.count, 0)).toBe(40);
    expect(CLAIMS_DATA.monthly.reduce((n, m) => n + m.opened, 0)).toBe(40);
  });

  it("passes a reference answer on every part", () => {
    for (const [id, file] of [["r1-table", "r1-table__ref.ss"], ["r7-claims-ref", "r7-claims-ref__ref.ss"]] as const) {
      const r = measure(requestById(id), "ref", fixture(file));
      expect(r.problems, id).toEqual([]);
      expect(r.parts.filter((p) => !p.passed), id).toEqual([]);
      expect(r.clean && r.complete).toBe(true);
    }
  });

  it("fails parts that aren't drawn", () => {
    const r = measure(requestById("r7-claims-ref"), "x", 'text "Claims" style=title\n');
    expect(r.complete).toBe(false);
    expect(r.parts.find((p) => p.label === "a title")!.passed).toBe(true);
  });

  it("counts tokens up to the first line that draws, data lines included", () => {
    const spec = 'state rows=[{a: 1}, {a: 2}, {a: 3}]\ntext "Hi"\n';
    expect(tokensBeforeFirstPaint(spec)).toBe(tokens(spec));
    expect(tokensBeforeFirstPaint('text "Hi"\nstate rows=[{a: 1}]\n')).toBe(tokens('text "Hi"\n'));
    expect(tokensBeforeFirstPaint("state a=1\n")).toBeUndefined();
  });

  it("splits tokens into data, structure, words and formulas", () => {
    const c = composition('state rows=[{a: 1}]\nderive n={len(rows)}\ncard\n  text "Total {n}" style=title\n  stat label="N" value={n}\n');
    expect(c.data).toBeGreaterThan(0);
    expect(c.formulas).toBeGreaterThan(0);
    expect(c.words).toBeGreaterThan(0);
    expect(c.structure).toBeGreaterThan(0);
  });
});
