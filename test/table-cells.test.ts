import { describe, expect, it } from "vitest";
import { render, type Rendered } from "../src/testing";
import { MAX_CELL_LINES, type TableGeometry } from "../src/components/table";

const geo = (ui: Rendered): TableGeometry => ui.find("table").box!.data as TableGeometry;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const spec = (note: string) => `state rows=[{id: 1, name: "Tent", note: "${note}", price: 180}] pick=0
table items=rows key=id bind=pick
  table-column "Item" field=name
  table-column "Note" field=note
  table-column "Price" field=price format=money
`;

describe("table text cells", () => {
  it("wrap a long text cell fully by default, with no ellipsis", () => {
    const ui = render(spec(words(20)), { width: 360 });
    const cell = geo(ui).rows[0]!.cells[1]!;
    expect(cell.lines.length).toBeGreaterThan(3);
    expect(cell.lines.join(" ")).toBe(words(20));
    expect(cell.lines.join("")).not.toContain("…");
    expect(cell.more).toBeUndefined();
  });

  it("shorten only very long text, behind a Show all toggle that brings it all back", () => {
    const ui = render(spec(words(400)), { width: 360 });
    let cell = geo(ui).rows[0]!.cells[1]!;
    expect(cell.lines.length).toBe(MAX_CELL_LINES);
    expect(cell.lines.at(-1)).toMatch(/…$/);
    expect(cell.more).toBe("closed");
    // A button to screen readers, collapsed, named for its column.
    const tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toMatch(/"role":"button","name":"Show all of Note"[^}]*"expanded":false/);
    const toggle = ui.hits.find((h) => h.detail === "more:0:1")!;
    expect(toggle).toBeDefined();
    ui.click(toggle.box.x + toggle.box.w / 2, toggle.box.y + toggle.box.h / 2);
    cell = geo(ui).rows[0]!.cells[1]!;
    expect(cell.more).toBe("open");
    expect(cell.lines.join(" ")).toBe(words(400));
    // Pressing it doesn't select the row.
    expect(ui.state.pick).toBe(0);
    expect(JSON.stringify(ui.accessibility({ full: true }))).toMatch(/"name":"Show less of Note"[^}]*"expanded":true/);
    // And from the keyboard: it's its own Tab stop.
    const focused = () => (ui.sayshape.focus as { detail?: unknown } | null)?.detail;
    for (let i = 0; i < 8 && focused() !== "more:0:1"; i++) ui.tab();
    expect(focused()).toBe("more:0:1");
    ui.key("Enter");
    expect(geo(ui).rows[0]!.cells[1]!.more).toBe("closed");
  });
});
