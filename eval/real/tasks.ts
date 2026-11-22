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
import { anyOf, comma, iso, money, num, pct, samples, usd, type Supplied } from "./data";

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
/** Extreme level: go to the screen with the rows first, if it is a separate one. */
const goTo = (names: string): Step => ({ press: new RegExp(`^\\s*(${names})\\s*$`, "i"), optional: true });
/** A whole count, not part of a bigger number. */
const count = (n: number) => num(n, [0]);
const ADD = /^\s*(\+\s*)?(add|save|log|submit|create|record)\b/i;
const NEXT = /^\s*(next( page)?|load more|show more|more|›|»|>|→|2)\s*$/i;

/** How many different ids this pattern finds in the visible text. */
const ids = (text: string[], re: RegExp) => new Set(text.join("\n").match(new RegExp(re.source, "g")) ?? []).size;

/** After a filter: some rows are visible, and every visible id is one of these. */
const only = (idRe: RegExp, allowed: readonly string[]) => (after: string[]) => {
  const seen = new Set(after.join("\n").match(new RegExp(idRe.source, "g")) ?? []);
  return seen.size > 0 && [...seen].every((id) => allowed.includes(id));
};
/** Extreme level: a first page of rows, and pressing next shows something else. */
const pages = (screen: Step, idRe: RegExp, rows: number): TaskCheck => ({
  label: `shows a page of the ${rows} rows, and next moves on`,
  steps: [screen, { press: NEXT }],
  // "before" is the fresh screen, so the page is counted after: fewer ids than rows, and next changed something.
  test: (after, before) => {
    const shown = ids(after, idRe);
    return shown > 0 && shown < rows && after.join("\n") !== before.join("\n");
  },
});
/** Extreme level: pressing a row's id opens something about it. */
const detail = (screen: Step, idRe: RegExp): TaskCheck => ({ label: "pressing a row opens its detail", steps: [screen, { press: idRe }], changes: true });
/** Extreme level: picking one value in a filter leaves only its rows. */
const picks = (label: string, screen: Step, value: string, idRe: RegExp, allowed: readonly string[]): TaskCheck => ({ label, steps: [screen, { press: press(value) }], test: only(idRe, allowed) });

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
      { label: "Urgent shows only urgent tickets", steps: [{ press: press("Urgent") }], hides: [lit(HK.lowSubject)], test: only(/#\d{4}/, HK.urgentIds) },
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
// The screens with the rows, by the names a model is likely to give them.
const toTx = goTo("transactions|all transactions"), toExpenses = goTo("expenses|all expenses|list"), toSessions = goTo("sessions|all sessions|log");
const toLog = goTo("log|study log|sessions"), toClaims = goTo("claims|all claims"), toRenewals = goTo("renewals|all renewals|list|policies");
const toLedger = goTo("ledger|lines"), toTickets = goTo("tickets|all tickets|list");
const extreme: RealTask[] = [
  {
    id: "ext-budget", level: "extreme", audience: "personal", wording: "tidy", category: "app",
    request: `Build a personal finance app over my transactions for 2026, with an overview screen (total spent, totals by category and by month), a transactions screen (a table with pages, a multi-select category filter and an account filter; nothing picked means all), and a detail view when I press a transaction. Count blank categories as Uncategorized and skip blank amounts.\n\n${supplied(EB.data, false)}\n\n${MESSY}`,
    data: dataOf(EB.data),
    checks: [
      { label: `total spent (${usd(EB.total)})`, shows: [money(EB.total)] },
      picks("picking Groceries leaves only groceries", toTx, "Groceries", /TX-\d{4}/, EB.groceryIds),
      pages(toTx, /TX-\d{4}/, 200),
      detail(toTx, /TX-\d{4}/),
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
      picks("picking Lisbon leaves only Lisbon", toExpenses, "Lisbon", /E-\d{3}/, ET.lisbonIds),
      pages(toExpenses, /E-\d{3}/, 200),
    ],
  },
  {
    id: "ext-workouts", level: "extreme", audience: "personal", wording: "tidy", category: "app",
    request: `Build a training app over my 2026 workout sessions: a summary screen (total minutes, sessions and minutes by type and by month), a sessions screen (a table with pages and a multi-select type filter; nothing picked means all), and a detail view when I press a session. Skip blank minutes.\n\n${supplied(EW.data, false)}\n\n${MESSY} Minutes may be written as 45, 45 min, 45m or 0:45.`,
    data: dataOf(EW.data),
    checks: [
      { label: `total minutes (${comma(EW.minutes)})`, shows: [count(EW.minutes)] },
      picks("picking Run leaves only runs", toSessions, "Run", /S-\d{3}/, EW.runIds),
      pages(toSessions, /S-\d{3}/, 200),
      detail(toSessions, /S-\d{3}/),
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
      picks("picking Chemistry leaves only chemistry", toLog, "Chemistry", /L-\d{3}/, ES.chemistryIds),
      pages(toLog, /L-\d{3}/, 200),
      detail(toLog, /L-\d{3}/),
    ],
  },
  {
    id: "ext-claims", level: "extreme", audience: "enterprise", wording: "tidy", category: "app",
    request: `Build a claims review app: an overview screen (total claimed and paid, claims and amounts by status, by type and by adjuster), a claims screen (a table with pages, and multi-select filters for type and status; nothing picked means all), and a detail view when I press a claim. Blank amount_paid means nothing paid yet.\n\n${supplied(EC.data, false)}\n\n${MESSY} Status casing is inconsistent.`,
    data: dataOf(EC.data),
    checks: [
      { label: `total claimed (${usd(EC.claimed)})`, shows: [money(EC.claimed)] },
      picks("picking Auto leaves only auto claims", toClaims, "Auto", /CLM-\d{5}/, EC.autoIds),
      pages(toClaims, /CLM-\d{5}/, 200),
      detail(toClaims, /CLM-\d{5}/),
    ],
    followUp: { request: "now only claims over $10,000", checks: [{ label: `${EC.bigCount} claims, ${usd(EC.bigClaimed)} claimed`, shows: [count(EC.bigCount), money(EC.bigClaimed)], hides: [money(EC.claimed)] }] },
  },
  {
    id: "ext-renewals", level: "extreme", audience: "enterprise", wording: "vague", category: "app",
    request: `renewals book for 2026. premium by carrier, line and month, filters for carrier + status (multi, none picked = all), renewals list with pages, click one for details\n\n${supplied(ER.data, true)}\n\ncarrier names are typed inconsistently, some premiums blank, dates w/ slashes are month/day`,
    data: dataOf(ER.data),
    checks: [
      { label: `total premium (${usd(ER.premium)})`, shows: [money(ER.premium)] },
      picks("picking Chubb leaves only Chubb", toRenewals, "Chubb", /RN-\d{4}/, ER.chubbIds),
      pages(toRenewals, /RN-\d{4}/, 200),
      detail(toRenewals, /RN-\d{4}/),
    ],
    followUp: { request: "now only Q3", checks: [{ label: `Q3 premium (${usd(ER.q3)}), not the year's`, shows: [money(ER.q3)], hides: [money(ER.premium)] }] },
  },
  {
    id: "ext-bva", level: "extreme", audience: "enterprise", wording: "tidy", category: "app",
    request: `Build a budget vs actual app for January to June: an overview screen (total budget, actual and variance, grouped by department and by month), a ledger screen (a table with pages and multi-select filters for department and account; nothing picked means all), and a detail view when I press a line. A blank actual means not booked yet; count it as zero.\n\n${supplied(EV.data, false)}\n\nThe data is messy: some cells are blank, and months and amounts come in mixed formats.`,
    data: dataOf(EV.data),
    checks: [
      { label: `totals (${usd(EV.budget)} budget, ${usd(EV.actual)} actual)`, shows: [money(EV.budget), money(EV.actual)] },
      picks("picking Marketing leaves only marketing lines", toLedger, "Marketing", /GL-\d{4}/, EV.mktIds),
      pages(toLedger, /GL-\d{4}/, 200),
    ],
  },
  {
    id: "ext-tickets", level: "extreme", audience: "enterprise", wording: "vague", category: "app",
    request: `support tickets since july. open count, tickets by priority + agent, avg first reply, filter by priority (multi, none picked = all), the ticket list w/ pages, click one for details\n\n${supplied(EK.data, true)}\n\npriority casing is all over the place, dates w/ slashes are month/day`,
    data: dataOf(EK.data),
    checks: [
      { label: `open tickets (${EK.open})`, shows: [count(EK.open)] },
      picks(`picking Urgent leaves only the ${EK.urgentIds.length} urgent tickets`, toTickets, "Urgent", /T-\d{4}/, EK.urgentIds),
      pages(toTickets, /T-\d{4}/, 200),
      detail(toTickets, /T-\d{4}/),
    ],
  },
];

export const realTasks: RealTask[] = [...low, ...medium, ...hard, ...extreme];
