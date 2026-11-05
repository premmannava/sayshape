/**
 * Turning a spreadsheet into SayShape data for the landing page
 * (site/examples/spreadsheet.ts): names, types, limits, what's sent to the
 * proxy, and suggested questions. The proxy accepts what this makes.
 */
import { describe, expect, it } from "vitest";
import { cleanNames, MAX_COLUMNS, MAX_VALUES, payload, suggestQuestions, tableFromGrid, tableFromRows } from "../site/examples/spreadsheet";
import { demo } from "../site/examples/data-demo";
import { readQuestion } from "../worker/src/answer";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const sov = [
  ["Location ID", "Country", "Occupancy", "Building Value", "Contents Value", "TIV (USD)", "Inspected", "Last survey"],
  ["L-00001", "United States", "Office", 12_500_000, "3,200,000", "$18,400,000", true, new Date(Date.UTC(2026, 2, 14))],
  ["L-00002", "Germany", "Warehouse", 8_100_000, "5,600,000", "$15,900,000", false, new Date(Date.UTC(2025, 10, 2))],
  [null, null, null, null, null, null, null, null],
  ["L-00003", "India", "Manufacturing", 21_000_000, "9,800,000", "$36,500,000", true, null],
  ["L-00004", "Germany", "Office", 4_000_000, "", "$5,100,000", false, new Date(Date.UTC(2026, 0, 9))],
];

describe("column names", () => {
  it("become names the engine and the proxy accept", () => {
    expect(cleanNames(["Total Insured Value (USD)", "Country", "country", "", "2026 Budget", "Café"])).toEqual([
      "total_insured_value_usd", "country", "country_2", "column_4", "c_2026_budget", "cafe",
    ]);
  });
});

describe("a sheet as a table", () => {
  const t = tableFromGrid(sov);

  it("types each column, turning numbers written as text into numbers and dates into YYYY-MM-DD", () => {
    expect(t.columns.map((c) => [c.name, c.type, c.distinct])).toEqual([
      ["location_id", "text", 4], ["country", "text", 3], ["occupancy", "text", 3], ["building_value", "number", 4],
      ["contents_value", "number", 3], ["tiv_usd", "number", 4], ["inspected", "yes/no", 2], ["last_survey", "date", 3],
    ]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual({ location_id: "L-00001", country: "United States", occupancy: "Office", building_value: 12_500_000, contents_value: 3_200_000, tiv_usd: 18_400_000, inspected: true, last_survey: "2026-03-14" });
    // Empty cells are left out, so sums say so instead of counting them as 0.
    expect(t.rows[3]).not.toHaveProperty("contents_value");
    expect(t.notes).toEqual(['Column names are written as the AI reads them: "TIV (USD)" is tiv_usd.']);
    expect(tableFromGrid([["Region", "Amount"], ["N", 1]]).notes).toEqual([]);
  });

  it("finds the headings below empty rows and drops empty columns", () => {
    const g = tableFromGrid([[null, null], ["", ""], ["Name", null, "Amount"], ["A", null, 1], ["B", null, 2]]);
    expect(g.columns.map((c) => c.name)).toEqual(["name", "amount"]);
    expect(g.rows).toEqual([{ name: "A", amount: 1 }, { name: "B", amount: 2 }]);
  });

  it("keeps text that only looks partly like numbers as text", () => {
    const g = tableFromGrid([["code", "rate"], ["007", "12%"], ["A12", "15%"]]);
    expect(g.columns.map((c) => c.type)).toEqual(["text", "text"]);
    expect(g.rows[0]).toEqual({ code: "007", rate: "12%" });
    const n = tableFromGrid([["amount"], ["(84.10)"], ["-12"], ["1,250.5"]]);
    expect(n.rows.map((r) => r.amount)).toEqual([-84.1, -12, 1250.5]);
  });

  it("says so for an empty sheet", () => {
    expect(tableFromGrid([[null], [""]])).toEqual({ columns: [], rows: [], notes: ["The sheet is empty."] });
  });

  it("keeps at most 40 columns, and as many rows as the engine holds, with notes", () => {
    const wide = tableFromGrid([Array.from({ length: 50 }, (_, i) => `c${i}`), Array.from({ length: 50 }, (_, i) => i)]);
    expect(wide.columns).toHaveLength(MAX_COLUMNS);
    expect(wide.notes[0]).toBe("Using the first 40 of 50 columns.");

    const cols = 9;
    const grid = [Array.from({ length: cols }, (_, i) => `c${i}`), ...Array.from({ length: 110_000 }, (_, r) => Array.from({ length: cols }, (_, c) => r * c))];
    const tall = tableFromGrid(grid);
    const fits = Math.floor((MAX_VALUES - 1) / (cols + 1));
    expect(tall.rows).toHaveLength(fits);
    expect(tall.notes[0]).toBe(`Using the first ${fits.toLocaleString("en-US")} of 110,000 rows: that's as much as the page holds with 9 columns.`);
    // And the engine takes them.
    const r = render(`text "{len(data)}"`, { width: 400 });
    r.set("data", tall.rows as unknown as Value);
    expect(r.text()).toContain(fits.toLocaleString("en-US").replace(/,/g, ""));
    r.destroy();
  });
});

describe("what leaves the browser", () => {
  it("is the question, the columns and three rows, and the proxy accepts it", () => {
    const t = tableFromGrid([["name", "notes"], ...Array.from({ length: 50 }, (_, i) => [`row ${i}`, "x".repeat(300)])]);
    const p = payload(t, "Which rows have notes?");
    expect(p.rows).toBe(50);
    expect(p.sample).toHaveLength(3);
    expect(String(p.sample[0]!.notes).length).toBe(100);
    expect(JSON.stringify(p).length).toBeLessThan(2_000);
    const read = readQuestion(p as unknown as Record<string, unknown>);
    expect("error" in read ? read.error : "ok").toBe("ok");
  });

  it("works for every sample spreadsheet too", () => {
    for (const { dataset } of demo) {
      const p = payload(tableFromRows(dataset.rows as never), "Anything?");
      expect("error" in readQuestion(p as unknown as Record<string, unknown>)).toBe(false);
    }
  });
});

describe("suggested questions", () => {
  it("come from the columns: a total per category, the top rows, a count and an average", () => {
    const t = tableFromGrid([
      ["location_id", "country", "occupancy", "tiv"],
      ...Array.from({ length: 40 }, (_, i) => [`L-${i}`, ["US", "DE", "IN", "BR"][i % 4], ["Office", "Warehouse"][i % 2], 1000 + i]),
    ]);
    expect(suggestQuestions(t)).toEqual(["Total tiv by country", "Top 10 location id by tiv", "How many rows per country?", "Average tiv by occupancy"]);
  });

  it("always offers something", () => {
    expect(suggestQuestions(tableFromGrid([["note"], ["a"], ["b"]]))).toEqual(["How many rows per note?"]);
    expect(suggestQuestions(tableFromGrid([["x"], [1]]))).toEqual(["Summarize this spreadsheet"]);
  });
});
