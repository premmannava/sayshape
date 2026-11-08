/**
 * Picking the right representation: requests where several answers would
 * work but one shows the data best. Each case describes the data and what
 * the person wants to see, never the element, and grades answers:
 *
 * - best: what shows it best (2 points);
 * - ok: works, but loses something (1 point);
 * - anything else, and the poor list in particular, scores 0.
 *
 * An answer is described by its signatures (see `signatures`): element types,
 * plus `chart:<kind>`, `tree:<kind>`, `meter:<kind>`, `schedule:<view>`,
 * `input:required|email|number|lines`, `select:multiple`, `date-picker:range`,
 * `text:rich` and `tip`. The best signature found wins.
 *
 * All names and figures are fictional. `why` says why the best is best, so
 * the judgement can be argued with case by case.
 */
import type { SayShapeNode } from "../src/types";

export type PickGroup = "chart" | "structure" | "input" | "content";

export interface PickCase {
  id: string;
  group: PickGroup;
  /** The request a person would type; it never names the element. */
  request: string;
  best: string[];
  ok?: string[];
  /** Answers that work against the data (a pie of 14 slices); reported by name. */
  poor?: string[];
  why: string;
  /** The obvious choice isn't the best one. */
  trap?: boolean;
}

export const pickCases: PickCase[] = [
  // ---------------------------------------------------------------- charts
  {
    id: "rank-long-names", group: "chart",
    request: "Our top 10 customers by annual spend: Harborview Regional Medical Center $1.42M, Northwind Logistics International $1.18M, Fieldstone Agricultural Cooperative $960K, Lumen Cinema Group $910K, Riverbend Community Credit Union $870K, Summit Ridge Outdoor Outfitters $640K, Clearwater Municipal Utilities $610K, Juniper & Rye Hospitality $480K, Copperline Construction Partners $455K, Blue Mesa School District $390K.",
    best: ["chart:hbar"], ok: ["chart:bar", "table"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "A ranking with long names reads best as horizontal bars: the names fit on one line each and the order is top to bottom.",
  },
  {
    id: "share-few", group: "chart",
    request: "How did our 2026 sales split across regions? West $820K, East $610K, Central $455K, South $380K.",
    best: ["chart:donut", "chart:pie"], ok: ["chart:hbar", "chart:bar", "chart:treemap"], poor: ["chart:line", "chart:area"],
    why: "Four parts of one whole: a pie or donut shows each share at a glance.",
  },
  {
    id: "share-many", group: "chart", trap: true,
    request: "What share of revenue does each of our 14 product lines bring in? Tents $412K, Packs $388K, Boots $301K, Jackets $276K, Sleeping bags $190K, Stoves $122K, Lamps $98K, Poles $86K, Water filters $71K, Gloves $64K, Hats $52K, Socks $47K, Maps $21K, Gift cards $18K.",
    best: ["chart:treemap", "chart:hbar"], ok: ["chart:bar", "table"], poor: ["chart:pie", "chart:donut"],
    why: "Fourteen parts are too many for a pie (it shows 6 slices, the rest as Other); a treemap or ranked bars keep every line visible.",
  },
  {
    id: "trend-year", group: "chart",
    request: "Monthly revenue for 2026 so far: Jan $182K, Feb $175K, Mar $201K, Apr $214K, May $229K, Jun $246K, Jul $238K, Aug $252K, Sep $267K, Oct $281K. Is it growing?",
    best: ["chart:line", "chart:area"], ok: ["chart:bar", "stat"], poor: ["chart:pie", "chart:donut", "chart:hbar"],
    why: "A trend over ten months is a line: the slope answers whether it's growing.",
  },
  {
    id: "two-series", group: "chart",
    request: "Monthly signups this year against last year: Jan 820 vs 640, Feb 790 vs 610, Mar 910 vs 700, Apr 1,020 vs 760, May 1,140 vs 810, Jun 1,210 vs 880.",
    best: ["chart:line"], ok: ["chart:bar", "chart:area", "table"], poor: ["chart:stacked", "chart:pie", "chart:donut"],
    why: "Two series over the same months compare best as two lines; stacking them would add years that shouldn't be added.",
  },
  {
    id: "mix-over-time", group: "chart",
    request: "Quarterly revenue split into hardware, software and services: Q1 $120K/$210K/$60K, Q2 $130K/$240K/$70K, Q3 $125K/$280K/$85K, Q4 $140K/$320K/$95K. I want to see the total and how the mix changes.",
    best: ["chart:stacked"], ok: ["chart:area", "chart:bar", "chart:line"], poor: ["chart:pie", "chart:donut"],
    why: "Totals and their mix per quarter: stacked bars show both at once.",
  },
  {
    id: "relate", group: "chart",
    request: "Do stores that spend more on ads sell more? Ad spend and monthly sales for 12 stores: Mesa $4K/$61K, Tempe $6K/$70K, Chandler $3K/$52K, Gilbert $8K/$88K, Scottsdale $9K/$97K, Peoria $2K/$41K, Glendale $5K/$66K, Surprise $1K/$33K, Goodyear $7K/$79K, Avondale $3K/$49K, Buckeye $2K/$38K, Queen Creek $6K/$74K.",
    best: ["chart:scatter"], ok: ["table"], poor: ["chart:line", "chart:bar", "chart:hbar"],
    why: "Whether two numbers move together is a scatter: each store a dot at its spend and sales.",
  },
  {
    id: "relate-trap", group: "chart", trap: true,
    request: "Are pricier hotels rated better? Nightly price and guest rating for 10 hotels: Cactus Inn $89/3.9, Saguaro Suites $142/4.4, Desert Rose $118/4.1, Copper Lodge $210/4.5, Palo Verde $96/3.6, Red Rock Retreat $265/4.7, Mesa Motel $72/3.4, Sonoran Spa $310/4.6, Canyon View $155/4.2, Oasis House $128/3.8.",
    best: ["chart:scatter"], ok: ["table"], poor: ["chart:line", "chart:bar", "chart:hbar"],
    why: "Price against rating is a relationship between two numbers, not a ranking: a scatter shows whether they rise together.",
  },
  {
    id: "drop-off", group: "chart",
    request: "Where do people drop out of our checkout? Viewed cart 8,400, entered shipping 5,100, entered payment 3,300, placed order 2,600.",
    best: ["chart:funnel"], ok: ["chart:bar", "chart:hbar"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Stages people drop out of: a funnel shows each stage and its share of the one before.",
  },
  {
    id: "bridge", group: "chart",
    request: "Walk me from revenue to net income: revenue $640K, cost of goods -$250K, payroll -$180K, rent -$40K, other income $15K.",
    best: ["chart:waterfall"], ok: ["chart:bar", "table", "details"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Changes adding up to a total: a waterfall walks from one to the other step by step.",
  },
  {
    id: "against-targets", group: "chart",
    request: "How are we tracking against Q4 goals? Revenue $1.31M of $1.4M, new customers 210 of 200, churn 3.4% where the goal is under 3%, NPS 47 of 50.",
    best: ["chart:bullet"], ok: ["progress", "meter", "stat", "table"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Several KPIs on different scales, each against its target (one where lower is better): a bullet chart.",
  },
  {
    id: "two-dimensions", group: "chart",
    request: "When do support tickets come in? Ticket counts by weekday and hour: weekdays peak at 10am (about 40) and 2pm (35), quiet after 6pm; weekends are flat at about 8 an hour. Cover 8am to 8pm, Monday to Sunday.",
    best: ["chart:heatmap"], ok: ["table", "chart:line"], poor: ["chart:pie", "chart:donut", "chart:bar"],
    why: "One number across two dimensions (day and hour): a heatmap shows the busy cells at once.",
  },
  {
    id: "flows", group: "chart",
    request: "Where does our nonprofit's money come from and where does it go? Grants $900K to programs $700K and admin $200K; donations $500K to programs $350K, fundraising $100K and admin $50K.",
    best: ["chart:sankey"], ok: ["chart:stacked", "table", "chart:treemap"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Amounts flowing from sources to uses: a sankey shows both ends and the bands between.",
  },
  {
    id: "storage", group: "chart", trap: true,
    request: "What's taking up space on our shared drive? Folders: Video 412 GB, Photos 268 GB, Backups 190 GB, Design 133 GB, Music 74 GB, Archive 61 GB, Datasets 58 GB, Email 22 GB, Docs 19 GB, Builds 17 GB, Fonts 6 GB, Logs 4 GB, Temp 3 GB, Other 2 GB, Configs 1 GB.",
    best: ["chart:treemap", "chart:hbar"], ok: ["chart:bar", "table"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Fifteen parts of a whole, sizes that differ a lot: a treemap shows what dominates, and no pie can hold them.",
  },
  {
    id: "one-score", group: "chart",
    request: "Our customer health score is 68 out of 100. Under 50 is at risk and 80 or more is healthy.",
    best: ["meter"], ok: ["progress", "stat"], poor: ["chart:bar", "chart:pie", "chart:donut"],
    why: "One number against its range with bands: a meter (gauge or ring) colored by the bands.",
  },
  {
    id: "one-kpi-change", group: "chart", trap: true,
    request: "This week's revenue is $84,200, up 12% from last week's $75,180.",
    best: ["stat"], ok: ["text", "callout"], poor: ["chart:bar", "chart:line", "chart:pie"],
    why: "One headline number with its change: a stat with change=, not a two-bar chart.",
  },
  {
    id: "rate-over-time", group: "chart",
    request: "Our checkout conversion rate by month: Jan 3.2%, Feb 3.5%, Mar 3.1%, Apr 3.9%, May 4.4%, Jun 4.1%, Jul 4.6%.",
    best: ["chart:line"], ok: ["chart:bar", "chart:area", "stat"], poor: ["chart:pie", "chart:donut", "chart:stacked"],
    why: "A rate over time is a line (format=percent); an area would suggest a volume that adds up.",
  },
  {
    id: "volume-over-time", group: "chart",
    request: "Weekly website visitors for the last 10 weeks, growing from 12,000 to 31,000: 12K, 13K, 15K, 16K, 19K, 21K, 24K, 26K, 29K, 31K. I want to feel how much traffic we're getting overall.",
    best: ["chart:area"], ok: ["chart:line", "chart:bar"], poor: ["chart:pie", "chart:donut"],
    why: "A volume over time where the amount matters: an area fills the quantity under the line.",
  },
  {
    id: "share-of-one", group: "chart", trap: true,
    request: "We've closed 312 of our 480 support tickets this month.",
    best: ["progress", "meter"], ok: ["stat", "chart:donut", "chart:pie"], poor: ["chart:bar", "chart:hbar", "chart:line"],
    why: "One part of one total: a progress bar or ring says 65% done without a chart.",
  },
  {
    id: "kpi-row", group: "chart", trap: true,
    request: "Today's store numbers: revenue $18,420, orders 212, average order $86.90, conversion 3.8%, returns 7, new customers 41.",
    best: ["stat"], ok: ["details", "table"], poor: ["chart:bar", "chart:hbar", "chart:pie", "chart:donut"],
    why: "Six headline numbers in different units: a row of stats, since no chart can share a scale between them.",
  },

  // ------------------------------------------------------------- structure
  {
    id: "org", group: "structure",
    request: "Show who reports to whom: Ana Ruiz (CEO); Ben Okafor (CTO) and Chloe Tan (CFO) report to Ana; Dev Patel and Eli Moss report to Ben; Fay Lin reports to Chloe; Gus Ward and Hana Ito report to Dev.",
    best: ["tree:org", "tree:list"], ok: ["list"], poor: ["table", "flow", "chart:bar"],
    why: "Reporting lines are a hierarchy: an org chart (or an indented tree).",
  },
  {
    id: "nested-budget", group: "structure",
    request: "Our 2027 budget, broken down: Operations $1.2M (Facilities $500K, IT $400K, Travel $300K); People $2.4M (Salaries $2M, Benefits $300K, Training $100K); Marketing $800K (Ads $500K, Events $200K, Content $100K). I want to open each area to see its lines.",
    best: ["tree:list"], ok: ["accordion", "table", "chart:treemap"], poor: ["flow", "chart:pie", "chart:donut"],
    why: "Lines nested under areas that open and close: a tree with amounts.",
  },
  {
    id: "process", group: "structure",
    request: "How does a refund get handled? A customer asks; if it's under $50 we refund automatically, otherwise an agent reviews it and either approves it (we refund) or declines it (we email the customer).",
    best: ["flow"], ok: ["timeline", "list"], poor: ["table", "tree:org", "chart:funnel"],
    why: "Steps with a decision that branches: boxes and arrows (flow), which a list or timeline can't branch.",
  },
  {
    id: "pipeline", group: "structure",
    request: "Our sales deals by stage: Lead (Lumen Cinema $12K, Harbor Books $8K), Qualified (Fieldstone Cafe $20K), Proposal (Riverbend CU $45K, Blue Mesa SD $30K), Won (Copperline $60K). I want to move deals along as they progress.",
    best: ["board"], ok: ["table", "list"], poor: ["chart:funnel", "chart:bar"],
    why: "Items by stage that move along: a board with columns per stage and move=true.",
  },
  {
    id: "rota", group: "structure",
    request: "Next week's support rota: Ana Mon and Wed 8:00–16:00, Ben Mon to Fri 12:00–20:00, Chloe Tue and Thu 8:00–16:00, Dev Sat and Sun 10:00–18:00.",
    best: ["schedule:week", "schedule:day"], ok: ["table"], poor: ["timeline", "chart:bar"],
    why: "Shifts at times of day across a week: a week schedule, overlaps side by side.",
  },
  {
    id: "project-plan", group: "structure",
    request: "Our app launch plan: design Nov 2–20, build Nov 16–Dec 18, testing Dec 10–Jan 8, marketing Dec 1–Jan 15, launch on Jan 15.",
    best: ["schedule:timeline"], ok: ["table", "timeline"], poor: ["chart:bar", "chart:hbar"],
    why: "Tasks over date ranges that overlap: a Gantt timeline with the launch as a milestone.",
  },
  {
    id: "delivery", group: "structure",
    request: "Where's my package? Ordered Nov 1, packed Nov 2, shipped Nov 3, out for delivery now, expected Nov 5.",
    best: ["timeline"], ok: ["list", "progress", "details"], poor: ["table", "chart:bar", "schedule:timeline"],
    why: "Steps in order with the current one marked: a timeline.",
  },
  {
    id: "one-record", group: "structure", trap: true,
    request: "Order NW-2041: placed Nov 3 by Lumen Cinema, paid by card, shipped with UPS, tracking 1Z84, total $412.50, status in transit.",
    best: ["details"], ok: ["list"], poor: ["table", "chart:bar"],
    why: "One record's fields: label and value rows (details), not a one-row table.",
  },
  {
    id: "choose-plan", group: "structure",
    request: "Help me choose a plan: Basic $9 a month, 50 GB, email support; Pro $19, 500 GB, chat support, version history; Team $49, 2 TB, phone support, version history, admin tools.",
    best: ["compare"], ok: ["table", "grid", "card"], poor: ["chart:bar", "chart:hbar"],
    why: "Two to four options side by side on the same rows, with the best value marked: compare.",
  },
  {
    id: "many-rows", group: "structure",
    request: "All 24 orders from this week with their customer, date, status and total, sortable by any column. (Make up realistic orders NW-2030 to NW-2053.)",
    best: ["table"], ok: ["list"], poor: ["chart:bar", "details"],
    why: "Many records with several columns to sort: a table.",
  },
  {
    id: "long-feed", group: "structure",
    request: "A card with today's store activity (about 20 events like orders shipped, refunds approved, new reviews, with their times), plus the totals for orders shipped and refunds below the list. Keep the card compact.",
    best: ["scroll"], ok: ["pagination"], poor: [],
    why: "A long list inside a compact card with totals under it: a scrolling region keeps the totals in sight.",
  },
  {
    id: "confirm", group: "structure",
    request: "A list of 4 saved addresses, each with a Delete button. Deleting can't be undone, so ask first.",
    best: ["dialog"], ok: ["callout", "if"], poor: [],
    why: "Asking before something that can't be undone: a confirm dialog.",
  },
  {
    id: "row-actions", group: "structure",
    request: "Our 5 open invoices (INV-1188 to INV-1192, with customer and amount). For each one I need to be able to view it, send a reminder, mark it paid, or void it, without the screen getting cluttered.",
    best: ["menu"], ok: ["button"], poor: [],
    why: "Several actions on each item without a row of buttons: a ⋯ menu per row.",
  },
  {
    id: "seats", group: "structure",
    request: "Let me pick seats for a small screening room: rows A to C, seats 1 to 6 each; A3, B4 and C1 are taken, and the price is $14 a seat.",
    best: ["tile"], ok: ["button", "check"], poor: ["table", "select"],
    why: "Small fixed-size faces to pick from in rows: tiles, taken ones disabled.",
  },

  // ----------------------------------------------------------------- inputs
  {
    id: "long-choice", group: "input",
    request: "Let me choose my team from our 28 teams (Accounts, Analytics, Billing, Brand, Compliance, Data, Design, Facilities, Finance, Growth, HR, Infra, IT, Legal, Marketing, Mobile, Ops, Partnerships, Payments, Platform, Procurement, Product, QA, Research, Sales, Security, Support, Web).",
    best: ["select"], ok: ["radio"], poor: ["segmented", "tabs"],
    why: "One choice from a long list: a select, not 28 radio buttons.",
  },
  {
    id: "switch-view", group: "input",
    request: "A revenue chart (make up monthly numbers) that I can switch between showing the last week, month or year.",
    best: ["segmented", "tabs"], ok: ["select", "radio"], poor: [],
    why: "Switching one view between three options: a segmented control.",
  },
  {
    id: "filter-several", group: "input",
    request: "Sales by region (West $820K, East $610K, Central $455K, South $380K, Northeast $290K). Let me pick which regions count toward the total.",
    best: ["select:multiple"], ok: ["check"], poor: ["radio", "segmented"],
    why: "Filtering by several values at once: a select with multiple=true (or checkboxes).",
  },
  {
    id: "date-range", group: "input",
    request: "This month's 12 orders with dates and amounts. Let me pick a period and see the revenue for just those days.",
    best: ["date-picker:range"], ok: ["date-picker", "select"], poor: ["input"],
    why: "Choosing a period: a date picker with range=true.",
  },
  {
    id: "validated-form", group: "input",
    request: "A newsletter sign-up: name and email, both needed, and tell people if the email doesn't look right.",
    best: ["input:email"], ok: ["input:required", "input"], poor: [],
    why: "An email field that says when it's wrong: kind=email (with required=), not just a text box.",
  },
  {
    id: "note-field", group: "input",
    request: "A feedback form: a rating from 1 to 5 stars and a box for a few sentences about their visit.",
    best: ["input:lines"], ok: ["input"], poor: [],
    why: "A few sentences need a box of several lines (lines=), not a one-line field.",
  },
  {
    id: "count-choice", group: "input",
    request: "Book a table: how many guests, from 1 to 8.",
    best: ["stepper"], ok: ["select", "slider", "input:number", "segmented"], poor: ["input"],
    why: "A small whole number in a range: a stepper.",
  },

  // ---------------------------------------------------------------- content
  {
    id: "explain-term", group: "content",
    request: "Show our net revenue retention (112%) and gross margin (64%), and explain what each one means for people who aren't sure, without cluttering the screen.",
    best: ["tip"], ok: ["text", "callout"], poor: [],
    why: "Explanations people may want but most won't: a tip= on each number.",
  },
  {
    id: "takeaway", group: "content",
    request: "Our churn this quarter rose to 4.1% from 3.0% (monthly churn: Jul 2.9%, Aug 3.4%, Sep 4.1%). Make sure the warning is the first thing people notice.",
    best: ["callout"], ok: ["text", "badge"], poor: [],
    why: "The one warning to notice first: a callout in the warn tone.",
  },
  {
    id: "rich-paragraph", group: "content",
    request: "Our returns policy in a short paragraph: returns within 30 days are free, items must be unused, and the full policy is at https://northwind.example/returns. Make the key terms stand out.",
    best: ["text:rich"], ok: ["text", "callout"], poor: [],
    why: "A paragraph with emphasis and a link: text with rich=true.",
  },
  {
    id: "places", group: "content",
    request: "Our 5 stores: Phoenix, Tucson, Flagstaff, Albuquerque and Las Vegas. Show where they are.",
    best: ["map"], ok: ["list", "table"], poor: ["chart:bar"],
    why: "Where things are: a map with pins.",
  },
];

/**
 * What an answer is made of, for grading: each element type, and the
 * variants that change what it shows.
 */
export function signatures(root: SayShapeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SayShapeNode) => {
    const p = n.props;
    out.add(n.type);
    if (p.tip !== undefined) out.add("tip");
    if (n.type === "chart") out.add(`chart:${p.kind ?? "bar"}`);
    if (n.type === "tree") out.add(`tree:${p.kind ?? "list"}`);
    if (n.type === "meter") out.add(`meter:${p.kind ?? "ring"}`);
    if (n.type === "schedule") out.add(`schedule:${p.view ?? "week"}`);
    if (n.type === "select" && p.multiple === "true") out.add("select:multiple");
    if (n.type === "date-picker" && p.range === "true") out.add("date-picker:range");
    if (n.type === "text" && p.rich === "true") out.add("text:rich");
    if (n.type === "input") {
      if (p.required !== undefined && p.required !== "false") out.add("input:required");
      if (p.kind === "email") out.add("input:email");
      if (p.kind === "number") out.add("input:number");
      if (p.lines !== undefined && Number(p.lines) > 1) out.add("input:lines");
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export type Grade = "best" | "ok" | "poor" | "other";

/** How an answer's signatures grade against a case: the best grade any of them reaches. */
export function grade(c: PickCase, sigs: ReadonlySet<string>): { grade: Grade; matched: string[] } {
  const hit = (list: readonly string[] | undefined) => (list ?? []).filter((s) => sigs.has(s));
  const best = hit(c.best);
  if (best.length) return { grade: "best", matched: best };
  const ok = hit(c.ok);
  if (ok.length) return { grade: "ok", matched: ok };
  const poor = hit(c.poor);
  if (poor.length) return { grade: "poor", matched: poor };
  return { grade: "other", matched: [] };
}

export const POINTS: Record<Grade, number> = { best: 2, ok: 1, poor: 0, other: 0 };
