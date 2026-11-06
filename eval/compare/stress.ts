/**
 * Harder requests, to stress a model's grasp of SayShape (and to see whether the compact guide
 * holds up against the full one): several screens, pagination, multi-select filtering, grouped
 * totals, the less common chart kinds, and figures that must be worked out and stay right as the
 * screen is used. Run them with `npm run compare -- --set stress`.
 *
 * Checks work like those in tasks.ts: what's visible, and what happens when it's used. Every
 * figure a check looks for is worked out in the comments, and stressReference holds a working
 * SayShape answer to each, which test/stress.test.ts runs through every check.
 */
import type { Task } from "./tasks";

const ORDERS = "A1 Acme $1,200 Shipped; A2 Globex $860 Pending; A3 Initech $2,310 Shipped; A4 Umbrella $410 Cancelled";
const STAFF = ["Ava", "Ben", "Cal", "Dia", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kai", "Liv"];
const TEAMS = ["Sales", "Ops", "Design", "Sales", "Ops", "Design", "Sales", "Ops", "Design", "Sales", "Ops", "Design"];

export const stressTasks: Task[] = [
  // Two screens and moving between them.
  { id: "z1", category: "app", request: `An orders app with two screens. The first lists these orders: ${ORDERS}. Pressing an order opens a second screen showing that order's customer, amount and status, with a Back button that returns to the list.`,
    checks: [
      { label: "starts on the list of all four orders", shows: [/Acme/, /Globex/, /Initech/, /Umbrella/] },
      { label: "pressing A3 opens its own screen", steps: [{ press: /\bA3\b|Initech/ }], shows: [/Initech/, /2,?310/, /Shipped/], hides: [/Acme/, /Umbrella/] },
      { label: "Back returns to the list", steps: [{ press: /\bA3\b|Initech/ }, { press: /^\s*(←\s*)?Back\b/i }], shows: [/Acme/, /Umbrella/] },
    ] },

  // Pagination: 12 people, 5 a page, so pages of 5, 5 and 2.
  { id: "z2", category: "table", request: `Staff directory with 5 people per page and page buttons, and a line saying which page is shown, like "Page 1 of 3": ${STAFF.map((n, i) => `${n} (${TEAMS[i]})`).join(", ")}.`,
    checks: [
      { label: "page 1 shows the first five only", shows: [/\bAva\b/, /\bEve\b/], hides: [/\bFay\b/, /\bLiv\b/] },
      { label: "page 3 shows the last two and says so", steps: [{ press: /^\s*3\s*$/ }], shows: [/\bKai\b/, /\bLiv\b/, /\b3\s*(of|\/)\s*3\b/i], hides: [/\bAva\b/, /\bJon\b/] },
    ] },

  // Several values chosen at once. Total 565; without Europe 565 - 90 - 80 = 395.
  { id: "z3", category: "dashboard", request: "Sales by quarter and region with a filter where several regions can be chosen at once (all three chosen at first), a table of the rows that match, and a total that follows the filter: Q1 North America 120, Q1 Europe 90, Q1 Asia 60, Q2 North America 140, Q2 Europe 80, Q2 Asia 75.",
    checks: [
      { label: "total for all regions (565)", shows: [/\b565\b/] },
      { label: "leaving out Europe makes the total 395", steps: [{ press: /^\s*Europe\s*$/ }], shows: [/\b395\b/] },
    ] },

  // Waterfall. 500 - 210 - 145 - 38 = 107; margin 107 / 500 = 21.4%.
  { id: "z4", category: "chart", request: "Profit bridge for Q3 in $K: Revenue 500, Cost of goods -210, Operating costs -145, Tax -38. Show it as a waterfall ending in a Net income bar, plus a stat with the net income and one with the margin as a percent of revenue.",
    checks: [
      { label: "names the steps and Net income", shows: [/Revenue/, /Cost of goods/, /Tax/, /Net income/i] },
      // 107 with or without a unit after it: "107", "$107K".
      { label: "net income (107) and margin (21.4%)", shows: [/\b107(?![\d.,])/, /21\.4\s?%/] },
    ] },

  // Heatmap, and a figure found from the data: Wed 6pm (41) is the busiest.
  { id: "z5", category: "chart", request: "Orders by weekday and time of day: Mon 9am 12, Mon 12pm 30, Mon 6pm 18; Tue 9am 15, Tue 12pm 34, Tue 6pm 22; Wed 9am 11, Wed 12pm 29, Wed 6pm 41; Thu 9am 14, Thu 12pm 37, Thu 6pm 25. Show a heatmap of it and a callout naming the busiest day and time with its number of orders.",
    checks: [
      { label: "the heatmap's days", shows: [/Mon/, /Thu/] },
      // Day and time in one piece of text: the callout, not two labels of the heatmap.
      { label: "names the busiest slot, Wed 6pm (41)", shows: [/Wed[^\n]{0,40}6\s?pm|6\s?pm[^\n]{0,40}Wed/i, /\b41\b/] },
    ] },

  // A cart. Subtotal 59.99 + 19.50 + 12.00 = 91.49; tax 7.32; total 98.81.
  // With SAVE10: 91.49 * 0.9 * 1.08 = 88.93 (the same whether the 10% comes before or after tax).
  { id: "z6", category: "calculator", request: "Shopping cart: Headphones $59.99, Charger $19.50, Case $12.00, each starting at quantity 1 with plus and minus buttons. Show the subtotal, 8% tax and the total, all updating as quantities change. A discount code field: typing SAVE10 takes 10% off.",
    checks: [
      { label: "subtotal and total at the start ($91.49, $98.81)", shows: [/91\.49/, /98\.81/] },
      { label: "SAVE10 brings the total to $88.93", steps: [{ type: [0, "SAVE10"] }], shows: [/88\.93/] },
    ] },

  // A quiz scored from the choices made.
  { id: "z7", category: "form", request: "A 3-question quiz with radio choices: 1. Capital of Australia? Sydney, Canberra, Melbourne (answer Canberra). 2. 7 × 8? 54, 56, 64 (answer 56). 3. Largest planet? Saturn, Jupiter, Neptune (answer Jupiter). A 'Check answers' button shows the score as 'You got X of 3'.",
    checks: [
      { label: "all right scores 3 of 3", steps: [{ press: /^\s*Canberra\s*$/ }, { press: /^\s*56\s*$/ }, { press: /^\s*Jupiter\s*$/ }, { press: /check answers/i }], shows: [/\b3\s*(of|\/)\s*3\b/] },
      { label: "one right scores 1 of 3", steps: [{ press: /^\s*Sydney\s*$/ }, { press: /^\s*56\s*$/ }, { press: /^\s*Saturn\s*$/ }, { press: /check answers/i }], shows: [/\b1\s*(of|\/)\s*3\b/] },
    ] },

  // Tabs whose sections share state: ticking a task changes the overview.
  { id: "z8", category: "dashboard", request: "Project page with tabs Overview, Tasks and Team. Overview shows 'X of 5 tasks done' and a progress bar. Tasks lists 5 tasks with checkboxes: Spec and Design done; Build, Test and Launch not done. Team lists Ana (Lead), Ben (Developer) and Chen (Designer).",
    checks: [
      { label: "the overview at the start (2 of 5)", shows: [/\b2\s*(of|\/)\s*5\b/] },
      { label: "Team shows the people", steps: [{ press: /^\s*Team\s*$/ }], shows: [/Ana/, /Chen/], hides: [/\bLaunch\b/] },
      { label: "ticking Build makes it 3 of 5", steps: [{ press: /^\s*Tasks\s*$/ }, { press: /^\s*Build\s*$/ }, { press: /^\s*Overview\s*$/ }], shows: [/\b3\s*(of|\/)\s*5\b/] },
    ] },

  // Comparison with a billing switch: yearly is 10 x monthly.
  { id: "z9", category: "table", request: "Compare three plans side by side with a Monthly/Yearly switch, marking the best value in each row: Basic $9 a month, 10 GB storage, 1 user; Pro $29 a month, 100 GB, 5 users; Team $79 a month, 1,000 GB, 20 users. Yearly prices are 10 times the monthly price.",
    checks: [
      { label: "the three plans at monthly prices", shows: [/Basic/, /\bPro\b/, /Team/, /\$?29\b/, /\$?79\b/] },
      { label: "Yearly shows $290 and $790", steps: [{ press: /^\s*Yearly\s*$/ }], shows: [/\$?290\b/, /\$?790\b/] },
    ] },

  // Grouped totals. Total 2,163; Food 320 + 85 + 28 = 433; Fun 15 + 110 = 125; Transport 60 + 45 = 105.
  { id: "z10", category: "dashboard", request: "Expense report: Rent Housing $1,500; Groceries Food $320; Dinner Food $85; Gas Transport $60; Bus Transport $45; Streaming Fun $15; Concert Fun $110; Coffee Food $28. Show the total spent, a donut by category, a table of category totals largest first, and a callout naming the largest category other than Housing with its total.",
    checks: [
      { label: "total spent ($2,163)", shows: [/2,?163/] },
      { label: "category totals (433, 125, 105)", shows: [/\b433\b/, /\b125\b/, /\b105\b/] },
      // A callout's title and detail line are separate pieces, so $433 may be in the piece after the one naming Food.
      { label: "the callout names Food ($433)", test: (t) => t.some((p, i) => /Food/.test(p) && /larg|bigg|top|most|lead|highest|other than|after|besides|excluding/i.test(p) && (/\b433\b/.test(p) || /\b433\b/.test(t[i + 1] ?? ""))) },
    ] },
  // The ultra-hard one: a whole small app in one request. Figures, all regions:
  // open pipeline (Lead + Qualified) 12,000 + 18,000 + 22,000 + 30,000 + 8,000 = 90,000;
  // won 25,000 + 40,000 + 15,000 + 11,000 = 91,000; win rate 4 won / (4 + 3 lost) = 57.1%.
  // Without Europe (Globex, Wayne, Soylent, Cyberdyne): open 64,000, won 76,000, 3 / (3 + 2) = 60%.
  // Adding Zeta for $5,000 (a Lead, North America) makes the open pipeline 95,000.
  { id: "z11", category: "app", request: "A sales pipeline app with two screens. Deals: Acme (North America, Lead, $12,000, owner Ana); Globex (Europe, Qualified, $18,000, owner Ben); Initech (North America, Won, $25,000, owner Ana); Umbrella (Asia Pacific, Lost, $9,000, owner Chen); Stark (North America, Won, $40,000, owner Ben); Wayne (Europe, Won, $15,000, owner Chen); Tyrell (Asia Pacific, Qualified, $22,000, owner Ana); Soylent (Europe, Lost, $7,000, owner Ben); Hooli (North America, Qualified, $30,000, owner Chen); Vandelay (Asia Pacific, Won, $11,000, owner Ana); Cyberdyne (Europe, Lead, $8,000, owner Ben); Oscorp (North America, Lost, $14,000, owner Chen). "
      + "The first screen has: a region filter where several regions can be chosen at once (all chosen at first); KPIs for open pipeline (total of Lead and Qualified deals), won revenue (total of Won deals) and win rate (Won deals divided by Won plus Lost deals, as a percent with one decimal); a bar chart of the total amount per stage; "
      + "and a list of the deals in the order given, 5 per page with page buttons. The KPIs, chart and list all follow the region filter. "
      + "Pressing a deal opens a second screen with its company, region, stage, amount and owner, and a Back button that returns. "
      + "The first screen also has a form to add a deal: a company name field, an amount field and an Add button; new deals are Leads in North America, and everything updates.",
    checks: [
      { label: "KPIs for all regions (open 90,000, won 91,000, 57.1%)", shows: [/\b90,?000\b|\b90(\.0)?\s?K\b/i, /\b91,?000\b|\b91(\.0)?\s?K\b/i, /57\.1\s?%/] },
      { label: "leaving out Europe: open 64,000, won 76,000, 60%", steps: [{ press: /^\s*Europe\s*$/ }], shows: [/\b64,?000\b|\b64(\.0)?\s?K\b/i, /\b76,?000\b|\b76(\.0)?\s?K\b/i, /\b60(\.0)?\s?%/] },
      { label: "page 3 shows the last two deals", steps: [{ press: /^\s*3\s*$/ }], shows: [/Cyberdyne/, /Oscorp/], hides: [/Acme/, /Stark/] },
      { label: "pressing Stark opens its own screen", steps: [{ press: /Stark/ }], shows: [/Stark/, /\bBen\b/, /40,?000|40(\.0)?\s?K/i], hides: [/Globex/, /Acme/] },
      { label: "Back returns to the list", steps: [{ press: /Stark/ }, { press: /^\s*(←\s*)?Back\b/i }], shows: [/Globex/, /Acme/] },
      { label: "adding Zeta for $5,000 makes the open pipeline 95,000", steps: [{ type: [0, "Zeta"] }, { type: [1, "5000"] }, { press: /^\s*(\+\s*)?add\b/i }], shows: [/\b95,?000\b|\b95(\.0)?\s?K\b/i] },
    ] },
];

/** A working SayShape answer to each stress task. */
export const stressReference: Record<string, string> = {
  z1: `state pick="" orders=[{id: "A1", customer: "Acme", amount: 1200, status: "Shipped"}, {id: "A2", customer: "Globex", amount: 860, status: "Pending"}, {id: "A3", customer: "Initech", amount: 2310, status: "Shipped"}, {id: "A4", customer: "Umbrella", amount: 410, status: "Cancelled"}]
derive o={find(orders, 'id', pick)}
screen name=list title="Orders"
  list
    each items=orders as=r
      list-item "{r.id} {r.customer}" detail="{r.status}" trailing="{money(r.amount)}" on="set:pick:{r.id};go:detail"
screen name=detail title="Order"
  details "Order {o.id}"
    detail "Customer" value="{o.customer}"
    detail "Amount" value="{money(o.amount)}"
    detail "Status" value="{o.status}"
  button "Back" on=back`,

  z2: `state page=1 staff=[${STAFF.map((n, i) => `{name: "${n}", team: "${TEAMS[i]}", page: ${Math.floor(i / 5) + 1}}`).join(", ")}]
card
  text "Staff" style=title
  table items={filter(staff, 'page', page)}
    table-column "Name" field=name
    table-column "Team" field=team
  text "Page {page} of 3" tone=muted
  pagination bind=page pages=3`,

  z3: `state chosen=["North America", "Europe", "Asia"] regions=[{name: "North America"}, {name: "Europe"}, {name: "Asia"}] sales=[{q: "Q1", region: "North America", amount: 120}, {q: "Q1", region: "Europe", amount: 90}, {q: "Q1", region: "Asia", amount: 60}, {q: "Q2", region: "North America", amount: 140}, {q: "Q2", region: "Europe", amount: 80}, {q: "Q2", region: "Asia", amount: 75}]
derive shown={filter(sales, 'region', chosen)}
card
  select "Regions" items=regions value=name label=name bind=chosen multiple=true
  stat label="Total" value="{sum(shown, 'amount')}"
  table items=shown
    table-column "Quarter" field=q
    table-column "Region" field=region
    table-column "Sales" field=amount format=number`,

  z4: `state steps=[{name: "Revenue", k: 500}, {name: "Cost of goods", k: -210}, {name: "Operating costs", k: -145}, {name: "Tax", k: -38}]
derive net={sum(steps, 'k')}
card
  chart "Q3 profit bridge ($K)" kind=waterfall items=steps x=name y=k total="Net income"
  grid min=140 gap=12
    stat label="Net income" value="\${net}K"
    stat label="Margin" value="{round(net / 500 * 100, 1)}%"`,

  z5: `state orders=[{day: "Mon", time: "9am", n: 12}, {day: "Mon", time: "12pm", n: 30}, {day: "Mon", time: "6pm", n: 18}, {day: "Tue", time: "9am", n: 15}, {day: "Tue", time: "12pm", n: 34}, {day: "Tue", time: "6pm", n: 22}, {day: "Wed", time: "9am", n: 11}, {day: "Wed", time: "12pm", n: 29}, {day: "Wed", time: "6pm", n: 41}, {day: "Thu", time: "9am", n: 14}, {day: "Thu", time: "12pm", n: 37}, {day: "Thu", time: "6pm", n: 25}]
derive top={first(sort(orders, 'n', 'desc'))}
card
  chart "Orders by day and time" kind=heatmap items=orders rows=day x=time y=n
  callout "Busiest: {top.day} {top.time} with {top.n} orders" tone=accent`,

  z6: `state code="" items=[{name: "Headphones", price: 59.99, qty: 1}, {name: "Charger", price: 19.5, qty: 1}, {name: "Case", price: 12, qty: 1}]
derive subtotal={sum(items, 'price', 'qty')}
derive discount={upper(trim(code)) == 'SAVE10' ? subtotal * 0.1 : 0}
derive tax={(subtotal - discount) * 0.08}
card
  text "Cart" style=title
  each items=items as=it
    row
      text "{it.name} {money(it.price)}"
      stepper bind=it.qty min=0 max=10
  input "Discount code" bind=code
  text "Subtotal {money(subtotal)}"
  text "Discount {money(discount)}" if={discount > 0}
  text "Tax {money(tax)}"
  text "Total {money(subtotal - discount + tax)}" style=title`,

  z7: `state a1="" a2="" a3="" checked=false
card
  text "Capital of Australia?"
  radio "Sydney" bind=a1 value="Sydney"
  radio "Canberra" bind=a1 value="Canberra"
  radio "Melbourne" bind=a1 value="Melbourne"
  text "7 × 8?"
  radio "54" bind=a2 value="54"
  radio "56" bind=a2 value="56"
  radio "64" bind=a2 value="64"
  text "Largest planet?"
  radio "Saturn" bind=a3 value="Saturn"
  radio "Jupiter" bind=a3 value="Jupiter"
  radio "Neptune" bind=a3 value="Neptune"
  button "Check answers" on=set:checked:true
  text "You got {(a1 == 'Canberra' ? 1 : 0) + (a2 == '56' ? 1 : 0) + (a3 == 'Jupiter' ? 1 : 0)} of 3" if={checked}`,

  z8: `state tab="Overview" tasks=[{name: "Spec", done: true}, {name: "Design", done: true}, {name: "Build", done: false}, {name: "Test", done: false}, {name: "Launch", done: false}]
tabs bind=tab
  tab "Overview"
    text "{count(tasks, 'done')} of 5 tasks done"
    progress value={count(tasks, 'done')} max=5
  tab "Tasks"
    each items=tasks as=t
      check "{t.name}" bind=t.done
  tab "Team"
    list
      list-item "Ana" detail="Lead"
      list-item "Ben" detail="Developer"
      list-item "Chen" detail="Designer"`,

  z9: `state billing="Monthly" plans=[{name: "Basic", month: 9, gb: 10, users: 1}, {name: "Pro", month: 29, gb: 100, users: 5}, {name: "Team", month: 79, gb: 1000, users: 20}]
derive shown={billing == 'Yearly' ? [{name: "Basic", price: 90, gb: 10, users: 1}, {name: "Pro", price: 290, gb: 100, users: 5}, {name: "Team", price: 790, gb: 1000, users: 20}] : [{name: "Basic", price: 9, gb: 10, users: 1}, {name: "Pro", price: 29, gb: 100, users: 5}, {name: "Team", price: 79, gb: 1000, users: 20}]}
card
  segmented bind=billing options="Monthly,Yearly"
  compare items=shown name=name
    compare-row "Price" field=price format=money best=low
    compare-row "Storage (GB)" field=gb format=number best=high
    compare-row "Users" field=users format=number best=high`,

  z10: `state expenses=[{name: "Rent", cat: "Housing", amt: 1500}, {name: "Groceries", cat: "Food", amt: 320}, {name: "Dinner", cat: "Food", amt: 85}, {name: "Gas", cat: "Transport", amt: 60}, {name: "Bus", cat: "Transport", amt: 45}, {name: "Streaming", cat: "Fun", amt: 15}, {name: "Concert", cat: "Fun", amt: 110}, {name: "Coffee", cat: "Food", amt: 28}]
derive byCat={sort(group(expenses, 'cat', 'amt'), 'amt', 'desc')}
derive top={first(filter(byCat, 'cat', ['Food', 'Fun', 'Transport']))}
card
  stat label="Total spent" value="{money(sum(expenses, 'amt'))}"
  chart "Spending by category" kind=donut items=byCat x=cat y=amt format=money
  table items=byCat
    table-column "Category" field=cat
    table-column "Total" field=amt format=money
  callout "Biggest after housing: {top.cat} at {money(top.amt)}" tone=accent`,

  z11: `state shown=["North America", "Europe", "Asia Pacific"] regions=[{name: "North America"}, {name: "Europe"}, {name: "Asia Pacific"}] page=1 pick="" company="" amount="" deals=[{id: "D1", company: "Acme", region: "North America", stage: "Lead", amount: 12000, owner: "Ana"}, {id: "D2", company: "Globex", region: "Europe", stage: "Qualified", amount: 18000, owner: "Ben"}, {id: "D3", company: "Initech", region: "North America", stage: "Won", amount: 25000, owner: "Ana"}, {id: "D4", company: "Umbrella", region: "Asia Pacific", stage: "Lost", amount: 9000, owner: "Chen"}, {id: "D5", company: "Stark", region: "North America", stage: "Won", amount: 40000, owner: "Ben"}, {id: "D6", company: "Wayne", region: "Europe", stage: "Won", amount: 15000, owner: "Chen"}, {id: "D7", company: "Tyrell", region: "Asia Pacific", stage: "Qualified", amount: 22000, owner: "Ana"}, {id: "D8", company: "Soylent", region: "Europe", stage: "Lost", amount: 7000, owner: "Ben"}, {id: "D9", company: "Hooli", region: "North America", stage: "Qualified", amount: 30000, owner: "Chen"}, {id: "D10", company: "Vandelay", region: "Asia Pacific", stage: "Won", amount: 11000, owner: "Ana"}, {id: "D11", company: "Cyberdyne", region: "Europe", stage: "Lead", amount: 8000, owner: "Ben"}, {id: "D12", company: "Oscorp", region: "North America", stage: "Lost", amount: 14000, owner: "Chen"}]
derive inRegion={filter(deals, 'region', shown)}
derive open={sum(filter(inRegion, 'stage', ['Lead', 'Qualified']), 'amount')}
derive won={sum(filter(inRegion, 'stage', 'Won'), 'amount')}
derive wins={count(inRegion, 'stage', 'Won')}
derive losses={count(inRegion, 'stage', 'Lost')}
derive byStage={group(inRegion, 'stage', 'amount')}
derive pages={max(1, ceil(len(inRegion) / 5))}
derive deal={find(deals, 'id', pick)}
screen name=overview title="Sales pipeline"
  select "Regions" items=regions value=name label=name bind=shown multiple=true
  grid min=140 gap=12
    stat label="Open pipeline" value="{money(open)}"
    stat label="Won revenue" value="{money(won)}"
    stat label="Win rate" value="{wins + losses ? fixed(wins / (wins + losses) * 100, 1) : 0}%"
  chart "Amount by stage" kind=bar items=byStage x=stage y=amount
  list
    each items={slice(inRegion, (page - 1) * 5, page * 5)} as=d
      list-item "{d.company}" detail="{d.region} · {d.stage}" trailing="{money(d.amount)}" on="set:pick:{d.id};go:detail"
  text "Page {page} of {pages}" tone=muted
  pagination bind=page pages={pages}
  input "Company" bind=company
  input "Amount" bind=amount kind=number
  button "Add" on="add:deals:{{id: 'N' + len(deals), company: company, region: 'North America', stage: 'Lead', amount: amount * 1, owner: 'You'}};set:company:'';set:amount:''"
screen name=detail title="Deal"
  details "{deal.company}"
    detail "Region" value="{deal.region}"
    detail "Stage" value="{deal.stage}"
    detail "Amount" value="{money(deal.amount)}"
    detail "Owner" value="{deal.owner}"
  button "Back" on=back`,
};
