/**
 * The landing page's hero: three requests a person might make, each answered
 * with a different working screen, and the presses that show it working.
 * Saved specs replayed the way a model's answer arrives; nothing is generated.
 *
 * Plain data with no browser imports, so test/hero-scenes.test.ts checks every
 * spec parses cleanly and every press does what the scene says, with the real
 * engine. All names, places and prices are made up.
 */

/** A press on part of an element: the nth element of a type, and which part (a stepper's "inc", a segmented option). */
export interface Tap {
  type: string;
  /** Which of that type, counting from 0 in the order they're drawn. Default 0. */
  nth?: number;
  /** The part to press, for elements with several (stepper "inc", segmented option text). */
  detail?: string;
}

export interface HeroScene {
  id: string;
  /** What the person asks, as typed into the chat. */
  ask: string;
  /** The short "ask for…, get…" line under the chat. */
  caption: { ask: string; get: string };
  spec: string;
  /** Pressed one after another once the screen is drawn, to show it works. */
  taps: Tap[];
  /** The agent's reply when the screen sends something back (on=emit:…). */
  reply?: string;
}

const trip: HeroScene = {
  id: "trip",
  ask: "Plan a weekend in Sedona for 4 people",
  caption: { ask: "a trip plan", get: "a planner" },
  spec: `state nights=2 people=4 room=189 food=55
card
  text "Sedona weekend" style=title
  row
    stepper "Nights" bind=nights min=1 max=7
    stepper "People" bind=people min=1 max=8
  row
    stat label="Hotel" value="\${number(nights * room * ceil(people / 2))}"
    stat label="Food" value="\${number(nights * people * food)}"
    stat label="Total" value="\${number(nights * room * ceil(people / 2) + nights * people * food)}"
  button "Save the plan" on=emit:save_plan`,
  taps: [{ type: "stepper", detail: "inc" }, { type: "stepper", detail: "inc" }],
};

const refund: HeroScene = {
  id: "refund",
  ask: "Help me file a refund for my rain jacket",
  caption: { ask: "a refund", get: "a form" },
  spec: `state reason=""
card
  text "Refund for order W-48213" style=title
  text "Rain shell · $129.00 · delivered Oct 28" tone=muted
  radio "It arrived damaged" bind=reason value=damaged
  radio "Wrong size" bind=reason value=size
  radio "I changed my mind" bind=reason value=mind
  button "Submit refund" disabled={reason == ''} on="emit:refund:{reason}"`,
  taps: [{ type: "radio", nth: 1 }, { type: "button" }],
  reply: "Done. Refund #4821 for $129.00 is on its way: 3 to 5 days.",
};

const laptop: HeroScene = {
  id: "laptop",
  ask: "Which laptop should I buy for travel?",
  caption: { ask: "which laptop", get: "a side-by-side" },
  spec: `state budget="Any price" laptops=[{name: "Atlas 13", price: 1099, battery: 18, weight: 1.2, cheap: true}, {name: "Summit 14", price: 1999, battery: 22, weight: 1.6, cheap: false}, {name: "Breeze 13", price: 899, battery: 12, weight: 1.1, cheap: true}]
derive shown={budget == 'Any price' ? laptops : filter(laptops, 'cheap')}
card
  text "Laptops for travel" style=title
  segmented bind=budget options="Any price,Under $1.2K"
  compare items=shown pick="Atlas 13"
    compare-row "Price" field=price format=money best=low
    compare-row "Battery (hours)" field=battery best=high
    compare-row "Weight (kg)" field=weight best=low`,
  // Options are split at commas, so the price is written without one.
  taps: [{ type: "segmented", detail: "Under $1.2K" }],
};

export const heroScenes: readonly HeroScene[] = [trip, refund, laptop];
