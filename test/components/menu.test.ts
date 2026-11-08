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

const items = (ui: ReturnType<typeof render>) => ui.popup?.regions.map((r) => r.detail) ?? [];
const pressItem = (ui: ReturnType<typeof render>, detail: string) => {
  const r = ui.popup!.regions.find((h) => h.detail === detail)!.box;
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
    expect(items(ui)).toEqual(["item:0", "item:1", "item:3"]); // Archive is disabled
    pressItem(ui, "item:0");
    expect(ui.popup).toBeNull();
    const orders = ui.state.orders as Array<{ status: string }>;
    expect(orders.map((o) => o.status)).toEqual(["Shipped", "Open"]);
    ui.press(firstMenu(ui));
    pressItem(ui, "item:3");
    expect(ui.state.last).toBe("NW-2041");
    expect(ui.emitted.at(-1)).toEqual({ name: "delete", value: "NW-2041" });
  });

  it("works from the keyboard: arrows, Home, End, a letter, Enter, and Escape back to the button", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("menu");
    ui.key("ArrowDown");
    expect(ui.popup?.state.highlight).toBe(0);
    ui.key("ArrowDown");
    ui.key("ArrowDown"); // skips the disabled Archive
    expect(ui.popup?.state.highlight).toBe(3);
    ui.key("ArrowDown"); // goes round
    expect(ui.popup?.state.highlight).toBe(0);
    ui.key("End");
    expect(ui.popup?.state.highlight).toBe(3);
    ui.key("s"); // the next item starting with s
    expect(ui.popup?.state.highlight).toBe(1);
    ui.key("Enter");
    expect((ui.state.orders as Array<{ stars: number }>)[0]!.stars).toBe(1);
    expect(ui.focused?.type).toBe("menu");
    ui.key("ArrowUp"); // opens on the last item
    expect(ui.popup?.state.highlight).toBe(3);
    ui.key("Escape");
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("menu");
  });

  it("is a menu button to screen readers, its list a menu of menuitems while open", () => {
    const ui = render(SPEC, { width: 600 });
    let tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toContain('"role":"button","name":"Actions for NW-2041"');
    expect(tree).toContain('"hasPopup":"menu"');
    ui.press(firstMenu(ui));
    tree = JSON.stringify(ui.accessibility({ full: true }));
    expect(tree).toContain('"role":"menu"');
    expect(tree).toContain('"role":"menuitem","name":"Mark shipped"');
    expect(tree).toMatch(/"role":"menuitem","name":"Archive"[^}]*"disabled":true/);
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
