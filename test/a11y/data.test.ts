import { describe, expect, it } from "vitest";
import { coreComponents, type AccessibleNode } from "../../src";
import { mapComponents } from "../../src/components/map";
import { render } from "../../src/testing";

const first = (spec: string, opts = {}) => render(spec, opts).accessibility({ full: true }).children[0]!;
const names = (n: AccessibleNode): unknown => (n.children.length ? [n.role, n.children.map(names)] : `${n.role}:${n.name ?? ""}`);

describe("data to a screen reader", () => {
  it("table: headers, rows and cells, with the sort direction and the chosen row", () => {
    const ui = render(`state gear=[{id: "tent", name: "Tent", kg: 2.1}, {id: "stove", name: "Stove", kg: 0.4}] pick="stove" by="kg" dir="asc"
table "Gear" items=gear key=id bind=pick sort=by direction=dir
  table-column "Item" field=name
  table-column "Weight" field=kg format=number`);
    const t = ui.accessibility({ full: true }).children[0]!;
    expect([t.role, t.name]).toEqual(["table", "Gear"]);
    expect(names(t)).toEqual(["table", [
      ["row", ["columnheader:Item", "columnheader:Weight"]],
      ["row", ["rowheader:Stove", "cell:0.4"]],
      ["row", ["rowheader:Tent", "cell:2.1"]],
    ]]);
    const [head, stove, tent] = t.children;
    expect(head!.children[1]!.sort).toBe("ascending");
    expect(head!.children[0]!.focusable).toBe(true);
    expect([stove!.selected, stove!.name, tent!.selected, tent!.focusable]).toEqual([true, "Stove, 0.4", false, true]);
    // Choosing a row, and sorting by a header, through the mirror.
    ui.mirror.activate(tent!.key);
    expect(ui.state.pick).toBe("tent");
    ui.mirror.activate(head!.children[0]!.key);
    expect(ui.state.by).toBe("name");
  });

  it("table: a message in place of rows is read as it is", () => {
    const n = first(`state rows=[]\ntable "Orders" items=rows\n  table-column "Id" field=id`);
    expect(names(n)).toEqual(["table", [["row", ["columnheader:Id"]], ["row", ["cell:Nothing to show"]]]]);
  });

  it("bar chart: a figure with a summary and its numbers as a table", () => {
    const n = first(`state sales=[{m: "Jan", v: 1200}, {m: "Feb", v: 900}, {m: "Mar", v: 1600}]
chart "Revenue" kind=bar items=sales x=m y=v format=money`);
    expect(n).toMatchObject({ role: "figure", roleDescription: "bar chart", name: "Revenue", description: "3 items. Highest: Mar, $1,600. Lowest: Feb, $900." });
    expect(names(n)).toEqual(["figure", [["table", [
      ["row", ["columnheader:m", "columnheader:v"]],
      ["row", ["rowheader:Jan", "cell:$1,200"]],
      ["row", ["rowheader:Feb", "cell:$900"]],
      ["row", ["rowheader:Mar", "cell:$1,600"]],
    ]]]]);
  });

  it("line chart with two series: where it starts and ends, the legend's names as headers", () => {
    const n = first(`state s=[{m: "Jan", a: 1, b: 4}, {m: "Feb", a: 3, b: 2}]
chart "Signups" kind=line items=s x=m y=a,b labels="This year,Last year"`);
    expect(n.description).toBe("2 items. 2 series: This year, Last year. From Jan, 1, to Feb, 3. Highest This year: Feb, 3. Lowest This year: Jan, 1.");
    expect(n.children[0]!.children[0]!.children.map((c) => c.name)).toEqual(["m", "This year", "Last year"]);
  });

  it("pie: the total and the largest share", () => {
    const n = first(`state s=[{k: "West", v: 30}, {k: "East", v: 70}]\nchart "Sales by region" kind=pie items=s x=k y=v`);
    expect(n.description).toBe("2 items, total 100. Largest: East, 70 (70%).");
  });

  it("funnel: from the first stage to the last", () => {
    const n = first(`state s=[{k: "Leads", v: 200}, {k: "Calls", v: 80}, {k: "Won", v: 20}]\nchart kind=funnel items=s x=k y=v`);
    expect([n.name, n.description]).toEqual(["Funnel chart", "3 stages, from Leads (200) to Won (20), 10% of the first."]);
  });

  it("heatmap: its size and highest cell, a row per cell in the table", () => {
    const n = first(`state s=[{d: "Mon", h: "9", v: 3}, {d: "Mon", h: "10", v: 8}, {d: "Tue", h: "9", v: 5}]
chart "Orders" kind=heatmap items=s rows=d x=h y=v`);
    expect(n.description).toBe("2 rows by 2 columns. Highest: Mon, 10, 8. Lowest: Mon, 9, 3.");
  });

  it("a chart that can't be drawn says why", () => {
    const n = first(`state s=[]\nchart "Empty" items=s x=a y=b`);
    expect([n.role, n.name, n.children.length]).toEqual(["figure", "Empty", 0]);
    expect(n.description).toBeTruthy();
  });

  it("compare: options as columns, the recommended one and the best values marked", () => {
    const n = first(`state plans=[{name: "Basic", price: 10, sso: false}, {name: "Pro", price: 25, sso: true}]
compare items=plans pick=Pro
  compare-row "Price" field=price format=money best=low
  compare-row "SSO" field=sso`);
    expect(names(n)).toEqual(["table", [
      ["row", ["cell:", "columnheader:Basic", "columnheader:Pro, recommended"]],
      ["row", ["rowheader:Price", "cell:$10.00, best", "cell:$25.00"]],
      ["row", ["rowheader:SSO", "cell:No", "cell:Yes"]],
    ]]);
  });

  it("map: a figure listing its places", () => {
    const n = first(`text "Stores"
map
  pin "Phoenix" lat=33.45 lon=-112.07 detail="Open late"
  pin "Austin" lat=30.27 lon=-97.74`, { components: [...coreComponents, ...mapComponents] });
    const map = render(`text "Stores"\nmap\n  pin "Phoenix" lat=33.45 lon=-112.07 detail="Open late"\n  pin "Austin" lat=30.27 lon=-97.74`, { components: [...coreComponents, ...mapComponents] }).accessibility({ full: true }).children[1]!;
    expect(n.name).toBe("Stores");
    expect(map).toMatchObject({ role: "figure", roleDescription: "map", name: "Stores", description: "2 places marked." });
    expect(names(map)).toEqual(["figure", [["list", ["listitem:Phoenix, Open late", "listitem:Austin"]]]]);
  });
});
