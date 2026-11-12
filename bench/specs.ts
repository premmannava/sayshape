/** Specs the benchmarks share, kept apart so importing one doesn't run another file's benches. */

/** About `elements` elements: repeated order cards using most core components. */
export function bigSpec(elements: number): string {
  const card = (i: number) => `card
  text "Order #${i}: trail runner socks, merino blend" style=title
  text "{qty} pairs, shipped to the valley campground" tone=muted
  row
    stat label="Each" value="\${price}"
    stat label="Total" value={qty * price + ${i % 7}}
  progress value={qty} max=10 label="Packed {qty} of 10"
  check "Gift wrap" bind=gift
  row
    button "Remove" variant=secondary on=dec:qty
    button "Add" on=inc:qty
`;
  const perCard = 11;
  const lines = ["state qty=2 price=24 gift=false"];
  for (let i = 0; i * perCard < elements; i++) lines.push(card(i));
  return lines.join("\n");
}
