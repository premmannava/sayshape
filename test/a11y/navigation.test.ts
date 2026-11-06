import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";

describe("navigation and popups to a screen reader", () => {
  it("screen: a region named by its title, with the title as its heading", () => {
    const ui = render(`screen name=cart title="Your cart"
  text "2 items"
screen name=checkout title="Checkout"
  text "Pay"`);
    expect(ui.accessibility().children).toEqual([
      { role: "region", name: "Your cart", children: [{ role: "heading", name: "Your cart", state: ["level 1"] }, { role: "text", name: "2 items" }] },
    ]);
  });

  it("screen without a title is named by its name", () => {
    const ui = render(`screen name=start\n  text "Hi"`);
    expect(ui.accessibility().children![0]).toMatchObject({ role: "region", name: "start" });
  });

  it("tabs: a tablist of tabs, the chosen one selected, its panel after the list", () => {
    const ui = render(`state t=specs
tabs bind=t
  tab "Overview" value=overview
    text "Light and fast."
  tab "Specs" value=specs
    text "280 g, 6 mm drop."`);
    expect(ui.accessibility().children).toEqual([
      {
        role: "tablist",
        children: [
          { role: "tab", name: "Overview", state: ["not selected", "focusable"] },
          { role: "tab", name: "Specs", state: ["selected", "focusable"] },
        ],
      },
      { role: "tabpanel", name: "Specs", children: [{ role: "text", name: "280 g, 6 mm drop." }] },
    ]);
    const tablist = ui.accessibility({ full: true }).children[0]!;
    ui.mirror.activate(tablist.children[0]!.key);
    expect(ui.state.t).toBe("overview");
    expect(ui.accessibility().children![1]).toMatchObject({ role: "tabpanel", name: "Overview" });
  });

  it("breadcrumb: navigation with links back and the current page marked", () => {
    const ui = render(`state at=""\nbreadcrumb "Home / Shoes / Trail runners" bind=at`);
    expect(ui.accessibility().children).toEqual([
      {
        role: "navigation",
        name: "Breadcrumb",
        children: [
          { role: "link", name: "Home", state: ["focusable"] },
          { role: "link", name: "Shoes", state: ["focusable"] },
          { role: "text", name: "Trail runners", state: ["current page"] },
        ],
      },
    ]);
  });

  it("breadcrumb that does nothing when pressed is plain text", () => {
    const ui = render(`breadcrumb "Home / Shoes"`);
    expect(ui.accessibility().children![0]!.children!.map((c) => c.role)).toEqual(["text", "text"]);
  });

  it("pagination: navigation with previous, page and next buttons, the current page marked", () => {
    const ui = render(`state page=1\npagination bind=page pages=3`);
    expect(ui.accessibility().children).toEqual([
      {
        role: "navigation",
        name: "Pages",
        children: [
          { role: "button", name: "Previous page", state: ["disabled"] },
          { role: "button", name: "Page 1", state: ["current page"] },
          { role: "button", name: "Page 2", state: ["focusable"] },
          { role: "button", name: "Page 3", state: ["focusable"] },
          { role: "button", name: "Next page", state: ["focusable"] },
        ],
      },
    ]);
    const next = ui.accessibility({ full: true }).children[0]!.children.at(-1)!;
    ui.mirror.activate(next.key);
    expect(ui.state.page).toBe(2);
  });

  it("select: a combobox showing its choice; open, a listbox with the highlighted option active", () => {
    const ui = render(`state dept="eng"
select "Department" bind=dept items={["sales", "eng", "ops"]}`);
    const id = ui.find("select").node.id;
    expect(ui.accessibility().children).toEqual([
      { role: "group", children: [{ role: "combobox", name: "Department", state: ["not expanded", "value eng", "focusable"] }] },
    ]);
    ui.mirror.focus(id);
    ui.mirror.key("ArrowDown");
    expect(ui.popup).not.toBeNull();
    const parts = () => ui.accessibility().children![0]!.children!;
    expect(parts()).toEqual([
      { role: "combobox", name: "Department", state: ["expanded", "value eng", "focusable"] },
      {
        role: "listbox",
        name: "Department",
        children: [
          { role: "option", name: "sales", state: ["not selected"] },
          { role: "option", name: "eng", state: ["selected"] },
          { role: "option", name: "ops", state: ["not selected"] },
        ],
      },
    ]);
    const full = () => ui.accessibility({ full: true }).children[0]!.children;
    expect(full()[0]!.controls).toBe(full()[1]!.key);
    expect(full()[0]!.activeDescendant).toBe(`${id}|opt:s:eng`);
    ui.mirror.key("ArrowDown");
    expect(full()[0]!.activeDescendant).toBe(`${id}|opt:s:ops`);
    ui.mirror.key("Enter");
    expect(ui.state.dept).toBe("ops");
    expect(parts()).toEqual([{ role: "combobox", name: "Department", state: ["not expanded", "value ops", "focusable"] }]);
  });

  it("select: a screen reader can choose an option directly, focus staying on the field", () => {
    const ui = render(`state dept="eng"\nselect "Department" bind=dept items={["sales", "eng", "ops"]}`);
    const id = ui.find("select").node.id;
    ui.mirror.activate(id);
    ui.mirror.activate(`${id}|opt:s:sales`);
    expect(ui.state.dept).toBe("sales");
    expect(ui.popup).toBeNull();
    expect(ui.focused?.id).toBe(id);
  });

  it("date-picker: a combobox showing its date; open, the month's days with the arrows' day active", () => {
    const ui = render(`state due="2026-10-21"\ndate-picker "Due date" bind=due`, { today: "2026-10-21" });
    const id = ui.find("date-picker").node.id;
    expect(ui.accessibility().children![0]!.children).toEqual([{ role: "combobox", name: "Due date", state: ["not expanded", "value Wed, Oct 21, 2026", "focusable"] }]);
    ui.mirror.activate(id);
    expect(ui.popup).not.toBeNull();
    const full = () => ui.accessibility({ full: true }).children[0]!.children;
    const days = full()[1]!;
    expect([days.role, days.name, days.children.length]).toEqual(["listbox", "Due date: October 2026", 31]);
    expect(days.children[20]).toMatchObject({ name: "Wed, Oct 21, 2026", selected: true });
    expect(full()[0]!.activeDescendant).toBe(`${id}|day:2026-10-21`);
    ui.mirror.key("ArrowRight");
    expect(full()[0]!.activeDescendant).toBe(`${id}|day:2026-10-22`);
    ui.mirror.key("Enter");
    expect(ui.state.due).toBe("2026-10-22");
  });
});
