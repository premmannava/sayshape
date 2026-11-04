/**
 * "Ask the docs": every curated answer is valid SayShape that renders
 * cleanly, links to a page that exists, and typical questions find the
 * answer a person would expect.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "../src/testing";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { COMMON_PROPS } from "../src/component";
import { answers, match, suggestions } from "../site/ask/answers";

const SITE = resolve(__dirname, "../site");
const elementNames = new Set(coreComponents.map((c) => c.type));

describe("ask: curated answers", () => {
  it("has unique ids", () => {
    expect(new Set(answers.map((a) => a.id)).size).toBe(answers.length);
  });

  for (const a of answers) {
    it(`${a.id}: renders cleanly at dialog widths`, () => {
      for (const width of [320, 520]) {
        const ui = render(a.spec, { width, today: "2026-10-21" });
        expect(ui.diagnostics).toEqual([]);
        expect(ui.warnings).toEqual([]);
        ui.destroy();
      }
    });

    it(`${a.id}: the note only names props that exist`, () => {
      // Notes are written by hand, so they must not drift from the component definitions.
      const known = new Set([...Object.keys(COMMON_PROPS), ...[...coreComponents, ...mapComponents].flatMap((c) => Object.keys(c.props))]);
      for (const m of a.note.matchAll(/\b([a-z][\w-]*)=/g)) expect(known.has(m[1]!), `${m[1]}= in "${a.note}"`).toBe(true);
    });

    it(`${a.id}: links to a page that exists`, () => {
      const m = /^\/docs\/elements\/([\w-]+)$/.exec(a.link.href);
      if (m) expect(elementNames.has(m[1]!), a.link.href).toBe(true);
      else expect(existsSync(resolve(SITE, a.link.href.slice(1) + ".md")), a.link.href).toBe(true);
    });
  }
});

describe("ask: matching questions to answers", () => {
  const cases: Array<[string, string]> = [
    ["how do I let people pick a quantity?", "quantity"],
    ["switch between a chart and a table", "few-options"],
    ["show a running total", "total"],
    ["a sortable table of orders", "table"],
    ["only show a field when a box is ticked", "show-hide"],
    ["dropdown of departments", "many-options"],
    ["pick a delivery date", "date"],
    ["revenue trend over time", "trend"],
    ["sales breakdown by region as a pie", "share"],
    ["track the order status", "tracking"],
    ["compare pricing plans side by side", "compare"],
    ["save the form and send it to my backend", "send"],
    ["multi step checkout flow", "screens"],
    ["add and remove items in a todo list", "add-remove"],
    ["stepper", "quantity"],
  ];
  for (const [q, id] of cases) {
    it(`"${q}" → ${id}`, () => {
      expect(match(q)[0]?.id).toBe(id);
    });
  }

  it("every suggestion finds an answer", () => {
    for (const s of suggestions) expect(match(s).length).toBeGreaterThan(0);
  });

  it("an unrelated question finds nothing rather than a wrong answer", () => {
    expect(match("what's the weather in Phoenix")).toEqual([]);
  });
});
