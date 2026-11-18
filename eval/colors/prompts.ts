/**
 * What the person says in `npm run colors-eval`. Each set is a few phrasings of the same two
 * conversations, with its own colors and its own kinds of interface:
 *
 *   A  the person names colors once, asks for three more interfaces without mentioning them, then asks
 *      to go back to normal and for one more
 *   B  the person never mentions colors and asks for several interfaces
 *
 * Colors are always given as hex (with or without the #), so "the same colors" is something that can be
 * checked exactly. The first set's reset turn is deliberately the plainest; the others word it in
 * ways a model could mistake for something else ("drop the brand colors", "default look").
 */
import type { Phase } from "./score";

export interface PromptSet {
  id: string;
  /** What the person names, most important first, as they typed it. */
  colors: string[];
  /** Conversation A: the request that names the colors. */
  ask: string;
  /** Conversation A: three more interfaces, with no word about colors. */
  later: [string, string, string];
  /** Conversation A: go back to normal, and one more interface. */
  reset: string;
  /** Conversation B: interfaces, with no word about colors. Some are the kind a model might theme by itself. */
  plain: [string, string, string, string];
}

export const PROMPT_SETS: PromptSet[] = [
  {
    id: "coffee",
    colors: ["#0b6e4f", "#f4b942"],
    ask: "Make me a dashboard of this month's sales for my coffee shop: revenue, orders, and a chart of sales by weekday. Use our brand colors, #0b6e4f first and then #f4b942.",
    later: [
      "Now a checklist for opening the shop in the morning.",
      "Show a table of the five best-selling drinks with price and units sold.",
      "Add a small calculator that works out how many cups 2 kg of beans makes at 18 g a cup.",
    ],
    reset: "Thanks, those look good. Go back to the normal colors from now on, and show a form for customers to leave feedback.",
    plain: [
      "Make me a dashboard of this month's sales for my coffee shop: revenue, orders, and a chart of sales by weekday.",
      "Now a checklist for opening the shop in the morning.",
      "Show a table of the five best-selling drinks with price and units sold.",
      "Add a small calculator that works out how many cups 2 kg of beans makes at 18 g a cup.",
    ],
  },
  {
    id: "navy-coral",
    colors: ["#1b2a49", "#ff6f61", "#f2e9e4"],
    ask: "I'm putting together a pitch for investors. Show the key numbers for our startup: 12,400 users, 8% monthly growth, $48k monthly revenue, and a line chart of revenue over the last six months (14, 19, 25, 31, 39, 48 in thousands). Our palette is navy #1B2A49, coral #FF6F61 and sand #F2E9E4, so please use it.",
    later: [
      "Next, a comparison of our three pricing plans: Free, Pro at $12 a month and Team at $40 a month.",
      "Can you do a funnel of last month's signups: 5000 visitors, 900 signed up, 310 trials, 120 paying?",
      "And a timeline of the launch plan: beta in March, public launch in May, mobile app in September.",
    ],
    reset: "OK, I've seen enough of that palette. Use the standard look again and give me a simple contact form for the website.",
    plain: [
      "Show the key numbers for our startup: 12,400 users, 8% monthly growth, $48k monthly revenue, and a line chart of revenue over the last six months (14, 19, 25, 31, 39, 48 in thousands).",
      "Next, a comparison of our three pricing plans: Free, Pro at $12 a month and Team at $40 a month.",
      "Can you do a funnel of last month's signups: 5000 visitors, 900 signed up, 310 trials, 120 paying?",
      "And a timeline of the launch plan: beta in March, public launch in May, mobile app in September.",
    ],
  },
  {
    id: "purple",
    colors: ["#7C3AED"],
    ask: "Build me a habit tracker for this week with checkboxes for reading, exercise and meditation. I want the accent color to be #7C3AED.",
    later: [
      "Now a pie chart of how I spent my time yesterday: sleep 8 hours, work 8, commute 1, meals 2, free time 5.",
      "Make a form to log a new expense with an amount, a category and a date.",
      "Show my monthly budget as a bar chart: rent 1200, food 400, transport 120, fun 150, savings 300.",
    ],
    reset: "Drop the purple, I want the default colors again. Then show me a packing list for a weekend trip.",
    plain: [
      "Build me a habit tracker for this week with checkboxes for reading, exercise and meditation.",
      "Now a pie chart of how I spent my time yesterday: sleep 8 hours, work 8, commute 1, meals 2, free time 5.",
      "Make a form to log a new expense with an amount, a category and a date.",
      "Show my monthly budget as a bar chart: rent 1200, food 400, transport 120, fun 150, savings 300.",
    ],
  },
  {
    id: "ocean",
    colors: ["#2e86ab", "#e4572e", "#f6c85f"],
    ask: "We're a surf school. Show this week's lesson bookings as a table (Mon 12, Tue 9, Wed 15, Thu 7, Fri 18) with a total, in these colors please: 2e86ab, e4572e, f6c85f.",
    later: [
      "Could you add a tide planner: a slider for the hour of the day and the water level it gives, low at 6, high at 12.",
      "I also need a sign-up form for a beginner lesson with name, email and a choice of day.",
      "Last one for now: a card showing instructor ratings: Ana 4.8, Leo 4.5, Sam 4.9.",
    ],
    reset: "Forget the colors I gave you earlier, back to how it normally looks. Can you make a weather summary for Saturday: 24 degrees, light wind, 20% chance of rain?",
    plain: [
      "We're a surf school. Show this week's lesson bookings as a table (Mon 12, Tue 9, Wed 15, Thu 7, Fri 18) with a total.",
      "Could you add a tide planner: a slider for the hour of the day and the water level it gives, low at 6, high at 12.",
      "I also need a sign-up form for a beginner lesson with name, email and a choice of day.",
      "Last one for now: a card showing instructor ratings: Ana 4.8, Leo 4.5, Sam 4.9.",
    ],
  },
];

/** A user turn of a conversation. */
export interface Turn {
  text: string;
  phase: Phase;
}

export interface Conversation {
  /** "A" or "B" with the set: "A:coffee". */
  id: string;
  kind: "A" | "B";
  set: string;
  /** What the person named (A), or nothing (B). */
  wanted: string[];
  turns: Turn[];
}

export function conversationA(s: PromptSet): Conversation {
  return {
    id: `A:${s.id}`, kind: "A", set: s.id, wanted: s.colors,
    turns: [
      { text: s.ask, phase: "ask" },
      ...s.later.map((text) => ({ text, phase: "later" as const })),
      { text: s.reset, phase: "reset" },
    ],
  };
}

export function conversationB(s: PromptSet): Conversation {
  return { id: `B:${s.id}`, kind: "B", set: s.id, wanted: [], turns: s.plain.map((text) => ({ text, phase: "plain" as const })) };
}

/** The system message every conversation starts with, before the server's own instructions. */
export const SYSTEM = "You are a helpful assistant in a chat app.";
