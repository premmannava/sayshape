/**
 * The landing page's "ask your data" demo (site/examples/data-demo.ts): every
 * answer parses with no problems when its spreadsheet is the host data, draws
 * the numbers its plain answer gives, and never copies a row into the spec.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "../src/testing";
import { parse, Registry, coreComponents } from "../src/index";
import type { Value } from "../src/types";
import { demo, SAMPLE_ROWS, wordCount } from "../site/examples/data-demo";

const registry = new Registry(coreComponents);

/** Draw a spec with its spreadsheet supplied by the host, the way the landing page does. */
function show(state: string, rows: unknown, spec: string) {
  const r = render("", { width: 720 });
  r.set(state, rows as Value); // the store copies host data in itself
  r.setSpec(spec);
  return r;
}

describe("data demo", () => {
  it("has three spreadsheets with two questions each, every one with more rows than the sample", () => {
    expect(demo).toHaveLength(3);
    for (const { dataset, questions } of demo) {
      expect(questions).toHaveLength(2);
      expect(dataset.rows.length).toBeGreaterThan(SAMPLE_ROWS);
      expect(dataset.columns.length).toBe(5);
    }
  });

  it("makes the same rows on every load", async () => {
    vi.resetModules();
    const again = (await import("../site/examples/data-demo")).demo;
    expect(again.map((e) => e.dataset.rows)).toEqual(demo.map((e) => e.dataset.rows));
  });

  for (const { dataset, questions } of demo) {
    for (const q of questions) {
      describe(`${dataset.name}: ${q.text}`, () => {
        it("parses with no problems when the spreadsheet is host data", () => {
          const { diagnostics } = parse(q.spec, registry, { knownNames: [dataset.state] });
          expect(diagnostics).toEqual([]);
        });

        it("reads the rows from the host instead of copying them", () => {
          expect(q.spec).not.toMatch(/^\s*state\b/m);
          for (const row of dataset.rows.slice(0, 20)) {
            const first = String(row[dataset.columns[0]!]);
            expect(q.spec.includes(`"${first}"`)).toBe(false);
          }
        });

        it("draws with no warnings, leading with the item its plain answer names", () => {
          const r = show(dataset.state, dataset.rows, q.spec);
          expect(r.diagnostics).toEqual([]);
          expect(r.warnings).toEqual([]);
          expect(r.find("callout").shownText).toContain(q.lead);
          expect(q.plain).toContain(q.lead.split(" are ")[0]!.replace(/ tickets| offers/, ""));
          r.destroy();
        });

        it("has a plain answer of a readable length", () => {
          expect(wordCount(q.plain)).toBeGreaterThan(20);
          expect(wordCount(q.plain)).toBeLessThan(120);
        });
      });
    }
  }
});
