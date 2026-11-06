/**
 * Conversations: people build an interface up in steps ("sales by region", then "only Europe",
 * then "split it by product") rather than asking for everything at once. Each session is four
 * requests in a row, and every step has its own checks on the screen as it is after that step,
 * so a change that breaks something asked for earlier shows up.
 *
 * All the data is in the first request, the way a chatbot that has fetched it would pass it on.
 * Every figure a check looks for is worked out in the comments, and sessionReference holds a
 * working SayShape screen for each step, which test/sessions.test.ts runs through its checks.
 */
import type { TaskCheck } from "./tasks";

export interface SessionStep {
  request: string;
  checks: TaskCheck[];
}

export interface Session {
  id: string;
  title: string;
  steps: SessionStep[];
}

/**
 * Some piece of text matching `a` with a piece matching `b` at most `reach` pieces away (or in
 * the same piece): a stat's label next to its value, a name next to its badge.
 */
export function near(text: string[], a: RegExp, b: RegExp, reach = 2): boolean {
  return text.some((p, i) => a.test(p) && text.slice(Math.max(0, i - reach), i + reach + 1).some((q) => b.test(q)));
}

const FLAG = /under|below|less than|low|flag|short|⚠|!/i;

/** A number on its own, with any sign, unit or decimals around it ("$515K", "$420.00"), but not inside a longer one ("1,420"). */
const num = (n: number) => new RegExp(`(^|[^\\d.,])${n}(?!\\d|,\\d)`);

export const sessions: Session[] = [
  // Totals by region: NA 120 + 90 = 210, EU 80 + 70 = 150, APAC 60 + 95 = 155; all 515, best NA.
  {
    id: "s1", title: "Sales by region",
    steps: [
      { request: "Here are this quarter's sales in $K by region and product: NA Laptops 120, NA Phones 90, EU Laptops 80, EU Phones 70, APAC Laptops 60, APAC Phones 95. Show total sales by region as a bar chart.",
        checks: [{ label: "the three regions", shows: [/\bNA\b|North America/, /\bEU\b|Europe/, /APAC|Asia/] }] },
      { request: "Add KPI cards above the chart for total sales and the best region.",
        checks: [
          { label: "total sales (515)", shows: [num(515)] },
          { label: "names NA as the best region", test: (t) => near(t, /best|top|lead|highest/i, /\bNA\b|North America/) },
          { label: "the chart is still there", shows: [/APAC|Asia/] },
        ] },
      { request: "Now show Europe only: the KPIs and the chart should cover just Europe.",
        // Region names can stay in a filter's options; the other regions' totals (210, 155) and the overall 515 can't.
        checks: [{ label: "Europe's total (150), no other region's figures", shows: [num(150), /\bEU\b|Europe/], hides: [num(515), num(210), num(155)] }] },
      { request: "Split Europe's sales by product.",
        checks: [{ label: "Laptops 80 and Phones 70, still Europe only", shows: [/Laptops/, /Phones/, num(80), num(70)], hides: [num(515), num(210), num(155), num(95)] }] },
    ],
  },

  // Tickets per person: Ana 2, Ben 1, Chen 2; after #102 goes, Ben has none and Chen still 2.
  {
    id: "s2", title: "Support tickets",
    steps: [
      { request: "Here are our open support tickets: #101 Login fails (High, Ana); #102 Slow export (Medium, Ben); #103 Typo on page (Low, Ana); #104 Data missing (High, Chen); #105 Billing error (Medium, Chen). Show them as a table.",
        checks: [{ label: "all five tickets", shows: [/Login fails/, /Slow export/, /Typo on page/, /Data missing/, /Billing error/] }] },
      { request: "Add a priority filter: All, High, Medium and Low.",
        checks: [
          { label: "all five at first", shows: [/Login fails/, /Billing error/] },
          { label: "High shows only the high-priority tickets", steps: [{ press: /^\s*High\s*$/ }], shows: [/Login fails/, /Data missing/], hides: [/Slow export/, /Typo on page/] },
        ] },
      { request: "Also show how many open tickets each person has.",
        checks: [
          // A chart draws its labels and then its values, so a count can be three pieces from its name.
          { label: "Ana 2, Ben 1, Chen 2", test: (t) => near(t, /\bAna\b/, num(2), 3) && near(t, /\bBen\b/, num(1), 3) && near(t, /\bChen\b/, num(2), 3) },
          { label: "the table is still there", shows: [/Login fails/, /Typo on page/] },
        ] },
      { request: "Ticket #102 is resolved now, so remove it.",
        checks: [{ label: "Slow export is gone, the rest stay, Chen still has 2", shows: [/Login fails/, /Billing error/], hides: [/Slow export/], test: (t) => near(t, /\bChen\b/, num(2), 3) }] },
    ],
  },

  // Budget 1,500 + 600 + 200 + 150 = 2,450; spent 1,500 + 420 + 90 + 180 = 2,190; only Fun is over (by 30).
  // Left: Rent 0, Food 180, Transport 110, Fun -30.
  {
    id: "s3", title: "Monthly budget",
    steps: [
      { request: "Monthly budget: Rent $1,500, Food $600, Transport $200, Fun $150. Spent so far: Rent $1,500, Food $420, Transport $90, Fun $180. Show the budget against what was spent for each category.",
        // A chart of budget against spent is a fine answer, and a bar's height can't be read as text, so only the categories are checked.
        checks: [{ label: "every category", shows: [/Rent/, /Food/, /Transport/, /Fun/] }] },
      { request: "Highlight the categories that are over budget.",
        // Highlighting may be color alone, which isn't checked (as nowhere in the benchmark): this step only checks nothing was lost.
        checks: [{ label: "every category is still there", shows: [/Rent/, /Food/, /Transport/, /Fun/] }] },
      { request: "Add totals: the total budget and the total spent.",
        checks: [{ label: "total budget 2,450 and spent 2,190", shows: [/2,?450/, /2,?190/] }] },
      { request: "Show the money left in each category instead of what was spent.",
        checks: [{ label: "left: Food 180, Transport 110, Fun -30, and spent figures gone", shows: [num(110), /[-−–]\s?\$?30\b|\(\$?30(\.00)?\)/], hides: [num(420)] }] },
    ],
  },

  // Team totals: Design 32, Engineering 40 + 28 = 68, Sales 36; Chen (28) is under 30.
  // Adding Eli (Sales, 25): Sales 61, and Eli is under 30 too.
  {
    id: "s4", title: "Team hours",
    steps: [
      { request: "Our team's hours this week: Ana (Design) 32, Ben (Engineering) 40, Chen (Engineering) 28, Dee (Sales) 36. Show each person's hours as a horizontal bar chart.",
        checks: [{ label: "everyone on the chart", shows: [/\bAna\b/, /\bBen\b/, /\bChen\b/, /\bDee\b/] }] },
      { request: "Add each team's total hours.",
        // 68 and 61 are only ever team totals, so they're checked on their own.
        checks: [{ label: "Engineering 68", shows: [/Engineering/, num(68)] }, { label: "the chart is still there", shows: [/\bDee\b/] }] },
      { request: "Flag anyone under 30 hours.",
        // A row can repeat its figures (a bar, its value, a label) before the flag, so the flag may be four pieces on.
        checks: [{ label: "Chen is flagged", test: (t) => near(t, /\bChen\b/, FLAG, 4) }] },
      { request: "Add Eli to Sales with 25 hours.",
        checks: [
          { label: "Eli is there, and Sales is now 61", shows: [/\bEli\b/, num(61)] },
          { label: "Eli is flagged too", test: (t) => near(t, /\bEli\b/, FLAG, 4) },
        ] },
    ],
  },
];

const REGIONS = `sales=[{region: "NA", product: "Laptops", k: 120}, {region: "NA", product: "Phones", k: 90}, {region: "EU", product: "Laptops", k: 80}, {region: "EU", product: "Phones", k: 70}, {region: "APAC", product: "Laptops", k: 60}, {region: "APAC", product: "Phones", k: 95}]`;
const TICKETS = (drop102: boolean) => `tickets=[{id: "#101", title: "Login fails", priority: "High", owner: "Ana"}, ${drop102 ? "" : `{id: "#102", title: "Slow export", priority: "Medium", owner: "Ben"}, `}{id: "#103", title: "Typo on page", priority: "Low", owner: "Ana"}, {id: "#104", title: "Data missing", priority: "High", owner: "Chen"}, {id: "#105", title: "Billing error", priority: "Medium", owner: "Chen"}]`;
const BUDGET = `cats=[{cat: "Rent", budget: 1500, spent: 1500}, {cat: "Food", budget: 600, spent: 420}, {cat: "Transport", budget: 200, spent: 90}, {cat: "Fun", budget: 150, spent: 180}]`;
const TEAM = (eli: boolean) => `people=[{name: "Ana", team: "Design", hours: 32}, {name: "Ben", team: "Engineering", hours: 40}, {name: "Chen", team: "Engineering", hours: 28}, {name: "Dee", team: "Sales", hours: 36}${eli ? `, {name: "Eli", team: "Sales", hours: 25}` : ""}]`;

const ticketTable = `table items={pick == 'All' ? tickets : filter(tickets, 'priority', pick)}
    table-column "Ticket" field=id
    table-column "Title" field=title
    table-column "Priority" field=priority
    table-column "Owner" field=owner`;
const perPerson = `  table "Open tickets per person" items={group(tickets, 'owner')}
    table-column "Person" field=owner
    table-column "Tickets" field=count format=number`;
const teamChart = `  chart "Hours this week" kind=hbar items=people x=name y=hours`;
const teamTotals = `  table "Team totals" items={group(people, 'team', 'hours')}
    table-column "Team" field=team
    table-column "Hours" field=hours format=number`;
const flags = `  each items={filter(people, 'short', true)} as=p
    callout "{p.name} is under 30 hours ({p.hours})" tone=warn`;

/** A working SayShape screen after each step: sessionReference[id][step]. */
export const sessionReference: Record<string, string[]> = {
  s1: [
    `state ${REGIONS}
chart "Sales by region ($K)" kind=bar items={group(sales, 'region', 'k')} x=region y=k`,
    `state ${REGIONS}
derive byRegion={group(sales, 'region', 'k')}
grid min=140 gap=12
  stat label="Total sales" value="\${sum(sales, 'k')}K"
  stat label="Best region" value="{first(sort(byRegion, 'k', 'desc')).region}"
chart "Sales by region ($K)" kind=bar items=byRegion x=region y=k`,
    `state ${REGIONS}
derive eu={filter(sales, 'region', 'EU')}
grid min=140 gap=12
  stat label="Europe sales" value="\${sum(eu, 'k')}K"
chart "Europe sales ($K)" kind=bar items={group(eu, 'region', 'k')} x=region y=k`,
    `state ${REGIONS}
derive eu={filter(sales, 'region', 'EU')}
grid min=140 gap=12
  stat label="Europe sales" value="\${sum(eu, 'k')}K"
chart "Europe sales by product ($K)" kind=bar items=eu x=product y=k`,
  ],
  s2: [
    `state ${TICKETS(false)}
table items=tickets
  table-column "Ticket" field=id
  table-column "Title" field=title
  table-column "Priority" field=priority
  table-column "Owner" field=owner`,
    `state pick="All" ${TICKETS(false)}
column gap=12
  segmented bind=pick options="All,High,Medium,Low" label="Priority"
  ${ticketTable}`,
    `state pick="All" ${TICKETS(false)}
column gap=12
  segmented bind=pick options="All,High,Medium,Low" label="Priority"
  ${ticketTable}
${perPerson}`,
    `state pick="All" ${TICKETS(true)}
column gap=12
  segmented bind=pick options="All,High,Medium,Low" label="Priority"
  ${ticketTable}
${perPerson}`,
  ],
  s3: [
    `state ${BUDGET}
table items=cats
  table-column "Category" field=cat
  table-column "Budget" field=budget format=money
  table-column "Spent" field=spent format=money`,
    `state ${BUDGET}
column gap=12
  table items=cats
    table-column "Category" field=cat
    table-column "Budget" field=budget format=money
    table-column "Spent" field=spent format=money
  each items=cats as=c
    callout "{c.cat} is over budget" detail="{money(c.spent - c.budget)} over" tone=bad if={c.spent > c.budget}`,
    `state ${BUDGET}
column gap=12
  grid min=140 gap=12
    stat label="Total budget" value="{money(sum(cats, 'budget'))}"
    stat label="Total spent" value="{money(sum(cats, 'spent'))}"
  table items=cats
    table-column "Category" field=cat
    table-column "Budget" field=budget format=money
    table-column "Spent" field=spent format=money
  each items=cats as=c
    callout "{c.cat} is over budget" detail="{money(c.spent - c.budget)} over" tone=bad if={c.spent > c.budget}`,
    `state ${BUDGET}
column gap=12
  grid min=140 gap=12
    stat label="Total budget" value="{money(sum(cats, 'budget'))}"
    stat label="Total left" value="{money(sum(cats, 'budget') - sum(cats, 'spent'))}"
  list
    each items=cats as=c
      list-item "{c.cat}" trailing="{money(c.budget - c.spent)} left" detail="{c.spent > c.budget ? 'Over budget' : 'Within budget'}"`,
  ],
  s4: [
    `state ${TEAM(false)}
${teamChart.trim()}`,
    `state ${TEAM(false)}
column gap=12
${teamChart}
${teamTotals}`,
    `state ${TEAM(false).replace(/hours: (\d+)\}/g, (_, h: string) => `hours: ${h}, short: ${Number(h) < 30}}`)}
column gap=12
${teamChart}
${teamTotals}
${flags}`,
    `state ${TEAM(true).replace(/hours: (\d+)\}/g, (_, h: string) => `hours: ${h}, short: ${Number(h) < 30}}`)}
column gap=12
${teamChart}
${teamTotals}
${flags}`,
  ],
};
