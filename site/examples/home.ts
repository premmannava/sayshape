/**
 * The specs the landing page plays and renders with the real engine:
 * the hero's launch planner, the four "one question" showcases, the
 * mortgage calculator and the small card the theme switcher redraws.
 *
 * They are saved answers, written the way a model would write them; no model
 * runs on the site. test/home.test.ts checks that each one parses with no
 * problems, streams line by line, and that its controls and numbers work.
 */
import type { PresetId } from "../../playground/appearance/presets";

/** A look for a demo: a playground preset, light/dark following the site unless pinned. */
export interface Look {
  preset: PresetId;
  /** Keep this scheme whatever the site's light/dark setting. */
  scheme?: "light" | "dark";
  /** A custom accent, as an app with its own brand color would set. */
  accent?: string;
}

// ---------------------------------------------------------------- hero

export const heroAsk = "We have $40k to launch our app. How should we split it across channels?";

export const heroSpec = `state search=16000 social=14000 creators=10000
derive spent={search + social + creators}
derive signups={round(search / 40 + social / 55 + creators / 70)}
derive split=[{channel: "Search ads", amount: search}, {channel: "Social ads", amount: social}, {channel: "Creators", amount: creators}]
derive ramp=[{week: "W1", signups: round(signups * 0.06)}, {week: "W2", signups: round(signups * 0.15)}, {week: "W3", signups: round(signups * 0.28)}, {week: "W4", signups: round(signups * 0.42)}, {week: "W5", signups: round(signups * 0.57)}, {week: "W6", signups: round(signups * 0.72)}, {week: "W7", signups: round(signups * 0.87)}, {week: "W8", signups: signups}]
text "App launch · $40,000 budget" style=title
grid min=170
  meter "Budget used" kind=ring value={spent / 40000} max=1 bands="0.9,1.005" good=down format=percent
  stat label="Projected signups" value={number(signups)}
  stat label="Cost per signup" value={signups ? money(spent / signups) : "–"}
grid min=280
  column
    slider "Search ads: \${number(search)}" bind=search min=0 max=30000 step=1000
    slider "Social ads: \${number(social)}" bind=social min=0 max=30000 step=1000
    slider "Creators: \${number(creators)}" bind=creators min=0 max=30000 step=1000
    callout "Over budget by {money(spent - 40000)}" detail="Lower a channel to get back to $40,000" tone=bad icon=true if={spent > 40000}
    callout "Search brings the cheapest signups" detail="About $40 each, against $55 for social and $70 for creators" tone=info icon=true if={spent <= 40000}
  chart "Where the money goes" kind=donut items=split x=channel y=amount format=money
chart "Signups over 8 weeks" kind=area items=ramp x=week y=signups
timeline
  step "Week 1: search ads live" status=current
  step "Week 3: creator videos" status=upcoming
  step "Week 6: retarget visitors" status=upcoming
button "Share the plan" on=emit:share`;

/** The two drags the hero's cursor makes: Search up past the budget, then Creators down to fit it again. */
export const heroDrags = [
  { bind: "search", to: 22000 },
  { bind: "creators", to: 4000 },
] as const;

// ---------------------------------------------------------------- showcases

export interface Showcase {
  id: string;
  /** What kind of answer it is, as a short label on its tab. */
  kind: string;
  /** The question a person asked. */
  ask: string;
  look: Look;
  /** The look's name, as shown above the screen. */
  lookName: string;
  spec: string;
}

export const showcases: Showcase[] = [
  {
    id: "insurance",
    kind: "Compare",
    ask: "Compare these three insurance plans and help me pick one.",
    look: { preset: "blue" },
    lookName: "Blue",
    spec: `state year="Medium" plans=[{plan: "Bronze", premium: 289, deductible: 6500, visit: 60, network: "Narrow"}, {plan: "Silver", premium: 412, deductible: 2000, visit: 30, network: "Broad"}, {plan: "Gold", premium: 498, deductible: 750, visit: 15, network: "Broad"}]
derive claim={year == "Low" ? 0 : year == "Medium" ? 4000 : 15000}
derive visits={year == "Low" ? 3 : year == "Medium" ? 8 : 15}
derive costs=[{plan: "Bronze", premiums: 289 * 12, care: min(6500, claim) + visits * 60}, {plan: "Silver", premiums: 412 * 12, care: min(2000, claim) + visits * 30}, {plan: "Gold", premiums: 498 * 12, care: min(750, claim) + visits * 15}]
derive totals=[{plan: "Bronze", total: 289 * 12 + min(6500, claim) + visits * 60}, {plan: "Silver", total: 412 * 12 + min(2000, claim) + visits * 30}, {plan: "Gold", total: 498 * 12 + min(750, claim) + visits * 15}]
derive best={first(sort(totals, 'total', 'asc'))}
segmented label="How much care do you expect this year?" bind=year options="Low,Medium,High"
callout "{best.plan} costs least in a {lower(year)} year" detail="{money(best.total)} for the year, premiums and care together" tone=good icon=true
grid min=320
  compare items=plans name=plan pick={best.plan}
    compare-row "Monthly premium" field=premium format=money best=low
    compare-row "Deductible" field=deductible format=money best=low
    compare-row "Doctor visit" field=visit format=money best=low
    compare-row "Network" field=network
  chart "Your year, all in" kind=stacked items=costs x=plan y=premiums,care labels="Premiums,Your care" format=money
button "Choose {best.plan}" on=emit:choose`,
  },
  {
    id: "latency",
    kind: "Analyze",
    ask: "Why are our API response times getting worse?",
    look: { preset: "studio", scheme: "dark" },
    lookName: "Studio, dark",
    spec: `state range="7 days" week=[{day: "Nov 3", p95: 212, target: 300, errors: 4}, {day: "Nov 4", p95: 220, target: 300, errors: 5}, {day: "Nov 5", p95: 208, target: 300, errors: 4}, {day: "Nov 6", p95: 231, target: 300, errors: 6}, {day: "Nov 7", p95: 452, target: 300, errors: 21}, {day: "Nov 8", p95: 476, target: 300, errors: 24}, {day: "Nov 9", p95: 318, target: 300, errors: 12}] month=[{day: "Oct 13", p95: 205, target: 300, errors: 4}, {day: "Oct 20", p95: 214, target: 300, errors: 5}, {day: "Oct 27", p95: 209, target: 300, errors: 4}, {day: "Nov 3", p95: 302, target: 300, errors: 11}] byEndpoint=[{endpoint: "/checkout", day: "Nov 6", p95: 240}, {endpoint: "/checkout", day: "Nov 7", p95: 690}, {endpoint: "/checkout", day: "Nov 8", p95: 720}, {endpoint: "/search", day: "Nov 6", p95: 180}, {endpoint: "/search", day: "Nov 7", p95: 210}, {endpoint: "/search", day: "Nov 8", p95: 205}, {endpoint: "/login", day: "Nov 6", p95: 120}, {endpoint: "/login", day: "Nov 7", p95: 130}, {endpoint: "/login", day: "Nov 8", p95: 125}]
derive shown={range == "7 days" ? week : month}
segmented bind=range options="7 days,30 days"
grid min=150
  stat label="p95 now" value="318 ms" change="+41%" trend=up good=down
  stat label="Errors per 1,000" value="12" change="+8" trend=up good=down
  meter "Error budget used" kind=gauge value=72 max=100 bands="50,80" good=down
callout "/checkout slowed down after the 2.14 deploy" detail="Its p95 tripled on Nov 7 and 8; search and login stayed flat" tone=warn icon=true
chart "p95 against the 300 ms target" kind=line items=shown x=day y=p95,target labels="p95 (ms),Target"
grid min=260
  chart "Errors per 1,000 requests" kind=bar items=shown x=day y=errors
  chart "p95 by endpoint (ms)" kind=heatmap items=byEndpoint x=day rows=endpoint y=p95`,
  },
  {
    id: "trip",
    kind: "Plan",
    ask: "Plan a weekend in Sedona for four people.",
    look: { preset: "purple" },
    lookName: "Purple",
    spec: `state nights=2 people=4 day="sat" picked="" stops=[{name: "Pink jeep tour, Sedona", lat: 34.8697, lon: -111.761, cost: 95, on: true}, {name: "Jerome ghost town", lat: 34.7489, lon: -112.1138, cost: 0, on: true}, {name: "Lowell Observatory, Flagstaff", lat: 35.2029, lon: -111.6646, cost: 30, on: true}, {name: "Grand Canyon South Rim", lat: 36.0617, lon: -112.1077, cost: 0, on: false}]
derive extras={sum(filter(stops, 'on', true), 'cost') * people}
derive hotel={nights * 245}
derive food={nights * people * 60}
derive breakdown=[{part: "Hotel", amount: hotel}, {part: "Food", amount: food}, {part: "Activities", amount: extras}]
text "Sedona weekend" style=title
grid min=160
  stepper "Nights" bind=nights min=1 max=5
  stepper "People" bind=people min=1 max=8
  stat label="Trip total" value={money(hotel + food + extras)}
  stat label="Per person" value={money((hotel + food + extras) / people)}
grid min=280
  map fit=pins bind=picked controls=true route=true
    each items=stops as=s
      pin "{s.name}" lat={s.lat} lon={s.lon} tone={s.on ? "accent" : "muted"}
  column
    text "Activities" style=lead
    each items=stops as=s
      check "{s.name}{s.cost ? ' · ' + money(s.cost) + ' each' : ''}" bind=s.on
grid min=280
  tabs bind=day
    tab "Saturday" value=sat
      timeline
        step "Pink jeep tour" detail="Red rock trails out of Sedona" time="9:00"
        step "Jerome ghost town" detail="Lunch on the hill, 40 minutes away" time="13:00"
        step "Sunset at Airport Mesa" detail="Back in Sedona" time="17:15"
    tab "Sunday" value=sun
      timeline
        step "Grand Canyon South Rim" detail="Optional: a 2-hour drive each way" time="7:30"
        step "Lowell Observatory, Flagstaff" detail="Evening telescope viewing" time="19:00"
  chart "Where the money goes" kind=donut items=breakdown x=part y=amount format=money`,
  },
  {
    id: "orders",
    kind: "Operate",
    ask: "Show our open orders and help me find delayed shipments.",
    look: { preset: "neutral" },
    lookName: "Neutral",
    spec: `state show="All" sel="A-1047" orders=[{id: "A-1042", customer: "Northwind", city: "Denver", lat: 39.74, lon: -104.99, due: "Nov 6", status: "Delayed", stage: 2}, {id: "A-1043", customer: "Bluebird Co", city: "Austin", lat: 30.27, lon: -97.74, due: "Nov 9", status: "On time", stage: 3}, {id: "A-1047", customer: "Kestrel", city: "Chicago", lat: 41.88, lon: -87.63, due: "Nov 5", status: "Delayed", stage: 2}, {id: "A-1051", customer: "Harbor & Pine", city: "Seattle", lat: 47.61, lon: -122.33, due: "Nov 11", status: "On time", stage: 1}, {id: "A-1052", customer: "Larkspur", city: "Atlanta", lat: 33.75, lon: -84.39, due: "Nov 7", status: "Delayed", stage: 3}, {id: "A-1055", customer: "Juniper Labs", city: "Phoenix", lat: 33.45, lon: -112.07, due: "Nov 12", status: "On time", stage: 1}]
derive shown={show == "All" ? orders : filter(orders, 'status', show)}
derive o={find(orders, 'id', sel)}
grid min=150
  stat label="Open orders" value={count(orders)}
  stat label="Delayed" value={count(orders, 'status', 'Delayed')}
  stat label="On time" value="{round(count(orders, 'status', 'On time') / count(orders) * 100)}%"
segmented bind=show options="All,Delayed,On time"
map fit=pins bind=sel
  each items=shown as=s
    pin "{s.id}" lat={s.lat} lon={s.lon} detail="{s.customer} · {s.city}" tone={s.status == "Delayed" ? "bad" : "good"}
grid min=280
  list
    each items=shown as=s
      list-item "{s.id} · {s.customer}" detail="{s.city} · due {s.due}" on=set:sel:{s.id}
        badge "{s.status}" tone={s.status == "Delayed" ? "bad" : "good"}
  column
    details "{o.id} · {o.customer}" subtitle="{o.city} · due {o.due}"
      detail "Status" value={o.status} tone={o.status == "Delayed" ? "bad" : "good"}
    timeline
      step "Packed" status={o.stage >= 1 ? "done" : "upcoming"}
      step "Left the warehouse" status={o.stage >= 2 ? (o.stage == 2 ? "current" : "done") : "upcoming"}
      step "Out for delivery" status={o.stage >= 3 ? "current" : "upcoming"}
      step "Delivered" status=upcoming
    button "Email the delayed customers" on=emit:notify`,
  },
];

// ---------------------------------------------------------------- answers you can do something with

/** A standard fixed-rate amortized payment: principal and interest only. */
export const mortgageSpec = `state amount=300000 rate=6.5 term="30 years"
derive years={term == "15 years" ? 15 : term == "20 years" ? 20 : 30}
derive r={rate / 100 / 12}
derive n={years * 12}
derive payment={amount * r * pow(1 + r, n) / (pow(1 + r, n) - 1)}
derive interest={payment * n - amount}
derive parts=[{part: "Loan", amount: amount}, {part: "Interest", amount: round(interest)}]
text "{money(payment)} a month" style=display
text "Principal and interest on a fixed-rate loan. Taxes, insurance and fees aren't included." style=caption tone=muted
grid min=260
  column
    slider "Loan amount: \${number(amount)}" bind=amount min=100000 max=1000000 step=10000
    slider "Interest rate: {fixed(rate, 1)}%" bind=rate min=3 max=9 step=0.1
    segmented label="Term" bind=term options="15 years,20 years,30 years"
    grid min=140
      stat label="Total interest" value={money(interest)}
      stat label="Total paid" value={money(payment * n)}
  chart "Loan and interest" kind=donut items=parts x=part y=amount format=money`;

export const mortgageLook: Look = { preset: "neutral", accent: "#B45309" };

// ---------------------------------------------------------------- your app stays in control

/** One small spec the theme switcher redraws in each look; its button sends an action to the page. */
export const lookSpec = `state guests=2
card
  text "Cabin weekend" style=title
  stepper "Guests" bind=guests min=1 max=6
  stat label="Total for two nights" value={money(guests * 180)}
  button "Book it" on=emit:book`;

export const lookChoices: { name: string; look: Look }[] = [
  { name: "Teal", look: { preset: "teal" } },
  { name: "Purple", look: { preset: "purple" } },
  { name: "Blue", look: { preset: "blue" } },
  { name: "Neutral", look: { preset: "neutral" } },
  { name: "Studio", look: { preset: "studio" } },
];
