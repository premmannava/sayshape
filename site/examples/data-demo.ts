/**
 * The landing page's "ask your data" demo: three made-up spreadsheets, two
 * questions each, the SayShape answer a model would write, and the plain
 * paragraph a chatbot without SayShape would write instead.
 *
 * Plain data with no browser or Vue imports, so test/data-demo.test.ts can
 * check every spec with the real engine against the same rows.
 *
 * Every row is generated from a fixed seed, so everyone sees the same
 * numbers. Names and figures are fictional. The plain answers are worked out
 * from the rows here, so they always agree with what the engine draws.
 */

export type Row = Record<string, string | number>;

export interface Dataset {
  id: string;
  /** What the spreadsheet is called, and the state name the specs read it by. */
  name: string;
  state: string;
  columns: readonly string[];
  rows: readonly Row[];
}

export interface Question {
  text: string;
  /** The SayShape answer a model writes. It reads the dataset by its state name and never copies rows. */
  spec: string;
  /** What a chatbot without SayShape answers, after being sent every row. */
  plain: string;
  /** The first item the answer ranks: the callout leads with it and the plain answer names it. */
  lead: string;
}

export interface DemoEntry {
  dataset: Dataset;
  questions: readonly Question[];
}

/** How many rows the model sees with SayShape: the column names and these. */
export const SAMPLE_ROWS = 3;

// --- A small seeded random source, so the rows are the same on every load ---

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const between = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
/** Like between, but most values sit near lo and only a few reach hi, the way waiting times do. */
const skewed = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() ** 2.2 * (hi - lo + 1));

const SURNAMES = [
  "Moreau", "Okafor", "Ibrahim", "Reyes", "Patel", "Chen", "Novak", "Silva", "Walsh", "Park", "Nair", "Haddad",
  "Ortiz", "Tanaka", "Mensah", "Costa", "Kim", "Adeyemi", "Dubois", "Rossi", "Lowe", "Brennan", "Sato", "Kowalski",
  "Fischer", "Diaz", "Ahmed", "Larsen", "Murphy", "Singh", "Ivanova", "Bauer", "Torres", "Nguyen", "Hughes", "Oyelaran",
  "Varga", "Lindqvist", "Mbeki", "Romero", "Hayes", "Kaur", "Petrov", "Grant", "Castillo", "Yilmaz", "Abbott", "Ferreira",
];
const INITIALS = "ABCDEFGHJKLMNPRSTVY";

/** 48 people with different names: an initial and a surname. */
function people(rand: () => number, count: number): string[] {
  return SURNAMES.slice(0, count).map((s) => `${pick(rand, INITIALS.split(""))}. ${s}`);
}

// --- The spreadsheets ---------------------------------------------------------

function salesRows(): Row[] {
  const rand = seeded(7);
  const regions = ["North", "South", "East", "West"];
  return people(rand, 48).map((rep, i) => {
    const region = regions[i % 4]!;
    const target = between(rand, 18, 34) * 5000;
    // West has a harder quarter, so the question about who is behind has an answer worth seeing.
    const pct = region === "West" ? between(rand, 58, 104) : between(rand, 72, 118);
    const revenue = Math.round((target * pct) / 100 / 100) * 100;
    return { rep, region, revenue, target, pct_target: Math.round((revenue / target) * 100) };
  });
}

function ticketRows(): Row[] {
  const rand = seeded(11);
  const categories = ["Billing", "Login", "Shipping", "Returns", "Account"];
  const rows: Row[] = [];
  for (let i = 0; i < 1240; i++) {
    const r = rand();
    const priority = r < 0.08 ? "Urgent" : r < 0.26 ? "High" : r < 0.8 ? "Normal" : "Low";
    // Urgent tickets stay open more often, so the question about them has a list worth showing.
    const open = rand() < (priority === "Urgent" ? 0.16 : 0.06);
    rows.push({
      id: `#${4000 + i}`,
      category: pick(rand, categories),
      priority,
      status: open ? "Open" : "Closed",
      hours_open: open ? skewed(rand, 2, 120) : skewed(rand, 1, 48),
    });
  }
  return rows;
}

function pipelineRows(): Row[] {
  const rand = seeded(23);
  const roles = ["Data Analyst", "Product Designer", "Sales Lead", "Backend Engineer", "Support Lead"];
  const sources = ["Referral", "LinkedIn", "Careers page", "Agency"];
  const stages: Array<[string, number, number, number]> = [
    // stage, how many, fewest and most days in it
    ["Applied", 140, 0, 9], ["Screen", 70, 1, 14], ["Interview", 61, 2, 36],
    ["Offer", 14, 1, 16], ["Hired", 9, 0, 0], ["Rejected", 18, 0, 0],
  ];
  const used = new Set<string>();
  const name = () => {
    for (;;) {
      const n = `${pick(rand, INITIALS.split(""))}. ${pick(rand, SURNAMES)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  };
  const rows: Row[] = [];
  for (const [stage, count, lo, hi] of stages) {
    for (let i = 0; i < count; i++) {
      rows.push({ candidate: name(), role: pick(rand, roles), source: pick(rand, sources), stage, days_in_stage: skewed(rand, lo, hi) });
    }
  }
  // Mixed up, so the sample rows aren't all from one stage.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  return rows;
}

// --- Working out the plain answers from the rows ----------------------------

const num = (r: Row, f: string) => Number(r[f]);
const str = (r: Row, f: string) => String(r[f]);
const where = (rows: readonly Row[], f: string, v: string) => rows.filter((r) => r[f] === v);
const sortBy = (rows: readonly Row[], f: string, dir: "asc" | "desc" = "asc") =>
  [...rows].sort((a, b) => (dir === "asc" ? 1 : -1) * (num(a, f) - num(b, f)));
const sumOf = (rows: readonly Row[], f: string) => rows.reduce((t, r) => t + num(r, f), 0);
const avgOf = (rows: readonly Row[], f: string) => (rows.length ? sumOf(rows, f) / rows.length : 0);
const group = (n: number) => n.toLocaleString("en-US");
const dollars = (n: number) => `$${group(n)}`;
const millions = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;
const listOf = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function salesQuestions(rows: readonly Row[]): Question[] {
  const behind = sortBy(rows, "pct_target").slice(0, 5);
  const top = sortBy(rows, "revenue", "desc").slice(0, 5);
  const total = sumOf(rows, "revenue");
  const avg = Math.round(avgOf(rows, "pct_target"));
  const westLow = behind.filter((r) => r.region === "West").length;
  return [
    {
      text: "Who is furthest behind target?",
      lead: str(behind[0]!, "rep"),
      spec: `derive behind={take(sort(sales, 'pct_target'), 5)}
row
  stat label="Q3 revenue" value="{compact(sum(sales, 'revenue'), 'USD')}"
  stat label="Average % of target" value="{round(avg(sales, 'pct_target'))}%"
  stat label="Reps" value="{len(sales)}"
callout "{first(behind).rep} is at {first(behind).pct_target}% of target" detail="The five lowest are below" icon=true
chart "Furthest behind target (%)" kind=hbar items=behind x=rep y=pct_target
table items=behind
  table-column "Rep" field=rep
  table-column "Region" field=region
  table-column "Revenue" field=revenue format=money`,
      plain: `Looking at the data you shared, the reps furthest behind target are ${listOf(behind.map((r) => `${str(r, "rep")} (${num(r, "pct_target")}%, ${str(r, "region")})`))}. Across all ${rows.length} reps, the team brought in about ${millions(total)} in Q3, averaging ${avg}% of target.${westLow >= 2 ? ` ${["", "", "Two", "Three", "Four", "All five"][westLow]} of the five lowest are in the West region, which may be worth a closer look.` : ""}`,
    },
    {
      text: "Who are the top 5 reps?",
      lead: str(top[0]!, "rep"),
      spec: `derive top={take(sort(sales, 'revenue', 'desc'), 5)}
row
  stat label="Q3 revenue" value="{compact(sum(sales, 'revenue'), 'USD')}"
  stat label="Top rep" value="{compact(first(top).revenue, 'USD')}"
  stat label="Reps" value="{len(sales)}"
callout "{first(top).rep} leads with {compact(first(top).revenue, 'USD')}" detail="{first(top).pct_target}% of target" icon=true
chart "Top 5 reps by revenue" kind=hbar items=top x=rep y=revenue format=money
table items=top
  table-column "Rep" field=rep
  table-column "Region" field=region
  table-column "Revenue" field=revenue format=money`,
      plain: `The top five reps by Q3 revenue are ${listOf(top.map((r) => `${str(r, "rep")} (${dollars(num(r, "revenue"))}, ${str(r, "region")})`))}. ${str(top[0]!, "rep")} finished at ${num(top[0]!, "pct_target")}% of target. Together the team brought in about ${millions(total)} across ${rows.length} reps.`,
    },
  ];
}

function ticketQuestions(rows: readonly Row[]): Question[] {
  const open = where(rows, "status", "Open");
  const urgent = where(open, "priority", "Urgent");
  const oldestUrgent = sortBy(urgent, "hours_open", "desc").slice(0, 5);
  const oldestOpen = sortBy(open, "hours_open", "desc").slice(0, 5);
  const closed = where(rows, "status", "Closed").length;
  return [
    {
      text: "Which urgent tickets have waited longest?",
      lead: str(oldestUrgent[0]!, "id"),
      spec: `derive urgent={filter(filter(tickets, 'status', 'Open'), 'priority', 'Urgent')}
derive oldest={take(sort(urgent, 'hours_open', 'desc'), 5)}
row
  stat label="Open tickets" value="{count(tickets, 'status', 'Open')}"
  stat label="Open and urgent" value="{len(urgent)}"
  stat label="Average hours, urgent" value="{round(avg(urgent, 'hours_open'))}"
callout "Ticket {first(oldest).id} has waited {first(oldest).hours_open} hours" detail="{first(oldest).category} · Urgent" icon=true
chart "Longest-waiting urgent tickets (hours)" kind=hbar items=oldest x=id y=hours_open
table items=oldest
  table-column "Ticket" field=id
  table-column "Category" field=category
  table-column "Hours open" field=hours_open`,
      plain: `There are ${open.length} open tickets, and ${urgent.length} of them are urgent. The urgent ones that have waited longest are ${listOf(oldestUrgent.map((r) => `${str(r, "id")} (${str(r, "category")}, ${num(r, "hours_open")} hours)`))}. On average, open urgent tickets have been waiting about ${Math.round(avgOf(urgent, "hours_open"))} hours.`,
    },
    {
      text: "How many tickets are still open?",
      lead: `${open.length} tickets are still open`,
      spec: `derive open={filter(tickets, 'status', 'Open')}
derive oldest={take(sort(open, 'hours_open', 'desc'), 5)}
row
  stat label="Open" value="{len(open)}"
  stat label="Closed" value="{number(count(tickets, 'status', 'Closed'))}"
  stat label="Urgent and open" value="{count(open, 'priority', 'Urgent')}"
callout "{len(open)} tickets are still open" detail="{count(open, 'priority', 'Urgent')} of them are urgent" icon=true
chart "Oldest open tickets (hours)" kind=hbar items=oldest x=id y=hours_open
table items=oldest
  table-column "Ticket" field=id
  table-column "Priority" field=priority
  table-column "Hours open" field=hours_open`,
      plain: `Out of ${group(rows.length)} tickets, ${open.length} are still open and ${group(closed)} are closed. Of the open ones, ${urgent.length} are marked urgent. The oldest open tickets are ${listOf(oldestOpen.map((r) => `${str(r, "id")} (${num(r, "hours_open")} hours)`))}.`,
    },
  ];
}

function pipelineQuestions(rows: readonly Row[]): Question[] {
  const interviewing = where(rows, "stage", "Interview");
  const waiting = sortBy(interviewing, "days_in_stage", "desc").slice(0, 5);
  const offers = sortBy(where(rows, "stage", "Offer"), "days_in_stage", "desc");
  const hired = where(rows, "stage", "Hired").length;
  return [
    {
      text: "Who is stuck in interviews?",
      lead: str(waiting[0]!, "candidate"),
      spec: `derive interviewing={filter(pipeline, 'stage', 'Interview')}
derive waiting={take(sort(interviewing, 'days_in_stage', 'desc'), 5)}
row
  stat label="Candidates" value="{len(pipeline)}"
  stat label="In interviews" value="{len(interviewing)}"
  stat label="Average days in interview" value="{round(avg(interviewing, 'days_in_stage'))}"
callout "{first(waiting).candidate} has waited {first(waiting).days_in_stage} days" detail="{first(waiting).role} · {first(waiting).source}" icon=true
chart "Longest in interviews (days)" kind=hbar items=waiting x=candidate y=days_in_stage
table items=waiting
  table-column "Candidate" field=candidate
  table-column "Role" field=role
  table-column "Days" field=days_in_stage`,
      plain: `Of ${rows.length} candidates, ${interviewing.length} are in the interview stage, and they have been there for about ${Math.round(avgOf(interviewing, "days_in_stage"))} days on average. The ones waiting longest are ${listOf(waiting.map((r) => `${str(r, "candidate")} (${str(r, "role")}, ${num(r, "days_in_stage")} days)`))}.`,
    },
    {
      text: "Which offers are still waiting?",
      lead: `${offers.length} offers are waiting`,
      spec: `derive offers={sort(filter(pipeline, 'stage', 'Offer'), 'days_in_stage', 'desc')}
derive oldest={take(offers, 5)}
row
  stat label="Offers out" value="{len(offers)}"
  stat label="Hired so far" value="{count(pipeline, 'stage', 'Hired')}"
  stat label="Average days on offer" value="{round(avg(offers, 'days_in_stage'))}"
callout "{len(offers)} offers are waiting for an answer" detail="The oldest has waited {first(offers).days_in_stage} days" icon=true
chart "Oldest open offers (days)" kind=hbar items=oldest x=candidate y=days_in_stage
table items=oldest
  table-column "Candidate" field=candidate
  table-column "Role" field=role
  table-column "Source" field=source`,
      plain: `There are ${offers.length} offers out and ${hired} hires so far. Offers have been waiting about ${Math.round(avgOf(offers, "days_in_stage"))} days on average. The oldest are ${listOf(offers.slice(0, 5).map((r) => `${str(r, "candidate")} (${str(r, "role")}, ${num(r, "days_in_stage")} days)`))}.`,
    },
  ];
}

function entry(dataset: Omit<Dataset, "columns">, questions: (rows: readonly Row[]) => Question[]): DemoEntry {
  return { dataset: { ...dataset, columns: Object.keys(dataset.rows[0] ?? {}) }, questions: questions(dataset.rows) };
}

export const demo: readonly DemoEntry[] = [
  entry({ id: "sales", name: "Q3 sales by rep", state: "sales", rows: salesRows() }, salesQuestions),
  entry({ id: "tickets", name: "Support tickets", state: "tickets", rows: ticketRows() }, ticketQuestions),
  entry({ id: "pipeline", name: "Hiring pipeline", state: "pipeline", rows: pipelineRows() }, pipelineQuestions),
];

/** Words in a plain answer, for the "the AI wrote" line. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
