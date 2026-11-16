/**
 * Chart polish: field names in legends and axis titles, one number style in a
 * pie's legend, wrapped x labels, and names beside a few scatter dots.
 */
import { describe, expect, it } from "vitest";
import type { ChartGeometry } from "../src/components/chart";
import type { ScatterGeometry } from "../src/components/chart-kinds";
import { fieldTitle, legendValueTexts, wrapLabel } from "../src/components/chart-kit";
import { render, type Rendered } from "../src/testing";

const geo = (ui: Rendered): ChartGeometry => ui.find("chart").box!.data as ChartGeometry;
const texts = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("field names without labels=", () => {
  it("reads as a person would write it", () => {
    expect(fieldTitle("revenue")).toBe("Revenue");
    expect(fieldTitle("unit_price")).toBe("Unit price");
    expect(fieldTitle("last-year")).toBe("Last year");
    expect(fieldTitle("unitPrice")).toBe("Unit price");
    expect(fieldTitle("ARR")).toBe("ARR");
    expect(fieldTitle("net_ARR")).toBe("Net ARR");
    expect(fieldTitle("")).toBe("");
  });

  const rows = `state rows=[{m: "Jan", revenue: 10, costs: 4, unit_price: 3}, {m: "Feb", revenue: 12, costs: 5, unit_price: 4}]`;

  it("titles the legend, and leaves labels= alone", () => {
    expect(geo(render(`${rows}\nchart kind=bar items=rows x=m y=revenue,costs\n`)).legend.map((l) => l.label)).toEqual(["Revenue", "Costs"]);
    expect(geo(render(`${rows}\nchart kind=line items=rows x=m y=revenue,unit_price\n`)).legend.map((l) => l.label)).toEqual(["Revenue", "Unit price"]);
    expect(geo(render(`${rows}\nchart kind=bar items=rows x=m y=revenue,costs labels="revenue,COSTS"\n`)).legend.map((l) => l.label)).toEqual(["revenue", "COSTS"]);
  });

  it("titles a scatter's axes, and leaves labels= alone", () => {
    const pts = `state pts=[{unit_price: 3, units: 9}, {unit_price: 5, units: 7}]`;
    const plain = render(`${pts}\nchart kind=scatter items=pts x=unit_price y=units\n`);
    expect(texts(plain)).toContain("Unit price →");
    expect(texts(plain)).toContain("Units");
    const named = render(`${pts}\nchart kind=scatter items=pts x=unit_price y=units labels="price_x,y_units"\n`);
    expect(texts(named)).toContain("price_x →");
    expect(texts(named)).toContain("y_units");
  });
});

describe("a pie's legend values", () => {
  it("uses one style for the whole set", () => {
    expect(legendValueTexts([1200, 950, 40000], "number")).toEqual(["1,200", "950", "40,000"]);
    expect(legendValueTexts([1200000, 950], "number")).toEqual(["1,200,000", "950"]);
    expect(legendValueTexts([12.5, 3], "number")).toEqual(["12.5", "3.0"]);
    expect(legendValueTexts([1500, 12.5], "money")).toEqual(["$1,500.00", "$12.50"]);
    expect(legendValueTexts([5, 7], "percent")).toEqual(["5%", "7%"]);
  });

  it("shows no compact value beside a plain one", () => {
    const ui = render(`state rows=[{k: "A", v: 250000}, {k: "B", v: 950}, {k: "C", v: 1200}]\nchart kind=donut items=rows x=k y=v\n`);
    expect(geo(ui).legend.map((l) => l.detail!.split(" · ")[0])).toEqual(["250,000", "950", "1,200"]);
  });
});

describe("x labels on two lines", () => {
  it("splits at a space, then cuts the second line", () => {
    const m = { width: (s: string) => s.length * 6 };
    expect(wrapLabel("North America", 100, "", m)).toEqual(["North America"]);
    expect(wrapLabel("North America sales", 80, "", m)).toEqual(["North America", "sales"]);
    expect(wrapLabel("Customer success managers team", 70, "", m)).toEqual(["Customer", "success ma…"]);
    expect(wrapLabel("Extraordinarilylongword", 60, "", m)).toEqual(["Extraordi…"]);
  });

  const spec = `state s=[{r: "North America east", v: 5}, {r: "Customer success team", v: 3}, {r: "Asia Pacific", v: 4}, {r: "Latin America", v: 2}]\nchart kind=line items=s x=r y=v\n`;

  it("wraps long category labels on a bar chart and makes room for both lines", () => {
    const g = geo(render(spec, { width: 400 }));
    const wrapped = g.slots.filter((s) => s.shownLabel2);
    expect(wrapped.length).toBeGreaterThan(0);
    for (const s of wrapped) expect(s.shownLabel!.endsWith("…")).toBe(false);
    const short = geo(render(`state s=[{r: "A", v: 5}, {r: "B", v: 3}]\nchart kind=line items=s x=r y=v\n`, { width: 400 }));
    const tall = render(spec, { width: 400 }).find("chart").box!.h;
    expect(tall).toBeGreaterThan(render(`state s=[{r: "A", v: 5}, {r: "B", v: 3}]\nchart kind=line items=s x=r y=v\n`, { width: 400 }).find("chart").box!.h);
    expect(short.slots.some((s) => s.shownLabel2)).toBe(false);
  });

  it("still thins labels on narrow charts", () => {
    const many = `state s=[${Array.from({ length: 12 }, (_, i) => `{r: "Region ${i + 1}", v: ${i + 1}}`).join(", ")}]\nchart kind=line items=s x=r y=v\n`;
    const g = geo(render(many, { width: 300 }));
    expect(g.slots.some((s) => s.shownLabel === null)).toBe(true);
  });
});

describe("names beside scatter dots", () => {
  const pts = (n: number, extra = "") => `state pts=[${Array.from({ length: n }, (_, i) => `{name: "Item${i}", x: ${(i * 37) % 100}, y: ${(i * 53) % 90}}`).join(", ")}]\nchart kind=scatter items=pts x=x y=y ${extra}\n`;
  const labels = (ui: Rendered) => (geo(ui).custom as ScatterGeometry).dotLabels ?? [];

  it("labels dots when there are 12 or fewer, from label= or a name field", () => {
    expect(labels(render(pts(8, "label=name"), { width: 600 })).length).toBeGreaterThan(0);
    expect(labels(render(pts(8), { width: 600 })).length).toBeGreaterThan(0);
    expect(texts(render(pts(5, "label=name"), { width: 600 }))).toContain("Item1");
  });

  it("draws no names beyond 12 dots, or when the items have none", () => {
    expect(labels(render(pts(13, "label=name"), { width: 600 }))).toEqual([]);
    expect(labels(render(`state pts=[{x: 1, y: 2}, {x: 3, y: 4}]\nchart kind=scatter items=pts x=x y=y\n`))).toEqual([]);
  });

  it("skips a name that would collide with another or run out of the box", () => {
    const ui = render(pts(12, "label=name"), { width: 360 });
    const ls = labels(ui), w = ui.find("chart").box!.w;
    for (const l of ls) expect(l.x + 6 * l.text.length * 0.5).toBeLessThanOrEqual(w + 40);
    const crowded = render(`state pts=[{n: "Alpha one", x: 1, y: 1}, {n: "Beta two", x: 1, y: 1}, {n: "Gamma three", x: 1, y: 1}]\nchart kind=scatter items=pts x=x y=y label=n\n`, { width: 400 });
    expect(labels(crowded).length).toBeLessThan(3);
  });
});
