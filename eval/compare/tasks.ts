/**
 * The SayShape vs HTML benchmark: requests every model answers twice, once in
 * SayShape and once as an HTML fragment. All data is in the request, so both
 * answers can be checked against the same figures.
 *
 * A check starts from a fresh screen, runs its steps (type into a field,
 * press something by its text), then looks at the visible text. Checks only
 * use what a person would see and do, so they mean the same for both formats.
 * Things neither format can show as text (a color, a bar's height) aren't
 * checked.
 */

/**
 * Type into the nth text field, or press something by its text. An optional
 * press may find nothing: a correctly disabled button can't be pressed at all.
 */
export type Step = { type: [nth: number, value: string] } | { press: RegExp; optional?: boolean };

export interface TaskCheck {
  label: string;
  steps?: Step[];
  /** Each must match somewhere in the visible text (joined with newlines). */
  shows?: RegExp[];
  /** None may match. */
  hides?: RegExp[];
  /** The visible text must differ from before the steps. */
  changes?: boolean;
  /** A custom test on the visible text after the steps, and before them. */
  test?: (after: string[], before: string[]) => boolean;
  /** Text from the data must stay text: no element may be made from it (HTML only can fail this). */
  safe?: boolean;
}

export interface Task {
  id: string;
  category: "kpi" | "chart" | "table" | "form" | "calculator" | "dashboard" | "security";
  request: string;
  checks: TaskCheck[];
}

/** Names from a list, in the order they appear on screen. */
const orderOf = (text: string[], names: string[]) => text.filter((t) => names.includes(t.trim())).map((t) => t.trim());
const count = (text: string[], re: RegExp) => text.join("\n").match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))?.length ?? 0;

const PEOPLE = ["Ana", "Ben", "Chen", "Dee", "Eli", "Fay"];
const BY_RATING = ["Dee", "Ben", "Eli", "Fay", "Ana", "Chen"];
const HOSTILE = `<img src=x onerror=alert(1)>`;

export const tasks: Task[] = [
  // KPIs
  { id: "k1", category: "kpi", request: "Show three KPI cards: Revenue $1.24M up 12%, Active users 48,210 up 5.4%, Churn 2.1% down 0.4 points. For churn, going down is good news.",
    checks: [{ label: "shows the three figures", shows: [/1\.24\s?M/, /48,210/, /2\.1\s?%/] }, { label: "shows each change", shows: [/12\s?%/, /5\.4\s?%/, /0\.4/] }] },
  { id: "k2", category: "kpi", request: "Website visits for the last 7 days were 1200, 1350, 1280, 1500, 1620, 1580, 1710. Show today's visits as a big number, the percent change from the first day, and a small trend line of all 7 days.",
    checks: [{ label: "shows today's visits (1,710)", shows: [/1,?710/] }, { label: "shows the change from the first day (42.5%)", shows: [/42\.5\s?%/] }] },
  { id: "k3", category: "kpi", request: "Budget tracker: $7,400 spent of a $10,000 budget. Show percent used, a progress bar, and the amount remaining.",
    checks: [{ label: "shows 74% used", shows: [/74(\.0)?\s?%/] }, { label: "shows $2,600 remaining", shows: [/2,600/] }] },
  { id: "k4", category: "kpi", request: "Compare this month with last month: orders 320 vs 290, average order value $58 vs $61, refunds 12 vs 18. Show each metric with its change; fewer refunds is good.",
    checks: [{ label: "shows this month's figures", shows: [/320/, /\$58/, /\b12\b/] }, { label: "shows the changes", shows: [/10\.3\s?%|\+\s?30\b/, /4\.9\s?%|[-−–]\s?\$?3(\.00)?\b/, /33(\.3)?\s?%|[-−–]\s?6\b/] }] },

  // Charts
  { id: "c1", category: "chart", request: "Bar chart of sales by region: NA 420, EU 310, APAC 280, LATAM 120 (thousands of dollars).",
    checks: [{ label: "labels all four regions", shows: [/\bNA\b/, /\bEU\b/, /APAC/, /LATAM/] }] },
  { id: "c2", category: "chart", request: "Line chart of monthly revenue Jan-Jun, this year 12, 18, 15, 21, 24, 22 and last year 10, 14, 16, 17, 19, 20 ($K).",
    checks: [{ label: "labels Jan to Jun", shows: [/Jan/, /Jun/] }, { label: "names both series", shows: [/this year/i, /last year/i] }] },
  { id: "c3", category: "chart", request: "Donut chart of traffic sources: Search 46%, Direct 28%, Social 16%, Email 10%.",
    checks: [{ label: "names every source", shows: [/Search/, /Direct/, /Social/, /Email/] }, { label: "shows the shares", shows: [/46/, /28/, /16/, /10/] }] },
  { id: "c4", category: "chart", request: "From these products, chart the top 5 by units sold, largest first: Lamp 120, Desk 340, Chair 410, Shelf 95, Rug 210, Mirror 180, Sofa 60, Stool 150.",
    checks: [{ label: "the top 5 in order", shows: [/Chair[\s\S]*Desk[\s\S]*Rug[\s\S]*Mirror[\s\S]*Stool/] }, { label: "leaves out the rest", hides: [/Lamp/, /Shelf/, /Sofa/] }] },
  { id: "c5", category: "chart", request: "Signups chart with a Week/Month toggle. Week: Mon-Sun 30, 42, 38, 51, 47, 22, 18. Month: weeks 1-4 210, 245, 230, 268.",
    checks: [{ label: "shows the week by default", shows: [/Mon/, /Sun/] }, { label: "Month shows the four weeks", steps: [{ press: /^\s*Month\s*$/i }], hides: [/\bMon\b/], shows: [/268|Week\s?4|W(k)?\s?4/i] }] },

  // Tables
  { id: "t1", category: "table", request: "Sortable table of employees: Ana (Design, 2019, 4.8 rating), Ben (Engineering, 2021, 4.2), Chen (Engineering, 2018, 4.9), Dee (Sales, 2022, 3.9), Eli (Design, 2020, 4.5), Fay (Sales, 2017, 4.6). Clicking a column header sorts by it.",
    checks: [
      { label: "shows all six people", test: (t) => PEOPLE.every((n) => orderOf(t, PEOPLE).includes(n)) },
      { label: "pressing the Rating header sorts by rating", steps: [{ press: /^\s*Rating\b/i }], test: (t) => { const o = orderOf(t, PEOPLE).join(); return o === BY_RATING.join() || o === [...BY_RATING].reverse().join(); } },
    ] },
  { id: "t2", category: "table", request: "Product table with a search box that filters by name as you type, and a count of matching rows: Notebook $4, Pen $2, Pencil $1, Backpack $35, Ruler $3, Marker $5, Paper pack $8, Pen case $9.",
    checks: [
      { label: "shows all eight products", shows: [/Notebook/, /Backpack/, /Paper pack/, /Pen case/] },
      { label: "typing 'pen' leaves Pen, Pencil and Pen case", steps: [{ type: [0, "pen"] }], shows: [/Pencil/, /Pen case/], hides: [/Notebook/, /Backpack/, /Ruler/] },
    ] },
  { id: "t3", category: "table", request: "Table of orders (A1 Acme $1,200 Shipped; A2 Globex $860 Pending; A3 Initech $2,310 Shipped; A4 Umbrella $410 Cancelled). Clicking a row shows that order's details below the table.",
    checks: [{ label: "clicking A3 shows its details", steps: [{ press: /\bA3\b/ }], test: (after, before) => count(after, /Initech/) > count(before, /Initech/) || count(after, /2,310/) > count(before, /2,310/) }] },
  { id: "t4", category: "table", request: "Invoice list with a status badge per row and a total of all amounts at the bottom: INV-1 $500 Paid, INV-2 $1,250 Overdue, INV-3 $320 Draft, INV-4 $780 Paid. Paid is green, Overdue red, Draft grey.",
    checks: [{ label: "shows every status", shows: [/Paid/, /Overdue/, /Draft/] }, { label: "shows the total ($2,850)", shows: [/2,850/] }] },

  // Forms
  { id: "f1", category: "form", request: "Sign-up form with name, email, a plan choice (Free, Pro, Team) and an 'I agree to the terms' checkbox. The submit button only works when name and email are filled and the box is ticked; after submitting, show 'Welcome, <name>!'.",
    checks: [
      { label: "submitting an empty form doesn't welcome", steps: [{ press: /^\s*(create account|sign up|submit|register|join|get started)/i, optional: true }], hides: [/Welcome/i] },
      { label: "a complete form welcomes by name", steps: [{ type: [0, "Ada"] }, { type: [1, "ada@example.com"] }, { press: /agree/i }, { press: /^\s*(create account|sign up|submit|register|join|get started)/i }], shows: [/Welcome,?\s*Ada/i] },
    ] },
  { id: "f2", category: "form", request: "To-do list starting with 'Buy milk' (done) and 'Call mom' (not done). People can add items, tick them off, and remove them. Show how many are left.",
    checks: [{ label: "shows both items", shows: [/Buy milk/, /Call mom/] }, { label: "adding an item shows it", steps: [{ type: [0, "Walk the dog"] }, { press: /^\s*(\+\s*)?add\b/i }], shows: [/Walk the dog/] }] },
  { id: "f3", category: "form", request: "Settings panel with switches for Notifications (on), Auto-save (on), Beta features (off), and a theme choice of Light, Dark or System (System chosen). Show a one-line summary of the current settings that updates live.",
    checks: [{ label: "names every setting", shows: [/Notifications/, /Auto-?save/i, /Beta/, /System/] }, { label: "choosing Dark updates the summary", steps: [{ press: /^\s*Dark\s*$/ }], changes: true }] },
  { id: "f4", category: "form", request: "Feedback card with a 1-5 star rating and a comment box. A Send button shows 'Thanks! You rated us X stars.' and is ignored if no rating is chosen.",
    checks: [{ label: "sending without a rating doesn't thank", steps: [{ press: /^\s*(send|submit)/i, optional: true }], hides: [/thanks/i] }] },

  // Calculators
  { id: "x1", category: "calculator", request: "Mortgage calculator with loan amount ($300,000), interest rate (6.5%) and term (30 years) controls. Show the monthly payment using the standard amortization formula, updating as controls change.",
    checks: [{ label: "the payment at the defaults ($1,896.20)", shows: [/1,?896\.2/] }] },
  { id: "x2", category: "calculator", request: "Tip splitter: bill amount ($84.50), tip choice of 15%, 18% or 20% (18% chosen), and number of people (3). Show tip total, grand total and amount per person.",
    checks: [{ label: "tip, total and share at the defaults", shows: [/15\.21/, /99\.71/, /33\.24/] }, { label: "choosing 20% updates the share ($33.80)", steps: [{ press: /^\s*20\s?%\s*$/ }], shows: [/33\.80?\b/] }] },
  { id: "x3", category: "calculator", request: "Distance converter: type a number and choose km-to-miles or miles-to-km; show the converted value to 2 decimals. Start with 10 km to miles.",
    checks: [{ label: "10 km is 6.21 miles", shows: [/6\.21/] }, { label: "miles to km converts 10 to 16.09", steps: [{ press: /mi(les?)?\s*(to|→|->|⇒)\s*k(ilo)?m/i }], shows: [/16\.09/] }] },

  // Dashboards
  { id: "d1", category: "dashboard", request: "Sales dashboard. Orders: A101 Acme NA Direct Shipped $12,400; A102 Globex EU Partner Pending $8,600; A103 Initech NA Online Shipped $23,100; A104 Umbrella APAC Direct Cancelled $4,100; A105 Stark NA Direct Pending $31,500; A106 Wayne EU Online Shipped $17,800; A107 Tyrell APAC Partner Shipped $9,900; A108 Soylent APAC Online Pending $14,300. Include a region filter (All, NA, EU, APAC), a customer search, KPIs for revenue, order count, average order and pending count that follow the filter, a chart of the top customers, and a sortable orders table.",
    checks: [
      // $117,600 leaves out the cancelled order, which is a fair reading of revenue.
      { label: "revenue for all regions ($121,700, or $117,600 without the cancelled order)", shows: [/121[.,]7|117[.,]6/] },
      { label: "EU shows $26,400 and hides NA orders", steps: [{ press: /^\s*EU\s*$/ }], shows: [/26[.,]4/], hides: [/Stark/] },
    ] },
  { id: "d2", category: "dashboard", request: "Support dashboard. Tickets per day Mon-Fri: 34, 41, 29, 38, 45. Open tickets: #201 'Login fails' High Ana; #202 'Slow export' Medium Ben; #203 'Typo on page' Low Ana; #204 'Data missing' High Chen; #205 'Billing error' Medium Chen. Show open count, high-priority count, a chart of tickets per day, and the open tickets table with a priority filter (All, High, Medium, Low).",
    checks: [
      { label: "shows the chart days and the tickets", shows: [/Mon/, /Fri/, /Login fails/, /Billing error/] },
      { label: "High shows only high-priority tickets", steps: [{ press: /^\s*High\s*$/ }], shows: [/Login fails/, /Data missing/], hides: [/Slow export/, /Typo on page/] },
    ] },
  { id: "d3", category: "dashboard", request: "Project tracker. Tasks: Design mockups (Website, Ana, done), Build pages (Website, Ben, not done), Write copy (Website, Ana, done), Set up CI (App, Chen, done), Login screen (App, Ben, not done), Push alerts (App, Chen, not done). Show progress per project, an owner filter (All, Ana, Ben, Chen), and the task list where ticking a task updates progress.",
    checks: [
      { label: "progress at the start (Website 2 of 3, App 1 of 3)", shows: [/2\s*(\/|of)\s*3|66\.7|67\s?%/, /1\s*(\/|of)\s*3|33(\.3)?\s?%/] },
      { label: "ticking Build pages completes Website", steps: [{ press: /Build pages/ }], shows: [/3\s*(\/|of)\s*3|100\s?%/] },
      { label: "Ben shows only Ben's tasks", steps: [{ press: /^\s*Ben\s*$/ }], shows: [/Build pages/, /Login screen/], hides: [/Design mockups/, /Push alerts/] },
    ] },
  { id: "d4", category: "dashboard", request: "Personal spending tracker. Expenses: Groceries Food $82; Gas Transport $45; Dinner out Food $64; Movie Fun $18; Bus pass Transport $30. Show total spent, a donut of spending by category, and a form to add an expense (name, category from Food/Transport/Fun, amount) that updates the total and the donut.",
    checks: [
      { label: "total spent ($239)", shows: [/\$?239\b/] },
      { label: "spending by category (146, 75, 18)", shows: [/146/, /\b75\b/, /\b18\b/] },
      { label: "adding a $20 expense makes the total $259", steps: [{ type: [0, "Taxi"] }, { type: [1, "20"] }, { press: /^\s*(\+\s*)?add\b/i }], shows: [/\$?259\b/] },
    ] },

  // Security: data that looks like markup must stay text.
  { id: "s1", category: "security", request: `Customer table with name, city and orders. Show the names exactly as given, symbols included: "Acme" (Phoenix, 12), "${HOSTILE}" (Tucson, 3), "Globex" (Mesa, 7).`,
    checks: [{ label: "markup in the data stays text", safe: true, shows: [/Acme/, /Globex/] }] },
  { id: "s2", category: "security", request: "A greeting box: a name field, and below it 'Hello, <name>!' that updates as you type.",
    checks: [{ label: "markup typed into the field stays text", safe: true, steps: [{ type: [0, HOSTILE] }], shows: [/Hello/] }] },
];
