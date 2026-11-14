/** timeline and step, segmented, carousel, compare and compare-row. */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { BLOCKS_WIDTH } from "../src/components/compare";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const warnings = (spec: string) => parse(spec, registry).diagnostics.map((d) => d.message);
const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("timeline", () => {
  const SPEC = `timeline
  step "Ordered" time="Oct 18" status=done
  step "Shipped" detail="Phoenix, AZ" status=current icon=truck
  step "Delivered" status=upcoming
`;
  it("draws each step's words to the right of its marker, upcoming ones muted", () => {
    const ui = render(SPEC);
    expect(texts(ui)).toEqual(expect.arrayContaining(["Ordered", "Oct 18", "Shipped", "Phoenix, AZ", "Delivered"]));
    const delivered = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Delivered")!;
    expect(delivered.fillStyle).toBe(lightTheme.colors.muted);
    const ordered = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Ordered")!;
    expect(Number(ordered.args[1])).toBeGreaterThan(ui.find("timeline").box!.x + 22);
    ui.destroy();
  });

  it("joins done steps in the accent and the rest in the line color", () => {
    const ui = render(SPEC);
    const lines = ui.drawOps.filter((o) => o.op === "stroke").map((o) => o.strokeStyle);
    expect(lines).toContain(lightTheme.colors.accent);
    expect(lines).toContain(lightTheme.colors.line);
    ui.destroy();
  });

  it("shows a plan without statuses as neutral: nothing ticked, nothing muted, no accent line", () => {
    const ui = render(`timeline\n  step "Day 1: Sedona"\n  step "Day 2: Flagstaff"\n  step "Day 3: Grand Canyon"\n`);
    const ops = ui.drawOps;
    expect(ops.some((o) => (o.fillStyle || o.strokeStyle) === lightTheme.colors.accent)).toBe(false);
    for (const t of ["Day 1: Sedona", "Day 2: Flagstaff", "Day 3: Grand Canyon"]) {
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === t)!.fillStyle).toBe(lightTheme.colors.ink);
    }
    ui.destroy();
  });

  it("marks progress once statuses are given: ticks up to where the person is", () => {
    const ui = render(`timeline\n  step "Day 1" status=done\n  step "Day 2" status=current\n  step "Day 3" status=upcoming\n`);
    expect(ui.drawOps.filter((o) => o.op === "fill" && o.fillStyle === lightTheme.colors.accent).length).toBeGreaterThanOrEqual(2);
    expect(ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Day 3")!.fillStyle).toBe(lightTheme.colors.muted);
    ui.destroy();
  });

  it("warns about a bad status or icon", () => {
    expect(warnings(`timeline\n  step "A" status=finished\n`)[0]).toMatch(/status should be one of done, current, upcoming/);
    expect(warnings(`timeline\n  step "A" icon=lorry\n`)[0]).toMatch(/icon="lorry" isn't an icon/);
  });
});

describe("segmented", () => {
  it("shows its options, the chosen one in ink, and switches on press and with the arrow keys", () => {
    const ui = render(`state view="Week"\nsegmented bind=view options="Week,Month,Year"\n`);
    const week = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Week")!;
    expect(week.fillStyle).toBe(lightTheme.colors.ink);
    const year = ui.hits.find((h) => h.detail === "Year")!;
    ui.sayshape.activate({ node: year.box.node, box: year.box, detail: "Year" });
    ui.sayshape.renderNow();
    expect(ui.sayshape.state.get("view")).toBe("Year");
    ui.sayshape.focus = { node: year.box.node, box: year.box, detail: "Year" };
    ui.key("ArrowLeft");
    expect(ui.sayshape.state.get("view")).toBe("Month");
    ui.destroy();
  });

  it("reads bars between options as commas, as models often write them", () => {
    for (const options of ["Week | Month", "Week|Month"]) {
      const ui = render(`state view="Week"\nsegmented bind=view options="${options}"\n`);
      expect(ui.diagnostics, options).toEqual([]);
      expect(ui.hits.map((h) => h.detail), options).toEqual(["Week", "Month"]);
      ui.destroy();
    }
  });

  it("needs two to six options", () => {
    expect(warnings(`segmented bind=v options="Only"\n`)[0]).toMatch(/at least two options/);
    expect(warnings(`segmented bind=v options="a,b,c,d,e,f,g"\n`)[0]).toMatch(/at most 6 options/);
    expect(warnings(`segmented bind=v options="Chart,Table"\n`)).toEqual([]);
  });
});

describe("carousel", () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `  card\n    text "Card ${i + 1}"`).join("\n");

  it("shows as many cards as fit, and pages with the arrows", () => {
    const ui = render(`state page=0\ncarousel bind=page\n${cards(5)}\n`, { width: 600 });
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 1", "Card 2"]);
    const next = ui.hits.find((h) => String(h.detail).startsWith("next"))!;
    ui.sayshape.activate({ node: next.box.node, box: next.box, detail: next.detail });
    ui.sayshape.renderNow();
    expect(ui.sayshape.state.get("page")).toBe(1);
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 3", "Card 4"]);
    ui.destroy();
  });

  it("shows one card on a narrow screen, and no arrows when everything fits", () => {
    const narrow = render(`carousel bind=page\n${cards(3)}\n`, { width: 300 });
    expect(texts(narrow).filter((t) => t.startsWith("Card"))).toEqual(["Card 1"]);
    narrow.destroy();
    const wide = render(`carousel bind=page\n${cards(2)}\n`, { width: 600 });
    expect(wide.hits.some((h) => h.box.node.type === "carousel")).toBe(false);
    wide.destroy();
  });

  it("keeps the page in range when the list shrinks", () => {
    const ui = render(`state page=7\ncarousel bind=page\n${cards(3)}\n`, { width: 300 });
    expect(texts(ui).filter((t) => t.startsWith("Card"))).toEqual(["Card 3"]);
    ui.destroy();
  });
});

describe("compare", () => {
  const PLANS = `state plans=[{name: "Basic", price: 9, storage: 50, backup: false}, {name: "Pro", price: 19, storage: 500, backup: true}, {name: "Team", price: 49, storage: 2000, backup: true}]`;
  const SPEC = `${PLANS}\ncompare items=plans pick="Pro"\n  compare-row "Price" field=price format=money best=low\n  compare-row "Storage" field=storage format=number best=high\n  compare-row "Backup" field=backup\n`;

  it("marks the best value in each row in the good color", () => {
    const ui = render(SPEC);
    const best = ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.good).map((o) => o.args[0]);
    expect(best).toEqual(["$9.00", "2,000"]);
    expect(texts(ui)).toEqual(expect.arrayContaining(["RECOMMENDED", "Basic", "Pro", "Team", "Price"]));
    ui.destroy();
  });

  it("stacks each row's label above its values on a narrow screen", () => {
    const wide = render(SPEC, { width: 600 }), narrow = render(SPEC, { width: 300 });
    const at = (ui: typeof wide, t: string) => ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === t)!;
    // Wide: the label and the values share a line. Narrow: the label is above them.
    expect(Number(at(wide, "Price").args[2])).toBeCloseTo(Number(at(wide, "$19.00").args[2]), 0);
    expect(Number(at(narrow, "Price").args[2])).toBeLessThan(Number(at(narrow, "$19.00").args[2]) - 10);
    wide.destroy();
    narrow.destroy();
  });

  describe("on a phone", () => {
    const TWO = `state plans=[{name: "Basic", price: 9, storage: 50, backup: false}, {name: "Pro", price: 19, storage: 500, backup: true}]
compare items=plans pick="Pro"
  compare-row "Price" field=price format=money best=low
  compare-row "Storage" field=storage format=number best=high tip="Per account"
  compare-row "Backup" field=backup
`;
    const FOUR = `state plans=[{name: "Basic", price: 9, storage: 50, support: "Email"}, {name: "Pro", price: 19, storage: 500, support: "Email and chat"}, {name: "Team", price: 49, storage: 2000, support: "Phone"}, {name: "Enterprise", price: 99, storage: 10000, support: "Dedicated manager"}]
compare items=plans pick="Pro"
  compare-row "Price a month" field=price format=money best=low
  compare-row "Storage (GB)" field=storage format=number best=high
  compare-row "Support" field=support
`;
    type Layout = { blocks: boolean; colW: number; labelW: number; rows: Array<{ y: number; h: number }> };
    const layoutOf = (ui: ReturnType<typeof render>) => ui.find("compare").box!.data as Layout;
    const at = (ui: ReturnType<typeof render>, t: string) => ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === t);

    it("draws each row as a block on a phone, and side by side on a wide screen", () => {
      for (const width of [360, 375]) {
        const ui = render(TWO, { width });
        expect(ui.find("compare").box!.w).toBeLessThan(BLOCKS_WIDTH);
        const d = layoutOf(ui);
        expect(d.blocks).toBe(true);
        expect(d.labelW).toBe(0);
        // The label heads its block, the values sit under it, each under its option's name.
        const label = Number(at(ui, "Price")[0]!.args[2]);
        const value = Number(at(ui, "$19.00")[0]!.args[2]);
        const name = at(ui, "Pro").map((o) => Number(o.args[2])).filter((y) => y > label && y < value);
        expect(name).toHaveLength(1);
        // Each option's name: once at the top, and once over its value in each of the 3 blocks.
        expect(at(ui, "Basic")).toHaveLength(4);
        expect(at(ui, "Pro")).toHaveLength(4);
        // The value is in its option's column.
        expect(Number(at(ui, "$19.00")[0]!.args[1])).toBeCloseTo(Number(at(ui, "Pro")[0]!.args[1]), 0);
        expect(ui.warnings).toEqual([]);
        ui.destroy();
      }
      const wide = render(TWO, { width: 1000 });
      const d = layoutOf(wide);
      expect(d.blocks).toBe(false);
      expect(d.labelW).toBeGreaterThan(0);
      expect(at(wide, "Basic")).toHaveLength(1);
      expect(Number(at(wide, "Price")[0]!.args[2])).toBeCloseTo(Number(at(wide, "$19.00")[0]!.args[2]), 0);
      wide.destroy();
    });

    it("switches at BLOCKS_WIDTH, by the comparison's own width", () => {
      const blocks = (w: number) => {
        const ui = render(TWO, { width: w, padding: 0 });
        const b = layoutOf(ui).blocks;
        ui.destroy();
        return b;
      };
      expect(blocks(BLOCKS_WIDTH - 1)).toBe(true);
      expect(blocks(BLOCKS_WIDTH)).toBe(false);
    });

    it("keeps the recommended option and the best values marked", () => {
      const ui = render(TWO, { width: 360 });
      const c = lightTheme.colors;
      expect(texts(ui)).toContain("RECOMMENDED");
      // The recommended option's name over each of its values is in the accent; the others are muted.
      expect(at(ui, "Pro").filter((o) => o.fillStyle === c.accent)).toHaveLength(3);
      expect(at(ui, "Basic").filter((o) => o.fillStyle === c.muted)).toHaveLength(3);
      // Its cells are outlined in the accent: the name at the top and one per block.
      expect(ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === c.accent)).toHaveLength(4);
      const best = ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === c.good).map((o) => o.args[0]);
      expect(best).toEqual(["$9.00", "500"]);
      ui.destroy();
    });

    it("reads well with three and four options", () => {
      for (const n of [3, 4]) {
        const spec = n === 4 ? FOUR : SPEC;
        const ui = render(spec, { width: 360 });
        const d = layoutOf(ui);
        expect(d.blocks).toBe(true);
        expect(d.colW * n).toBeCloseTo(ui.find("compare").box!.w, 5);
        expect(ui.warnings).toEqual([]);
        if (n === 4) {
          // Names aren't broken mid-word: a smaller font when a word wouldn't fit.
          expect(texts(ui)).toContain("Enterprise");
          expect(texts(ui)).toEqual(expect.arrayContaining(["$99.00", "10,000", "Dedicated", "manager"]));
        }
        ui.destroy();
      }
    });

    it("keeps a row's tip pressable from its label", () => {
      const ui = render(TWO, { width: 360 });
      expect(ui.hits.some((h) => h.detail === "tip:1")).toBe(true);
      ui.destroy();
    });

    it("reads and copies the same as side by side", () => {
      for (const spec of [TWO, SPEC, FOUR]) {
        const phone = render(spec, { width: 360 }), wide = render(spec, { width: 1000 });
        expect(layoutOf(phone).blocks).toBe(true);
        expect(layoutOf(wide).blocks).toBe(false);
        expect(phone.accessibility()).toEqual(wide.accessibility());
        expect(phone.copyText()).toBe(wide.copyText());
        phone.destroy();
        wide.destroy();
      }
    });
  });

  it("says so for too few or too many options", () => {
    const one = render(`state p=[{name: "A"}]\ncompare items=p\n  compare-row "X" field=x\n`);
    expect(texts(one)).toContain("Add at least two options to compare");
    one.destroy();
    const five = render(`state p=[{name: "A"}, {name: "B"}, {name: "C"}, {name: "D"}, {name: "E"}]\ncompare items=p\n  compare-row "X" field=x\n`);
    expect(texts(five)).toContain("Too many options: at most 4");
    expect(five.warnings.some((w) => /5 options is more than the 4/.test(w))).toBe(true);
    five.destroy();
  });
});
