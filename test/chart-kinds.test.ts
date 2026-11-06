/**
 * Chart kinds in their own modules (src/components/chart-kinds/): funnel and
 * waterfall, and the seam chart.ts hands them through.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { chartHoverAt, type ChartGeometry } from "../src/components/chart";
import { barText, changeText, CHART_KINDS, MAX_FUNNEL_STAGES, type FunnelGeometry, type WaterfallGeometry } from "../src/components/chart-kinds";
import { KINDS } from "../src/components/chart-kit";
import { parse } from "../src/parser";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";

const registry = new Registry(coreComponents);
const geo = (ui: Rendered): ChartGeometry => ui.find("chart").box!.data as ChartGeometry;
const texts = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);

const STAGES = `[{stage: "Leads", n: 1200}, {stage: "Qualified", n: 640}, {stage: "Proposal", n: 310}, {stage: "Won", n: 120}]`;
const STEPS = `[{step: "Revenue", amt: 480000}, {step: "Costs", amt: -190000}, {step: "Salaries", amt: -140000}, {step: "Other", amt: 22000}]`;
const funnel = (rows: string, extra = "", width = 600) => render(`state rows=${rows}\nchart "Pipeline" kind=funnel items=rows x=stage y=n ${extra}\n`, { width });
const waterfall = (rows: string, extra = "", width = 600) => render(`state rows=${rows}\nchart "Net" kind=waterfall items=rows x=step y=amt ${extra}\n`, { width });

describe("the kind seam", () => {
  it("registers every module kind under a name chart's kind= accepts", () => {
    for (const k of Object.keys(CHART_KINDS)) expect(KINDS).toContain(k);
  });

  it("teaches the new kinds in the model guide", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain("kind=<bar|hbar|line|pie|donut|funnel|waterfall>");
    expect(guide).toContain("funnel shows stages top to bottom");
    expect(guide).toContain("waterfall shows each item as a change");
    expect(guide).toContain("total=");
  });

  it("parses both kinds with no problems", () => {
    expect(msgs(`state rows=${STAGES}\nchart "P" kind=funnel items=rows x=stage y=n`)).toEqual([]);
    expect(msgs(`state rows=${STEPS}\nchart "N" kind=waterfall items=rows x=step y=amt total="Net" format=money`)).toEqual([]);
  });

  it("warns, line by line, about props that don't fit the kind", () => {
    expect(msgs(`state rows=${STAGES}\nchart kind=funnel items=rows x=stage y=n,m`)[0]).toMatch(/kind=funnel shows one field, so only y=n is used/);
    expect(msgs(`state rows=${STAGES}\nchart kind=funnel items=rows x=stage y=n labels="A"`)[0]).toMatch(/a funnel's items are named by x=/);
    expect(msgs(`state rows=${STAGES}\nchart kind=bar items=rows x=stage y=n total="All"`)[0]).toMatch(/total= adds a final bar to kind=waterfall only/);
  });

  it("draws a placeholder of a related kind while the data loads", () => {
    const ui = render(`chart "P" kind=funnel items=rows x=stage y=n\n`);
    ui.sayshape.setLoading(["rows"]);
    ui.sayshape.renderNow();
    expect(geo(ui).loading).toBeDefined();
    expect(geo(ui).kind).toBe("hbar");
    ui.destroy();
  });
});

describe("funnel", () => {
  it("draws one band per stage, top to bottom in list order, widths following the values", () => {
    const ui = funnel(STAGES);
    const f = geo(ui).custom as FunnelGeometry;
    expect(f.stages.map((s) => s.label)).toEqual(["Leads", "Qualified", "Proposal", "Won"]);
    for (let i = 1; i < f.stages.length; i++) expect(f.stages[i]!.y).toBeGreaterThan(f.stages[i - 1]!.y);
    expect(f.stages[1]!.top / f.stages[0]!.top).toBeCloseTo(640 / 1200);
    // Each band narrows to the next stage's width; the last is straight.
    expect(f.stages[0]!.bottom).toBeCloseTo(f.stages[1]!.top);
    expect(f.stages[3]!.bottom).toBeCloseTo(f.stages[3]!.top);
    expect(ui.warnings).toEqual([]);
  });

  it("shows each stage's value and its share of the stage before", () => {
    const ui = funnel(STAGES);
    expect(texts(ui)).toEqual(expect.arrayContaining(["Leads", "1,200", "640 · 53%", "310 · 48%", "120 · 39%"]));
    const d = geo(ui);
    expect(d.slots[1]!.notes).toEqual(["640", "53% of Leads"]);
  });

  it("finds the stage under the pointer for the tooltip", () => {
    const d = geo(funnel(STAGES));
    const bar = d.slots[2]!.bars![0]!;
    expect(chartHoverAt(d, bar.x + bar.w / 2, bar.y + bar.h / 2)).toEqual({ kind: "slot", index: 2 });
    expect(d.noHoverOutline).toBe(true);
  });

  it("shows a stage without a number as a gap, never as 0", () => {
    const ui = funnel(`[{stage: "Leads", n: 100}, {stage: "Calls"}, {stage: "Won", n: 20}]`);
    const f = geo(ui).custom as FunnelGeometry;
    expect(f.stages[1]!.top).toBe(0);
    expect(f.stages[1]!.detail).toBe("—");
    // The band before a gap doesn't narrow into nothing.
    expect(f.stages[0]!.bottom).toBeCloseTo(f.stages[0]!.top);
    expect(ui.warnings.join()).toMatch(/1 of 3 stages have no number/);
  });

  it("says so instead of drawing negative values, too many stages, or all zeros", () => {
    expect(geo(funnel(`[{stage: "A", n: 10}, {stage: "B", n: -2}]`)).message).toBe("A funnel can't show negative values");
    const many = `[${Array.from({ length: MAX_FUNNEL_STAGES + 1 }, (_v, i) => `{stage: "S${i}", n: ${100 - i}}`).join(", ")}]`;
    expect(geo(funnel(many)).message).toMatch(/at most 12/);
    expect(geo(funnel(`[{stage: "A", n: 0}, {stage: "B", n: 0}]`)).message).toMatch(/every stage is 0/);
    expect(geo(funnel(`[]`)).message).toBe("No data to chart");
  });

  it("keeps its names and numbers inside the box at narrow widths", () => {
    for (const width of [240, 360]) {
      const ui = funnel(`[{stage: "Leads from every marketing channel", n: 1200}, {stage: "Won", n: 120}]`, "", width);
      const d = geo(ui);
      const f = d.custom as FunnelGeometry | undefined;
      if (!f) { expect(d.message).toBeDefined(); continue; }
      for (const s of f.stages) expect(s.textX).toBeLessThanOrEqual(width);
      ui.destroy();
    }
  });
});

describe("waterfall", () => {
  it("starts each change where the running total stands", () => {
    const ui = waterfall(STEPS, `format=money`);
    const d = geo(ui);
    const bars = d.slots.map((s) => s.bar!);
    // Revenue rises from 0; costs fall from the top of revenue.
    expect(bars[1]!.y).toBeCloseTo(bars[0]!.y, 0);
    expect(bars[1]!.h / bars[0]!.h).toBeCloseTo(190 / 480, 1);
    const w = d.custom as WaterfallGeometry;
    expect(w.bars.map((b) => b!.tone)).toEqual(["up", "down", "down", "up"]);
    expect(w.connectors).toHaveLength(3);
    expect(ui.warnings).toEqual([]);
  });

  it("adds the total as a last bar from 0 when total= names it", () => {
    const d = geo(waterfall(STEPS, `total="Net income" format=money`));
    expect(d.slots.map((s) => s.label)).toEqual(["Revenue", "Costs", "Salaries", "Other", "Net income"]);
    expect(d.slots[4]!.value).toBe(172000);
    expect((d.custom as WaterfallGeometry).bars[4]!.tone).toBe("total");
    expect(d.slots[4]!.notes).toEqual(["Total: $172,000.00"]);
    expect(d.slots[1]!.notes).toEqual(["Change: -$190,000.00", "Running total: $290,000.00"]);
  });

  it("labels bars in one style, signed for changes", () => {
    const ui = waterfall(STEPS, `total="Net" format=money`);
    expect(texts(ui)).toEqual(expect.arrayContaining(["+$480K", "-$190K", "+$22K", "$172K"]));
    expect(changeText(1200, "number")).toBe("+1,200");
    expect(barText(-45000, "money", true)).toBe("-$45K");
  });

  it("draws a total below 0 going down from 0", () => {
    const d = geo(waterfall(`[{step: "Start", amt: 10}, {step: "Loss", amt: -30}]`, `total="Net"`));
    const w = d.custom as WaterfallGeometry;
    expect(w.bars[2]!.rising).toBe(false);
    expect(d.zeroY).not.toBeNull();
  });

  it("carries the total over an item without a number", () => {
    const d = geo(waterfall(`[{step: "A", amt: 10}, {step: "B"}, {step: "C", amt: 5}]`, `total="Net"`));
    expect(d.slots[1]!.bars).toEqual([null]);
    expect(d.slots[3]!.value).toBe(15);
    expect((d.custom as WaterfallGeometry).connectors).toHaveLength(2);
  });

  it("says so when there's nothing to chart or no room", () => {
    expect(geo(waterfall(`[]`)).message).toBe("No data to chart");
    expect(geo(waterfall(`[{step: "A"}]`)).message).toBe("No numbers to chart");
    const many = `[${Array.from({ length: 40 }, (_v, i) => `{step: "S${i}", amt: ${i}}`).join(", ")}]`;
    expect(geo(waterfall(many, "", 240)).message).toMatch(/Too narrow/);
  });
});
