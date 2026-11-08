import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { chartHoverAt, type ChartGeometry } from "../../src/components/chart";
import { MAX_SANKEY_LINKS, MAX_SANKEY_NODES, sankeyLinkAt, type SankeyGeometry } from "../../src/components/chart-kinds";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const FLOWS = `state flows=[{source: "Grants", target: "Programs", amount: 800}, {source: "Donations", target: "Programs", amount: 500}, {source: "Donations", target: "Overhead", amount: 200}, {source: "Programs", target: "Water", amount: 700}, {source: "Programs", target: "Meals", amount: 600}, {source: "Bad", target: "", amount: 5}, {source: "X", target: "Y", amount: 0}]
chart "Funding" kind=sankey items=flows from=source to=target y=amount format=money
`;
const geo = (spec: string, width = 600) => render(spec, { width }).find("chart").box!.data as ChartGeometry;
const sk = (d: ChartGeometry) => d.custom as SankeyGeometry;
const node = (d: ChartGeometry, name: string) => sk(d).nodes.find((n) => n.name === name)!;

describe("chart kind=sankey", () => {
  it("is in the guide, needs from= and to=, and doesn't ask for x=", () => {
    expect(languageGuide(registry)).toContain("chart kind=sankey from=source to=target");
    expect(msgs(`state s=[]\nchart kind=sankey items=s from=a to=b y=v`)).toEqual([]);
    expect(msgs(`state s=[]\nchart kind=sankey items=s y=v`).join(" ")).toContain("needs from= and to=");
    expect(msgs(`state s=[]\nchart kind=bar items=s y=v from=a`).join(" ")).toContain("from= is for kind=sankey only");
    expect(msgs(`state s=[]\nchart kind=bar items=s y=v`).join(" ")).toContain(`"chart" needs x=`);
  });

  it("puts nodes in columns found from the flows, sinks last, sized by what flows through", () => {
    const d = geo(FLOWS);
    expect([node(d, "Grants").col, node(d, "Donations").col, node(d, "Programs").col, node(d, "Water").col, node(d, "Overhead").col]).toEqual([0, 0, 1, 2, 2]);
    expect(node(d, "Programs").value).toBe(1300);
    // Height in proportion to value.
    expect(node(d, "Programs").rect.h / node(d, "Grants").rect.h).toBeCloseTo(1300 / 800, 1);
  });

  it("makes each band as thick as its amount, leaving and arriving inside its nodes", () => {
    const d = geo(FLOWS);
    const s = sk(d);
    for (const l of s.links) {
      const a = s.nodes[l.from]!.rect, b = s.nodes[l.to]!.rect;
      expect(l.y0 - l.width / 2).toBeGreaterThanOrEqual(a.y - 0.01);
      expect(l.y0 + l.width / 2).toBeLessThanOrEqual(a.y + a.h + 0.01);
      expect(l.y1 - l.width / 2).toBeGreaterThanOrEqual(b.y - 0.01);
      expect(l.y1 + l.width / 2).toBeLessThanOrEqual(b.y + b.h + 0.01);
    }
    const g = s.links.find((l) => s.nodes[l.from]!.name === "Grants")!, o = s.links.find((l) => s.nodes[l.to]!.name === "Overhead")!;
    expect(g.width / o.width).toBeCloseTo(4, 1);
  });

  it("skips flows without both ends or a number above 0, with a warning", () => {
    const ui = render(FLOWS, { width: 600 });
    expect(ui.warnings.join(" ")).toContain("2 of 7 flows");
    expect(sk(ui.find("chart").box!.data as ChartGeometry).links.length).toBe(5);
  });

  it("says so for flows that go round in a circle, and never throws", () => {
    const ui = render(`state s=[{a: "A", b: "B", v: 1}, {a: "B", b: "C", v: 1}, {a: "C", b: "A", v: 1}]\nchart kind=sankey items=s from=a to=b y=v\n`, { width: 600 });
    const d = ui.find("chart").box!.data as ChartGeometry;
    expect(d.message).toContain("go round in a circle (A to B to C to A)");
    expect(geo(`state s=[{a: "A", b: "A", v: 1}]\nchart kind=sankey items=s from=a to=b y=v\n`).message).toContain("circle");
  });

  it("shows a message past MAX_SANKEY_NODES nodes or MAX_SANKEY_LINKS flows", () => {
    const nodes = Array.from({ length: MAX_SANKEY_NODES }, (_, i) => `{a: "S", b: "T${i}", v: 1}`).join(", ");
    expect(geo(`state s=[${nodes}]\nchart kind=sankey items=s from=a to=b y=v\n`).message).toContain("Too many nodes");
    const links = Array.from({ length: MAX_SANKEY_LINKS + 1 }, (_, i) => `{a: "S${i % 11}", b: "T${Math.floor(i / 11)}", v: 1}`).join(", ");
    expect(geo(`state s=[${links}]\nchart kind=sankey items=s from=a to=b y=v\n`).message).toContain("Too many flows");
  });

  it("finds the band or node under the pointer for its tip", () => {
    const d = geo(FLOWS);
    const s = sk(d);
    const l = s.links[0]!;
    const mid = (l.x0 + l.x1) / 2, y = (l.y0 + l.y1) / 2;
    expect(sankeyLinkAt(s, mid, y)).toBeGreaterThanOrEqual(0);
    const hit = chartHoverAt(d, mid, y)!;
    expect(d.slots[hit.index]!.notes![0]).toContain("of");
    const n = node(d, "Programs").rect;
    expect(d.slots[chartHoverAt(d, n.x + 1, n.y + n.h / 2)!.index]!.label).toBe("Programs");
  });

  it("is a figure with a summary and the flows as a table, for screen readers and Copy text", () => {
    const text = render(FLOWS, { width: 600 }).copyText();
    expect(text).toContain("5 flows between 6 places, $1,500 in all from Grants, Donations. Largest: Grants to Programs, $800.");
    expect(text).toContain("source\ttarget\tamount");
    expect(text).toContain("Programs\tWater\t$700");
  });

  it("lays out inside its box at every width, and every streamed prefix renders", () => {
    for (const width of [240, 360, 600, 1024]) {
      const b = render(FLOWS, { width }).find("chart").box!;
      for (const n of sk(b.data as ChartGeometry).nodes) {
        expect(n.rect.x).toBeGreaterThanOrEqual(0);
        expect(n.rect.x + n.rect.w).toBeLessThanOrEqual(b.w + 0.01);
        expect(n.rect.y + n.rect.h).toBeLessThanOrEqual(b.h + 0.01);
      }
    }
    for (const odd of [`items=5`, `items={[1]}`, `items={[{a: {x: 1}, b: "B", v: 1}]}`, `items={[{a: "A", b: "B", v: 1e308}, {a: "B", b: "C", v: 1e308}]}`]) {
      expect(() => render(`chart kind=sankey from=a to=b y=v ${odd}\n`, { width: 360 })).not.toThrow();
    }
    const lines = FLOWS.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("chart kind=sankey, after review", () => {
  it("keeps names apart in a two-column sankey", () => {
    const d = geo(`state s=[{a: "Salaries and wages", b: "Operating expenses", v: 50}, {a: "Marketing budget", b: "Customer acquisition", v: 50}]\nchart kind=sankey items=s from=a to=b y=v\n`, 240);
    const s = sk(d);
    for (const l of s.nodes.filter((n) => n.col === 0)) for (const r of s.nodes.filter((n) => n.col === 1)) {
      if (!l.label || !r.label) continue;
      if (Math.abs((l.rect.y + l.rect.h / 2) - (r.rect.y + r.rect.h / 2)) > 10) continue;
      expect(l.labelX + 7 * l.label.length).toBeLessThan(r.labelX + 1 + 120);
    }
    for (const n of s.nodes) expect(n.label === "" || n.label.length <= 30).toBe(true);
  });

  it("says so when the chain is too long for the width", () => {
    const chain = Array.from({ length: 30 }, (_, i) => `{a: "N${i}", b: "N${i + 1}", v: 1}`).join(", ");
    expect(geo(`state s=[${chain}]\nchart kind=sankey items=s from=a to=b y=v\n`, 360).message).toContain("Too many steps");
  });

  it("puts a source just before the place it feeds", () => {
    const d = geo(`state s=[{a: "A", b: "B", v: 5}, {a: "B", b: "C", v: 5}, {a: "C", b: "E", v: 6}, {a: "D", b: "C", v: 1}]\nchart kind=sankey items=s from=a to=b y=v\n`, 600);
    expect(node(d, "D").col).toBe(node(d, "C").col - 1);
  });

  it("adds up flows between the same two places", () => {
    const d = geo(`state s=[{a: "A", b: "B", v: 10}, {a: "A", b: "B", v: 5}, {a: "A", b: "C", v: 5}]\nchart kind=sankey items=s from=a to=b y=v\n`);
    expect(sk(d).links.map((l) => l.value).sort()).toEqual([15, 5].sort());
  });

  it("keeps x= required for other kinds, even when y= is an expression", () => {
    expect(msgs(`state s=[]\nchart items=s y={'v'}`).join(" ")).toContain(`"chart" needs x=`);
    expect(msgs(`state s=[]\nchart kind=sankey items=s`).join(" ")).toContain("needs from= and to=");
    expect(languageGuide(registry, { mode: "compact" })).toContain("x=name!");
  });

  it("says so for amounts too large to add up", () => {
    const ui = render(`chart kind=sankey items=s from=a to=b y=v\n`, { width: 600 });
    ui.set("s", [{ a: "A", b: "B", v: 1e308 }, { a: "C", b: "B", v: 1e308 }]);
    expect((ui.find("chart").box!.data as ChartGeometry).message).toContain("too large");
  });
});
