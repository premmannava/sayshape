import { describe, expect, it } from "vitest";
import { menu, MAX_MENU_ITEMS } from "../../src/components/menu";
import { render } from "../../src/testing";

const SPEC = `state orders=[{id: "NW-2041", status: "Open", stars: 0}, {id: "NW-2042", status: "Open", stars: 0}] last=""
each items=orders as=o
  row
    text "{o.id}: {o.status}"
    menu label="Actions for {o.id}"
      menu-item "Mark shipped" icon=truck on=set:o.status:Shipped
      menu-item "Star" icon=star on=inc:o.stars
      menu-item "Archive" disabled=true on=emit:archive
      menu-item "Delete" icon=x-circle tone=bad on="set:last:{o.id};emit:delete:{o.id}"
`;

type UI = ReturnType<typeof render>;
/** The open list's items, by their text. */
const labelOf = (ui: UI, id: unknown) => ui.findAll("menu-item").find((m) => m.node.id === id)?.node.text;
const items = (ui: UI) => ui.popup?.regions.map((r) => labelOf(ui, String(r.detail).slice(5))) ?? [];
const highlighted = (ui: UI) => labelOf(ui, ui.popup?.state.highlight);
const pressItem = (ui: UI, label: string) => {
  const r = ui.popup!.regions.find((h) => labelOf(ui, String(h.detail).slice(5)) === label)!.box;
  ui.click(r.x + 8, r.y + r.h / 2);
};
const firstMenu = (ui: ReturnType<typeof render>) => ({ id: ui.findAll("menu")[0]!.node.id });

describe("menu", () => {
  it("parses its example, and warns about menu-items outside a menu", () => {
    expect(render(menu.example! + "\n").diagnostics).toEqual([]);
    const r = render(`menu-item "Edit" on=emit:edit\n`);
    expect(r.diagnostics.map((d) => d.message).join(" ")).toMatch(/menu/);
  });

  it("is a button as wide as its words, or a small square of three dots without them", () => {
    const ui = render(`row\n  menu "Actions"\n    menu-item "Edit" on=emit:edit\n  menu\n    menu-item "Edit" on=emit:edit\n`, { width: 600 });
    const [withText, dots] = ui.findAll("menu").map((m) => m.box!);
    expect(withText!.w).toBeGreaterThan(dots!.w);
    expect(dots!.w).toBe(dots!.h);
    for (const width of [240, 360, 600, 1024]) {
      const u = render(SPEC, { width });
      for (const m of u.findAll("menu")) expect(m.box!.x + m.box!.w).toBeLessThanOrEqual(width + 0.5);
      u.destroy();
    }
  });

  it("opens its list on press, and runs the chosen item's on= for its own copy", () => {
    const ui = render(SPEC, { width: 600 });
    ui.press(firstMenu(ui));
    expect(items(ui)).toEqual(["Mark shipped", "Star", "Delete"]); // Archive is disabled
    pressItem(ui, "Mark shipped");
    expect(ui.popup).toBeNull();
    const orders = ui.state.orders as Array<{ status: string }>;
    expect(orders.map((o) => o.status)).toEqual(["Shipped", "Open"]);
    ui.press(firstMenu(ui));
    pressItem(ui, "Delete");
    expect(ui.state.last).toBe("NW-2041");
    expect(ui.emitted.at(-1)).toEqual({ name: "delete", value: "NW-2041" });
  });

  it("works from the keyboard: arrows, Home, End, a letter, Enter, and Escape back to the button", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("menu");
    ui.key("ArrowDown");
    expect(highlighted(ui)).toBe("Mark shipped");
    ui.key("ArrowDown");
    ui.key("ArrowDown"); // skips the disabled Archive
    expect(highlighted(ui)).toBe("Delete");
    ui.key("ArrowDown"); // goes round
    expect(highlighted(ui)).toBe("Mark shipped");
    ui.key("End");
    expect(highlighted(ui)).toBe("Delete");
    ui.key("s"); // the next item starting with s
    expect(highlighted(ui)).toBe("Star");
    ui.key("Enter");
    expect((ui.state.orders as Array<{ stars: number }>)[0]!.stars).toBe(1);
    expect(ui.focused?.type).toBe("menu");
    ui.key("ArrowUp"); // opens on the last item
    expect(highlighted(ui)).toBe("Delete");
    ui.key("Escape");
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("menu");
  });

  it("is a menu button to screen readers; open, the focused node is the menu, pointing at the highlighted item", () => {
    const ui = render(SPEC, { width: 600 });
    let tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toContain('"role":"button","name":"Actions for NW-2041"');
    expect(tree).toContain('"hasPopup":"menu"');
    ui.tab();
    ui.key("ArrowDown");
    const full = ui.accessibility({ full: true });
    const find = (n: typeof full, role: string): typeof full | undefined => (n.role === role ? n : n.children.map((k) => find(k, role)).find(Boolean));
    const open = find(full, "menu")!;
    expect(open.name).toBe("Actions for NW-2041");
    expect(open.focusable).toBe(true);
    expect(open.activeDescendant).toBe(open.children[0]!.key);
    tree = JSON.stringify(full);
    expect(tree).toContain('"role":"menuitem","name":"Mark shipped"');
    expect(tree).toMatch(/"role":"menuitem","name":"Archive"[^}]*"disabled":true/);
  });

  it("highlights the item a screen reader moves onto, so Enter chooses it", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    ui.key("ArrowDown");
    const del = ui.popup!.regions.find((r) => labelOf(ui, String(r.detail).slice(5)) === "Delete")!;
    ui.mirror.focus(`${ui.findAll("menu")[0]!.node.id}|${String(del.detail)}`);
    expect(highlighted(ui)).toBe("Delete");
    ui.key("Enter");
    expect(ui.state.last).toBe("NW-2041");
  });

  it("keeps the highlight on the same item when the list changes while open", () => {
    const ui = render(`state show=false
menu "Actions"
  menu-item "Edit" on=emit:edit
  menu-item "Star" if={show} on=emit:star
  menu-item "Delete" on=emit:delete
`, { width: 600 });
    ui.tab();
    ui.key("ArrowUp");
    expect(highlighted(ui)).toBe("Delete");
    ui.set("show", true);
    ui.key("Enter");
    expect(ui.emitted.map((e) => e.name)).toEqual(["delete"]);
  });

  it("sits at the start of its room with words, and at the end as a ⋯ (align= changes it)", () => {
    const ui = render(`row
  menu "Actions"
    menu-item "Edit" on=emit:edit
  button "Save" on=emit:save
row
  text "Order"
  menu
    menu-item "Edit" on=emit:edit
row
  text "Orders"
  menu "Export" align=end
    menu-item "CSV" on=emit:csv
`, { width: 600 });
    const [words, dots, end] = ui.findAll("menu").map((m) => m.box!);
    expect(words!.x).toBeLessThan(30);
    expect(dots!.x + dots!.w).toBeGreaterThan(560);
    expect(end!.x + end!.w).toBeGreaterThan(560);
  });

  it("can't be opened when disabled or when no item can be chosen", () => {
    const ui = render(`row\n  menu "A" disabled=true\n    menu-item "Edit" on=emit:edit\n  menu "B"\n    menu-item "Edit" disabled=true on=emit:edit\n`, { width: 600 });
    expect(ui.hits.length).toBe(0);
  });

  it(`shows at most ${MAX_MENU_ITEMS} items, with a warning`, () => {
    const many = Array.from({ length: MAX_MENU_ITEMS + 3 }, (_, i) => `  menu-item "Item ${i}" on=emit:i${i}`).join("\n");
    const ui = render(`menu "Lots"\n${many}\n`, { width: 600 });
    ui.press("menu");
    expect(items(ui).length).toBe(MAX_MENU_ITEMS);
    expect(ui.warnings.join(" ")).toMatch(new RegExp(`first ${MAX_MENU_ITEMS} of ${MAX_MENU_ITEMS + 3}`));
  });

  it("is left out of Copy text, as a control", () => {
    expect(render(SPEC, { width: 600 }).copyText()).not.toMatch(/Mark shipped/);
  });

  it("streams: every prefix parses", () => {
    const lines = SPEC.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const ui = render(lines.slice(0, i).join("\n") + "\n", { width: 400 });
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      ui.destroy();
    }
  });
});
