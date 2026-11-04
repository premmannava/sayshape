/**
 * "Ask the docs": curated answers to the questions people ask most, each a
 * small working spec. No model is involved; a question is matched to an
 * answer by its words. test/site-ask.test.ts checks every spec renders
 * cleanly and that typical questions find the right answer.
 */

export interface Answer {
  id: string;
  /** The answer's headline, e.g. "Use a stepper". */
  title: string;
  /** Words and short phrases a question might use. Phrases count more than single words. */
  keywords: string[];
  /** One or two sentences on why and how. */
  note: string;
  /** The element or language page that goes deeper. */
  link: { text: string; href: string };
  spec: string;
}

export const answers: Answer[] = [
  {
    id: "quantity",
    title: "Use a stepper",
    keywords: ["quantity", "how many", "count", "number of", "guests", "qty", "plus minus", "increment", "people", "tickets"],
    note: "bind= keeps the number in state; min and max stop the buttons.",
    link: { text: "stepper", href: "/docs/elements/stepper" },
    spec: `state guests=2
stepper "Guests" bind=guests min=1 max=8
text "{plural(guests, 'guest')}" tone=muted`,
  },
  {
    id: "few-options",
    title: "Use segmented for two to six choices",
    keywords: ["switch between", "toggle between", "between", "pick one", "choose one", "view", "chart or table", "options", "mode", "week month year"],
    note: "Then show different content for each option with if=.",
    link: { text: "segmented", href: "/docs/elements/segmented" },
    spec: `state view="Chart"
segmented bind=view options="Chart,Table"
text "Showing the {lower(view)}" tone=muted`,
  },
  {
    id: "many-options",
    title: "Use a select for a longer list",
    keywords: ["dropdown", "drop down", "select", "choose from", "list of options", "department", "country", "pick from many", "menu of options"],
    note: "items= takes a list; value= and label= pick fields when the list holds records.",
    link: { text: "select", href: "/docs/elements/select" },
    spec: `state teams=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}, {id: "ops", name: "Operations"}] team=""
select "Team" items=teams value=id label=name bind=team placeholder="Choose a team"
text "Picked: {team}" tone=muted if={team != ''}`,
  },
  {
    id: "date",
    title: "Use a date picker",
    keywords: ["date", "calendar", "day", "deadline", "booking", "due", "schedule", "delivery date"],
    note: "Dates are YYYY-MM-DD text; min and max limit what can be picked.",
    link: { text: "date-picker", href: "/docs/elements/date-picker" },
    spec: `state due=""
date-picker "Due date" bind=due min="2026-01-01" max="2027-12-31" placeholder="Pick a date"`,
  },
  {
    id: "on-off",
    title: "Use a switch for a setting",
    keywords: ["on off", "toggle", "setting", "enable", "disable", "yes no", "true false", "notifications", "preference"],
    note: "A switch takes effect right away. For agreeing to something, use check.",
    link: { text: "switch", href: "/docs/elements/switch" },
    spec: `state updates=true
switch "Email me order updates" bind=updates
text "{updates ? 'You will get emails' : 'No emails'}" tone=muted`,
  },
  {
    id: "range",
    title: "Use a slider for a range",
    keywords: ["slider", "range", "price range", "budget", "between", "drag", "amount", "distance", "up to"],
    note: "step= sets how far each move goes.",
    link: { text: "slider", href: "/docs/elements/slider" },
    spec: `state maxPrice=120
slider "Up to \${maxPrice}" bind=maxPrice min=20 max=300 step=10`,
  },
  {
    id: "total",
    title: "Use derive for a running total",
    keywords: ["total", "sum", "add up", "running total", "calculate", "computed", "subtotal", "price times", "work out", "formula"],
    note: "A derive line recalculates whenever what it reads changes. No code runs.",
    link: { text: "Derived values", href: "/docs/language/derived" },
    spec: `state qty=2
derive total={qty * 24}
stepper "Trail socks, $24" bind=qty min=0
stat label="Total" value={money(total)}`,
  },
  {
    id: "repeat",
    title: "Use each to repeat for a list",
    keywords: ["list", "repeat", "loop", "for each", "every item", "rows", "items", "array", "records", "map over"],
    note: "Never copy an element per item. Inside each, the current item has the name you give as=.",
    link: { text: "each", href: "/docs/elements/each" },
    spec: `state gear=[{name: "Tent", kg: 2.1}, {name: "Stove", kg: 0.4}, {name: "Headlamp", kg: 0.1}]
each items=gear as=g
  text "{g.name}, {g.kg} kg"
text "Total {sum(gear, 'kg')} kg" weight=semibold`,
  },
  {
    id: "add-remove",
    title: "Use add and remove actions",
    keywords: ["add item", "remove item", "add", "remove", "delete", "todo", "to do", "new item", "append", "add to list", "checklist"],
    note: "add:list:{…} appends a record; remove:t removes the current item inside each.",
    link: { text: "Actions", href: "/docs/language/actions" },
    spec: `state task="" todos=[{text: "Pack water", done: false}]
each items=todos as=t
  row
    check "{t.text}" bind=t.done
    button "Remove" variant=secondary on=remove:t
input "New item" bind=task placeholder="e.g. Snacks" on="add:todos:{text: task, done: false};set:task:''"`,
  },
  {
    id: "screens",
    title: "Use screens with go: and back",
    keywords: ["multiple screens", "pages", "navigate", "next page", "wizard", "steps", "checkout flow", "back button", "multi step", "flow"],
    note: "Only one screen shows at a time; state is shared between them.",
    link: { text: "screen", href: "/docs/elements/screen" },
    spec: `state name="Ada"
screen name=start title="Welcome"
  input "Your name" bind=name
  button "Next" on=go:done
screen name=done title="All set"
  text "Thanks, {name}." style=lead
  button "Back" variant=secondary on=back`,
  },
  {
    id: "tabs",
    title: "Use tabs for sections",
    keywords: ["tabs", "sections", "overview details", "switch section", "tabbed"],
    note: "Only the selected tab's content shows; bind= holds which one.",
    link: { text: "tabs", href: "/docs/elements/tabs" },
    spec: `state view=overview
tabs bind=view
  tab "Overview" value=overview
    text "Light, quick-drying trail runners."
  tab "Specs" value=specs
    text "280 g, 6 mm drop."`,
  },
  {
    id: "table",
    title: "Use a table to sort rows",
    keywords: ["table", "sort", "sortable", "columns", "spreadsheet", "inventory", "orders", "grid of data", "select a row"],
    note: "sort= and direction= let people sort by pressing a header; bind= and key= select a row.",
    link: { text: "table", href: "/docs/elements/table" },
    spec: `state gear=[{id: "tent", name: "Tent", price: 180}, {id: "stove", name: "Stove", price: 45}, {id: "lamp", name: "Headlamp", price: 30}] picked="" by="name" dir="asc"
table items=gear key=id bind=picked sort=by direction=dir
  table-column "Item" field=name
  table-column "Price" field=price format=money`,
  },
  {
    id: "trend",
    title: "Use a line chart for a trend",
    keywords: ["chart", "graph", "over time", "trend", "line chart", "monthly", "revenue", "plot", "bar chart", "compare months"],
    note: "kind=bar compares categories; kind=line shows a trend. y= can take several fields.",
    link: { text: "chart", href: "/docs/elements/chart" },
    spec: `state sales=[{month: "Jan", revenue: 12000, last_year: 10000}, {month: "Feb", revenue: 18000, last_year: 14000}, {month: "Mar", revenue: 15000, last_year: 16000}]
chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year labels="This year,Last year" format=money`,
  },
  {
    id: "share",
    title: "Use a donut for shares of a total",
    keywords: ["pie", "donut", "share", "percentage", "breakdown", "split", "proportion", "by region", "composition"],
    note: "pie and donut take one y field; past six slices the rest become Other.",
    link: { text: "chart", href: "/docs/elements/chart" },
    spec: `state regions=[{name: "West", sales: 42000}, {name: "East", sales: 31000}, {name: "South", sales: 18000}]
chart "Sales by region" kind=donut items=regions x=name y=sales format=money`,
  },
  {
    id: "kpi",
    title: "Use stat for a key number",
    keywords: ["kpi", "metric", "key number", "big number", "stat", "dashboard", "figure", "change", "growth", "sparkline"],
    note: "change= shows ▲ or ▼, and spark= draws a small line of recent values.",
    link: { text: "stat", href: "/docs/elements/stat" },
    spec: `grid min=140 gap=10
  stat label="Revenue" value="$48.9K" change="+6.6%" spark={[41, 43, 42, 46, 47, 49]}
  stat label="Refunds" value="$1.2K" change="-3.1%" good=down`,
  },
  {
    id: "progress",
    title: "Use progress to show how far along",
    keywords: ["progress", "how far", "percent done", "completion", "loading bar", "steps done", "goal"],
    note: "value= and max= set how full the bar is.",
    link: { text: "progress", href: "/docs/elements/progress" },
    spec: `state done=3
progress value={done} max=5 label="{done} of 5 steps"
button "Next step" on=inc:done disabled={done >= 5}`,
  },
  {
    id: "show-hide",
    title: "Use if= to show or hide",
    keywords: ["show hide", "hide", "conditional", "only when", "only", "if", "visible", "toggle visibility", "show when", "ticked", "checked", "unless", "depending on"],
    note: "Any element takes if=; a line holding only if= shows the lines indented under it.",
    link: { text: "Conditional visibility", href: "/docs/language/conditions" },
    spec: `state gift=false message=""
check "This is a gift" bind=gift
if={gift}
  input "Gift message" bind=message placeholder="Happy birthday!"
  text "We'll leave the price off the receipt." tone=muted`,
  },
  {
    id: "tracking",
    title: "Use a timeline for steps or tracking",
    keywords: ["timeline", "tracking", "order status", "itinerary", "history", "steps in order", "shipping status", "journey"],
    note: "Give steps a status only to show progress: done, current or upcoming.",
    link: { text: "timeline", href: "/docs/elements/timeline" },
    spec: `timeline
  step "Ordered" time="Oct 18" status=done
  step "Out for delivery" detail="Arrives by 8 PM" status=current icon=truck
  step "Delivered" status=upcoming`,
  },
  {
    id: "compare",
    title: "Use compare for options side by side",
    keywords: ["compare", "plans", "pricing", "side by side", "versus", "vs", "which is better", "tiers"],
    note: "best= marks the lowest or highest value in each row; pick= recommends one option.",
    link: { text: "compare", href: "/docs/elements/compare" },
    spec: `state plans=[{name: "Basic", price: 9, storage: 50}, {name: "Pro", price: 19, storage: 500}]
compare items=plans pick="Pro"
  compare-row "Price a month" field=price format=money best=low
  compare-row "Storage (GB)" field=storage format=number best=high`,
  },
  {
    id: "empty",
    title: "Use empty when there is nothing to show",
    keywords: ["empty", "no results", "nothing", "empty state", "zero items", "no data"],
    note: "Give it an action so people can move on.",
    link: { text: "empty", href: "/docs/elements/empty" },
    spec: `empty "No results" detail="Try a wider price range." action="Clear filters" on=emit:clear_filters`,
  },
  {
    id: "send",
    title: "Use emit: to tell your app",
    keywords: ["submit", "send", "save", "api", "backend", "tell the app", "callback", "event", "post", "form submit"],
    note: "Specs can't call anything. emit: hands the choice to your app, which decides what happens.",
    link: { text: "Host data and events", href: "/docs/integration/host-data" },
    spec: `state qty=1
stepper "Quantity" bind=qty min=1
button "Place order" on="emit:order:{qty};notify:'Order sent'"`,
  },
];

/** Starter questions shown before anything is typed. */
export const suggestions = [
  "how do I let people pick a quantity?",
  "switch between a chart and a table",
  "show a running total",
  "a sortable table of orders",
  "only show a field when a box is ticked",
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 1);
const STOP = new Set(["how", "do", "to", "the", "an", "and", "or", "of", "in", "on", "for", "with", "my", "me", "can", "what", "is", "it", "that", "let", "people", "show", "make", "want", "use", "should", "which"]);

/**
 * The answers that best match a question, best first. Phrases score more
 * than single words; an element's own name scores most.
 */
export function match(question: string, limit = 3): Answer[] {
  const q = ` ${words(question).join(" ")} `;
  const qWords = new Set(words(question).filter((w) => !STOP.has(w)));
  const scored = answers.map((a) => {
    let score = 0;
    for (const k of a.keywords) {
      const kw = words(k);
      if (kw.length > 1) { if (q.includes(` ${kw.join(" ")} `)) score += 3; }
      else if (qWords.has(kw[0]!) || qWords.has(kw[0]! + "s") || (kw[0]!.endsWith("s") && qWords.has(kw[0]!.slice(0, -1)))) score += 1.5;
    }
    if (qWords.has(a.link.text)) score += 1.5;
    return { a, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).slice(0, limit).map((s) => s.a);
}
