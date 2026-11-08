/**
 * Picking the right representation: requests where several answers would
 * work but one shows the data best. Each case describes the data and what
 * the person wants to see, never the element, and grades answers:
 *
 * - best: what shows it best (2 points);
 * - ok: works, but loses something (1 point);
 * - anything else, and the poor list in particular, scores 0;
 * - never: wrong even beside the best (a 14-slice pie next to a treemap), so
 *   the two together are only ok. On traps, the trap pick is a never.
 *
 * An answer is read element by element (see `elementSignatures`): each
 * element's type, plus `chart:<kind>`, `tree:<kind>`, `meter:<kind>`,
 * `map:<kind>`, `schedule:<view>`, `input:required|email|number|lines`,
 * `select:multiple`, `date-picker:range` and `text:rich`, and a `tip` for each
 * tip=. An element is graded by its most specific signature the case lists
 * (a multiple select by `select:multiple` when listed, else by `select`), and
 * the best element found wins. A case with parts gives each part its own
 * element: one element never counts for two parts.
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
  /**
   * Poor answers that stay wrong even beside the best one (a 14-slice pie next to a treemap), so
   * having both is only ok. Other poor kinds beside the best are taken as another view of the data
   * (bars of weekday averages next to a line of the days).
   */
  never?: string[];
  why: string;
  /** The obvious choice isn't the best one. */
  trap?: boolean;
  /**
   * 1: the data or the ask points at one representation. 2: harder and closer to real
   * messages: raw data with a vague ask, several things to show at once (parts), or
   * a need the picks don't word directly.
   */
  round?: 1 | 2;
  /** Several things to show in one answer, each graded on its own; the case scores their average. */
  parts?: Array<{ label: string; best: string[]; ok?: string[] }>;
}

const round1: PickCase[] = [
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
    best: ["chart:treemap", "chart:hbar"], ok: ["chart:bar", "table"], poor: [], never: ["chart:pie", "chart:donut"],
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
    best: ["chart:scatter"], ok: ["table"], poor: ["chart:bar", "chart:hbar"], never: ["chart:line"],
    why: "Whether two numbers move together is a scatter: each store a dot at its spend and sales.",
  },
  {
    id: "relate-trap", group: "chart", trap: true,
    request: "Are pricier hotels rated better? Nightly price and guest rating for 10 hotels: Cactus Inn $89/3.9, Saguaro Suites $142/4.4, Desert Rose $118/4.1, Copper Lodge $210/4.5, Palo Verde $96/3.6, Red Rock Retreat $265/4.7, Mesa Motel $72/3.4, Sonoran Spa $310/4.6, Canyon View $155/4.2, Oasis House $128/3.8.",
    best: ["chart:scatter"], ok: ["table"], poor: ["chart:bar", "chart:hbar"], never: ["chart:line"],
    why: "Price against rating is a relationship between two numbers, not a ranking: a scatter shows whether they rise together.",
  },
  {
    id: "drop-off", group: "chart",
    request: "Where are we losing shoppers in checkout? Viewed cart 8,400, entered shipping 5,100, entered payment 3,300, placed order 2,600.",
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
    request: "When do support tickets come in? Ticket counts for each day of the week and each hour: weekdays peak at 10am (about 40) and 2pm (35), quiet after 6pm; weekends are flat at about 8 an hour. Cover 8am to 8pm, Monday to Sunday.",
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
    best: ["chart:treemap", "chart:hbar"], ok: ["chart:bar", "table"], poor: ["chart:line"], never: ["chart:pie", "chart:donut"],
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
    best: ["stat"], ok: ["text", "callout"], never: ["chart:bar", "chart:line", "chart:pie"],
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
    best: ["progress", "meter"], ok: ["stat", "chart:donut", "chart:pie"], never: ["chart:bar", "chart:hbar", "chart:line"],
    why: "One part of one total: a progress bar or ring says 65% done without a chart.",
  },
  {
    id: "kpi-row", group: "chart", trap: true,
    request: "Today's store numbers: revenue $18,420, orders 212, average order $86.90, conversion 3.8%, returns 7, new customers 41.",
    best: ["stat"], ok: ["details", "table"], never: ["chart:bar", "chart:hbar", "chart:pie", "chart:donut"],
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
    best: ["tree:list"], ok: ["accordion", "table", "chart:treemap", "tree:org"], poor: ["flow", "chart:pie", "chart:donut"],
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
    best: ["details"], ok: ["list"], poor: ["table"], never: ["chart:bar"],
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
    request: "A list of 4 saved addresses, each with a Delete button. A deleted address is gone for good, so ask first.",
    best: ["dialog"], ok: ["callout"], poor: [],
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
    best: ["select:multiple"], ok: ["check", "switch"], poor: ["radio", "segmented"],
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

const round2: PickCase[] = [
  {
    id: "raw-daily", group: "chart", trap: true,
    request: "Here are our daily orders for the last 60 days, starting Sep 1: 212, 198, 230, 241, 205, 188, 176, 220, 236, 249, 252, 213, 190, 182, 228, 245, 251, 266, 231, 204, 197, 239, 257, 263, 271, 240, 215, 208, 250, 268, 274, 281, 249, 226, 219, 262, 279, 288, 292, 257, 233, 225, 270, 291, 297, 305, 266, 240, 236, 284, 300, 309, 318, 276, 252, 246, 296, 311, 322, 330. What do you make of it?",
    best: ["chart:line", "chart:area"], ok: ["stat", "chart:bar"], poor: ["chart:hbar", "table"],
    why: "Sixty days is a series to read as a shape (weekly dips, a rising trend): a line. Sixty bars are crowded and hide the trend.",
  },
  {
    id: "raw-table-vague", group: "chart",
    request: "Region, 2025, 2026: West 610, 820; East 590, 610; Central 470, 455; South 300, 380; Northeast 260, 290 (in $K). Can you show this?",
    best: ["chart:bar", "chart:hbar"], ok: ["table", "chart:line"], poor: ["chart:pie", "chart:donut", "chart:stacked"],
    why: "Two years per region compared side by side: grouped bars (two series). Stacking would add the years together; a pie can't show two years.",
  },
  {
    id: "budget-vs-actual", group: "chart",
    request: "Budget against actual spend by department this quarter: Engineering $420K budget, $455K actual; Sales $310K, $290K; Marketing $180K, $210K; Support $120K, $118K; Admin $90K, $84K. Who's over?",
    best: ["chart:bullet", "chart:bar", "chart:hbar"], ok: ["table", "stat"], poor: ["chart:pie", "chart:donut", "chart:stacked", "chart:line"],
    why: "Actual against a budget per department, lower is better: a bullet chart with good=down, or bars of both side by side.",
  },
  {
    id: "survey", group: "chart",
    request: "Survey results, share of answers per question (agree / neutral / disagree): Easy to use 72/18/10, Fast 61/25/14, Good value 48/30/22, Would recommend 66/21/13.",
    best: ["chart:stacked"], ok: ["chart:bar", "chart:hbar", "table"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Each question's answers make up 100%: stacked bars compare the splits across questions (one pie per question can't be compared).",
  },
  {
    id: "spread", group: "chart", trap: true,
    request: "How are our order values spread out? Orders by value: under $25: 140, $25–50: 310, $50–100: 420, $100–200: 260, $200–500: 90, over $500: 18.",
    best: ["chart:bar"], ok: ["chart:hbar", "table"], poor: ["chart:line", "chart:area"], never: ["chart:pie", "chart:donut"],
    why: "A distribution over ordered buckets: bars in bucket order (a histogram); a pie loses the order, a line suggests time.",
  },
  {
    id: "three-regions-trend", group: "chart",
    request: "Monthly active users by region, Jan to Jun: North America 12, 13, 13, 15, 16, 18 (thousands); Europe 8, 8, 9, 11, 12, 12; Asia 4, 5, 7, 8, 10, 13. Which region is growing fastest?",
    best: ["chart:line"], ok: ["chart:bar", "chart:area", "table"], poor: ["chart:pie", "chart:donut", "chart:stacked"],
    why: "Growth of three separate series: lines, one per region; stacking hides each region's slope.",
  },
  {
    id: "two-kpis-vs-last", group: "chart", trap: true,
    request: "This month vs last month: revenue $212K vs $190K, orders 2,310 vs 2,250, refunds 41 vs 58.",
    best: ["stat"], ok: ["table", "details"], poor: ["chart:bar", "chart:line"], never: ["chart:pie"],
    why: "Three headline numbers with their change: stats with change= (and good=down for refunds), not a bar chart of mixed units.",
  },
  {
    id: "by-country", group: "chart",
    request: "Our customers by country: United States 4,200, United Kingdom 1,300, Germany 1,100, Canada 900, Australia 650, France 600, Japan 420, Brazil 380, India 360, Mexico 240. Show me where they are.",
    best: ["map:choropleth", "map:bubble"], ok: ["map:markers", "chart:hbar", "chart:bar", "table", "chart:treemap"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "Asked where they are, with an amount each: a map shaded by country (kind=choropleth) or sized bubbles; pins or ranked bars are a fair second.",
  },
  {
    id: "dashboard-mix", group: "chart",
    request: "Build me a dashboard for this quarter: revenue $1.9M (target $2M), orders 18,400 (target 17,000), monthly revenue Jul $590K, Aug $640K, Sep $670K, and revenue by channel: web $1.1M, retail $520K, wholesale $280K.",
    best: [], parts: [
      { label: "targets", best: ["chart:bullet", "progress", "meter"], ok: ["stat"] },
      { label: "monthly", best: ["chart:line", "chart:area", "chart:bar"] },
      { label: "channels", best: ["chart:donut", "chart:pie", "chart:hbar"], ok: ["chart:bar", "chart:treemap"] },
    ],
    why: "Three kinds of data in one screen: goals (bullet or progress), a trend (line or bars) and a split (donut).",
  },
  {
    id: "team-skills", group: "chart",
    request: "Skill levels (1 to 5) for our team: Ana: SQL 5, Python 4, Design 2, Writing 3; Ben: SQL 3, Python 5, Design 1, Writing 2; Chloe: SQL 2, Python 2, Design 5, Writing 4; Dev: SQL 4, Python 3, Design 3, Writing 5. Where are we thin?",
    best: ["chart:heatmap"], ok: ["table", "chart:bar"], poor: ["chart:pie", "chart:donut", "chart:line"],
    why: "One number across people and skills: a heatmap shows the thin cells at a glance.",
  },
  {
    id: "restaurants", group: "structure",
    request: "Here are 12 restaurants near our office with cuisine, rating and price level: Juniper & Rye (American, 4.6, $$$), Saffron Lane (Indian, 4.5, $$), Little Kyoto (Japanese, 4.7, $$$), Casa Verde (Mexican, 4.3, $), Olive & Vine (Italian, 4.4, $$), Pho Real (Vietnamese, 4.2, $), The Copper Pot (American, 4.0, $$), Seoul Food (Korean, 4.5, $$), Bread & Salt (Bakery, 4.8, $), Marina Grill (Seafood, 4.1, $$$), Green Bowl (Vegan, 4.3, $$), Smoke & Ash (BBQ, 4.6, $$). Help me pick one for lunch.",
    best: ["table", "list"], ok: ["card", "grid"], poor: ["chart:bar", "chart:hbar", "chart:scatter"],
    why: "Choosing among places by several attributes: a sortable table or a list, not a chart of ratings.",
  },
  {
    id: "steps-instructions", group: "structure", trap: true,
    request: "How do I set up two-factor sign-in on our admin site? Open Settings, choose Security, press Turn on 2FA, scan the code with an authenticator app, then type the 6-digit code to confirm.",
    best: ["timeline", "list"], ok: ["text"], poor: ["flow", "table"], never: ["chart:funnel"],
    why: "Steps to follow in order with no branches: a numbered list or steps, not a flow chart.",
  },
  {
    id: "approval-branch", group: "structure",
    request: "What happens to an expense claim? It's submitted, then checked by the manager. Under $500 it's paid straight away; over $500 it goes to finance, who either pay it or send it back to the employee to fix and resubmit.",
    best: ["flow"], ok: ["timeline", "list"], poor: ["table", "chart:funnel", "tree:org"],
    why: "A process with a branch and a loop back: a flow with a decision; a list can't show the loop.",
  },
  {
    id: "today-meetings", group: "structure",
    request: "My meetings today: standup 9:00–9:15, design review 10:00–11:00, lunch with Ana 12:00–13:00, interview 13:30–14:30, planning 15:00–16:30, 1:1 with Ben 16:00–16:30.",
    best: ["schedule:day", "schedule:week"], ok: ["list", "timeline", "table"], poor: ["chart:bar", "flow"],
    why: "Blocks at times of day, two of them overlapping: a day schedule shows the clash.",
  },
  {
    id: "folder-structure", group: "structure",
    request: "Our shared drive's folders: Clients (Acme, Northwind (Contracts, Invoices), Lumen), Internal (HR, Finance (2025, 2026)), Templates. Let me browse it.",
    best: ["tree:list"], ok: ["accordion", "list"], poor: ["table", "flow", "tree:org"],
    why: "Folders inside folders to open and close: a tree list, not an org chart.",
  },
  {
    id: "ticket-queue", group: "structure",
    request: "Our support tickets: 4 new, 6 open, 3 waiting on the customer, 9 solved this week. Each has a subject, customer and priority (make up a few realistic ones). I want to work through them and move them along.",
    best: ["board"], ok: ["table", "list", "tabs"], poor: ["chart:pie", "chart:donut", "chart:funnel"],
    why: "Work items by status that move along: a board with move=true.",
  },
  {
    id: "two-options", group: "structure",
    request: "Should we lease or buy the delivery van? Lease: $480 a month, 3 years, maintenance included, no resale. Buy: $29,000 upfront, maintenance about $900 a year, resale about $12,000 after 3 years.",
    best: ["compare"], ok: ["table", "details", "grid", "card"], poor: ["chart:bar", "chart:pie"],
    why: "Two options on the same rows: compare, with the better value per row marked.",
  },
  {
    id: "settings-page", group: "input",
    request: "A settings screen: display name, email for receipts, whether to get weekly summaries, a theme (light, dark or system), and the number of items per page (10, 25, 50 or 100).",
    best: [], parts: [
      { label: "email", best: ["input:email"], ok: ["input"] },
      { label: "weekly summaries", best: ["switch"], ok: ["check"] },
      { label: "theme", best: ["segmented", "radio"], ok: ["select"] },
      { label: "page size", best: ["select", "segmented"], ok: ["radio", "stepper"] },
    ],
    why: "Each setting has its own best control: an email field, a switch for on/off, three options in a segmented control, four sizes in a select.",
  },
  {
    id: "quick-filter", group: "input",
    request: "My 20 tasks (make up realistic ones with due dates and a status of to do, doing or done). Let me quickly show just one status at a time.",
    best: ["segmented", "tabs"], ok: ["select", "radio"], poor: ["select:multiple"],
    why: "Switching between three statuses: a segmented control (or tabs).",
  },
  {
    id: "price-range", group: "input",
    request: "48 tents from $90 to $720. Let me narrow them to my budget and see how many fit.",
    best: ["slider"], ok: ["input:number", "select", "stepper", "segmented"], poor: ["date-picker"],
    why: "A budget limit across a continuous range: a slider.",
  },
  {
    id: "terms-explain", group: "content", trap: true,
    request: "Our pricing table: Basic $9, Pro $19, Team $49 a month. Some people don't know what 'seats', 'SSO' and 'audit log' mean; Team has all three, Pro has seats only.",
    best: ["tip"], ok: ["text", "callout", "compare"], poor: [],
    why: "Unfamiliar terms explained where they appear: a tip= on each, keeping the table clean.",
  },
  {
    id: "long-terms", group: "content",
    request: "Show our 14-point terms of service (make up short realistic points) on a sign-up card, above an Accept button, without the card getting long.",
    best: ["scroll"], ok: ["accordion", "pagination"], poor: [],
    why: "Long text that mustn't stretch the card: a scrolling region above the button.",
  },
];

export const pickCases: PickCase[] = [...round1.map((c) => ({ ...c, round: 1 as const })), ...round2.map((c) => ({ ...c, round: 2 as const }))];

/** Values written as {…} are worked out when shown, so the grader can't read them. */
const literal = (v: string | undefined): string | undefined => (v === undefined || v.trim().startsWith("{") ? undefined : v);
const on = (v: string | undefined) => literal(v) !== undefined && v !== "false";

/** A prop's default from the element's own definition, so specs are read as the engine draws them. */
export type Defaults = (type: string, prop: string) => string | undefined;

/** Which prop picks an element's variant. */
const VARIANT: Record<string, string> = { chart: "kind", tree: "kind", meter: "kind", map: "kind", schedule: "view" };

/**
 * What an answer is made of, element by element: each element's signatures, most specific
 * first ("chart:line" before "chart"), and one ["tip"] for each tip=.
 */
export function elementSignatures(root: SayShapeNode, defaults: Defaults = () => undefined): string[][] {
  const out: string[][] = [];
  const walk = (n: SayShapeNode) => {
    const p = n.props;
    const sigs: string[] = [];
    const vp = VARIANT[n.type];
    if (vp) {
      // Written as {…}, the variant isn't known: graded as the element alone.
      const v = p[vp] === undefined ? defaults(n.type, vp) : literal(p[vp]);
      if (v) sigs.push(`${n.type}:${v}`);
    }
    if (n.type === "select" && on(p.multiple)) sigs.push("select:multiple");
    if (n.type === "date-picker" && on(p.range)) sigs.push("date-picker:range");
    if (n.type === "text" && on(p.rich)) sigs.push("text:rich");
    if (n.type === "input") {
      const kind = literal(p.kind);
      if (kind === "email") sigs.push("input:email");
      if (kind === "number") sigs.push("input:number");
      if (on(p.required)) sigs.push("input:required");
      const lines = literal(p.lines);
      if (lines !== undefined && Number(lines) > 1) sigs.push("input:lines");
    }
    sigs.push(n.type);
    out.push(sigs);
    if (p.tip !== undefined) out.push(["tip"]);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Every signature in an answer, for the report. */
export function signatures(root: SayShapeNode, defaults?: Defaults): Set<string> {
  return new Set(elementSignatures(root, defaults).flat());
}

export type Grade = "best" | "ok" | "poor" | "other";
type Lists = Pick<PickCase, "best" | "ok" | "poor" | "never">;

/** One element's grade, by its most specific signature the case lists. */
function elementGrade(c: Lists, sigs: readonly string[]): { grade: Grade; never: boolean; sig?: string } {
  for (const s of sigs) {
    if (c.best.includes(s)) return { grade: "best", never: false, sig: s };
    if (c.ok?.includes(s)) return { grade: "ok", never: false, sig: s };
    if (c.never?.includes(s)) return { grade: "poor", never: true, sig: s };
    if (c.poor?.includes(s)) return { grade: "poor", never: false, sig: s };
  }
  return { grade: "other", never: false };
}

const RANK: Record<Grade, number> = { best: 3, ok: 2, poor: 1, other: 0 };

/** How an answer grades against a case: by its best element, made only ok by a never element beside it. */
export function grade(c: Lists, elements: ReadonlyArray<readonly string[]>): { grade: Grade; matched: string[] } {
  const graded = elements.map((e) => elementGrade(c, e)).filter((g) => g.sig !== undefined);
  const top = graded.reduce<Grade>((a, g) => (RANK[g.grade] > RANK[a] ? g.grade : a), "other");
  const matched = [...new Set(graded.filter((g) => g.grade === top).map((g) => g.sig!))];
  const never = [...new Set(graded.filter((g) => g.never).map((g) => g.sig!))];
  if (top === "best" && never.length) return { grade: "ok", matched: [...matched, ...never] };
  return { grade: top, matched };
}

export const POINTS: Record<Grade, number> = { best: 2, ok: 1, poor: 0, other: 0 };

export interface Scored {
  grade: Grade;
  points: number;
  matched: string[];
  parts?: Array<{ label: string; grade: Grade }>;
}

/**
 * Points out of 2 for an answer: its grade, or for a case with parts the average of its parts',
 * each part taking a different element (whichever assignment scores most).
 */
export function scoreElements(c: PickCase, elements: ReadonlyArray<readonly string[]>): Scored {
  if (!c.parts?.length) {
    const g = grade(c, elements);
    return { ...g, points: POINTS[g.grade] };
  }
  const parts = c.parts;
  // What each element would score for each part; only elements that score for some part matter.
  const table = elements.map((e) => parts.map((p) => elementGrade({ best: p.best, ok: p.ok }, e)));
  const useful = table.map((row, i) => ({ row, i })).filter(({ row }) => row.some((g) => g.grade !== "other"));
  let top = { points: -1, pick: [] as number[] };
  const pick: number[] = [];
  const used = new Set<number>();
  const search = (k: number, points: number) => {
    if (k === parts.length) {
      if (points > top.points) top = { points, pick: [...pick] };
      return;
    }
    pick.push(-1);
    search(k + 1, points);
    pick.pop();
    for (const { row, i } of useful) {
      const g = row[k]!;
      if (used.has(i) || g.grade === "other") continue;
      used.add(i);
      pick.push(i);
      search(k + 1, points + POINTS[g.grade]);
      pick.pop();
      used.delete(i);
    }
  };
  search(0, 0);
  const graded = parts.map((p, k) => {
    const i = top.pick[k] ?? -1;
    const g = i >= 0 ? table[i]![k]! : undefined;
    return { label: p.label, grade: g?.grade ?? ("other" as Grade), sig: g?.sig };
  });
  const points = graded.reduce((a, p) => a + POINTS[p.grade], 0) / parts.length;
  const overall: Grade = points >= 2 ? "best" : points >= 1 ? "ok" : "other";
  return { grade: overall, points, matched: graded.flatMap((p) => (p.sig ? [p.sig] : [])), parts: graded.map(({ label, grade: g }) => ({ label, grade: g })) };
}
