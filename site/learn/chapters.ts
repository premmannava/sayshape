/**
 * The build-along on /learn/: five chapters that grow one spec into a small
 * store. Each chapter's spec is complete and valid on its own, so the live
 * panel can show any chapter directly. test/site-learn.test.ts checks that
 * every spec parses cleanly and that the "Try it" in each chapter works.
 */

export interface Chapter {
  id: string;
  title: string;
  /** What the chapter teaches, in a sentence or two. */
  body: string;
  /** The language features it adds, shown as a short list. */
  adds: string[];
  /** What to do in the live panel. */
  tryIt: string;
  /** Pages that go deeper. */
  more: Array<{ text: string; link: string }>;
  spec: string;
}

export const chapters: Chapter[] = [
  {
    id: "state",
    title: "Start with one value",
    body: "Every interface starts with state: a value people can change. Bind a stepper to it, and pressing + changes the value. Nothing else is needed.",
    adds: ["state qty=1", "stepper … bind=qty"],
    tryIt: "Press + on the stepper. The state below the panel follows.",
    more: [{ text: "State", link: "/docs/language/state" }, { text: "stepper", link: "/docs/elements/stepper" }],
    spec: `state qty=1
card
  text "Your cart" style=title
  stepper "Trail socks" bind=qty min=0`,
  },
  {
    id: "derive",
    title: "Work out a total",
    body: "A derive line computes a value from state and keeps it current. The total follows the stepper on its own: no events, no code.",
    adds: ["derive total={qty * 24}", "stat … value={money(total)}"],
    tryIt: "Change the quantity and watch the total.",
    more: [{ text: "Derived values", link: "/docs/language/derived" }, { text: "stat", link: "/docs/elements/stat" }],
    spec: `state qty=1
derive total={qty * 24}
card
  text "Your cart" style=title
  stepper "Trail socks" bind=qty min=0
  stat label="Total" value={money(total)}`,
  },
  {
    id: "lists",
    title: "Repeat for a list",
    body: "Put records in state and repeat elements with each. bind=item.qty writes into the right row, and sum() totals the whole list.",
    adds: ["state cart=[{…}, {…}]", "each items=cart as=item", "sum(cart, 'price', 'qty')"],
    tryIt: "Change either item. The total covers both.",
    more: [{ text: "Lists and iteration", link: "/docs/language/lists" }, { text: "each", link: "/docs/elements/each" }],
    spec: `state cart=[{name: "Trail socks", price: 24, qty: 1}, {name: "Rain shell", price: 129, qty: 1}]
derive total={sum(cart, 'price', 'qty')}
card
  text "Your cart" style=title
  each items=cart as=item
    stepper "{item.name}" bind=item.qty min=0
  stat label="Total" value={money(total)}`,
  },
  {
    id: "actions",
    title: "Let people act",
    body: "Actions change state when something is pressed. add puts a new record on a list, notify shows a short message, and ; runs them one after another.",
    adds: ["button … on=\"add:cart:{…};notify:'…'\"", "disabled={…}"],
    tryIt: "Add the headlamp. The button switches off once it's in the cart.",
    more: [{ text: "Actions and navigation", link: "/docs/language/actions" }, { text: "button", link: "/docs/elements/button" }],
    spec: `state cart=[{name: "Trail socks", price: 24, qty: 1}, {name: "Rain shell", price: 129, qty: 1}]
derive total={sum(cart, 'price', 'qty')}
derive hasLamp={includes(join(cart, 'name'), 'Headlamp')}
card
  text "Your cart" style=title
  each items=cart as=item
    stepper "{item.name}" bind=item.qty min=0
  stat label="Total" value={money(total)}
  button "Add headlamp, $30" disabled={hasLamp} on="add:cart:{name: 'Headlamp', price: 30, qty: 1};notify:'Headlamp added'"`,
  },
  {
    id: "screens",
    title: "Move between screens",
    body: "Wrap parts of the spec in screen blocks and move between them with go: and back. State is shared, so checkout already knows the total.",
    adds: ["screen name=cart", "on=go:checkout", "on=back"],
    tryIt: "Press Checkout, then go back to the cart.",
    more: [{ text: "Actions and navigation", link: "/docs/language/actions" }, { text: "screen", link: "/docs/elements/screen" }],
    spec: `state cart=[{name: "Trail socks", price: 24, qty: 1}, {name: "Rain shell", price: 129, qty: 1}]
derive total={sum(cart, 'price', 'qty')}
derive hasLamp={includes(join(cart, 'name'), 'Headlamp')}
screen name=cart title="Your cart"
  each items=cart as=item
    stepper "{item.name}" bind=item.qty min=0
  stat label="Total" value={money(total)}
  button "Add headlamp, $30" variant=secondary disabled={hasLamp} on="add:cart:{name: 'Headlamp', price: 30, qty: 1};notify:'Headlamp added'"
  button "Checkout" on=go:checkout
screen name=checkout title="Checkout"
  text "You pay {money(total)}" style=lead
  button "Back to cart" variant=secondary on=back`,
  },
];

/** Line numbers (from 0) in a chapter's spec that the chapter before it didn't have. */
export function newLines(index: number): Set<number> {
  const prev = new Set(index > 0 ? chapters[index - 1]!.spec.split("\n") : []);
  return new Set(chapters[index]!.spec.split("\n").flatMap((l, i) => (prev.has(l) ? [] : [i])));
}
