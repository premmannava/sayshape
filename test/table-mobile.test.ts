import { describe, expect, it } from "vitest";
import type { TableGeometry } from "../src/components/table";
import { render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

/** Tables on a phone: 390 px wide, less a card's padding when inside one. */
const PHONE = 390;
const geo = (ui: Rendered): TableGeometry => ui.find("table").box!.data as TableGeometry;
const allLines = (g: TableGeometry) => g.rows.flatMap((r) => r.cells.flatMap((c) => c.lines));

const products = `state rows=[{sku: "A1", name: "Ultra-lightweight backpacking tent for two people", qty: 3, price: 1299.99}, {sku: "B2", name: "Stove", qty: 12, price: 45}]`;
const threeCol = `${products}
table items=rows
  table-column "Product name" field=name
  table-column "Quantity ordered" field=qty format=number
  table-column "Unit price (USD)" field=price format=money
`;
const teams = Array.from({ length: 6 }, (_, i) => `{id: ${i}, team: "Team ${i}", p: ${i}, w: ${i}, d: ${i}, l: ${i}, gf: ${i}, ga: ${i}, gd: ${i}, pts: ${i * 3}}`);
const stats = ["p", "w", "d", "l", "gf", "ga", "gd", "pts"];
const wide = `state rows=[${teams.join(", ")}]\ntable items=rows\n  table-column "Team" field=team\n${stats.map((k) => `  table-column "${k.toUpperCase()} long" field=${k} format=number`).join("\n")}\n`;

describe("tables on a phone", () => {
  it("(e) lays a three-column table out without sideways scrolling at 390 px, in a card too", () => {
    const inCard = `${products}\ncard\n${threeCol.split("\n").slice(1).map((l) => (l ? `  ${l}` : l)).join("\n")}`;
    for (const spec of [threeCol, inCard]) {
      const ui = render(spec, { width: PHONE });
      expect(geo(ui).scroll).toBeUndefined();
      expect(ui.warnings).toEqual([]);
    }
    const four = render(`${products}\ntable items=rows\n  table-column "SKU" field=sku\n  table-column "Product name" field=name\n  table-column "Quantity ordered" field=qty format=number\n  table-column "Unit price" field=price format=money\n`, { width: PHONE });
    expect(geo(four).scroll).toBeUndefined();
  });

  it("(c) sizes columns by content: numbers at their natural width, text takes the rest and wraps", () => {
    const ui = render(threeCol, { width: PHONE });
    const g = geo(ui);
    const [name, qty, price] = g.columns;
    // Numbers aren't widened to hold a one-line header: the header wraps instead, and text has the rest.
    expect(qty!.labelLines.length).toBeGreaterThan(1);
    expect(qty!.w).toBeLessThan(100);
    expect(price!.w).toBeLessThan(110);
    expect(name!.w + qty!.w + price!.w).toBeCloseTo(ui.find("table").box!.w, 3);
    expect(name!.w).toBeGreaterThan(qty!.w + price!.w - 20);
    expect(g.rows[0]!.cells[0]!.lines.length).toBeGreaterThan(1);
  });

  it("(b, c) never cut a header or a cell mid-word, nor show a header as a stub", () => {
    for (const width of [320, PHONE, 600]) {
      const g = geo(render(threeCol, { width }));
      for (const col of g.columns) {
        expect(col.labelLines.join(" ")).toBe(col.label);
        expect(col.labelLines.join("")).not.toContain("…");
      }
      for (const line of allLines(g)) expect(line).not.toMatch(/…$/);
      expect(g.rows[0]!.cells[0]!.lines.join(" ")).toBe("Ultra-lightweight backpacking tent for two people");
    }
  });

  it("(d) one policy per column: badge cells are never cut while text beside them wraps", () => {
    const ui = render(`state rows=[{id: 1, task: "Replace the worn conveyor guard on line three", s: "In progress", tone: "warn"}, {id: 2, task: "Audit", s: "Waiting on supplier", tone: "bad"}]
table items=rows
  table-column "Task" field=task
  table-column "Status" field=s tone=tone
`, { width: PHONE });
    const g = geo(ui);
    for (const row of g.rows) expect(row.cells[1]!.lines).toEqual([row.cells[1]!.full]);
    expect(g.rows[0]!.cells[0]!.lines.length).toBeGreaterThan(1);
  });

  it("(f) aligns numeric columns right in the header and the cells, text left", () => {
    const ui = render(threeCol, { width: PHONE });
    const g = geo(ui);
    const align = (text: string) => ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === text)?.textAlign;
    expect(align(g.columns[0]!.labelLines[0]!)).toBe("left");
    expect(align(g.columns[1]!.labelLines[0]!)).toBe("right");
    expect(align(g.columns[2]!.labelLines[0]!)).toBe("right");
    expect(align("3")).toBe("right");
    expect(align("$1,299.99")).toBe("right");
    expect(align("Stove")).toBe("left");
  });

  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("(a) paints the pinned column opaque, with a theme shadow at its edge once scrolled (%s)", (_, theme) => {
    const ui = render(wide, { width: PHONE, theme });
    const g = geo(ui), s = g.scroll!;
    expect(s.pinned).toBeGreaterThan(0);
    const box = ui.find("table").box!;
    ui.wheel(box.x + box.w / 2, box.y + g.frame.y + 60, 0, { deltaX: 80 });
    ui.sayshape.renderNow();
    const ops = ui.drawOps;
    const pinnedX = box.x + g.frame.x;
    for (const row of g.rows.slice(0, 3)) {
      const label = ops.findIndex((o) => o.op === "fillText" && o.args[0] === row.cells[0]!.lines[0]);
      expect(label).toBeGreaterThan(0);
      // Just before the pinned label: an opaque fill of the pinned cell in the surface color.
      const fills = ops.slice(0, label).filter((o) => o.op === "fill" || o.op === "fillRect").slice(-4);
      expect(fills.map((o) => o.fillStyle)).toContain(theme.colors.raised);
      // Drawn after every scrolled cell of that row, so nothing scrolled shows over it.
      const later = ops.slice(label).findIndex((o) => o.op === "fillText" && o.args[0] === row.cells[1]!.lines[0]);
      expect(later).toBe(-1);
    }
    expect(ops.some((o) => o.fillStyle === theme.colors.shadow && (o.op === "fill" || o.op === "fillRect"))).toBe(true);
    expect(pinnedX).toBeGreaterThanOrEqual(0);
  });

  it("(b) keeps the header in view over a table taller than the screen, and pressable there", () => {
    const rows = Array.from({ length: 60 }, (_, i) => `{id: ${i}, name: "Item ${i}", qty: ${i}}`);
    const spec = `state rows=[${rows.join(", ")}] by="" dir="asc"\ntable items=rows sort=by direction=dir\n  table-column "Name" field=name\n  table-column "Qty" field=qty format=number\n`;
    const ui = render(spec, { width: PHONE, viewport: { top: 900, bottom: 1600 } });
    const g = geo(ui);
    const box = ui.find("table").box!;
    expect(box.y + g.frame.y).toBeLessThan(900);
    const head = ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === "Qty");
    // Drawn where the visible area starts, not at the table's top.
    expect(head.some((o) => Math.abs((o.args[2] as number) - (900 + g.headerH / 2)) < g.headerH)).toBe(true);
    const sort = ui.hits.filter((h) => h.detail === "sort:qty");
    expect(sort.some((h) => h.box.y >= 899 && h.box.y < 900 + g.headerH)).toBe(true);
    // Scrolled back to the top, it's where it always was.
    const top = render(spec, { width: PHONE, viewport: { top: 0, bottom: 700 } });
    const at = top.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Qty")!;
    expect(at.args[2] as number).toBeLessThan(top.find("table").box!.y + geo(top).frame.y + geo(top).headerH);
  });
});
