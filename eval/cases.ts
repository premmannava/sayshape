/**
 * The evaluation set: requests a model should be able to turn into SayShape.
 * `expect` lists elements a good answer uses; a list inside it means any one
 * of them will do. `checks` render the answer and use it (see checks.ts).
 * Choosing cases describe the data without naming the element, to check a
 * model picks the specific one (a bullet chart, details) over a lookalike.
 * Traps check that models stay within the language.
 */
import { acts, allDoneShowsMore, calls, nested, pressChanges, removes, repeats, shows, typingChanges, typingFilters, writes, type Check } from "./checks";

export interface EvalCase {
  id: string;
  category: "form" | "compare" | "dashboard" | "shop" | "navigation" | "content" | "interactive" | "data" | "choose" | "hard" | "trap";
  request: string;
  expect?: Array<string | string[]>;
  /** What the screen must do when used, checked on the final spec. */
  checks?: Check[];
  /** What a trap is testing, for the report. */
  note?: string;
}

export const cases: EvalCase[] = [
  // Forms
  { id: "form-booking", category: "form", request: "A booking form for a mountain cabin: 2 to 6 guests, 1 to 14 nights, and a Book button.", expect: ["stepper", "button"] },
  { id: "form-settings", category: "form", request: "Notification settings with switches for email, SMS and push notifications, and a Save button.", expect: ["switch", "button"] },
  { id: "form-survey", category: "form", request: "A one-question survey: how did you hear about us? Pick one of four answers, then Submit.", expect: ["radio", "button"] },
  { id: "form-login", category: "form", request: "A login form with email and password fields.", expect: ["input", "button"], checks: [typingChanges("ada@example.com")] },
  { id: "form-signup", category: "form", request: "A sign-up form: name, email, password, and agreeing to the terms.", expect: ["input", "check", "button"], checks: [typingChanges("Ada")] },
  { id: "form-checklist", category: "form", request: "A packing checklist for a day hike with six items and a bar showing how many are packed.", expect: ["check", "progress"] },

  // Comparisons
  { id: "compare-laptops", category: "compare", request: "Compare two laptops side by side: price, weight and battery life, with a button to choose each.", expect: [["row", "grid", "compare"], "button"] },
  { id: "compare-plans", category: "compare", request: "Three pricing plans (Free, Pro, Team) with their main features and a Choose button for each.", expect: ["card", "button"] },

  // Dashboards
  { id: "dash-sales", category: "dashboard", request: "A sales dashboard for today: revenue, orders, average order value and conversion rate.", expect: ["stat"] },
  { id: "dash-running", category: "dashboard", request: "My running this week: total distance, longest run, and progress toward a 40 km goal.", expect: ["stat", ["progress", "meter"]] },
  { id: "dash-habits", category: "dashboard", request: "A water tracker: a button to add a glass, and progress toward 8 glasses a day.", expect: ["button", "progress"] },

  // Shopping
  { id: "shop-product", category: "shop", request: "A product page for waterproof hiking boots: sizes 8 to 12, a star rating, the price, and Add to cart.", expect: [["radio", "stepper"], "rating", "button"] },
  { id: "shop-cart", category: "shop", request: "A shopping cart with three items whose quantities I can change, and the total price.", expect: ["stepper"] },
  { id: "shop-filter", category: "shop", request: "Let me filter tents by maximum price with a slider, and list the three tents with their prices.", expect: ["slider", ["list", "card"]] },
  { id: "shop-sale", category: "shop", request: "A sale banner card for a rain jacket, was $160 now $128, with a Shop now button.", expect: ["card", "button"] },

  // Navigation
  { id: "nav-onboarding", category: "navigation", request: "A three-step onboarding: welcome, choose your interests, all set. With Next and Back buttons.", expect: ["screen"] },
  { id: "nav-checkout", category: "navigation", request: "A checkout with three screens: cart, shipping method, and order confirmation.", expect: ["screen"] },
  { id: "nav-recipe", category: "navigation", request: "A recipe for pancakes with tabs for ingredients, steps and notes.", expect: ["tabs"] },
  { id: "nav-faq", category: "navigation", request: "An FAQ about shipping with four questions that open to show their answers.", expect: ["accordion"] },
  { id: "nav-results", category: "navigation", request: "Page 2 of 9 of search results for trail shoes, with a way to change page.", expect: ["pagination"] },

  // Content
  { id: "content-profile", category: "content", request: "A profile card for a trail guide: name, role, rating out of 5, and a Contact button.", expect: ["avatar", "button"] },
  { id: "content-empty", category: "content", request: "What to show when a search for hotels finds nothing.", expect: ["empty"] },
  { id: "content-loading", category: "content", request: "A loading placeholder for a list of news articles.", expect: ["skeleton"] },
  { id: "content-install", category: "content", request: "Show how to install our command line tool with npm.", expect: ["code"] },
  { id: "content-status", category: "content", request: "Order status for a package: ordered, shipped, out for delivery (current), delivered.", expect: [["timeline", "list", "text", "badge"]] },

  // Interactive
  { id: "int-quiz", category: "interactive", request: "A quiz question about which planet is largest, with four answers, that tells me if I'm right.", expect: [["radio", "button"]] },
  { id: "int-tip", category: "interactive", request: "A tip calculator for a $64 bill: tip from 10 to 25 percent with a slider, split between 1 to 6 people.", expect: ["slider", "stepper"] },
  { id: "int-mortgage", category: "interactive", request: "A mortgage calculator: loan amount $300,000, interest rate 6.5%, 30-year term, each with a slider. Show the monthly payment.", expect: ["slider"], checks: [calls("pow"), shows(/\$1,896\.2\d/, "the correct monthly payment ($1,896.20)")] },
  { id: "int-map", category: "interactive", request: "Show the countries I've visited, Japan, Peru and Kenya, with a pin on each capital.", expect: ["map", "pin"] },

  // Data: lists that should come from state through each, with numbers computed from them
  { id: "data-todo", category: "data", request: "A to-do list of 5 tasks I can tick off, with \"X of 5 done\" at the top.", expect: ["each", "check"], checks: [calls("count"), pressChanges("check")] },
  { id: "data-cart", category: "data", request: "A shopping cart of 3 items with quantities I can change and a total that updates.", expect: ["each", "stepper"], checks: [calls("sum"), pressChanges("stepper")] },
  { id: "data-leaderboard", category: "data", request: "A leaderboard of the top 8 runners in our club this week, with rank, name and distance.", expect: ["each"], checks: [repeats(8)] },
  { id: "data-products", category: "data", request: "A grid of 6 tents, each with its name, price and an Add to cart button.", expect: ["each", "button"], checks: [repeats(6)] },
  { id: "data-orders", category: "data", request: "My last 3 orders, each showing its date, its 2 or 3 items, and the order total.", expect: ["each"], checks: [nested, repeats(3)] },
  { id: "data-kanban", category: "data", request: "A kanban board with three columns, To do, Doing and Done, each holding 2 or 3 task cards.", expect: ["each"], checks: [repeats(6)] },
  { id: "data-contacts", category: "data", request: "A contact list of 6 people with name and phone, where I can remove a contact or add a new one.", expect: ["each", "button", "input"], checks: [repeats(6), acts("add"), removes(/remove|delete/i)] },
  { id: "data-search", category: "data", request: "A list of 8 hiking trails near Phoenix with a search box that filters them as I type.", expect: ["each", "input"], checks: [repeats(8), typingFilters] },

  // Choosing: the data is described, the element isn't named
  { id: "choose-targets", category: "choose", request: "How are we doing against our Q3 goals? Revenue $1.24M of $1.15M, new customers 182 of 200, expansion $310K of $400K, pipeline $2.1M of $2M.", expect: ["chart"], checks: [writes(/kind=bullet/, "a bullet chart")] },
  { id: "choose-funnel", category: "choose", request: "Our signup flow last month: 12,400 visited, 3,100 started signing up, 1,900 verified their email and 640 paid. Where do we lose people?", expect: ["chart"], checks: [writes(/kind=funnel/, "a funnel chart")] },
  { id: "choose-bridge", category: "choose", request: "Walk me from revenue to net income: revenue $480K, cost of goods -$190K, salaries -$140K, other income $22K.", expect: ["chart"], checks: [writes(/kind=waterfall/, "a waterfall chart")] },
  { id: "choose-mix", category: "choose", request: "Monthly revenue from January to April, split into hardware, software and services, so I can see the total and the mix.", expect: ["chart"], checks: [writes(/kind=stacked/, "a stacked chart")] },
  { id: "choose-ranking", category: "choose", request: "Our top 8 customers by annual spend, with their full company names.", expect: ["chart"], checks: [writes(/kind=hbar/, "a horizontal bar chart")] },
  { id: "choose-share", category: "choose", request: "How our sales split across regions: West $820K, East $610K, Central $455K, South $380K.", expect: ["chart"], checks: [writes(/kind=(donut|pie)/, "a pie or donut chart")] },
  { id: "choose-score", category: "choose", request: "Our customer health score is 72 out of 100, where under 60 is at risk and 85 or more is healthy.", expect: ["meter"] },
  { id: "choose-record", category: "choose", request: "Order #1042: placed Oct 3, shipped by UPS, in transit, total $186.40, going to Phoenix, AZ.", expect: ["details"] },
  { id: "choose-plans", category: "choose", request: "Help me choose between the Basic ($9 a month, 50 GB), Pro ($19, 500 GB) and Team ($49, 2 TB) plans.", expect: ["compare"] },
  { id: "choose-grid", category: "choose", request: "When do orders come in? Weekdays peak around noon at about 65 an hour and 7pm at about 45; weekends peak at 7pm at about 80. Show 6am to 9pm for all 7 days.", expect: ["chart"], checks: [writes(/kind=heatmap/, "a heatmap")] },
  { id: "choose-volume", category: "choose", request: "Weekly site visitors over the last 10 weeks, growing from 12,000 to 31,000, so I can see how much traffic we're getting overall.", expect: ["chart"], checks: [writes(/kind=area/, "an area chart")] },
  { id: "choose-rate", category: "choose", request: "Our checkout conversion rate by month: Jan 3.2%, Feb 3.5%, Mar 3.1%, Apr 3.9%, May 4.4%, Jun 4.1%.", expect: ["chart"], checks: [writes(/format=percent/, "percent formatting")] },
  { id: "choose-regions", category: "choose", request: "Sales by region: West $820K, East $610K, Central $455K, South $380K, Northeast $290K. Let me choose which regions are included in the total and the chart.", expect: ["select"], checks: [writes(/multiple=true/, "a multi-select"), calls("filter")] },
  { id: "choose-period", category: "choose", request: "This month's 10 orders with their dates and amounts. Let me pick a date range and see the revenue for just those days.", expect: ["date-picker"], checks: [writes(/range=true/, "a date range"), calls("filter")] },
  { id: "choose-trend", category: "choose", request: "Daily signups for the last 14 days in a table, with a headline total above it that has a small trend line of those days.", expect: ["stat", "table"], checks: [writes(/spark=\{?\s*pluck\(/, "a sparkline taken from the data with pluck()")] },
  { id: "choose-alert", category: "choose", request: "Show our churn for this quarter: it rose to 4.1% from 3.0%. Make sure the warning about it is the first thing people notice.", expect: ["callout"] },
  { id: "choose-views", category: "choose", request: "A revenue chart where I can switch between the Week, Month and Year views.", expect: ["chart", "segmented"] },
  { id: "choose-delivery", category: "choose", request: "Where's my package? Ordered Oct 1, shipped Oct 2, out for delivery now, expected Oct 4.", expect: ["timeline"] },

  // Hard: several ideas at once, from testing with a 14B model
  { id: "hard-bill", category: "hard", request: "Split a $186 dinner bill: tip from 0 to 25% with a slider, 2 to 8 people with a stepper, and show each person's share.", expect: ["slider", "stepper"], checks: [pressChanges("stepper")] },
  { id: "hard-celebrate", category: "hard", request: "A to-do list of 4 chores I can tick off. When all are done, show a celebration message.", expect: ["each", "check"], checks: [allDoneShowsMore] },

  // Traps: staying inside the language
  { id: "trap-red", category: "trap", request: "A big red Buy now button.", expect: ["button"], note: "No colors in SayShape: the closest role is variant=danger." },
  { id: "trap-css", category: "trap", request: "A card with a blue background and 18px Helvetica text saying Welcome back.", expect: ["card"], note: "No backgrounds, sizes or fonts: should ignore them, not invent props." },
  { id: "trap-prose", category: "trap", request: "Explain what you are.", note: "Should still answer in SayShape, not prose." },
];
