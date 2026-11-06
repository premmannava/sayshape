import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { cellText, EMPTY_CELL, fitColumns, keyOf, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, sortedOrder, type TableGeometry } from "../src/components/table";
import { toData } from "../src/data";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { monoWidth, render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import type { Value } from "../src/types";

const registry = new Registry(coreComponents);
const equipment = `state equipment=[{id: "laptop", name: "Laptop", price: 1200, stock: 12}, {id: "monitor", name: "Monitor", price: 350, stock: 24}, {id: "keyboard", name: "Keyboard", price: 79, stock: 41}] selected="" sortField="name" sortDirection="asc"`;
const columns = `  table-column "Equipment" field=name\n  table-column "Price" field=price format=money\n  table-column "In stock" field=stock format=number`;
const full = `${equipment}\ntable "Available equipment" items=equipment key=id bind=selected sort=sortField direction=sortDirection\n${columns}\n`;

const geo = (ui: Rendered, i = 0): TableGeometry => ui.findAll("table")[i]!.box!.data as TableGeometry;
const names = (ui: Rendered) => geo(ui).rows.map((r) => r.cells[0]!.full);
const regions = (ui: Rendered, prefix: string) => ui.hits.filter((h) => typeof h.detail === "string" && h.detail.startsWith(prefix));
const clickDetail = (ui: Rendered, detail: string) => {
  const h = ui.hits.find((x) => x.detail === detail);
  expect(h, `a hit region for ${detail}`).toBeDefined();
  ui.click(h!.box.x + h!.box.w / 2, h!.box.y + h!.box.h / 2);
};
const list = (rows: unknown[]) => toData(rows);
/** A one-column table over rows written in SayShape, with extra table props. */
const simple = (rows: string, props = "", cols = `  table-column "V" field=v`, width = 600) =>
  render(`state rows=${rows} pick="" by="" dir="asc"\ntable items=rows ${props}\n${cols}\n`, { width });

describe("table specs", () => {
  it("parses the documented spec with no problems", () => {
    expect(parse(full, registry).diagnostics).toEqual([]);
    const ui = render(full);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(geo(ui).columns.map((c) => [c.label, c.field, c.format, c.align])).toEqual([
      ["Equipment", "name", "text", "left"],
      ["Price", "price", "money", "right"],
      ["In stock", "stock", "number", "right"],
    ]);
  });

  it("keeps table-column inside a table, and only columns inside a table", () => {
    const msgs = (spec: string) => parse(`${equipment}\n${spec}\n`, registry).diagnostics.map((d) => `${d.severity}: ${d.message}`);
    expect(msgs(`table-column "Name" field=name`)).toEqual([`error: "table-column" only goes inside table`]);
    expect(msgs(`card\n  table-column "Name" field=name`)).toEqual([`error: "table-column" only goes inside table`]);
    expect(msgs(`table items=equipment\n  text "Hi"`)).toEqual([`error: "table" (line 2) can't contain "text"; it holds table-column`]);
  });

  it("explains bad props", () => {
    const msgs = (spec: string) => parse(`${equipment}\n${spec}\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs(`table key=id\n  table-column field=name`)).toEqual([`"table" needs items=`]);
    expect(msgs(`table items=equipment\n  table-column "Name"`)).toEqual([`"table-column" needs field=`]);
    expect(msgs(`table items=equipment\n  table-column field=price format=euro`)).toEqual([`format should be one of text, number, money; got "euro"`]);
    expect(msgs(`table items=equipment key="the id"\n  table-column field=name`)[0]).toMatch(/key should be a plain name/);
    expect(msgs(`table items=equipment bind="a b"\n  table-column field=name`)[0]).toMatch(/bind should be a state name or a path/);
    expect(msgs(`table items=equipment color=red\n  table-column field=name`)[0]).toMatch(/"table" has no prop "color"/);
  });

  it("parses and renders every line-boundary prefix while streaming", () => {
    const lines = full.split("\n");
    for (let n = 1; n < lines.length; n++) {
      const prefix = lines.slice(0, n).join("\n") + "\n";
      expect(parse(prefix, registry).diagnostics, prefix).toEqual([]);
      const ui = render(prefix);
      if (n === 2) {
        // The table line has arrived, its columns haven't: a placeholder, not a warning.
        expect(geo(ui).message).toBe("No columns yet");
        expect(ui.warnings).toEqual([]);
        expect(ui.hits).toEqual([]);
      }
      if (n > 2) expect(geo(ui).columns).toHaveLength(n - 2);
    }
  });

  it("ends up the same however the stream is chunked", () => {
    const whole = render(full);
    const streamed = render("");
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 5) chunks.push(full.slice(i, i + 5));
    streamed.stream(chunks);
    expect(streamed.diagnostics).toEqual([]);
    expect(geo(streamed)).toEqual(geo(whole));
  });

  it("shows columns hidden by if= only while their condition holds", () => {
    const ui = render(`${equipment} detail=false\ntable items=equipment\n  table-column field=name\n  table-column field=stock format=number if=detail\n`);
    expect(geo(ui).columns.map((c) => c.field)).toEqual(["name"]);
    ui.set("detail", true);
    expect(geo(ui).columns.map((c) => c.field)).toEqual(["name", "stock"]);
  });
});

describe("cells", () => {
  it("formats text, numbers and money, keeping 0 and false", () => {
    expect(cellText("Tent", "text").text).toBe("Tent");
    expect(cellText(0, "text").text).toBe("0");
    expect(cellText(false, "text").text).toBe("No");
    expect(cellText(true, "text").text).toBe("Yes");
    expect(cellText(1234.567, "number").text).toBe("1,234.57");
    expect(cellText(0, "number").text).toBe("0");
    expect(cellText(-5, "money").text).toBe("-$5.00");
    expect(cellText(0, "money").text).toBe("$0.00");
    expect(cellText(189.5, "money").text).toBe("$189.50");
  });

  it("shows the placeholder for missing values and values a column can't show, never a made-up number", () => {
    for (const fmt of ["text", "number", "money"] as const) {
      expect(cellText(undefined, fmt)).toEqual({ text: EMPTY_CELL, incompatible: false });
      expect(cellText(null, fmt)).toEqual({ text: EMPTY_CELL, incompatible: false });
      expect(cellText(list([1, 2]), fmt)).toEqual({ text: EMPTY_CELL, incompatible: true });
      expect(cellText(toData({ a: 1 }), fmt)).toEqual({ text: EMPTY_CELL, incompatible: true });
    }
    expect(cellText("12", "number")).toEqual({ text: EMPTY_CELL, incompatible: true });
    expect(cellText("12", "money")).toEqual({ text: EMPTY_CELL, incompatible: true });
    expect(cellText(false, "number")).toEqual({ text: EMPTY_CELL, incompatible: true });
  });

  it("writes very large and small numbers in scientific form, so they're never cut or shown as 0", () => {
    expect(cellText(1e300, "number").text).toBe("1E300");
    expect(cellText(-1e300, "money").text).toBe("-$1.00E300");
    expect(cellText(1e-101, "number").text).toBe("1E-101");
    expect(cellText(Number.MAX_VALUE, "number").text).toBe("1.798E308");
    // Money keeps cents, like money().
    expect(cellText(0.001, "money").text).toBe("$0.00");
  });

  it("renders a mix of values, malformed items and long text in one table", () => {
    const ui = simple(`[{v: 0}, {v: false}, {v: -3}, {}, {v: null}, "oops", {v: "A very long piece of text that will not fit in a narrow column at all"}]`, "", `  table-column "V" field=v\n  table-column "N" field=v format=number`, 320);
    const g = geo(ui);
    expect(g.rows.map((r) => r.cells.map((c) => c.full))).toEqual([
      ["0", "0"], ["No", EMPTY_CELL], ["-3", "-3"], [EMPTY_CELL, EMPTY_CELL], [EMPTY_CELL, EMPTY_CELL], [EMPTY_CELL, EMPTY_CELL],
      ["A very long piece of text that will not fit in a narrow column at all", EMPTY_CELL],
    ]);
    const long = g.rows[6]!.cells[0]!;
    expect(long.text.endsWith("…")).toBe(true);
    expect(monoWidth(long.text, g.cellFont)).toBeLessThanOrEqual(g.columns[0]!.w);
    expect(ui.warnings).toEqual([
      "table on line 2: 1 items aren't records, so their cells show —",
      "table on line 2: 2 cells hold a value their column can't show (number and money columns need numbers), so they show —",
    ]);
  });
});

describe("empty, invalid and oversized data", () => {
  it("shows the header and a message for an empty list", () => {
    const ui = simple(`[]`, "key=v bind=pick");
    const g = geo(ui);
    expect(g.columns).toHaveLength(1);
    expect(g.rows).toEqual([]);
    expect(g.empty).toBe("Nothing to show");
    expect(regions(ui, "row:")).toEqual([]);
    expect(ui.text()).toContain("Nothing to show");
  });

  it("says when items isn't a list", () => {
    const ui = render(`state n=3\ntable items=n\n  table-column field=v\n`);
    expect(geo(ui).empty).toBe("No data");
    expect(ui.warnings).toEqual(["table on line 2: items is not a list. Use a list of records, like items=equipment"]);
  });

  it(`shows up to ${MAX_TABLE_ROWS} rows, and a message rather than a cut-off table past that`, () => {
    const rows = (n: number) => `[${Array.from({ length: n }, (_, i) => `{v: ${i}}`).join(", ")}]`;
    expect(geo(simple(rows(MAX_TABLE_ROWS))).rows).toHaveLength(MAX_TABLE_ROWS);
    const ui = simple(rows(MAX_TABLE_ROWS + 1), "key=v bind=pick");
    expect(geo(ui).message).toBe(`Too many rows to show: ${MAX_TABLE_ROWS + 1}, at most ${MAX_TABLE_ROWS}`);
    expect(geo(ui).rows).toEqual([]);
    expect(ui.hits).toEqual([]);
    expect(ui.warnings[0]).toMatch(/Show a page with slice\(\) and pagination/);
    // A page of a longer list works.
    expect(geo(render(`state rows=${rows(500)}\ntable items={take(rows, 50)}\n  table-column field=v\n`)).rows).toHaveLength(50);
  });

  it(`shows up to ${MAX_TABLE_COLUMNS} columns`, () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `  table-column "C${i}" field=v`).join("\n");
    expect(geo(simple(`[{v: 1}]`, "", cols(MAX_TABLE_COLUMNS), 1200)).columns).toHaveLength(MAX_TABLE_COLUMNS);
    const ui = simple(`[{v: 1}]`, "", cols(MAX_TABLE_COLUMNS + 1), 1200);
    expect(geo(ui).message).toBe(`Too many columns: at most ${MAX_TABLE_COLUMNS}`);
  });

  it("says nothing more than once, however often it lays out", () => {
    const ui = simple(`["oops"]`, "bind=pick");
    const before = ui.warnings.length;
    ui.set("other", 1);
    ui.set("other", 2);
    expect(ui.warnings.length).toBe(before);
    expect(ui.warnings).toContain("table on line 2: bind= needs key= naming a field that identifies each row, like key=id");
  });
});

describe("sorting", () => {
  it("orders numbers by value and text by collation, in a new order without touching the list", () => {
    const items = list([{ v: 1200 }, { v: 79 }, { v: 350 }]) as readonly Value[];
    expect(sortedOrder(items, "v", "asc")).toEqual([1, 2, 0]);
    expect(sortedOrder(items, "v", "desc")).toEqual([0, 2, 1]);
    const words = list([{ v: "item 10" }, { v: "Item 2" }, { v: "apple" }, { v: "Éclair" }, { v: "banana" }]) as readonly Value[];
    expect(sortedOrder(words, "v", "asc").map((i) => (words[i] as { v: string }).v)).toEqual(["apple", "banana", "Éclair", "Item 2", "item 10"]);
    expect(sortedOrder(items, null, "asc")).toEqual([0, 1, 2]);
  });

  it("keeps equal values in list order, both ways", () => {
    const items = list([{ v: 2, n: "a" }, { v: 1, n: "b" }, { v: 2, n: "c" }, { v: 1, n: "d" }]) as readonly Value[];
    expect(sortedOrder(items, "v", "asc")).toEqual([1, 3, 0, 2]);
    expect(sortedOrder(items, "v", "desc")).toEqual([0, 2, 1, 3]);
  });

  it("puts missing values last both ways, and orders mixed types numbers, text, then true/false", () => {
    const items = list([{ v: "b" }, {}, { v: true }, { v: 3 }, "oops", { v: null }, { v: "a" }, { v: false }, { v: -1 }]) as readonly Value[];
    expect(sortedOrder(items, "v", "asc")).toEqual([8, 3, 6, 0, 7, 2, 1, 4, 5]);
    expect(sortedOrder(items, "v", "desc")).toEqual([2, 7, 0, 6, 3, 8, 1, 4, 5]);
  });

  it("sorts by a header press, flips on the second, and never changes the list in state", () => {
    const ui = render(full);
    const source = ui.state.equipment;
    expect(names(ui)).toEqual(["Keyboard", "Laptop", "Monitor"]);
    expect(geo(ui).columns[0]!.sorted).toBe("asc");

    clickDetail(ui, "sort:price");
    expect(ui.state).toMatchObject({ sortField: "price", sortDirection: "asc" });
    expect(names(ui)).toEqual(["Keyboard", "Monitor", "Laptop"]);
    expect(geo(ui).columns.map((c) => c.sorted)).toEqual([null, "asc", null]);

    clickDetail(ui, "sort:price");
    expect(ui.state.sortDirection).toBe("desc");
    expect(names(ui)).toEqual(["Laptop", "Monitor", "Keyboard"]);

    clickDetail(ui, "sort:price");
    expect(ui.state.sortDirection).toBe("asc");

    clickDetail(ui, "sort:stock");
    expect(ui.state).toMatchObject({ sortField: "stock", sortDirection: "asc" });
    expect(ui.state.equipment).toBe(source);
    expect(JSON.stringify(ui.state.equipment)).toBe(JSON.stringify(list([{ id: "laptop", name: "Laptop", price: 1200, stock: 12 }, { id: "monitor", name: "Monitor", price: 350, stock: 24 }, { id: "keyboard", name: "Keyboard", price: 79, stock: 41 }])));
  });

  it("sorts ascending only when there's no direction=", () => {
    const ui = simple(`[{v: 2}, {v: 1}]`, "sort=by");
    clickDetail(ui, "sort:v");
    expect(ui.state.by).toBe("v");
    clickDetail(ui, "sort:v");
    expect(ui.state.by).toBe("v");
    expect(geo(ui).rows.map((r) => r.cells[0]!.full)).toEqual(["1", "2"]);
  });

  it("leaves the list in order when the sort state names no column", () => {
    const ui = render(`${equipment.replace('sortField="name"', 'sortField="color"')}\ntable items=equipment sort=sortField direction=sortDirection\n${columns}\n`);
    expect(names(ui)).toEqual(["Laptop", "Monitor", "Keyboard"]);
    expect(geo(ui).columns.every((c) => c.sorted === null)).toBe(true);
  });

  it("has no header targets without sort=", () => {
    expect(regions(render(`${equipment}\ntable items=equipment key=id bind=selected\n${columns}\n`), "sort:")).toEqual([]);
  });
});

describe("selection", () => {
  it("stores the row's key, and the selection follows the record through sorting", () => {
    const ui = render(full);
    clickDetail(ui, "row:s:monitor");
    expect(ui.state.selected).toBe("monitor");
    const selectedName = () => geo(ui).rows.filter((r) => r.selected).map((r) => r.cells[0]!.full);
    expect(selectedName()).toEqual(["Monitor"]);
    clickDetail(ui, "sort:price");
    clickDetail(ui, "sort:price");
    expect(names(ui)).toEqual(["Laptop", "Monitor", "Keyboard"]);
    expect(selectedName()).toEqual(["Monitor"]);
    expect(ui.state.selected).toBe("monitor");
  });

  it("follows the record when the data is replaced, and selects nothing when it's gone", () => {
    const ui = render(full);
    clickDetail(ui, "row:s:keyboard");
    ui.set("equipment", list([{ id: "keyboard", name: "Keyboard", price: 79, stock: 40 }, { id: "mouse", name: "Mouse", price: 25, stock: 9 }]));
    expect(geo(ui).rows.filter((r) => r.selected).map((r) => r.key)).toEqual(["keyboard"]);
    ui.set("equipment", list([{ id: "mouse", name: "Mouse", price: 25, stock: 9 }]));
    expect(geo(ui).rows.some((r) => r.selected)).toBe(false);
    // Layout never writes state: the old key stays until something changes it.
    expect(ui.state.selected).toBe("keyboard");
  });

  it("supports a number key of 0, kept apart from the text \"0\"", () => {
    const ui = render(`state rows=[{id: 0, v: "zero"}, {id: "0", v: "text zero"}, {id: 1, v: "one"}] pick=-1\ntable items=rows key=id bind=pick\n  table-column field=v\n`);
    clickDetail(ui, "row:n:0");
    expect(ui.state.pick).toBe(0);
    expect(geo(ui).rows.map((r) => r.selected)).toEqual([true, false, false]);
    clickDetail(ui, "row:s:0");
    expect(ui.state.pick).toBe("0");
    expect(geo(ui).rows.map((r) => r.selected)).toEqual([false, true, false]);
    expect(keyOf(toData({ id: 0 }), "id")).toBe(0);
  });

  it("only lets rows with a unique key be selected, and says why once", () => {
    const ui = render(`state rows=[{id: "a"}, {id: "b"}, {id: "a"}, {name: "no id"}, {id: true}, {id: 2.5}] pick=""\ntable items=rows key=id bind=pick\n  table-column field=id\n`);
    const g = geo(ui);
    expect(g.rows.map((r) => r.selectable)).toEqual([true, true, false, false, false, true]);
    expect(regions(ui, "row:").map((h) => h.detail)).toEqual(["row:s:a", "row:s:b", "row:n:2.5"]);
    expect(ui.warnings).toEqual([
      `table on line 2: 2 rows have no text or number in "id", so they can't be selected`,
      `table on line 2: 1 rows repeat another row's "id", so only the first of each can be selected. Keys should be unique`,
    ]);
    // The first "a" keeps it however the rows are sorted.
    ui.setSpec(`state rows=[{id: "a"}, {id: "b"}, {id: "a"}] pick="a" by="id" dir="desc"\ntable items=rows key=id bind=pick sort=by direction=dir\n  table-column field=id\n`, { resetState: true });
    expect(geo(ui).rows.filter((r) => r.selected).map((r) => r.index)).toEqual([0]);
  });

  it("runs on= after the selection is stored", () => {
    const ui = render(`${equipment}\ntable items=equipment key=id bind=selected on="emit:picked:{selected}"\n${columns}\n`);
    clickDetail(ui, "row:s:laptop");
    expect(ui.emitted).toEqual([{ name: "picked", value: "laptop" }]);
  });

  it("writes to paths inside each, for selection and sorting", () => {
    const ui = render(`state groups=[{name: "A", pick: "", by: "", dir: "asc", rows: [{id: 1, v: 5}, {id: 2, v: 3}]}, {name: "B", pick: "", by: "", dir: "asc", rows: [{id: 1, v: 1}]}]
each items=groups as=g
  table "{g.name}" items=g.rows key=id bind=g.pick sort=g.by direction=g.dir
    table-column field=v format=number
`);
    expect(ui.diagnostics).toEqual([]);
    const firstTable = ui.findAll("table")[0]!.node.id;
    const hit = (d: string) => ui.hits.find((h) => h.box.node.id === firstTable && h.detail === d)!.box;
    const press = (d: string) => { const b = hit(d); ui.click(b.x + b.w / 2, b.y + b.h / 2); };
    press("sort:v");
    press("row:n:2");
    const groups = JSON.parse(JSON.stringify(ui.state.groups)) as Array<{ pick: Value; by: string }>;
    expect(groups[0]).toMatchObject({ pick: 2, by: "v" });
    expect(groups[1]).toMatchObject({ pick: "", by: "" });
    expect(geo(ui, 0).rows.map((r) => r.cells[0]!.full)).toEqual(["3", "5"]);
  });
});

describe("pointer and keyboard", () => {
  it("reaches each header and row with Tab, in order, and presses them with Enter and Space", () => {
    const ui = render(full);
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      ui.tab();
      order.push(String(ui.sayshape.focus?.detail));
    }
    expect(order).toEqual(["sort:name", "sort:price", "sort:stock", "row:s:keyboard", "row:s:laptop", "row:s:monitor"]);
    ui.key("Enter");
    expect(ui.state.selected).toBe("monitor");
    ui.tab(true);
    ui.key(" ");
    expect(ui.state.selected).toBe("laptop");
    for (let i = 0; i < 3; i++) ui.tab(true);
    expect(ui.sayshape.focus?.detail).toBe("sort:price");
    ui.key("Enter");
    expect(ui.state.sortField).toBe("price");
  });

  it("makes no Tab stops in a read-only table", () => {
    const ui = render(`${equipment}\ntable items=equipment\n${columns}\nbutton "After"\n`);
    expect(ui.hits.filter((h) => h.box.node.type === "table")).toEqual([]);
    ui.tab();
    expect(ui.focused?.type).toBe("button");
  });

  it("draws hover, selection and focus with theme colors", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = render(full, { theme });
      const c = theme.colors;
      clickDetail(ui, "row:s:laptop");
      ui.tab();
      ui.sayshape.renderNow();
      const ops = ui.drawOps;
      // The selected row: an accent tint and an accent bar.
      expect(ops.some((o) => o.op === "fill" && o.fillStyle === c.accent && o.globalAlpha < 1)).toBe(true);
      expect(ops.some((o) => o.op === "fill" && o.fillStyle === c.accent && o.globalAlpha === 1)).toBe(true);
      // The keyboard focus ring.
      expect(ops.some((o) => o.op === "stroke" && o.strokeStyle === c.focus)).toBe(true);
      // Text: ink cells and the sorted header, muted other headers.
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Laptop")!.fillStyle).toBe(c.ink);
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Equipment")!.fillStyle).toBe(c.ink);
      expect(ops.find((o) => o.op === "fillText" && o.args[0] === "Price")!.fillStyle).toBe(c.muted);
      const allowed = new Set(Object.values(c));
      for (const o of ops) expect(allowed.has(o.op.startsWith("fill") ? o.fillStyle : o.strokeStyle), `${o.op}`).toBe(true);
    }
  });
});

describe("layout", () => {
  const wide = `state rows=[{name: "A rather long product name for a narrow phone", sku: "SKU-0001", price: 1299.99, qty: 3}] pick=""
table items=rows key=sku bind=pick
  table-column "Product name" field=name
  table-column "SKU" field=sku
  table-column "Unit price" field=price format=money
  table-column "Quantity ordered" field=qty format=number
`;

  it.each([400, 1000])("fits columns side by side in the box at %i px, never cutting a number", (width) => {
    const ui = render(wide, { width });
    const { box } = ui.find("table");
    const g = box!.data as TableGeometry;
    expect(g.message).toBeUndefined();
    let x = 0;
    for (const col of g.columns) {
      expect(col.x).toBeCloseTo(x, 6);
      expect(col.w).toBeGreaterThan(0);
      expect(monoWidth(col.shownLabel, g.headerFont)).toBeLessThanOrEqual(col.w);
      x += col.w;
    }
    expect(x).toBeCloseTo(box!.w, 6);
    for (const row of g.rows) {
      row.cells.forEach((cell, ci) => {
        expect(monoWidth(cell.text, g.cellFont), `${cell.text} fits`).toBeLessThanOrEqual(g.columns[ci]!.w);
        if (g.columns[ci]!.format !== "text") expect(cell.text).toBe(cell.full);
      });
    }
    if (width === 1000) expect(g.rows[0]!.cells[0]!.text).toBe(g.rows[0]!.cells[0]!.full);
    else expect(g.rows[0]!.cells[0]!.text.endsWith("…")).toBe(true);
    // Hit regions stay inside the table.
    for (const h of ui.hits) {
      expect(h.box.x).toBeGreaterThanOrEqual(box!.x - 1e-6);
      expect(h.box.x + h.box.w).toBeLessThanOrEqual(box!.x + box!.w + 1e-6);
      expect(h.box.y).toBeGreaterThanOrEqual(box!.y - 1e-6);
      expect(h.box.y + h.box.h).toBeLessThanOrEqual(box!.y + box!.h + 1e-6);
    }
  });

  it("gives spare width to text columns, so numbers stay snug", () => {
    expect(fitColumns([100, 60], [72, 60], 300, [true, false])).toEqual([240, 60]);
    expect(fitColumns([100, 100], [72, 72], 300)).toEqual([150, 150]);
    const shrunk = fitColumns([200, 60, 150], [72, 60, 72], 300, [true, false, true])!;
    expect(shrunk.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    expect(shrunk[1]).toBe(60);
    expect(fitColumns([200, 200], [150, 160], 300)).toBeNull();
  });

  it("scrolls sideways when the columns can't fit, rather than dropping or squashing them", () => {
    const cols = Array.from({ length: 6 }, (_, i) => `  table-column "Column ${i}" field=v format=money`).join("\n");
    const ui = simple(`[{v: 1234567}]`, "key=v bind=pick", cols, 320);
    const g = geo(ui);
    expect(g.message).toBeUndefined();
    expect(ui.warnings).toEqual([]);
    expect(g.columns).toHaveLength(6);
    // Numbers are never cut short.
    expect(g.rows[0]!.cells.every((c) => c.text === c.full)).toBe(true);
    expect(g.scroll).toBeDefined();
    expect(g.scroll!.max).toBeGreaterThan(0);
    expect(geo(simple(`[{v: 1234567}]`, "key=v bind=pick", cols, 1400)).scroll).toBeUndefined();
  });

  it("works inside a card and a row, and its hits move with it", () => {
    const ui = render(`${equipment}\ncard\n  row\n    text "Side"\n    table items=equipment key=id bind=selected\n      table-column field=name\n`, { width: 900 });
    const { box } = ui.find("table");
    const card = ui.find("card").box!;
    expect(box!.x).toBeGreaterThan(card.x);
    expect(box!.x + box!.w).toBeLessThanOrEqual(card.x + card.w);
    const rowHits = regions(ui, "row:");
    expect(rowHits).toHaveLength(3);
    for (const h of rowHits) expect(h.box.x).toBeCloseTo(box!.x, 6);
    clickDetail(ui, "row:s:monitor");
    expect(ui.state.selected).toBe("monitor");
  });

  it("has no targets while hidden", () => {
    const ui = render(`${equipment} show=false\ntable items=equipment key=id bind=selected sort=sortField direction=sortDirection if=show\n${columns}\n`);
    expect(ui.hits).toEqual([]);
    ui.set("show", true);
    expect(ui.hits.length).toBe(6);
  });
});

describe("the Inventory playground sample", () => {
  it("sorts, selects and summarizes the selected item", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.inventory!.spec, { width: 375 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toContain("$1,200.00");
    clickDetail(ui, "sort:price");
    clickDetail(ui, "sort:price");
    expect(names(ui)[0]).toBe("Laptop");
    clickDetail(ui, "row:s:dock");
    expect(ui.state.selected).toBe("dock");
    expect(ui.emitted.at(-1)).toEqual({ name: "selected", value: "dock" });
    expect(ui.text()).toContain("USB-C dock");
    expect(ui.find({ type: "button", text: "Request one" }).node).toBeDefined();
  });
});

describe("sideways scrolling", () => {
  // A league table: the team name, then nine numbers.
  const stats = ["p", "w", "d", "l", "gf", "ga", "gd", "pts", "form"];
  const teams = Array.from({ length: 6 }, (_, i) => `{id: ${i + 1}, team: "Team number ${i + 1}", ${stats.map((k, j) => `${k}: ${i * 10 + j}`).join(", ")}}`);
  const wide = (width: number, props = "key=id bind=pick sort=by direction=dir") =>
    render(`state rows=[${teams.join(", ")}] pick=0 by="" dir="asc"\ntable items=rows ${props}\n  table-column "Team" field=team\n${stats.map((k) => `  table-column "${k.toUpperCase()} long" field=${k} format=number`).join("\n")}\n`, { width });
  const offset = (ui: Rendered) => ui.sayshape.viewState(ui.find("table").node.id)?.x ?? 0;
  const bar = (ui: Rendered) => ui.hits.find((h) => h.detail === "scroll:bar")!;
  const headers = (ui: Rendered) => regions(ui, "sort:").map((h) => String(h.detail).slice(5));

  it("lays out with the first column pinned and a scrollbar under the rows", () => {
    const ui = wide(360);
    const g = geo(ui);
    const s = g.scroll!;
    expect(ui.warnings).toEqual([]);
    expect(s.pinned).toBeCloseTo(g.columns[0]!.w, 6);
    expect(s.pinned).toBeLessThanOrEqual(360 * 0.5);
    expect(s.view + s.pinned).toBeCloseTo(g.frame.w, 6);
    expect(s.content).toBeCloseTo(g.columns.slice(1).reduce((a, c) => a + c.w, 0), 6);
    expect(s.bar.y + s.bar.h).toBeCloseTo(g.frame.y + g.frame.h, 6);
    expect(bar(ui)).toBeDefined();
    // Only the headers in view can be pressed; the first is always there.
    expect(headers(ui)[0]).toBe("team");
    expect(headers(ui)).not.toContain("form");
  });

  it("fits a ten-column league table at chat width without scrolling", () => {
    const short = render(`state rows=[${teams.join(", ")}]\ntable items=rows\n  table-column "Team" field=team\n${stats.map((k) => `  table-column "${k.toUpperCase()}" field=${k} format=number`).join("\n")}\n`, { width: 600 });
    expect(geo(short).columns).toHaveLength(10);
    expect(geo(short).scroll).toBeUndefined();
    expect(geo(short).message).toBeUndefined();
  });

  it("scrolls with a sideways swipe or Shift and the wheel, and leaves up and down to the page", () => {
    const ui = wide(360);
    const { box } = ui.find("table");
    const cx = box!.x + box!.w / 2, cy = box!.y + geo(ui).frame.y + 50;
    ui.wheel(cx, cy, 120);
    expect(offset(ui)).toBe(0);
    ui.wheel(cx, cy, 0, { deltaX: 40 });
    expect(offset(ui)).toBe(40);
    ui.wheel(cx, cy, 30, { shift: true });
    expect(offset(ui)).toBe(70);
    ui.wheel(cx, cy, 0, { deltaX: 99999 });
    expect(offset(ui)).toBeCloseTo(geo(ui).scroll!.max, 6);
    ui.wheel(cx, cy, 0, { deltaX: -99999 });
    expect(offset(ui)).toBe(0);
    // Past the end, the event isn't taken, so the page can have it.
    expect(ui.canvas.dispatch("wheel", { clientX: cx, clientY: cy, deltaY: 0, deltaX: -10 })).toBe(false);
    expect(ui.canvas.dispatch("wheel", { clientX: cx, clientY: cy, deltaY: 0, deltaX: 10 })).toBe(true);
  });

  it("works without sort or bind, so a plain wide table still scrolls", () => {
    const ui = wide(360, "");
    const { box } = ui.find("table");
    ui.wheel(box!.x + box!.w / 2, box!.y + 40, 0, { deltaX: 50 });
    expect(offset(ui)).toBe(50);
    // The scrollbar is a Tab stop, so the keyboard reaches it.
    ui.tab();
    expect(ui.sayshape.focus?.detail).toBe("scroll:bar");
    ui.key("End");
    expect(offset(ui)).toBeCloseTo(geo(ui).scroll!.max, 6);
    ui.key("Home");
    expect(offset(ui)).toBe(0);
    ui.key("ArrowRight");
    expect(offset(ui)).toBe(48);
    ui.key("ArrowLeft");
    expect(offset(ui)).toBe(0);
  });

  it("drags the rows to scroll without selecting, and a still press still selects", () => {
    const ui = wide(360);
    const row = regions(ui, "row:")[1]!;
    const y = row.box.y + row.box.h / 2;
    const x0 = row.box.x + row.box.w * 0.8;
    const at = (x: number) => ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1 });
    at(x0);
    ui.canvas.dispatch("pointerdown", { clientX: x0, clientY: y, pointerId: 1 });
    for (const x of [x0 - 20, x0 - 60, x0 - 100]) { at(x); ui.sayshape.renderNow(); }
    ui.canvas.dispatch("pointerup", { clientX: x0 - 100, clientY: y, pointerId: 1 });
    ui.sayshape.renderNow();
    expect(offset(ui)).toBe(100);
    expect(ui.state.pick).toBe(0);
    clickDetail(ui, "row:n:3");
    expect(ui.state.pick).toBe(3);
  });

  it("drags the scrollbar thumb, and a click on the track jumps there", () => {
    const ui = wide(360);
    const s = geo(ui).scroll!;
    const b = bar(ui).box;
    const y = b.y + b.h / 2;
    ui.click(b.x + b.w - 2, y);
    expect(offset(ui)).toBeCloseTo(s.max, 6);
    ui.click(b.x + 2, y);
    expect(offset(ui)).toBe(0);
    // Dragging the thumb right scrolls right, further than the pointer moved.
    const at = (type: string, x: number) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });
    const x0 = b.x + 12;
    at("pointermove", x0);
    at("pointerdown", x0);
    for (const x of [x0 + 10, x0 + 30]) { at("pointermove", x); ui.sayshape.renderNow(); }
    at("pointerup", x0 + 30);
    ui.sayshape.renderNow();
    expect(offset(ui)).toBeGreaterThan(30);
    expect(ui.state.pick).toBe(0);
  });

  it("sorts by a column once it's scrolled into view", () => {
    const ui = wide(360);
    ui.key("End");
    ui.wheel(ui.find("table").box!.x + 100, ui.find("table").box!.y + 60, 0, { deltaX: 99999 });
    expect(headers(ui)).toContain("form");
    clickDetail(ui, "sort:form");
    expect(ui.state.by).toBe("form");
    // Sorting relays out; the offset stays where it was.
    expect(offset(ui)).toBeCloseTo(geo(ui).scroll!.max, 6);
  });

  it("brings a partly hidden header fully into view when the keyboard focuses it", () => {
    const ui = wide(360);
    const visible = headers(ui);
    // Tab to the last header that shows (likely cut off at the right edge).
    for (let i = 0; i < visible.length; i++) ui.tab();
    expect(ui.sayshape.focus?.detail).toBe(`sort:${visible[visible.length - 1]}`);
    ui.sayshape.renderNow();
    const field = String(ui.sayshape.focus!.detail).slice(5);
    const g = geo(ui), s = g.scroll!;
    const col = g.columns.find((c) => c.field === field)!;
    const left = col.x - s.pinned - offset(ui);
    expect(left).toBeGreaterThanOrEqual(-1e-6);
    expect(left + col.w).toBeLessThanOrEqual(s.view + 1e-6);
  });

  it("keeps the offset in range when the table gets narrower content, and resets with state", () => {
    const ui = wide(360);
    ui.wheel(ui.find("table").box!.x + 100, ui.find("table").box!.y + 60, 0, { deltaX: 99999 });
    const before = offset(ui);
    ui.set("rows", toData([{ id: 1, team: "A", p: 1, w: 1, d: 0, l: 0, gf: 1, ga: 0, gd: 1, pts: 3, form: 1 }]));
    expect(offset(ui)).toBeLessThanOrEqual(geo(ui).scroll!.max + 1e-6);
    expect(offset(ui)).toBeLessThanOrEqual(before);
    ui.setSpec(ui.sayshape.spec ?? "", { resetState: true });
    expect(ui.sayshape.viewState(ui.find("table").node.id)?.x ?? 0).toBe(0);
  });

  it("draws nothing of a scrolled column outside the table", () => {
    const ui = wide(360);
    ui.wheel(ui.find("table").box!.x + 100, ui.find("table").box!.y + 60, 0, { deltaX: 60 });
    const { box } = ui.find("table");
    for (const h of ui.hits) {
      expect(h.box.x).toBeGreaterThanOrEqual(box!.x - 1e-6);
      expect(h.box.x + h.box.w).toBeLessThanOrEqual(box!.x + box!.w + 1e-6);
    }
  });

  it("streams in and paints in light and dark with no warnings", () => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = render(`state rows=[${teams.join(", ")}]\ntable items=rows\n  table-column "Team" field=team\n${stats.map((k) => `  table-column "${k.toUpperCase()} long" field=${k} format=number`).join("\n")}\n`, { width: 360, theme });
      expect(ui.warnings).toEqual([]);
      expect(geo(ui).scroll).toBeDefined();
    }
  });
});
