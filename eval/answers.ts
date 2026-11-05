/**
 * Data questions for choosing the landing page's model: each is a question
 * about a spreadsheet, answered the way the live proxy answers it (the same
 * guide, request and checks as worker/src/answer.ts), then drawn by the real
 * engine with every row and scored on whether it shows the right numbers.
 *
 * The right numbers are worked out here from the rows, never typed, so a
 * case can't drift from its data. Run with `npm run eval:answers`.
 */
import { demo } from "../site/examples/data-demo";
import { payload, tableFromGrid, tableFromRows, type Row, type Table } from "../site/examples/spreadsheet";
import { answerGuide, answerRequest, checkAnswer, DATA, readQuestion } from "../worker/src/answer";
import { coreComponents } from "../src/components";
import { generateSpec, type ModelConfig } from "../src/model";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { Value } from "../src/types";

export interface AnswerCase {
  id: string;
  sheet: string;
  table: Table;
  question: string;
  /** Text the drawn answer must show: each entry, or one of each list (for ties). */
  expect: Array<string | string[]>;
  /** A figure it must show, to 1%, however it's written: 238400000000, $238.4B or 238.4B. */
  expectNumber?: number;
}

// --- A made-up statement of values (SOV), like an insurance broker's -------

function seeded(seed: number) {
  let a = seed;
  return () => ((a = (a * 16807) % 2147483647) / 2147483647);
}

function sovGrid(): Array<Array<string | number | null>> {
  const r = seeded(42);
  const countries: Array<[string, number]> = [["United States", 0.31], ["United Kingdom", 0.12], ["Germany", 0.1], ["India", 0.09], ["Brazil", 0.07], ["Japan", 0.07], ["Mexico", 0.06], ["Australia", 0.05], ["Canada", 0.05], ["France", 0.04], ["Singapore", 0.02], ["South Africa", 0.02]];
  const occupancies = ["Office", "Warehouse", "Manufacturing", "Retail", "Data center"];
  const country = () => {
    const x = r();
    let a = 0;
    for (const [c, w] of countries) { a += w; if (x < a) return c; }
    return countries[0]![0];
  };
  const grid: Array<Array<string | number | null>> = [["Location ID", "Country", "Occupancy", "Building Value", "Contents Value", "BI Value", "TIV (USD)"]];
  for (let i = 0; i < 5000; i++) {
    const b = Math.round(2e6 + r() ** 2 * 6e7), c = Math.round(b * (0.1 + r() * 0.5)), bi = Math.round(b * r() * 0.4);
    grid.push([`L-${String(i + 1).padStart(5, "0")}`, country(), occupancies[Math.floor(r() * occupancies.length)]!, b, c, bi, b + c + bi]);
  }
  return grid;
}

// --- Working out the right answers ------------------------------------------

const num = (r: Row, f: string) => Number(r[f]);
const totals = (rows: readonly Row[], by: string, field: string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[by]), (m.get(String(r[by])) ?? 0) + num(r, field));
  return [...m].sort((a, b) => b[1] - a[1]);
};
const counts = (rows: readonly Row[], by: string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[by]), (m.get(String(r[by])) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
/** Every row with the highest (or lowest) value of a field: ties all count as right. */
const top = (rows: readonly Row[], field: string, label: string, dir: "asc" | "desc" = "desc") => {
  const best = (dir === "desc" ? Math.max : Math.min)(...rows.map((r) => num(r, field)));
  return rows.filter((r) => num(r, field) === best).map((r) => String(r[label]));
};
const where = (rows: readonly Row[], f: string, v: string) => rows.filter((r) => r[f] === v);

export function answerCases(): AnswerCase[] {
  const sov = tableFromGrid(sovGrid());
  const [sales, tickets, pipeline] = demo.map((e) => tableFromRows(e.dataset.rows as never)) as [Table, Table, Table];
  const tivByCountry = totals(sov.rows, "country", "tiv_usd");
  const byOccupancy = counts(sov.rows, "occupancy");
  const openTickets = where(tickets.rows, "status", "Open");
  const byCategory = counts(openTickets, "category");
  const interviews = where(pipeline.rows, "stage", "Interview");
  return [
    { id: "sov-country", sheet: "SOV", table: sov, question: "Sum of TIV by country", expect: [tivByCountry[0]![0], tivByCountry[1]![0], "Singapore"] },
    { id: "sov-top-location", sheet: "SOV", table: sov, question: "Which location has the highest TIV?", expect: [top(sov.rows, "tiv_usd", "location_id")] },
    { id: "sov-occupancy-count", sheet: "SOV", table: sov, question: "How many locations per occupancy?", expect: byOccupancy.map(([o]) => o) },
    { id: "sov-total", sheet: "SOV", table: sov, question: "What's the total insured value?", expect: [], expectNumber: sov.rows.reduce((t, r) => t + num(r, "tiv_usd"), 0) },
    { id: "sov-avg-building", sheet: "SOV", table: sov, question: "Average building value by occupancy", expect: byOccupancy.map(([o]) => o) },
    { id: "sales-behind", sheet: "Sales", table: sales, question: "Who is furthest behind target?", expect: [top(sales.rows, "pct_target", "rep", "asc")] },
    { id: "sales-region", sheet: "Sales", table: sales, question: "Total revenue by region", expect: totals(sales.rows, "region", "revenue").map(([g]) => g) },
    { id: "sales-top", sheet: "Sales", table: sales, question: "Top 5 reps by revenue", expect: [top(sales.rows, "revenue", "rep")] },
    { id: "tickets-open", sheet: "Tickets", table: tickets, question: "How many tickets are still open?", expect: [String(openTickets.length)] },
    { id: "tickets-category", sheet: "Tickets", table: tickets, question: "Open tickets by category", expect: [byCategory[0]![0]] },
    { id: "pipeline-stage", sheet: "Pipeline", table: pipeline, question: "How many candidates are in each stage?", expect: counts(pipeline.rows, "stage").map(([s]) => s) },
    { id: "pipeline-stuck", sheet: "Pipeline", table: pipeline, question: "Who has been in interviews the longest?", expect: [top(interviews, "days_in_stage", "candidate")] },
  ];
}

// --- Running and scoring ----------------------------------------------------

export interface AnswerResult {
  id: string;
  question: string;
  pass: boolean;
  /** Why it failed, in a few words. */
  why?: string;
  repaired: boolean;
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
  spec: string;
}

/** Numbers as drawn text writes them: 1,234.5, $12.3M, 238.4B, -84.10. */
function drawnNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?([KMBT])?\b/g)) {
    const n = Number(m[1]!.replace(/,/g, "") + (m[2] ?? ""));
    const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[3] as "K"] ?? 1;
    out.push(n * scale);
  }
  return out;
}

/** Whether a drawn answer shows what a case needs; the reason when it doesn't. */
export function score(c: AnswerCase, drawn: string): string | null {
  for (const e of c.expect) {
    const any = Array.isArray(e) ? e : [e];
    if (!any.some((t) => drawn.includes(t))) return `doesn't show ${any.length > 1 ? `any of ${any.slice(0, 3).join(", ")}` : any[0]}`;
  }
  if (c.expectNumber !== undefined && !drawnNumbers(drawn).some((n) => Math.abs(n - c.expectNumber!) <= Math.abs(c.expectNumber!) * 0.01)) {
    return `doesn't show ${c.expectNumber.toLocaleString("en-US")}`;
  }
  return null;
}

const registry = new Registry(coreComponents);

/** Answer one case the way the live proxy does, then draw it with every row and score it. */
export async function runAnswerCase(c: AnswerCase, config: ModelConfig, opts: { fetch?: typeof fetch } = {}): Promise<AnswerResult> {
  const q = readQuestion(payload(c.table, c.question) as unknown as Record<string, unknown>);
  if ("error" in q) throw new Error(`${c.id}: the proxy wouldn't take this case: ${q.error}`);
  const base = { id: c.id, question: c.question };
  try {
    const r = await generateSpec({ config, registry, request: answerRequest(q), guide: answerGuide(), stateNames: [DATA], check: checkAnswer, repairOn: "errors", fetch: opts.fetch });
    const result = { ...base, repaired: !!r.repair, ms: Math.round(r.timings.totalMs), promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens, spec: r.spec };
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) return { ...result, pass: false, why: errors[0]!.message.slice(0, 120) };
    const ui = render("", { width: 720 });
    ui.set(DATA, c.table.rows as unknown as Value);
    ui.setSpec(r.spec);
    const drawn = ui.text().join("\n");
    const warnings = [...ui.warnings, ...ui.diagnostics.filter((d) => d.severity !== "error").map((d) => d.message)];
    ui.destroy();
    const why = score(c, drawn) ?? (warnings.length ? `warning: ${warnings[0]!.slice(0, 100)}` : null);
    return { ...result, pass: why === null, ...(why ? { why } : {}) };
  } catch (e) {
    return { ...base, pass: false, why: e instanceof Error ? e.message.slice(0, 120) : String(e), repaired: false, ms: 0, spec: "" };
  }
}
