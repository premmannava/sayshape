/**
 * The real-world benchmark's requests: 32 requests over four levels, plus 8
 * follow-ups. Every level has 4 personal and 4 enterprise requests, and 4 in
 * tidy wording and 4 vague (the short, loose way people type). The design is
 * in `eval/real/PLAN.md`.
 *
 * All data comes from `./data.ts` (seeded), and every expected figure is
 * computed there, never typed in. Checks use only what a person would see and
 * do, and accept `1,200` or `1200`, `$` or none.
 */
import type { Step, Task, TaskCheck } from "../compare/tasks";
import * as D from "./data";
import { anyOf, comma, iso, looser, money, num, pct, round2, samples, usd, type CleanRow, type Supplied } from "./data";

export interface RealTask extends Task {
  level: "low" | "medium" | "hard" | "extreme";
  audience: "personal" | "enterprise";
  wording: "tidy" | "vague";
  /** Extreme level: the lists the app supplies, by name. The request text shows only columns, five sample rows and the count. */
  data?: Record<string, Array<Record<string, string | number | null>>>;
  followUp?: { request: string; checks: TaskCheck[] };
}

// ---------------------------------------------------------------------------
// Check helpers

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The literal text, anywhere. */
const lit = (s: string) => new RegExp(esc(s));
const lits = (xs: readonly string[]) => xs.map(lit);
/** Something to press whose text starts with this word (`Dining`, `Dining (12)`), in any case. */
const press = (s: string) => new RegExp(`^\\s*${esc(s)}\\s*(\\(?\\d+\\)?)?\\s*$`, "i");
/**
 * Extreme level: go to the screen with the rows first, if it is a separate one: any button, link or tab
 * whose short text holds the list's word ("View transactions", "All claims"), but not one that adds,
 * exports or deletes. One that says what it does goes first, so a table header that only names the list
 * ("Claims", over counts by status) isn't pressed instead; then the list's bare name, for a tab.
 */
const goTo = (words: string): Step[] => [
  { press: new RegExp(`^(?=.{1,40}$)\\s*(view|see|show|open|go to|browse|manage|explore|all)\\b(?!.*\\b(add|new|create|export|import|delete|remove|download)\\b).*\\b(${words})\\b`, "i"), optional: true },
  { press: new RegExp(`^\\s*(all\\s+)?(${words})(\\s+(list|screen|page|tab|table))?\\s*(\\(\\d+\\))?\\s*[›»>→]*\\s*$`, "i"), optional: true },
];
/** A whole count, not part of a bigger number. */
const count = (n: number) => num(n, [0]);
const ADD = /^\s*(\+\s*)?(add|save|log|submit|create|record)\b/i;
/** A next-page control: next wording, page 2, or an arrow (a "›" text, or an aria-label such as "Next page"). */
const NEXT = /^\s*((go to )?next( page)?|load more|show more|more|older|page 2|2)\s*[›»>→▶▸⟩⏵]*\s*$|^\s*[›»>→▶▸⟩⏵]{1,2}\s*$/i;

/** Every letter in either case, for patterns that `anyOf` joins (it drops flags). */
const caseless = (w: string) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
/**
 * A count where a person reads it as one: under a label ("Transactions" then "53"), "53 transactions",
 * "of 53" or "(53)". Never a bare number among the rows' own numbers.
 */
function tally(ns: readonly number[], words: string): RegExp {
  const w = `(?:${[...words.split("|"), "count", "results", "rows", "items", "records", "matches", "matching", "shown", "found", "total"].map(caseless).join("|")})`;
  const n = `(?:${[...new Set(ns)].map((x) => comma(x).replace(",", ",?")).join("|")})`;
  const bare = `(?<![\\d.,$])${n}(?!\\d|[.,]\\d)`;
  return new RegExp([`${w}[^\\n\\d]{0,20}\\n\\s*${bare}\\s*(?=\\n|$)`, `${bare}\\s+${w}`, `\\b[oO][fF]\\s+${bare}`, `\\(\\s*${bare}\\s*\\)`].join("|"));
}

// Finding the supplied rows on screen, whichever columns a model chose to show.

type Kind = "text" | "date" | "num";
interface RowSpec {
  rows: readonly CleanRow[];
  /** The fields a row may show, and how to read each. A "num" field may be shown as minutes or hours (`hours`). */
  fields: Record<string, Kind | "hours">;
  /** Fields that alone tell one row (an id, a client): a row is on screen where one shows, or where two of its own fields show close together. */
  keys: string[];
  /** Fields whose values pressing a row may use (never a filter's own values). */
  press: string[];
}
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const dayKey = (m: number, d: number) => `${m}-${d}`;
/** Every date a piece of text shows, as month-day keys, in the formats people and models write. */
function datesIn(s: string): string[] {
  const out: string[] = [];
  let rest = s.replace(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g, (_, _y, m, d) => (out.push(dayKey(+m, +d)), " "));
  rest = rest.replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?![\d/])/g, (_, m, d) => (out.push(dayKey(+m, +d)), " "));
  for (const x of rest.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?!\\d)`, "gi"))) out.push(dayKey(MONTH_NO[x[1]!.toLowerCase()] ?? 0, +x[2]!));
  for (const x of rest.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})\\s+${MONTH_RE}`, "gi"))) out.push(dayKey(MONTH_NO[x[2]!.toLowerCase()] ?? 0, +x[1]!));
  return out;
}
/** Every number a piece of text shows ($1,234.50, 45 min, 0:45 as 45). */
function numsIn(s: string): number[] {
  const out: number[] = [];
  // Not the numbers inside a date: 2026-08-14 is no amount of 14.
  const rest = s
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?<![\d/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\d/])/g, " ")
    .replace(new RegExp(`\\b${MONTH_RE}\\s+\\d{1,2}(?:,?\\s+\\d{4})?(?!\\d)|(?<!\\d)\\d{1,2}\\s+${MONTH_RE}(?:\\s+\\d{4})?`, "gi"), " ")
    .replace(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, (_, h, m) => (out.push(+h * 60 + +m), " "));
  for (const x of rest.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g)) out.push(Number(x[1]!.replace(/,/g, "") + (x[2] ?? "")));
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const textIn = (piece: string, value: string) => {
  const p = norm(piece), v = norm(value);
  if (!v) return false;
  if (new RegExp(`(?<![a-z0-9])${esc(v)}(?![a-z0-9])`).test(p)) return true;
  // A cell cut short: "Trader Jo…" is Trader Joe's.
  const cut = p.match(/^(.{4,})(…|\.\.\.)$/);
  return !!cut && v.startsWith(cut[1]!.trim());
};
const closeTo = (a: number, b: number) => Math.abs(a - b) < 0.006 || (b >= 100 && Math.abs(a - b) < 0.5);

/** Where each row's fields show: for each row, for each field, the pieces that show it. */
function placesOf(spec: RowSpec, text: string[]): Array<Record<string, number[]>> {
  const out = spec.rows.map(() => ({}) as Record<string, number[]>);
  const add = (r: number, f: string, i: number) => ((out[r]![f] ??= []).push(i));
  text.forEach((piece, i) => {
    const days = new Set(datesIn(piece));
    const nums = numsIn(piece);
    spec.rows.forEach((row, r) => {
      for (const [f, kind] of Object.entries(spec.fields)) {
        const v = row[f];
        if (v === null || v === undefined) continue;
        if (kind === "date") { if (typeof v === "object" && days.has(dayKey(v.m, v.d))) add(r, f, i); }
        else if (kind === "num" || kind === "hours") { if (typeof v === "number" && nums.some((x) => closeTo(x, v) || (kind === "hours" && closeTo(x, round2(v / 60))) || (kind === "hours" && closeTo(x, Math.round((v / 60) * 10) / 10)))) add(r, f, i); }
        else if (textIn(piece, String(v))) add(r, f, i);
      }
    });
  });
  return out;
}
/** Whether few other rows share this row's value of a field, so seeing it points at this row. */
const ownCache = new WeakMap<RowSpec, Map<string, number>>();
function own(spec: RowSpec, r: number, f: string): boolean {
  let counts = ownCache.get(spec);
  if (!counts) {
    counts = new Map();
    for (const row of spec.rows) for (const k of Object.keys(spec.fields)) { const key = `${k}=${JSON.stringify(row[k])}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
    ownCache.set(spec, counts);
  }
  return spec.keys.includes(f) || (counts.get(`${f}=${JSON.stringify(spec.rows[r]![f])}`) ?? 0) <= Math.max(3, spec.rows.length * 0.05);
}
/** One place a row shows: a run of pieces no longer than a row, with how many of its fields (and of its own fields) show there. */
interface Showing { all: number; own: number; pieces: number[] }
function showingsOf(spec: RowSpec, at: Record<string, number[]>, r: number, loose = false): Showing[] {
  const width = Object.keys(spec.fields).length;
  const fields = Object.entries(at);
  const starts = new Set(fields.flatMap(([, ps]) => ps.flatMap((p) => Array.from({ length: width }, (_, k) => p - k))));
  const out: Showing[] = [];
  for (const start of starts) {
    const inside = fields.map(([f, ps]) => [f, ps.filter((p) => p >= start && p < start + width)] as const).filter(([, ps]) => ps.length);
    const mine = inside.filter(([f]) => own(spec, r, f));
    if (mine.length >= 2 || inside.some(([f]) => spec.keys.includes(f)) || (loose && mine.length >= 1 && inside.length >= 3)) out.push({ all: inside.length, own: mine.length, pieces: inside.flatMap(([, ps]) => ps) });
  }
  return out;
}
/** The rows on screen, by index, with where each shows. */
const seenOn = (spec: RowSpec, text: string[], loose = false) => placesOf(spec, text).map((at, r) => ({ r, shows: showingsOf(spec, at, r, loose) })).filter((x) => x.shows.length);
const rowsOn = (spec: RowSpec, text: string[]) => seenOn(spec, text).map((x) => x.r);

/** Something to press that shows one of the rows: its id, name or date, as text. */
function rowPress(spec: RowSpec): RegExp {
  const alts = new Set<string>();
  for (const row of spec.rows.slice(0, 200)) {
    for (const f of spec.press) {
      const v = row[f];
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "object") {
        const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][v.m - 1]!;
        const p2 = (n: number) => String(n).padStart(2, "0");
        for (const d of [`${v.y}-${p2(v.m)}-${p2(v.d)}`, `${p2(v.m)}/${p2(v.d)}(/(${v.y}|${v.y % 100}))?`, `${v.m}/${v.d}(/(${v.y}|${v.y % 100}))?`, `${mon}[a-z]*\\.? ${v.d}`, `${v.d} ${mon}[a-z]*`, `${v.y}/${v.m}/${v.d}`]) alts.add(d);
      } else alts.add(esc(String(v)));
    }
  }
  return new RegExp(`(?<![\\w/-])(${[...alts].join("|")})(?![\\w/-]|\\d)`, "i");
}

/** Extreme level: a page of the rows, a next control, and pressing it shows other rows. */
const pages = (screen: Step[], spec: RowSpec): TaskCheck => ({
  label: `shows a page of the ${spec.rows.length} rows, and next moves on`,
  steps: [...screen, { press: NEXT }],
  test: (after, before) => {
    const now = rowsOn(spec, after);
    if (!now.length || now.length >= spec.rows.length * 0.75) return false;
    const was = rowsOn(spec, before);
    // The rows were on the opening screen: next must have shown other ones.
    if (was.length) return now.some((r) => !was.includes(r));
    // They were on a screen of their own, which a check can't see before next: what next shows mustn't be
    // the first rows in the data's order or by date, which is what a page 1 shows.
    const byDay = spec.rows.map((row, r) => ({ r, d: row.day })).filter((x): x is { r: number; d: D.Day } => typeof x.d === "object" && x.d !== null).sort((a, b) => a.d.m - b.d.m || a.d.d - b.d.d).map((x) => x.r);
    const all = spec.rows.map((_, r) => r);
    return [all, byDay, [...byDay].reverse()].every((order) => {
      const first = new Set(order.slice(0, now.length + 3));
      return now.filter((r) => first.has(r)).length < now.length * 0.6;
    });
  },
});
/** Extreme level: pressing a row by what it shows opens more about it: its fields again, or more of them. */
const detail = (screen: Step[], spec: RowSpec): TaskCheck => ({
  label: "pressing a row opens its detail",
  steps: [...screen, { press: rowPress(spec) }],
  test: (after) => {
    const seen = seenOn(spec, after);
    if (!seen.length) {
      // A screen of one row whose own values are mostly blank (no premium): one own field and two more will do.
      const one = seenOn(spec, after, true);
      return one.length > 0 && one.length <= 3;
    }
    const best = (shows: Showing[]) => Math.max(...shows.map((x) => x.all));
    const counts = seen.map((x) => best(x.shows)).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)] ?? 0;
    // Shown twice in full (in the list and in its detail), in different pieces, not just a value two rows share.
    const twice = (shows: Showing[]) => {
      const full = Math.max(...shows.map((x) => x.own));
      const used = new Set<number>();
      let n = 0;
      for (const x of shows.filter((y) => y.own >= full)) {
        if (x.pieces.some((j) => used.has(j))) continue;
        x.pieces.forEach((j) => used.add(j));
        n++;
      }
      return n >= 2;
    };
    // Or more of its fields than a row of the list shows, or a screen of its own.
    return seen.some((x) => twice(x.shows) || best(x.shows) >= median + 2 || (seen.length <= 3 && best(x.shows) >= 3));
  },
});
/**
 * Extreme level: picking one value in a filter shows its figures: the filtered total or count. When the
 * filter sits on the opening screen and that screen already showed the figure (a total per category),
 * the figure must show more often than before, so a filter that does nothing doesn't pass.
 */
const picks = (label: string, screen: Step[], value: string, ...figures: RegExp[]): TaskCheck => {
  const fig = anyOf(...figures);
  const times = (text: string[]) => text.join("\n").match(new RegExp(looser(fig).source, "g"))?.length ?? 0;
  return {
    label, steps: [...screen, { press: press(value) }], shows: [fig],
    test: (after, before) => {
      const kept = before.filter((t) => after.includes(t)).length;
      const sameScreen = before.length > 0 && kept >= before.length * 0.6;
      return !sameScreen || times(before) === 0 || times(after) > times(before);
    },
  };
};

/** The request text for a list the app supplies (extreme level). */
const supplied = (s: Supplied, vague: boolean) =>
  vague
    ? `the app passes you the rows as a list called "${s.name}" (${s.rows.length} rows), don't type them in. columns: ${s.columns.join(", ")}. first 5 look like:\n${samples(s)}`
    : `The app supplies the rows as a list named "${s.name}" (${s.rows.length} rows), so don't type them in. Columns: ${s.columns.join(", ")}. Five sample rows:\n${samples(s)}`;
const MESSY = "The data is messy: some cells are blank, and dates and amounts come in mixed formats. Dates with slashes are month/day.";
const dataOf = (...lists: Supplied[]) => Object.fromEntries(lists.map((s) => [s.name, s.rows]));

// ---------------------------------------------------------------------------
// Low: one thing, data in the sentence

const low: RealTask[] = [
  {
    id: "low-budget-chart", level: "low", audience: "personal", wording: "tidy", category: "chart",
    request: `Make a bar chart of my spending this month by category, with the total above it: ${D.lowBudget.rows.map((r) => `${r.category} ${usd(r.amount)}`).join(", ")}.`,
    checks: [
      { label: "labels every category", shows: lits(D.lowBudget.rows.map((r) => r.category)) },
      { label: `shows the total (${usd(D.lowBudget.total)})`, shows: [money(D.lowBudget.total)] },
    ],
  },
  {
    id: "low-subs-kpi", level: "low", audience: "personal", wording: "vague", category: "kpi",
    request: `my subs: ${D.lowSubs.rows.map((r) => `${r.name.toLowerCase()} ${(r.cents / 100).toFixed(2)}`).join(", ")}. what am i paying a month and a year`,
    checks: [
      { label: `monthly total (${usd(D.lowSubs.monthly)})`, shows: [money(D.lowSubs.monthly)] },
      { label: `yearly total (${usd(D.lowSubs.yearly)})`, shows: [money(D.lowSubs.yearly)] },
    ],
  },
  {
    id: "low-workout-table", level: "low", audience: "personal", wording: "tidy", category: "table",
    request: `Show this week's workouts as a table with day, activity and minutes, and a total row at the bottom: ${D.lowWorkouts.rows.map((r) => `${r.day} ${r.activity} ${r.minutes} min`).join("; ")}.`,
    checks: [
      { label: "shows every day", shows: lits(D.lowWorkouts.rows.map((r) => r.day)) },
      { label: `shows the total minutes (${D.lowWorkouts.total})`, shows: [count(D.lowWorkouts.total)] },
    ],
  },
  {
    id: "low-trip-split", level: "low", audience: "personal", wording: "vague", category: "calculator",
    request: `${D.lowTrip.people} of us went to tahoe. ${D.lowTrip.rows.map((r) => `${r.what} ${r.amount}`).join(", ")}. how much does each person owe`,
    checks: [
      { label: `shows the total (${usd(D.lowTrip.total)})`, shows: [money(D.lowTrip.total)] },
      { label: `shows each person's share (${usd(D.lowTrip.each)})`, shows: [money(D.lowTrip.each)] },
    ],
  },
  {
    id: "low-pipeline-kpi", level: "low", audience: "enterprise", wording: "tidy", category: "kpi",
    request: `Show a KPI row for the sales pipeline: ${D.lowPipeline.deals} open deals worth ${usd(D.lowPipeline.value)} in total, a win rate of ${D.lowPipeline.winRate}% this quarter, and the average deal size.`,
    checks: [
      { label: "shows the pipeline value and win rate", shows: [money(D.lowPipeline.value), pct(D.lowPipeline.winRate, [0, 1])] },
      { label: `shows the average deal size (${usd(D.lowPipeline.average)})`, shows: [money(D.lowPipeline.average)] },
    ],
  },
  {
    id: "low-tickets-donut", level: "low", audience: "enterprise", wording: "vague", category: "chart",
    request: `donut of open tickets by priority: ${D.lowTickets.rows.map((r) => `${r.priority.toLowerCase()} ${r.count}`).join(", ")}`,
    checks: [
      { label: "names every priority", shows: D.lowTickets.rows.map((r) => new RegExp(r.priority, "i")) },
      { label: "shows the counts", shows: D.lowTickets.rows.map((r) => count(r.count)) },
    ],
  },
  {
    id: "low-headcount-table", level: "low", audience: "enterprise", wording: "tidy", category: "table",
    request: `Table of headcount by department with a total row: ${D.lowHeadcount.rows.map((r) => `${r.dept} ${r.headcount} people, ${r.open} open roles`).join("; ")}.`,
    checks: [
      { label: "shows every department", shows: lits(D.lowHeadcount.rows.map((r) => r.dept)) },
      { label: `shows the totals (${D.lowHeadcount.headcount} people, ${D.lowHeadcount.open} open roles)`, shows: [count(D.lowHeadcount.headcount), count(D.lowHeadcount.open)] },
    ],
  },
  {
    id: "low-renewals-bar", level: "low", audience: "enterprise", wording: "vague", category: "chart",
    request: `renewals due in june by carrier, ${D.lowRenewals.rows.map((r) => `${r.carrier.toLowerCase()} ${r.count}`).join(", ")}. bar chart biggest first`,
    checks: [
      { label: "names every carrier", shows: D.lowRenewals.rows.map((r) => new RegExp(esc(r.carrier), "i")) },
      {
        label: `carriers largest first (${D.lowRenewals.largestFirst.join(", ")})`,
        shows: [new RegExp(D.lowRenewals.largestFirst.map(esc).join("[\\s\\S]*"), "i")],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Medium: two or three parts and one interaction, up to 15 rows

const L = D.medLoans;
const medium: RealTask[] = [
  {
    id: "med-loan-compare", level: "medium", audience: "personal", wording: "tidy", category: "calculator",
    request: `Compare three car loan offers: ${L.rows.map((r) => `${r.lender} at ${r.apr}% APR for ${r.months} months`).join("; ")}. Give me one loan amount field (starting at ${usd(L.amount)}) and show each lender's monthly payment and total interest, using the standard amortization formula, with the cheapest offer marked.`,
    checks: [
      { label: "monthly payments at the default amount", shows: L.rows.map((r) => money(D.payment(L.amount, r.apr, r.months))) },
      { label: `typing ${usd(L.typed)} updates every payment`, steps: [{ type: [0, String(L.typed)] }], shows: L.rows.map((r) => money(D.payment(L.typed, r.apr, r.months))) },
    ],
  },
  {
    id: "med-subs-toggle", level: "medium", audience: "personal", wording: "vague", category: "table",
    request: `list my subscriptions w/ a monthly/yearly switch and the total. ${D.medSubs.rows.map((r) => `${r.name} ${(r.cents / 100).toFixed(2)}/mo`).join(", ")}`,
    checks: [
      { label: "lists every subscription", shows: lits(D.medSubs.rows.map((r) => r.name)) },
      { label: `monthly total (${usd(D.medSubs.monthly)})`, shows: [money(D.medSubs.monthly)] },
      { label: `switching to yearly shows ${usd(D.medSubs.yearly)}`, steps: [{ press: /^\s*(yearly|year|annual(ly)?|per year|\/\s?yr)\b/i }], shows: [money(D.medSubs.yearly)] },
    ],
  },
  {
    id: "med-workout-filter", level: "medium", audience: "personal", wording: "tidy", category: "dashboard",
    request: `My March workouts: ${D.medWorkouts.rows.map((r) => `${iso(r.day)} ${r.type} ${r.minutes} min ${r.km} km`).join("; ")}. Show total minutes and total distance, and the sessions in a table, with a type filter (All, Run, Bike, Swim) that the totals follow.`,
    checks: [
      { label: `totals for all sessions (${D.medWorkouts.minutes} min, ${D.medWorkouts.km} km)`, shows: [count(D.medWorkouts.minutes), num(D.medWorkouts.km, [1, 0, 2])] },
      { label: `Run shows ${D.medWorkouts.runMinutes} min and ${D.medWorkouts.runKm} km`, steps: [{ press: press("Run") }], shows: [count(D.medWorkouts.runMinutes), num(D.medWorkouts.runKm, [1, 0, 2])] },
    ],
  },
  {
    id: "med-study-checklist", level: "medium", audience: "personal", wording: "vague", category: "app",
    request: `study plan for my calc exam, ${D.medStudy.rows.map((r) => `${r.topic} ${r.hours}h${r.done ? " (done)" : ""}`).join(", ")}. want to tick stuff off and see hours left`,
    checks: [
      { label: "lists every topic", shows: lits(D.medStudy.rows.map((r) => r.topic)) },
      { label: `hours left at the start (${D.medStudy.left})`, shows: [count(D.medStudy.left)] },
      { label: `ticking ${D.medStudy.target} leaves ${D.medStudy.leftAfter} hours`, steps: [{ press: lit(D.medStudy.target) }], shows: [count(D.medStudy.leftAfter)] },
    ],
  },
  {
    id: "med-pipeline-filter", level: "medium", audience: "enterprise", wording: "tidy", category: "table",
    request: `Deals table with account, owner, stage and value, sortable by value, with stage filter buttons (All, Prospect, Proposal, Negotiation, Won) and a total value that follows the filter. Deals: ${D.medDeals.rows.map((r) => `${r.account}, ${r.owner}, ${r.stage}, ${usd(r.value)}`).join("; ")}.`,
    checks: [
      { label: `total for all deals (${usd(D.medDeals.total)})`, shows: [money(D.medDeals.total)] },
      { label: `Negotiation shows ${usd(D.medDeals.negotiation)} and hides other stages`, steps: [{ press: press("Negotiation") }], shows: [money(D.medDeals.negotiation)], hides: [lit(D.medDeals.notNegotiation)] },
    ],
  },
  {
    id: "med-tickets-status", level: "medium", audience: "enterprise", wording: "vague", category: "table",
    request: `our tickets, need to filter by status and see how many are open: ${D.medTickets.rows.map((r) => `${r.id} ${r.subject} ${r.status.toLowerCase()} ${r.priority.toLowerCase()}`).join(", ")}`,
    checks: [
      { label: `shows the open count (${D.medTickets.open})`, shows: [count(D.medTickets.open)] },
      { label: "Pending shows only pending tickets", steps: [{ press: press("Pending") }], shows: lits(D.medTickets.pending.slice(0, 2)), hides: lits(D.medTickets.solved.slice(0, 2)) },
    ],
  },
  {
    id: "med-claims-form", level: "medium", audience: "enterprise", wording: "tidy", category: "form",
    request: `Claims intake. Show the current claims in a table with the total claimed: ${D.medClaims.rows.map((r) => `${r.id} ${r.policy} ${r.claimant} ${usd(r.amount)}`).join("; ")}. Below it, a form with policy number, claimant name and amount, in that order. The policy number must be POL- followed by 6 digits and the amount between $1 and $50,000; show a message for each invalid field. Submitting a valid claim adds it to the table and updates the total.`,
    checks: [
      { label: `total claimed (${usd(D.medClaims.total)})`, shows: [money(D.medClaims.total)] },
      { label: "a bad policy number is refused", steps: [{ type: [0, "123"] }, { type: [1, D.medClaims.add.claimant] }, { type: [2, String(D.medClaims.add.amount)] }, { press: ADD }], shows: [money(D.medClaims.total)], hides: [money(D.medClaims.after)] },
      { label: `a valid claim makes the total ${usd(D.medClaims.after)}`, steps: [{ type: [0, D.medClaims.add.policy] }, { type: [1, D.medClaims.add.claimant] }, { type: [2, String(D.medClaims.add.amount)] }, { press: ADD }], shows: [money(D.medClaims.after), lit(D.medClaims.add.claimant)] },
    ],
  },
  {
    id: "med-bva-toggle", level: "medium", audience: "enterprise", wording: "vague", category: "table",
    request: `budget vs actual by dept, show variance + flag overspend, and let me show just the over budget ones. ${D.medBva.rows.map((r) => `${r.dept} ${comma(r.budget)} / ${comma(r.actual)}`).join(", ")} (budget / actual)`,
    checks: [
      { label: `totals (${usd(D.medBva.budget)} budget, ${usd(D.medBva.actual)} actual)`, shows: [money(D.medBva.budget), money(D.medBva.actual)] },
      { label: "showing only over budget hides the rest", steps: [{ press: /^\s*(show\s+)?(only\s+)?over[\s-]?(budget|spend)/i }], shows: lits(D.medBva.over.slice(0, 2)), hides: lits(D.medBva.under.slice(0, 2)) },
    ],
  },
];

// ---------------------------------------------------------------------------
// Hard: a full screen over about 50 rows, in the request

const HB = D.hardBudget, HT = D.hardTrip, HW = D.hardWorkouts, HS = D.hardStudy, HR = D.hardRenewals, HD = D.hardDeals, HK = D.hardTickets, HF = D.hardStaff;
const hard: RealTask[] = [
  {
    id: "hard-budget", level: "hard", audience: "personal", wording: "tidy", category: "dashboard",
    request: `Build a monthly budget screen from my transactions for January to March. Include a category filter and a month filter that drive everything: total spent, number of transactions, a chart of spending by category, and the transactions table. Add a form to add a transaction (merchant, category, amount) that updates all of it.\n\nTransactions (date, merchant, category, amount):\n${HB.rows.map((r) => `${iso(r.day)}, ${r.merchant}, ${r.category}, ${usd(r.amount)}`).join("\n")}`,
    checks: [
      { label: `total spent (${usd(HB.total)})`, shows: [money(HB.total)] },
      { label: `Dining shows ${usd(HB.dining)}`, steps: [{ press: press("Dining") }], shows: [money(HB.dining)] },
      { label: `adding $${HB.add} makes the total ${usd(HB.total + HB.add)}`, steps: [{ type: [0, "Bookshop"] }, { type: [1, String(HB.add)] }, { press: ADD }], shows: [money(HB.total + HB.add)] },
    ],
    followUp: { request: "now only March", checks: [{ label: `March total (${usd(HB.march)}), not the quarter's`, shows: [money(HB.march)], hides: [money(HB.total)] }] },
  },
  {
    id: "hard-trip", level: "hard", audience: "personal", wording: "vague", category: "dashboard",
    request: `trip w/ ${HT.people.join(", ")}, here's everything we paid. want total, what each of us paid, each persons balance (paid minus their share, split even), filter by category, and a way to add more\n\n${HT.rows.map((r) => `${r.who} ${r.what} (${r.category.toLowerCase()}) ${r.amount}`).join("\n")}`,
    checks: [
      { label: `total (${usd(HT.total)}) and each share (${usd(HT.share)})`, shows: [money(HT.total), money(HT.share)] },
      { label: "what each person paid", shows: HT.paid.map((p) => money(p.paid)) },
      { label: "each person's balance", shows: HT.paid.filter((p) => p.balance !== 0).map((p) => money(p.balance)) },
      { label: `Food shows ${usd(HT.food)}`, steps: [{ press: press("Food") }], shows: [money(HT.food)] },
    ],
  },
  {
    id: "hard-workouts", level: "hard", audience: "personal", wording: "tidy", category: "dashboard",
    request: `Make a training log screen from these sessions (February to April). A type filter (All, Run, Bike, Swim, Strength) drives the totals (minutes, distance, sessions), a chart of minutes per type, and the sessions table. Add a form to log a session: type, minutes and km, in that order.\n\nSessions (date, type, minutes, km):\n${HW.rows.map((r) => `${iso(r.day)}, ${r.type}, ${r.minutes}, ${r.km ?? "-"}`).join("\n")}`,
    checks: [
      { label: `totals (${HW.minutes} min, ${HW.km} km)`, shows: [count(HW.minutes), num(HW.km, [1, 0, 2])] },
      { label: `Run shows ${HW.runMinutes} min and ${HW.runKm} km`, steps: [{ press: press("Run") }], shows: [count(HW.runMinutes), num(HW.runKm, [1, 0, 2])] },
      { label: `logging ${HW.add.minutes} min makes ${HW.minutes + HW.add.minutes} min`, steps: [{ type: [0, String(HW.add.minutes)] }, { type: [1, String(HW.add.km)] }, { press: ADD }], shows: [count(HW.minutes + HW.add.minutes)] },
    ],
  },
  {
    id: "hard-study", level: "hard", audience: "personal", wording: "vague", category: "dashboard",
    request: `my study log for this term. want hours per subject, total hours, filter by subject, and add new sessions (topic, subject, hours)\n\n${HS.rows.map((r) => `${iso(r.day)} ${r.subject} - ${r.topic} ${r.hours}h`).join("\n")}`,
    checks: [
      { label: `total hours (${HS.hours})`, shows: [num(HS.hours, [1, 0])] },
      { label: `Chemistry shows ${HS.chemistry} hours`, steps: [{ press: press("Chemistry") }], shows: [num(HS.chemistry, [1, 0])] },
      { label: `adding ${HS.add} hours makes ${HS.hours + HS.add}`, steps: [{ type: [0, "Past papers"] }, { type: [1, String(HS.add)] }, { press: ADD }], shows: [num(HS.hours + HS.add, [1, 0])] },
    ],
  },
  {
    id: "hard-renewals", level: "hard", audience: "enterprise", wording: "tidy", category: "dashboard",
    request: `Build an insurance renewals pipeline screen for 2026. Carrier and status filters drive everything: total premium, number of renewals, the share bound, a chart of premium by carrier, and the renewals table. Add a form to add a renewal (client, carrier, premium) that updates all of it.\n\nRenewals (policy, client, carrier, line, premium, renewal date, status):\n${HR.rows.map((r) => `${r.policy}, ${r.client}, ${r.carrier}, ${r.line}, ${usd(r.premium)}, ${iso(r.day)}, ${r.status}`).join("\n")}`,
    checks: [
      { label: `total premium (${usd(HR.premium)})`, shows: [money(HR.premium)] },
      { label: `Chubb shows ${usd(HR.chubb)}`, steps: [{ press: press("Chubb") }], shows: [money(HR.chubb)] },
      { label: `adding ${usd(HR.add.premium)} makes ${usd(HR.premium + HR.add.premium)}`, steps: [{ type: [0, HR.add.client] }, { type: [1, String(HR.add.premium)] }, { press: ADD }], shows: [money(HR.premium + HR.add.premium)] },
    ],
    followUp: { request: "now only Q3", checks: [{ label: `Q3 premium (${usd(HR.q3)}, ${HR.q3Count} renewals)`, shows: [money(HR.q3), count(HR.q3Count)], hides: [money(HR.premium)] }] },
  },
  {
    id: "hard-deals", level: "hard", audience: "enterprise", wording: "vague", category: "dashboard",
    request: `pipeline screen for the team. filter by owner and stage, total value, chart by stage, deals table, form to add a deal\n\n${HD.rows.map((r) => `${r.id} ${r.account} ${r.owner} ${r.stage} value ${comma(r.value)} cost ${comma(r.cost)} close ${r.close}`).join("\n")}`,
    checks: [
      { label: `total value (${usd(HD.total)}, or ${usd(HD.open)} open)`, shows: [anyOf(money(HD.total), money(HD.open))] },
      { label: `Marco shows ${usd(HD.marcoTotal)} (or ${usd(HD.marcoOpen)} open)`, steps: [{ press: press("Marco") }], shows: [anyOf(money(HD.marcoTotal), money(HD.marcoOpen))] },
    ],
    followUp: {
      request: "add a column for margin",
      checks: [
        { label: "has a margin column", shows: [/margin/i] },
        { label: "shows deals' margins, in dollars or percent", test: (t) => { const s = t.join("\n"); return HD.margins.filter((m) => money(m.dollars).test(s) || pct(m.percent).test(s)).length >= 3; } },
      ],
    },
  },
  {
    id: "hard-tickets", level: "hard", audience: "enterprise", wording: "tidy", category: "dashboard",
    request: `Build a support queue screen. Priority and agent filters drive everything: open tickets, average first reply time in hours, urgent open tickets, a chart of tickets per agent, and the tickets table. Add a form to add a ticket (subject, customer, priority) that updates all of it; new tickets are Open.\n\nTickets (id, subject, customer, priority, agent, status, first reply hours):\n${HK.rows.map((r) => `${r.id}, ${r.subject}, ${r.customer}, ${r.priority}, ${r.agent}, ${r.status}, ${r.replyHours}`).join("\n")}`,
    checks: [
      { label: `open tickets (${HK.open}) and average first reply (${HK.avgReply.toFixed(1)} h)`, shows: [count(HK.open), num(HK.avgReply, [1, 2])] },
      // Not the urgent open count: the screen shows that before any filter.
      { label: `Urgent shows its average first reply (${HK.urgentReply.map((h) => `${h.toFixed(1)} h`).join(" or ")})`, steps: [{ press: press("Urgent") }], shows: [anyOf(...HK.urgentReply.map((h) => num(h, [1, 2])))] },
      { label: `adding a ticket makes ${HK.open + 1} open`, steps: [{ type: [0, "Printer offline"] }, { type: [1, "Lakeside Dental"] }, { press: ADD }], shows: [count(HK.open + 1)] },
    ],
    followUp: { request: "now only Ana's tickets", checks: [{ label: `Ana's open tickets (${HK.anaOpen}), no one else's`, shows: [count(HK.anaOpen)], hides: lits(HK.notAna) }] },
  },
  {
    id: "hard-headcount", level: "hard", audience: "enterprise", wording: "vague", category: "dashboard",
    request: `headcount screen. filter by dept + location, show headcount, payroll, avg salary, chart by dept, the people table, and a way to add a new hire (name, salary)\n\n${HF.rows.map((r) => `${r.name}, ${r.dept}, ${r.location}, ${comma(r.salary)}, since ${r.start}`).join("\n")}`,
    checks: [
      { label: `headcount (${HF.headcount}) and payroll (${usd(HF.payroll)})`, shows: [count(HF.headcount), money(HF.payroll)] },
      { label: `Sales shows ${HF.sales} people and ${usd(HF.salesPayroll)}`, steps: [{ press: press("Sales") }], shows: [count(HF.sales), money(HF.salesPayroll)] },
      { label: `a new hire makes ${HF.headcount + 1} people and ${usd(HF.payroll + HF.add.salary)}`, steps: [{ type: [0, HF.add.name] }, { type: [1, String(HF.add.salary)] }, { press: ADD }], shows: [count(HF.headcount + 1), money(HF.payroll + HF.add.salary)] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Extreme: about 200 messy rows, passed by name

const EB = D.extremeBudget, ET = D.extremeTrip, EW = D.extremeWorkouts, ES = D.extremeStudy, EC = D.extremeClaims, ER = D.extremeRenewals, EV = D.extremeBva, EK = D.extremeTickets;
// The screens with the rows: anything pressable whose text holds the list's word.
const toTx = goTo("transactions?"), toExpenses = goTo("expenses?"), toSessions = goTo("sessions?|workouts?");
const toLog = goTo("log|sessions?"), toClaims = goTo("claims?"), toRenewals = goTo("renewals?|polic(y|ies)");
const toLedger = goTo("ledger|lines?"), toTickets = goTo("tickets?");
// What each list's rows may show, and how to know one on screen.
const rowsEB: RowSpec = { rows: EB.clean, fields: { id: "text", day: "date", merchant: "text", category: "text", account: "text", amount: "num" }, keys: ["id"], press: ["id", "merchant", "day"] };
const rowsET: RowSpec = { rows: ET.clean, fields: { id: "text", day: "date", who: "text", city: "text", category: "text", amount: "num", note: "text" }, keys: ["id"], press: ["id", "day"] };
const rowsEW: RowSpec = { rows: EW.clean, fields: { id: "text", day: "date", type: "text", minutes: "num", km: "num", hr: "num" }, keys: ["id"], press: ["id", "day"] };
const rowsES: RowSpec = { rows: ES.clean, fields: { id: "text", day: "date", subject: "text", topic: "text", minutes: "hours", focus: "num" }, keys: ["id"], press: ["id", "day", "topic"] };
const rowsEC: RowSpec = { rows: EC.clean, fields: { id: "text", day: "date", policy: "text", claimant: "text", type: "text", claimed: "num", paid: "num", status: "text", adjuster: "text" }, keys: ["id", "policy"], press: ["id", "policy", "claimant"] };
const rowsER: RowSpec = { rows: ER.clean, fields: { id: "text", client: "text", carrier: "text", line: "text", premium: "num", day: "date", status: "text", broker: "text" }, keys: ["id", "client"], press: ["id", "client", "day"] };
const rowsEV: RowSpec = { rows: EV.clean, fields: { id: "text", cc: "text", dept: "text", account: "text", budget: "num", actual: "num" }, keys: ["id"], press: ["id"] };
const rowsEK: RowSpec = { rows: EK.clean, fields: { id: "text", day: "date", customer: "text", subject: "text", agent: "text", status: "text", reply: "num" }, keys: ["id"], press: ["id", "subject", "customer"] };
const extreme: RealTask[] = [
  {
    id: "ext-budget", level: "extreme", audience: "personal", wording: "tidy", category: "app",
    request: `Build a personal finance app over my transactions for 2026, with an overview screen (total spent, totals by category and by month), a transactions screen (a table with pages, a multi-select category filter and an account filter; nothing picked means all), and a detail view when I press a transaction. Count blank categories as Uncategorized and skip blank amounts.\n\n${supplied(EB.data, false)}\n\n${MESSY}`,
    data: dataOf(EB.data),
    checks: [
      { label: `total spent (${usd(EB.total)})`, shows: [money(EB.total)] },
      picks(`picking Groceries shows its figures (${usd(EB.groceries)}, or ${EB.groceryCounts.join(" or ")} transactions)`, toTx, "Groceries", money(EB.groceries), tally(EB.groceryCounts, "transactions?|groceries")),
      pages(toTx, rowsEB),
      detail(toTx, rowsEB),
    ],
    followUp: { request: "now only Q3", checks: [{ label: `Q3 total (${usd(EB.q3)}), not the year's`, shows: [money(EB.q3)], hides: [money(EB.total)] }] },
  },
  {
    id: "ext-trip", level: "extreme", audience: "personal", wording: "vague", category: "app",
    request: `big group trip, portugal + spain. need who paid what, who owes who (split even), totals by city and category, filter by city (can pick more than one, none picked = all), and the expenses list with pages + tap one for details. some amounts are blank, skip those\n\n${supplied(ET.data, true)}\n\nnames are typed kinda inconsistently, dates w/ slashes are month/day`,
    data: dataOf(ET.data),
    checks: [
      { label: `total (${usd(ET.total)})`, shows: [money(ET.total)] },
      { label: "what each person paid", shows: ET.people.map((p) => money(ET.paid[p] ?? 0)) },
      picks(`picking Lisbon shows its figures (${usd(ET.lisbon)}, or ${ET.lisbonCounts.join(" or ")} expenses)`, toExpenses, "Lisbon", money(ET.lisbon), tally(ET.lisbonCounts, "expenses?|lisbon")),
      pages(toExpenses, rowsET),
    ],
  },
  {
    id: "ext-workouts", level: "extreme", audience: "personal", wording: "tidy", category: "app",
    request: `Build a training app over my 2026 workout sessions: a summary screen (total minutes, sessions and minutes by type and by month), a sessions screen (a table with pages and a multi-select type filter; nothing picked means all), and a detail view when I press a session. Skip blank minutes.\n\n${supplied(EW.data, false)}\n\n${MESSY} Minutes may be written as 45, 45 min, 45m or 0:45.`,
    data: dataOf(EW.data),
    checks: [
      { label: `total minutes (${comma(EW.minutes)})`, shows: [count(EW.minutes)] },
      picks(`picking Run shows its figures (${comma(EW.runMinutes)} min, or ${EW.runCounts.join(" or ")} sessions)`, toSessions, "Run", count(EW.runMinutes), tally(EW.runCounts, "sessions?|runs?|workouts?")),
      pages(toSessions, rowsEW),
      detail(toSessions, rowsEW),
    ],
    followUp: {
      request: "add a column for pace on runs (minutes per km)",
      checks: [
        { label: "has a pace column", shows: [/pace/i] },
        {
          label: "shows runs' paces, as decimals or m:ss",
          test: (t) => {
            const s = t.join("\n");
            const mss = (p: number) => { const sec = Math.round(p * 60); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
            const ok = (p: number) => num(p, [2, 1]).test(s) || new RegExp(`\\b${mss(p)}\\b`).test(s);
            return EW.paces.filter(ok).length >= 3;
          },
        },
      ],
    },
  },
  {
    id: "ext-study", level: "extreme", audience: "personal", wording: "vague", category: "app",
    request: `my study log since january, kind of a mess. want hours per subject and per month, a filter where i can pick subjects (none picked = all), the log with pages, and tap a session to see it. skip blank minutes\n\n${supplied(ES.data, true)}\n\nsubject names arent consistent, minutes are written different ways, dates w/ slashes are month/day`,
    data: dataOf(ES.data),
    checks: [
      { label: `total hours (${ES.hours.toFixed(1)})`, shows: [num(ES.hours, [1, 0, 2])] },
      picks(`picking Chemistry shows its figures (${ES.chemistry.toFixed(1)} h, or ${ES.chemistryCounts.join(" or ")} sessions)`, toLog, "Chemistry", num(ES.chemistry, [1, 0, 2]), count(Math.round(ES.chemistry * 60)), tally(ES.chemistryCounts, "sessions?|entries|chemistry")),
      pages(toLog, rowsES),
      detail(toLog, rowsES),
    ],
  },
  {
    id: "ext-claims", level: "extreme", audience: "enterprise", wording: "tidy", category: "app",
    request: `Build a claims review app: an overview screen (total claimed and paid, claims and amounts by status, by type and by adjuster), a claims screen (a table with pages, and multi-select filters for type and status; nothing picked means all), and a detail view when I press a claim. Blank amount_paid means nothing paid yet.\n\n${supplied(EC.data, false)}\n\n${MESSY} Status casing is inconsistent.`,
    data: dataOf(EC.data),
    checks: [
      { label: `total claimed (${usd(EC.claimed)})`, shows: [money(EC.claimed)] },
      picks(`picking Auto shows its figures (${usd(EC.auto)} claimed, or ${EC.autoCount} claims)`, toClaims, "Auto", money(EC.auto), tally([EC.autoCount], "claims?|auto")),
      pages(toClaims, rowsEC),
      detail(toClaims, rowsEC),
    ],
    followUp: { request: "now only claims over $10,000", checks: [{ label: `${EC.bigCount} claims, ${usd(EC.bigClaimed)} claimed`, shows: [count(EC.bigCount), money(EC.bigClaimed)], hides: [money(EC.claimed)] }] },
  },
  {
    id: "ext-renewals", level: "extreme", audience: "enterprise", wording: "vague", category: "app",
    request: `renewals book for 2026. premium by carrier, line and month, filters for carrier + status (multi, none picked = all), renewals list with pages, click one for details\n\n${supplied(ER.data, true)}\n\ncarrier names are typed inconsistently, some premiums blank, dates w/ slashes are month/day`,
    data: dataOf(ER.data),
    checks: [
      { label: `total premium (${usd(ER.premium)})`, shows: [money(ER.premium)] },
      picks(`picking Chubb shows its figures (${usd(ER.chubb)}, or ${ER.chubbCounts.join(" or ")} renewals)`, toRenewals, "Chubb", money(ER.chubb), tally(ER.chubbCounts, "renewals?|polic(y|ies)|chubb")),
      pages(toRenewals, rowsER),
      detail(toRenewals, rowsER),
    ],
    followUp: { request: "now only Q3", checks: [{ label: `Q3 premium (${usd(ER.q3)}), not the year's`, shows: [money(ER.q3)], hides: [money(ER.premium)] }] },
  },
  {
    id: "ext-bva", level: "extreme", audience: "enterprise", wording: "tidy", category: "app",
    request: `Build a budget vs actual app for January to June: an overview screen (total budget, actual and variance, grouped by department and by month), a ledger screen (a table with pages and multi-select filters for department and account; nothing picked means all), and a detail view when I press a line. A blank actual means not booked yet; count it as zero.\n\n${supplied(EV.data, false)}\n\nThe data is messy: some cells are blank, and months and amounts come in mixed formats.`,
    data: dataOf(EV.data),
    checks: [
      { label: `totals (${usd(EV.budget)} budget, ${usd(EV.actual)} actual)`, shows: [money(EV.budget), money(EV.actual)] },
      picks(`picking Marketing shows its figures (${usd(EV.mktBudget)} budget, ${usd(EV.mktActual)} actual, or ${EV.mktCount} lines)`, toLedger, "Marketing", money(EV.mktBudget), money(EV.mktActual), tally([EV.mktCount], "lines?|entries|marketing")),
      pages(toLedger, rowsEV),
    ],
  },
  {
    id: "ext-tickets", level: "extreme", audience: "enterprise", wording: "vague", category: "app",
    request: `support tickets since july. open count, tickets by priority + agent, avg first reply, filter by priority (multi, none picked = all), the ticket list w/ pages, click one for details\n\n${supplied(EK.data, true)}\n\npriority casing is all over the place, dates w/ slashes are month/day`,
    data: dataOf(EK.data),
    checks: [
      { label: `open tickets (${EK.open})`, shows: [count(EK.open)] },
      // The urgent open count alone is too small to tell from a page number, so only the urgent count counts.
      picks(`picking Urgent shows its count (${EK.urgentCounts[0]} tickets)`, toTickets, "Urgent", tally(EK.urgentCounts.slice(0, 1), "tickets?|urgent")),
      pages(toTickets, rowsEK),
      detail(toTickets, rowsEK),
    ],
  },
];

export const realTasks: RealTask[] = [...low, ...medium, ...hard, ...extreme];
