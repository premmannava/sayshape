/**
 * What the visual regression suite renders: every core component's example
 * and every playground sample. The map and pin are covered by the map sample.
 *
 * This file is loaded both by the browser page and by the Playwright spec, so
 * it must not import the map entry point (its outlines are a JSON file).
 */
import { coreComponents } from "../src/components";
import { samples } from "../playground/samples";
import { exampleSpec } from "../test/examples";

export interface VisualCase {
  name: string;
  spec: string;
}

export const cases: VisualCase[] = [
  ...coreComponents.filter((c) => c.example).map((c) => ({ name: `component-${c.type}`, spec: exampleSpec(c, coreComponents) })),
  ...Object.entries(samples).map(([k, s]) => ({ name: `sample-${k}`, spec: s.spec })),
  // Chart cases the example and sample don't reach: negative values, a gap in
  // a line, labels thinned on a phone, and the message shown instead of a plot.
  {
    name: "chart-edges",
    spec: `state pnl=[{q: "Q1", v: 4200}, {q: "Q2", v: -1800}, {q: "Q3", v: 900}, {q: "Q4", v: -300}] temps=[{d: "Mon", t: 18.5}, {d: "Tue", t: 21}, {d: "Wed"}, {d: "Thu", t: 19.5}, {d: "Fri", t: 23}, {d: "Sat", t: 23}] days=[${Array.from({ length: 30 }, (_, i) => `{d: "Oct ${i + 1}", n: ${(i * 7) % 13 + 2}}`).join(", ")}] none=[]
chart "Profit by quarter" kind=bar items=pnl x=q y=v format=money
chart "Temperature" kind=line items=temps x=d y=t
chart "Signups per day" kind=bar items=days x=d y=n
chart "Nothing yet" kind=line items=none x=d y=n
`,
  },
  // Multi-series and round chart cases the example and samples don't reach:
  // grouped bars with a gap and negatives, a wrapping legend, a pie folding
  // 9 items into Other, and the messages for too many series and a negative slice.
  {
    name: "chart-series-edges",
    spec: `state q=[{q: "Q1", a: 4200, b: 3100, c: -600}, {q: "Q2", a: -1800, b: 2500, c: 1200}, {q: "Q3", a: 900, c: 2000}, {q: "Q4", a: 3300, b: 2900, c: 2600}] spend=[{k: "Rent", v: 1800}, {k: "Groceries", v: 640}, {k: "Transport", v: 310}, {k: "Utilities", v: 220}, {k: "Dining out", v: 180}, {k: "Streaming", v: 45}, {k: "Gym", v: 40}, {k: "Books", v: 25}, {k: "Gifts", v: 60}] mixed=[{k: "A", v: 3}, {k: "B", v: -1}] wide=[{k: "A", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7}]
chart "Profit by region and quarter" kind=bar items=q x=q y=a,b,c labels="North America,Europe and Middle East,Asia Pacific" format=money
chart "Monthly spending" kind=pie items=spend x=k y=v format=money
chart "Mixed signs" kind=donut items=mixed x=k y=v
chart "Seven series" kind=line items=wide x=k y=a,b,c,d,e,f,g
`,
  },
  // Table cases the example and sample don't reach: missing and unusable
  // values, 0, false and negatives, long text, a read-only table, the empty
  // message, and a table too wide for a phone (it fits at desktop width).
  {
    name: "table-edges",
    spec: `state rows=[{name: "Trail socks", qty: 0, price: -4.5, ok: false}, {name: "A very long product name that has to be cut", qty: 12, price: 1299.99, ok: true}, {name: "No price", qty: "lots"}, {qty: 3, price: 18}] none=[] wide=[{a: 1200, b: 350, c: 79, d: 12, e: 24, f: 41}]
table "Order lines" items=rows
  table-column "Item" field=name
  table-column "Qty" field=qty format=number
  table-column "Price" field=price format=money
  table-column "In stock" field=ok
table "Nothing yet" items=none
  table-column "Item" field=name
table "Six money columns" items=wide
  table-column "Jan" field=a format=money
  table-column "Feb" field=b format=money
  table-column "Mar" field=c format=money
  table-column "Apr" field=d format=money
  table-column "May" field=e format=money
  table-column "Jun" field=f format=money
`,
  },
  // A short, ordinary dashboard spec of the kind a model writes: a title with
  // its filters, KPIs, one primary chart, a supporting chart and a table. The
  // visual design is judged on this (scripts/review-shots.ts captures it).
  {
    name: "review-dashboard",
    spec: `state region="All" period="Quarter" by="revenue" dir="desc" picked="" months=[{m: "Jul", web: 42000, retail: 31000, partner: 12000}, {m: "Aug", web: 45500, retail: 29800, partner: 14500}, {m: "Sep", web: 39800, retail: 33500, partner: 15100}, {m: "Oct", web: 51200, retail: 34800}, {m: "Nov", web: 56900, retail: 38200, partner: 17900}, {m: "Dec", web: 63400, retail: 41100, partner: 21000}] regions=[{name: "West Coast and Pacific Northwest", revenue: 98200}, {name: "Northeast", revenue: 71500}, {name: "South", revenue: 64300}, {name: "Midwest", revenue: 38900}, {name: "Online only", revenue: 26400}] accounts=[{id: "a1", name: "Fernwood Freight", owner: "Ada Park", revenue: 48200, growth: 12.4}, {id: "a2", name: "Harbor & Pine Outfitters International", owner: "Ben Ortiz", revenue: 39150, growth: -3.1}, {id: "a3", name: "Summit Labs", owner: "Chloe Wu", revenue: 27800, growth: 8}, {id: "a4", name: "Atlas Coffee", owner: "Dev Rao", revenue: 9120, growth: 0}]
text "Sales overview" style=title
row
  segmented bind=period options="Month,Quarter,Year" label="Period"
  select items={["All", "West", "Northeast", "South"]} bind=region
row
  stat label="Revenue" value="$1.24M" change="+12.4%" spark={[31, 35, 33, 39, 42, 47]}
  stat label="Orders" value="8,214" change="+3.1%"
  stat label="Refund rate" value="2.4%" change="-0.6%" good=down
  stat label="Avg. order" value="$151" change="0%" trend=flat
card
  chart "Revenue by channel" kind=line items=months x=m y=web,retail,partner labels="Web,Retail,Partner" format=money
    chart-rule "Target" y=50000
    chart-note "Holiday sale" at="Nov"
row align=top
  card
    chart "Revenue by region" kind=hbar items=regions x=name y=revenue format=money
  card
    chart "Monthly web revenue" kind=bar items=months x=m y=web format=money
table "Top accounts" items={sort(accounts, by, dir)} key=id bind=picked sort=by direction=dir
  table-column "Account" field=name
  table-column "Owner" field=owner
  table-column "Revenue" field=revenue format=money
  table-column "Growth %" field=growth format=number
row
  button "Export report"
  button "Share" variant=secondary
  button "Archive" variant=secondary disabled=true
`,
  },
  // Dense data and long labels: many bars and lines, crowded legends.
  {
    name: "review-dense",
    spec: `state days=[${Array.from({ length: 45 }, (_, i) => `{d: "Day ${i + 1}", a: ${1200 + ((i * 37) % 23) * 90}, b: ${900 + ((i * 53) % 19) * 70}, c: ${400 + ((i * 29) % 17) * 60}}`).join(", ")}] teams=[{t: "Customer success and onboarding", q1: 82000, q2: 91000, q3: 87000}, {t: "Enterprise sales (North America)", q1: 140000, q2: 128000, q3: 151000}, {t: "Self-serve growth", q1: 61000, q2: 74000, q3: 80500}, {t: "Partnerships", q1: 33000, q2: 29000, q3: 41000}]
chart "Daily active users by plan over 45 days" kind=line items=days x=d y=a,b,c labels="Business plan,Professional plan,Starter plan"
chart "Bookings by team and quarter" kind=bar items=teams x=t y=q1,q2,q3 labels="First quarter,Second quarter,Third quarter" format=money
chart "Daily signups" kind=bar items=days x=d y=c
chart "Share of bookings" kind=donut items=teams x=t y=q3 format=money
`,
  },
];

export const THEMES = ["light", "dark"] as const;
export const WIDTHS = [375, 1024] as const;
