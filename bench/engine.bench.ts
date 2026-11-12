/**
 * Engine benchmarks on 1,000- and 5,000-element specs.
 *
 *   npm run bench                                   print timings
 *   npm run bench -- --outputJson bench.json        save them (CI does this per commit)
 *   npm run bench -- --compare bench.json           compare against a saved run
 *
 * Paint runs against the recording canvas from sayshape/testing, so it
 * measures the engine's and components' own work, not the browser's raster.
 */
import { bench, describe } from "vitest";
import { coreComponents } from "../src/components";
import { layoutTree } from "../src/layout";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { Store } from "../src/state";
import { render } from "../src/testing";
import { MonoMeasurer } from "../src/text";
import { lightTheme } from "../src/theme";
import { bigSpec } from "./specs";

export { bigSpec };


const registry = new Registry(coreComponents);
const rootProps = { pad: "20", gap: "14" };

for (const size of [1000, 5000]) {
  const spec = bigSpec(size);
  const parsed = parse(spec, registry, { rootProps });
  const store = new Store();
  parsed.state.forEach((s) => store.declare(s.key, s.value));
  const measure = new MonoMeasurer();

  describe(`${parsed.nodeCount} elements`, () => {
    bench("parse", () => {
      parse(spec, registry, { rootProps });
    });

    bench("layout", () => {
      layoutTree(parsed.root, 1024, registry, lightTheme, measure, store.scope);
    });

    const ui = render(spec, { width: 1024 });
    bench("full frame (parse, layout, paint)", () => {
      ui.sayshape.setSpec(spec);
      ui.sayshape.renderNow();
    });

    bench("state change (layout and paint)", () => {
      ui.sayshape.state.set("qty", (Number(ui.state.qty) + 1) % 10);
      ui.sayshape.renderNow();
    });
  });
}

/** A 500-item list (each's limit) of order rows: 500 × 5 copies made and laid out per frame. */
const orders = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Order ${i}`, qty: (i % 5) + 1, price: 12 + (i % 9) }));
const listSpec = `state picked=-1
card
  text "{len(orders)} orders, {sum(orders, 'price', 'qty')} total" style=title
  each items=orders as=o key={o.id}
    row
      text "{o.name}" weight=semibold
      text "{o.qty} × \${o.price}" tone=muted
      badge "{o.qty * o.price}"
      button "Pick" variant=secondary on="set:picked:{o.id}"
`;

describe("each over 500 items", () => {
  const ui = render(listSpec, { width: 1024 });
  ui.set("orders", orders as never);

  bench("state change (expand, layout and paint)", () => {
    ui.sayshape.state.set("picked", (Number(ui.state.picked) + 1) % 500);
    ui.sayshape.renderNow();
  });

  bench("list change (one item updated)", () => {
    const i = Math.floor(Math.random() * 500);
    const next = orders.map((o) => (o.id === i ? { ...o, qty: o.qty + 1 } : o));
    ui.set("orders", next as never);
    ui.sayshape.renderNow();
  });
});
