import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { buildTree, MAX_TREE_NODES, tree, type TreeGeometry } from "../../src/components/tree";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";
import { toData } from "../../src/data";

// The contract tests already check the definition, layout bounds, text that
// fits at 240, 360 and 600 px, theme-only colors and keyboard reach.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const geo = (ui: Rendered): TreeGeometry => ui.find("tree").box!.data as unknown as TreeGeometry;
const shownRows = (ui: Rendered) => geo(ui).rows.map((r) => r.node.label);

const PEOPLE = `state picked="" people=[{id: "e1", name: "Ana Ruiz", role: "COO"}, {id: "e2", name: "Ben Okafor", role: "Head of Claims", manager: "e1"}, {id: "e3", name: "Chloe Park", role: "Head of Operations", manager: "e1"}, {id: "e4", name: "Dev Malhotra", role: "Claims lead", manager: "e2"}, {id: "e5", name: "Erin Walsh", role: "Claims lead", manager: "e2"}]`;
const LIST = `${PEOPLE}\ntree "Org" items=people parent=manager label=name detail=role bind=picked on=emit:picked\n`;
const ORG = `${PEOPLE}\ntree "Org" items=people parent=manager label=name detail=role kind=org bind=picked\n`;
const PLAIN = `${PEOPLE}\ntree "Org" items=people parent=manager label=name detail=role\n`;

describe("building the hierarchy", () => {
  const f = { id: "id", parent: "parent", label: "name", detail: "", value: "", format: "text" as const };
  it("puts children under parents in list order, whatever order they come in", () => {
    const t = buildTree(toData([{ id: 3, name: "C", parent: 1 }, { id: 1, name: "A" }, { id: 2, name: "B", parent: 1 }]) as never, f);
    expect(t.roots.map((r) => r.label)).toEqual(["A"]);
    expect(t.roots[0]!.children.map((c) => c.label)).toEqual(["C", "B"]);
    expect(t.all.map((n) => [n.label, n.depth])).toEqual([["A", 0], ["C", 1], ["B", 1]]);
  });

  it("shows items with a missing parent, and a loop of parents, at the top, and never throws", () => {
    const t = buildTree(toData([{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "c" }, { id: "c", name: "C", parent: "a" }, { id: "d", name: "D", parent: "zz" }, { id: "a", name: "Again" }]) as never, f);
    expect(t.loops).toEqual(["A → B → C"]);
    expect(t.orphans).toEqual(["D"]);
    expect(t.duplicates).toBe(1);
    expect(t.roots.map((r) => r.label)).toEqual(["A", "D"]);
    expect(t.all.length).toBe(4);
  });
});

describe("tree", () => {
  it("renders its example and the samples without problems, and is in the guide", () => {
    expect(msgs(tree.example!)).toEqual([]);
    for (const s of [LIST, ORG]) {
      const ui = render(s, { width: 600 });
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
    }
    expect(languageGuide(registry)).toContain("tree items=rows parent=parent");
  });

  it("warns about bad props but keeps the element", () => {
    const m = msgs(`state p=[]\ntree items=p kind=chart colour=red`);
    expect(m.some((x) => x.includes("kind"))).toBe(true);
    expect(m.some((x) => x.includes("colour"))).toBe(true);
  });

  it("list: opens the first level to start, open= opens more, and 0 only the top", () => {
    expect(shownRows(render(LIST))).toEqual(["Ana Ruiz", "Ben Okafor", "Chloe Park"]);
    expect(shownRows(render(LIST.replace("bind=picked", "open=2 bind=picked")))).toEqual(["Ana Ruiz", "Ben Okafor", "Dev Malhotra", "Erin Walsh", "Chloe Park"]);
    expect(shownRows(render(LIST.replace("bind=picked", "open=0 bind=picked")))).toEqual(["Ana Ruiz"]);
  });

  it("list: the chevron opens and closes a branch, as view state rather than app state", () => {
    const ui = render(LIST, { width: 600 });
    const before = { ...ui.state };
    const chevron = ui.hits.find((h) => h.detail === "toggle:e2")!;
    ui.click(chevron.box.x + chevron.box.w / 2, chevron.box.y + chevron.box.h / 2);
    expect(shownRows(ui)).toEqual(["Ana Ruiz", "Ben Okafor", "Dev Malhotra", "Erin Walsh", "Chloe Park"]);
    expect(ui.state).toEqual(before);
    const again = ui.hits.find((h) => h.detail === "toggle:e2")!;
    ui.click(again.box.x + again.box.w / 2, again.box.y + again.box.h / 2);
    expect(shownRows(ui)).toEqual(["Ana Ruiz", "Ben Okafor", "Chloe Park"]);
  });

  it("list: pressing a row selects it (bind=, then on=); without bind= it opens and closes", () => {
    const ui = render(LIST, { width: 600 });
    const row = ui.hits.find((h) => h.detail === "node:e3")!;
    ui.click(row.box.x + row.box.w / 2, row.box.y + row.box.h / 2);
    expect(ui.state.picked).toBe("e3");
    expect(ui.emitted.map((e) => e.name)).toEqual(["picked"]);
    const plain = render(PLAIN, { width: 600 });
    const r2 = plain.hits.find((h) => h.detail === "node:e2")!;
    plain.click(r2.box.x + r2.box.w / 2, r2.box.y + r2.box.h / 2);
    expect(shownRows(plain)).toContain("Dev Malhotra");
  });

  it("list: one Tab stop; Down and Up move, Right opens then steps in, Left closes then steps out, Enter selects", () => {
    const ui = render(LIST, { width: 600 });
    const focusedName = () => ui.mirror.focused?.split("|")[1];
    ui.tab();
    expect(focusedName()).toBe("node:e1");
    ui.key("ArrowDown");
    expect(focusedName()).toBe("node:e2");
    ui.key("ArrowRight");
    expect(shownRows(ui)).toContain("Dev Malhotra");
    ui.key("ArrowRight");
    expect(focusedName()).toBe("node:e4");
    ui.key("ArrowLeft");
    expect(focusedName()).toBe("node:e2");
    ui.key("ArrowLeft");
    expect(shownRows(ui)).not.toContain("Dev Malhotra");
    ui.key("Enter");
    expect(ui.state.picked).toBe("e2");
    ui.key("End");
    expect(focusedName()).toBe("node:e3");
    // Tab leaves the tree: only one of its rows is a Tab stop.
    expect(ui.hits.filter((h) => h.box.node.type === "tree" && h.focusable !== false).length).toBe(1);
  });

  it("org: a parent centred over its children, children on the row below, lines between", () => {
    const d = geo(render(ORG, { width: 1024 }));
    const box = (name: string) => d.boxes.find((b) => b.node.label === name)!;
    const ana = box("Ana Ruiz"), ben = box("Ben Okafor"), chloe = box("Chloe Park"), dev = box("Dev Malhotra"), erin = box("Erin Walsh");
    expect(ben.y).toBeGreaterThan(ana.y + ana.h);
    expect(ben.y).toBe(chloe.y);
    expect(ben.x + ben.w / 2).toBeCloseTo((dev.x + dev.w / 2 + erin.x + erin.w / 2) / 2, 5);
    expect(dev.x + dev.w).toBeLessThan(erin.x);
    expect(d.links.length).toBe(4);
  });

  it("org: scrolls sideways when wide, and its boxes are Tab stops that select", () => {
    const ui = render(ORG, { width: 300 });
    const d = geo(ui);
    expect(d.contentW).toBeGreaterThan(d.viewW);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.picked).toBe("e1");
  });

  it("is a tree to a screen reader, with levels and open state, and copies as an indented outline", () => {
    const ui = render(LIST.replace("bind=picked", "open=2 bind=picked"), { width: 600 });
    expect(ui.copyText().split("\n")).toEqual([
      "Org",
      "Ana Ruiz, COO",
      "  Ben Okafor, Head of Claims",
      "    Dev Malhotra, Claims lead",
      "    Erin Walsh, Claims lead",
      "  Chloe Park, Head of Operations",
    ]);
    const tree = ui.accessibility({ full: true });
    const items: Array<{ name?: string; level?: number; expanded?: boolean }> = [];
    const walk = (n: typeof tree) => { if (n.role === "treeitem") items.push(n); n.children.forEach(walk); };
    walk(tree);
    expect(items[0]).toMatchObject({ name: "Ana Ruiz, COO", level: 1, expanded: true });
    expect(items[2]).toMatchObject({ level: 3 });
    expect(items[2]!.expanded).toBeUndefined();
  });

  it("warns about missing parents and loops, naming them, and still draws everything", () => {
    const ui = render(`state p=[{id: 1, name: "A", parent: 2}, {id: 2, name: "B", parent: 1}, {id: 3, name: "C", parent: 9}]\ntree items=p kind=org`);
    expect(geo(ui).boxes.length).toBe(3);
    expect(ui.warnings.join(" ")).toContain("A → B");
    expect(ui.warnings.join(" ")).toContain("(C)");
  });

  it("shows a message instead of too many items", () => {
    const many = Array.from({ length: MAX_TREE_NODES + 1 }, (_, i) => `{id: ${i}, name: "N${i}"}`).join(", ");
    expect(geo(render(`state p=[${many}]\ntree items=p`)).message).toContain("Too many items");
  });

  it("lays out at every width inside its box", () => {
    for (const width of [240, 360, 600, 1024]) for (const s of [LIST, ORG]) {
      const ui = render(s, { width });
      const box = ui.find("tree").box!;
      expect(box.w).toBeLessThanOrEqual(width);
      expect(box.h).toBeGreaterThan(0);
    }
  });

  it("never throws on odd data, and every streamed prefix renders", () => {
    for (const odd of [`items=5`, `items={[null, "x", {id: {a: 1}}]}`, `items=nope`, ``]) {
      expect(() => render(`tree ${odd}`)).not.toThrow();
      expect(() => render(`tree ${odd} kind=org`)).not.toThrow();
    }
    const lines = ORG.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("tree, from the review", () => {
  it("org: reads and copies as the hierarchy, parents before their children", () => {
    const lines = render(ORG, { width: 1024 }).copyText().split("\n");
    expect(lines).toEqual(["Org", "Ana Ruiz, COO", "  Ben Okafor, Head of Claims", "    Dev Malhotra, Claims lead", "    Erin Walsh, Claims lead", "  Chloe Park, Head of Operations"]);
  });

  it("opens the branch that holds the selected item", () => {
    expect(shownRows(render(LIST.replace('picked=""', 'picked="e5"')))).toContain("Erin Walsh");
  });

  it("keeps deep rows and long values inside its box", () => {
    const chain = Array.from({ length: 20 }, (_, i) => `{id: ${i}, name: "Level ${i}", value: "a rather long text value for level ${i}"${i ? `, parent: ${i - 1}` : ""}}`).join(", ");
    const ui = render(`state p=[${chain}]\ntree items=p value=value open=20`, { width: 240 });
    const box = ui.find("tree").box!;
    for (const h of ui.hits.filter((x) => x.box.node.type === "tree")) {
      expect(h.box.w).toBeGreaterThan(0);
      expect(h.box.x + h.box.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
    }
    for (const r of (ui.find("tree").box!.data as unknown as TreeGeometry).rows) expect(r.lines.join("")).not.toBe("…");
  });

  it("warns when an item names itself as its parent", () => {
    expect(render(`state p=[{id: 1, name: "A", parent: 1}]\ntree items=p`).warnings.join(" ")).toContain("or itself");
  });
});
