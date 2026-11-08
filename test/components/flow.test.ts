import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { flow, MAX_FLOW_NODES, type FlowGeometry } from "../../src/components/flow";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";

// The contract tests already check the definition, layout bounds, text that
// fits at 240, 360 and 600 px, theme-only colors and keyboard reach.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const geo = (ui: Rendered): FlowGeometry => ui.find("flow").box!.data as unknown as FlowGeometry;
const node = (d: FlowGeometry, label: string) => d.nodes.find((n) => n.label === label)!;

const CLAIM = `state picked="" steps=[{id: "fnol", label: "Claim filed", kind: "start", next: "triage"}, {id: "triage", label: "Triage", next: "small"}, {id: "small", label: "Under $5,000?", kind: "decision", next: "auto,adjuster"}, {id: "auto", label: "Approve automatically", next: "pay"}, {id: "adjuster", label: "Adjuster inspects", next: "fraud"}, {id: "fraud", label: "Fraud signals?", kind: "decision", next: ["siu", "approve"]}, {id: "siu", label: "Investigate", next: "adjuster"}, {id: "approve", label: "Manager approves", next: "pay"}, {id: "pay", label: "Pay out", kind: "end"}]
state edges=[{from: "small", to: "auto", label: "Yes"}, {from: "small", to: "adjuster", label: "No"}, {from: "siu", to: "adjuster", label: "Cleared"}]`;
const DOWN = `${CLAIM}\nflow "Claims" items=steps edges=edges bind=picked on=emit:picked\n`;
const RIGHT = `state steps=[{id: 1, label: "Signed", kind: "start", next: 2}, {id: 2, label: "Kickoff", next: 3}, {id: 3, label: "Live", kind: "end"}]\nflow items=steps direction=right\n`;

/** Whether a segment of an arrow passes through a box (not its own ends). */
function crosses(d: FlowGeometry): string[] {
  const out: string[] = [];
  for (const e of d.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i]!, b = e.points[i + 1]!;
      for (const n of d.nodes) {
        if (n === e.from || n === e.to) continue;
        const l = Math.min(a.x, b.x), r = Math.max(a.x, b.x), t = Math.min(a.y, b.y), bt = Math.max(a.y, b.y);
        if (r > n.x + 1 && l < n.x + n.w - 1 && bt > n.y + 1 && t < n.y + n.h - 1) out.push(`${e.from.label}→${e.to.label} through ${n.label}`);
      }
    }
  }
  return out;
}

describe("flow", () => {
  it("renders its example and the samples without problems, and is in the guide", () => {
    expect(msgs(flow.example!)).toEqual([]);
    for (const s of [DOWN, RIGHT]) {
      const ui = render(s, { width: 1024 });
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
    }
    expect(languageGuide(registry)).toContain("flow items=steps next=next kind=kind");
  });

  it("warns about bad props but keeps the element", () => {
    const m = msgs(`state s=[]\nflow items=s direction=up colour=red`);
    expect(m.some((x) => x.includes("direction"))).toBe(true);
    expect(m.some((x) => x.includes("colour"))).toBe(true);
  });

  it("puts each step a layer after the furthest step leading to it, and shapes steps by kind", () => {
    const d = geo(render(DOWN, { width: 1024 }));
    const layer = (l: string) => node(d, l).layer;
    expect([layer("Claim filed"), layer("Triage"), layer("Under $5,000?"), layer("Approve automatically"), layer("Adjuster inspects"), layer("Fraud signals?"), layer("Pay out")]).toEqual([0, 1, 2, 3, 3, 4, 6]);
    expect(node(d, "Under $5,000?").kind).toBe("decision");
    expect(node(d, "Pay out").kind).toBe("end");
    // Down: each layer below the one before.
    expect(node(d, "Triage").y).toBeGreaterThan(node(d, "Claim filed").y + node(d, "Claim filed").h);
  });

  it("finds the loop back, draws it as a back arrow, and keeps it out of the layering", () => {
    const d = geo(render(DOWN, { width: 1024 }));
    const backs = d.edges.filter((e) => e.back);
    expect(backs.map((e) => `${e.from.label}→${e.to.label}`)).toEqual(["Investigate→Adjuster inspects"]);
  });

  it("never runs an arrow through a box, down or right", () => {
    expect(crosses(geo(render(DOWN, { width: 1024 })))).toEqual([]);
    expect(crosses(geo(render(DOWN, { width: 390 })))).toEqual([]);
    expect(crosses(geo(render(DOWN.replace("edges=edges", "edges=edges direction=right"), { width: 1400 })))).toEqual([]);
  });

  it("labels arrows from edges=", () => {
    const d = geo(render(DOWN, { width: 1024 }));
    expect(d.edges.filter((e) => e.label).map((e) => e.label).sort()).toEqual(["Cleared", "No", "Yes"]);
    for (const e of d.edges.filter((x) => x.label)) expect(e.labelAt).toBeDefined();
  });

  it("runs right when asked, and turns down on a narrow screen when it doesn't fit", () => {
    const wide = geo(render(RIGHT, { width: 1024 }));
    expect(wide.direction).toBe("right");
    expect(node(wide, "Kickoff").x).toBeGreaterThan(node(wide, "Signed").x + node(wide, "Signed").w);
    expect(geo(render(RIGHT, { width: 300 })).direction).toBe("down");
  });

  it("selects a step: sets bind= to its id, then runs on=", () => {
    const ui = render(DOWN, { width: 1024 });
    const r = ui.hits.find((h) => h.detail === "step:adjuster")!;
    ui.click(r.box.x + r.box.w / 2, r.box.y + r.box.h / 2);
    expect(ui.state.picked).toBe("adjuster");
    expect(ui.emitted.map((e) => e.name)).toEqual(["picked"]);
  });

  it("is a list of steps saying where each leads, and copies as one line per step", () => {
    const lines = render(DOWN, { width: 1024 }).copyText().split("\n");
    expect(lines).toContain("Claims");
    expect(lines).toContain("- Under $5,000? leads to Approve automatically (Yes), Adjuster inspects (No)");
    expect(lines).toContain("- Investigate leads to Adjuster inspects (Cleared)");
    expect(lines).toContain("- Pay out");
    // Steps in layer order.
    expect(lines.indexOf("- Claim filed leads to Triage")).toBeLessThan(lines.indexOf("- Pay out"));
  });

  it("warns about arrows to steps that aren't there, and shows a message instead of too many", () => {
    const ui = render(`state s=[{id: "a", label: "A", next: "b,zz"}, {id: "b", label: "B"}]\nflow items=s`);
    expect(geo(ui).edges.length).toBe(1);
    expect(ui.warnings.join(" ")).toContain("zz");
    const many = Array.from({ length: MAX_FLOW_NODES + 1 }, (_, i) => `{id: ${i}, label: "S${i}", next: ${i + 1}}`).join(", ");
    expect(geo(render(`state s=[${many}]\nflow items=s`)).message).toContain("Too many steps");
  });

  it("handles a loop of one step and a cycle with no start without throwing", () => {
    expect(() => render(`state s=[{id: "a", label: "A", next: "a"}]\nflow items=s`)).not.toThrow();
    const d = geo(render(`state s=[{id: "a", label: "A", next: "b"}, {id: "b", label: "B", next: "a"}]\nflow items=s`));
    expect(d.edges.filter((e) => e.back).length).toBe(1);
  });

  it("lays out at every width inside its box", () => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = render(DOWN, { width });
      const box = ui.find("flow").box!;
      expect(box.w).toBeLessThanOrEqual(width);
      for (const n of geo(ui).nodes) expect(n.y + n.h).toBeLessThanOrEqual(box.h);
    }
  });

  it("never throws on odd data, and every streamed prefix renders", () => {
    for (const odd of [`items=5`, `items={[null, "x", {id: {a: 1}}]}`, `items=nope`, ``, `items={[{id: 1, next: {x: 2}}]}`]) {
      expect(() => render(`flow ${odd}`)).not.toThrow();
    }
    const lines = DOWN.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("flow, after review", () => {
  it("keeps a back arrow into the first step inside the flow, under the title", () => {
    const ui = render(`state s=[{id: "a", label: "Start", next: "b"}, {id: "b", label: "Check", next: "a,c"}, {id: "c", label: "Again", next: "a"}]\nflow "Loop" items=s`, { width: 600 });
    const d = geo(ui);
    for (const e of d.edges) for (const pt of e.points) expect(pt.y).toBeGreaterThanOrEqual(d.top);
    expect(crosses(d)).toEqual([]);
  });

  it("never runs a back arrow along a forward one", () => {
    const d = geo(render(DOWN, { width: 1024 }));
    const back = d.edges.find((e) => e.back)!;
    const into = back.points[back.points.length - 1]!;
    for (const e of d.edges.filter((x) => !x.back && x.to === back.to)) {
      const end = e.points[e.points.length - 1]!;
      expect(Math.abs(end.x - into.x) + Math.abs(end.y - into.y)).toBeGreaterThan(8);
    }
  });

  it("leaves a step's arrows in the order their targets sit, so they don't cross", () => {
    const d = geo(render(`state s=[{id: "s", label: "Split", next: "c,a"}, {id: "a", label: "Left"}, {id: "c", label: "Right"}]\nflow items=s`, { width: 600 }));
    const outs = d.edges.filter((e) => e.from.label === "Split");
    const startX = (label: string) => outs.find((e) => e.to.label === label)!.points[0]!.x;
    const targetX = (label: string) => node(d, label).x;
    expect(Math.sign(startX("Right") - startX("Left"))).toBe(Math.sign(targetX("Right") - targetX("Left")));
  });

  it("puts a straight arrow's label by its middle, not on the arrowhead", () => {
    const d = geo(render(`state s=[{id: "a", label: "A", next: "b"}, {id: "b", label: "B"}]\nstate e=[{from: "a", to: "b", label: "Then"}]\nflow items=s edges=e`, { width: 600 }));
    const e = d.edges[0]!;
    expect(e.labelAt!.y).toBeLessThan(e.points[1]!.y - 4);
  });

  it("warns about duplicate ids, unknown kinds, labels for arrows that aren't there, and items that aren't records", () => {
    const ui = render(`state s=[{id: "a", label: "A", kind: "Decision", next: "b"}, {id: "a", label: "Again"}, {id: "b", label: "B"}, 5]\nstate e=[{from: "b", to: "a", label: "No"}]\nflow items=s edges=e`);
    const w = ui.warnings.join(" | ");
    expect(w).toContain(`kind "Decision" isn't known`);
    expect(w).toContain("more than one step has the id a");
    expect(w).toContain("b to a");
    expect(w).toContain("item 4 isn't a record");
  });

  it("keeps ids with any characters apart", () => {
    const d = geo(render(`state s=[{id: "a>b", label: "One", next: "c"}, {id: "a", label: "Two", next: "b>c"}, {id: "c", label: "Three"}, {id: "b>c", label: "Four"}]\nstate e=[{from: "a>b", to: "c", label: "x"}]\nflow items=s edges=e`, { width: 600 }));
    expect(d.edges.filter((e) => e.label === "x").map((e) => e.from.label)).toEqual(["One"]);
  });

  it("runs right when that fits, and down when right is too wide and down is narrower", () => {
    const long = Array.from({ length: 12 }, (_, i) => `{id: ${i}, label: "Step ${i}", next: ${i + 1}}`).join(", ");
    expect(geo(render(`state s=[${long}]\nflow items=s direction=right`, { width: 700 })).direction).toBe("down");
  });

  it("opens a wide flow on its first step, and only scrolls when it's really too wide", () => {
    const ui = render(DOWN, { width: 390 });
    const d = geo(ui);
    const first = d.nodes[0]!;
    const x = first.x - (d.scrolled ?? 0);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + first.w).toBeLessThanOrEqual(390);
    const scrollHit = ui.hits.some((h) => h.detail === "scroll:area");
    expect(scrollHit).toBe(d.contentW - d.viewW > 0.5);
  });
});
