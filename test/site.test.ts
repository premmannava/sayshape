/**
 * The website's examples and documentation run on the real engine, so they
 * must be valid SayShape and must do what the site says they do.
 *
 * - Every gallery example parses with no diagnostics and renders without
 *   warnings at phone and desktop widths, and its interactions work.
 * - Every ```sayshape block in the site's Markdown parses with no diagnostics,
 *   and live ones render without runtime warnings (unless marked `warns`),
 *   except blocks marked `invalid`, which exist to show diagnostics and must
 *   produce at least one.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render } from "../src/testing";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { examples, exampleById } from "../site/examples/catalog";

const TODAY = "2026-10-21";
type UI = ReturnType<typeof render>;
/** Everything the last frame drew, as one string, so a phrase inside a longer line can be found. */
const shown = (ui: UI) => ui.text().join("\n");
const present = (ui: UI, query: Parameters<UI["findAll"]>[0]) => ui.findAll(query).some((f) => f.box);
/** Press one of a table's parts: a header ("sort:price") or a row ("row:…"). */
function pressPart(ui: UI, detail: string) {
  const hit = ui.hits.find((h) => h.box.node.type === "table" && h.detail === detail);
  if (!hit) throw new Error(`No table part ${detail}`);
  ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
}
const ex = (id: string) => {
  const e = exampleById(id);
  if (!e) throw new Error(`No example ${id}`);
  return e.spec;
};

describe("gallery examples", () => {
  it("has at least six examples with unique ids", () => {
    expect(examples.length).toBeGreaterThanOrEqual(6);
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length);
  });

  for (const e of examples) {
    for (const width of [340, 720]) {
      it(`${e.id} renders cleanly at ${width}px`, () => {
        const ui = render(e.spec, { width, today: TODAY });
        expect(ui.diagnostics).toEqual([]);
        expect(ui.warnings).toEqual([]);
      });
    }
    it(`${e.id} renders every prefix while streaming`, () => {
      const lines = e.spec.split("\n");
      for (let n = 1; n <= lines.length; n++) {
        const ui = render(lines.slice(0, n).join("\n"), { today: TODAY });
        expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        ui.destroy();
      }
    });
  }

  it("tip calculator: totals follow the inputs", () => {
    const ui = render(ex("tip-calculator"));
    expect(shown(ui)).toContain("$15.48"); // 18% of $86
    expect(shown(ui)).toContain("$101.48");
    expect(shown(ui)).toContain("$50.74"); // split two ways
    ui.press({ type: "button", text: "20%" });
    expect(ui.state.percent).toBe(20);
    expect(shown(ui)).toContain("$17.20");
    ui.set("people", 4);
    expect(shown(ui)).toContain("$25.80");
  });

  it("sales pipeline: a column per stage with totals, and pressing a deal shows it", () => {
    const ui = render(exampleById("sales-pipeline")!.spec, { width: 1024 });
    expect(shown(ui)).toContain("$94.5K");
    expect(shown(ui)).toContain("Policy admin suite");
    const deal = ui.hits.find((h) => h.box.node.type === "board" && h.detail === "card:k:number:3")!;
    ui.click(deal.box.x + deal.box.w / 2, deal.box.y + deal.box.h / 2);
    expect(ui.state.picked).toBe(3);
    expect(shown(ui)).toContain("Priya Nair");
  });

  it("org chart: a box per person, and pressing one shows who they report to", () => {
    const ui = render(exampleById("org-chart")!.spec, { width: 1024 });
    expect(shown(ui)).toContain("Chief Operating Officer");
    const ben = ui.hits.find((h) => h.box.node.type === "tree" && h.detail === "node:e2")!;
    ui.click(ben.box.x + ben.box.w / 2, ben.box.y + ben.box.h / 2);
    expect(ui.state.picked).toBe("e2");
    expect(shown(ui)).toContain("Ana Ruiz");
  });

  it("claim approval: a box per step with labelled arrows, and pressing one shows it", () => {
    const ui = render(exampleById("claim-approval")!.spec, { width: 1024 });
    expect(shown(ui)).toContain("Fraud signals?");
    expect(shown(ui)).toContain("Cleared");
    const r = ui.hits.find((h) => h.box.node.type === "flow" && h.detail === "step:approve")!;
    ui.click(r.box.x + r.box.w / 2, r.box.y + r.box.h / 2);
    expect(ui.state.picked).toBe("approve");
    expect(shown(ui)).toContain("Owned by the claims team");
  });

  it("launch plan: a bar per task by team, and pressing one shows its details", () => {
    const ui = render(exampleById("launch-plan")!.spec, { width: 1024, today: "2026-10-21" });
    expect(shown(ui)).toContain("Beta with 12 customers");
    const site = ui.hits.find((h) => h.box.node.type === "schedule" && h.detail === "item:2")!;
    ui.click(site.box.x + site.box.w / 2, site.box.y + site.box.h / 2);
    expect(ui.state.picked).toBe(3);
    expect(shown(ui)).toContain("Luis Ortega");
    expect(shown(ui)).toContain("At risk");
  });

  it("grocery checklist: check, hide, add, remove and clear", () => {
    const ui = render(ex("grocery-checklist"));
    expect(shown(ui)).toContain("2 of 5 items in the cart");
    ui.press({ type: "check", text: "Oat milk" });
    expect(shown(ui)).toContain("3 of 5 items in the cart");

    ui.press({ type: "switch" });
    expect(present(ui, { type: "check", text: "Oat milk" })).toBe(false);
    expect(present(ui, { type: "check", text: "Bananas" })).toBe(true);
    ui.press({ type: "switch" });

    expect(ui.find({ type: "button", text: "Add" }).node).toBeTruthy();
    ui.type({ type: "input" }, "  Apples ");
    ui.press({ type: "button", text: "Add" });
    expect(shown(ui)).toContain("3 of 6 items in the cart");
    expect(present(ui, { type: "check", text: "Apples" })).toBe(true);
    expect(ui.state.newItem).toBe("");

    ui.press({ type: "button", text: "Remove items in the cart" });
    expect(shown(ui)).toContain("0 of 3 items in the cart");
    expect(present(ui, { type: "check", text: "Eggs" })).toBe(false);

    for (const name of ["Sourdough bread", "Bananas", "Apples"]) ui.press({ type: "check", text: name });
    expect(shown(ui)).toContain("Everything is in the cart.");
    ui.press({ type: "button", text: "Remove items in the cart" });
    expect(shown(ui)).toContain("Your list is empty");
    expect(ui.warnings).toEqual([]);
  });

  it("monthly budget: filters, budget and selection agree", () => {
    const ui = render(ex("monthly-budget"));
    // October: 64.5 + 80 + 42 + 87.5 + 132 + 35
    expect(shown(ui)).toContain("$441.00");
    expect(shown(ui)).toContain("$159.00");
    ui.set("category", "Food");
    expect(shown(ui)).toContain("$152.00");
    ui.set("month", "November");
    expect(shown(ui)).toContain("$72.00");
    ui.set("category", "All");
    // November with rent goes over the $600 budget.
    expect(shown(ui)).toContain("Over budget by $207.00");
    ui.set("budget", 900);
    expect(present(ui, { type: "text", text: /Over budget/ })).toBe(false);
    expect(shown(ui)).toContain("Electricity · Home · 2026-10-15");
    pressPart(ui, "sort:amount");
    expect(ui.state.sortField).toBe("amount");
    expect(ui.warnings).toEqual([]);
  });


  it("every example has a short title, a prompt and a look", () => {
    for (const e of examples) {
      expect(e.title.split(" ").length, e.id).toBeLessThanOrEqual(3);
      expect(e.prompt.length, e.id).toBeGreaterThan(10);
      expect(["light", "dark"]).toContain(e.look.scheme);
    }
  });


  it("coffee order: size, extras and cups change the total", () => {
    const ui = render(ex("coffee-order"));
    expect(shown(ui)).toContain("$4.85"); // medium 4.25 + oat 0.60
    ui.set("size", "Large");
    ui.set("sweet", true);
    expect(shown(ui)).toContain("$6.10");
    ui.set("cups", 2);
    expect(shown(ui)).toContain("$12.20");
    expect(shown(ui)).toContain("Order 2 cups");
    ui.press({ type: "button", text: /Order/ });
    expect(ui.emitted.at(-1)?.name).toBe("order");
  });

  it("book a cabin: price follows nights, too many guests warns, reserve needs a date", () => {
    const ui = render(ex("book-a-cabin"), { today: TODAY });
    expect(shown(ui)).toContain("$298.00"); // 149 x 2
    expect(shown(ui)).toContain("$333.76"); // + 12%
    expect(() => ui.press({ type: "button", text: "Reserve" })).toThrow(/isn't pressable/);
    ui.set("guests", 5);
    expect(shown(ui)).toContain("Pine sleeps 4");
    ui.set("cabin", "Ridge");
    expect(shown(ui)).not.toContain("Ridge fits up to 6");
    ui.set("checkin", "2026-11-20");
    ui.press({ type: "button", text: "Reserve" });
    expect(ui.emitted.at(-1)?.name).toBe("reserve");
  });

  it("pick a laptop: the recommendation follows the use", () => {
    const ui = render(ex("pick-a-laptop"));
    expect(shown(ui)).toContain("Air 13 for travel");
    ui.set("use", "Video");
    expect(shown(ui)).toContain("Pro 14 for video");
    ui.set("use", "Office");
    expect(shown(ui)).toContain("Flex 15 for office");
  });

  it("sales this week: totals and the best day come from the data", () => {
    const ui = render(ex("sales-this-week"));
    expect(shown(ui)).toContain("$31.7K");
    expect(shown(ui)).toContain("Best day: Sun");
  });

  it("trip planner: days switch and packing counts up", () => {
    const ui = render(ex("trip-planner"));
    expect(shown(ui)).toContain("Cathedral Rock");
    expect(shown(ui)).toContain("2 of 4 packed");
    ui.set("day", "Day 2");
    expect(shown(ui)).toContain("Devil's Bridge");
    ui.press({ type: "check", text: "Sunscreen" });
    expect(shown(ui)).toContain("3 of 4 packed");
  });

  it("order tracking: updates move the order to delivered", () => {
    const ui = render(ex("order-tracking"));
    expect(shown(ui)).toContain("On the way");
    ui.press({ type: "button", text: "Next update" });
    ui.press({ type: "button", text: "Next update" });
    expect(shown(ui)).toContain("Delivered");
    expect(() => ui.press({ type: "button", text: "Next update" })).toThrow(/isn't pressable/);
  });

  it("product builder: configure, add, change quantities, remove and check out", () => {
    const ui = render(ex("product-builder"));
    ui.press({ type: "radio", text: "L (+$10)" });
    expect(shown(ui)).toContain("$139.00");
    ui.press({ type: "button", text: "Add to cart" });
    ui.press({ type: "radio", text: "Ridge 18 L · $99.00" });
    ui.press({ type: "radio", text: "S" });
    ui.set("color", "moss");
    ui.press({ type: "button", text: "Add to cart" });
    expect(ui.state.cart).toHaveLength(2);
    ui.press({ type: "button", text: "View cart (2)" });
    expect(ui.sayshape.currentScreen).toBe("cart");
    // 139 + 99, free shipping over $150
    expect(shown(ui)).toContain("$238.00");
    expect(shown(ui)).toContain("Free");
    ui.press({ id: ui.findAll({ type: "link", text: "Remove" })[0]!.node.id });
    expect(ui.state.cart).toHaveLength(1);
    expect(shown(ui)).toContain("Moss · size S");
    // $99 alone pays shipping.
    expect(shown(ui)).toContain("$108.00");
    ui.press({ type: "button", text: "Check out" });
    expect(ui.emitted.map((e) => e.name)).toEqual(["checkout"]);
    ui.press({ type: "link", text: "Remove" });
    expect(shown(ui)).toContain("Your cart is empty");
  });


});

// ----------------------------------------------------------------- docs

const SITE = resolve(__dirname, "../site");
const registry = new Registry([...coreComponents, ...mapComponents]);

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".vitepress" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

interface Block { file: string; line: number; info: string; spec: string }
function sayShapeBlocks(): Block[] {
  const blocks: Block[] = [];
  for (const file of markdownFiles(SITE)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const open = /^(\s*)```sayshape\b(.*)$/.exec(lines[i]!);
      if (!open) continue;
      const start = i;
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i]!.slice(open[1]!.length));
      blocks.push({ file: relative(SITE, file), line: start + 1, info: open[2]!.trim(), spec: body.join("\n") });
    }
  }
  return blocks;
}

describe("documentation examples", () => {
  const blocks = sayShapeBlocks();

  // The component pages are generated (npm run site:docs) and ignored by git, so CI's
  // plain `npm test` may not have them; count only the hand-written pages here.
  it("finds the documentation's examples", () => {
    expect(blocks.filter((b) => !b.file.startsWith("docs/components")).length).toBeGreaterThanOrEqual(30);
  });

  for (const b of blocks) {
    const invalid = b.info.split(/\s+/).includes("invalid");
    it(`${b.file}:${b.line} ${invalid ? "shows diagnostics" : "is valid SayShape"}`, () => {
      // `known=a,b` names state the host app supplies (sayshape.state.set), as in the integration docs.
      const known = /(?:^|\s)known=([\w,]+)/.exec(b.info)?.[1]?.split(",") ?? [];
      const diagnostics = parse(b.spec, registry, { knownNames: known }).diagnostics;
      if (invalid) expect(diagnostics.length).toBeGreaterThan(0);
      else expect(diagnostics.map((d) => `L${d.line} ${d.message}`)).toEqual([]);
      // Live examples also run: nothing they do may warn (a chart given bad data, a table that doesn't fit).
      // `warns` marks an example that shows a runtime warning on purpose (a blocked image).
      if (!invalid && b.info.split(/\s+/).includes("live")) {
        const ui = render(b.spec, { components: [...coreComponents, ...mapComponents], width: 640, today: TODAY });
        if (b.info.split(/\s+/).includes("warns")) expect(ui.warnings.length).toBeGreaterThan(0);
        else expect(ui.warnings).toEqual([]);
        ui.destroy();
      }
    });
  }
});
