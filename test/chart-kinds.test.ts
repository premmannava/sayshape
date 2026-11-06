/**
 * Chart kinds in their own modules (src/components/chart-kinds/): funnel and
 * waterfall, stacked, area and bullet, and the seam chart.ts hands them through.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { chartHoverAt, type ChartGeometry } from "../src/components/chart";
import { barText, bulletTone, changeText, CHART_KINDS, MAX_BULLET_ROWS, MAX_FUNNEL_STAGES, pairText, type AreaGeometry, type BulletGeometry, type FunnelGeometry, type StackedGeometry, type WaterfallGeometry } from "../src/components/chart-kinds";
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
    expect(guide).toContain("kind=<bar|hbar|line|area|stacked|pie|donut|funnel|waterfall|bullet>");
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

const SALES = `[{m: "Jan", hw: 12000, sw: 8000, sv: 4000}, {m: "Feb", hw: 14000, sw: 9000, sv: 5000}, {m: "Mar", hw: 11000, sw: 11000, sv: 6000}]`;
const stackedChart = (rows: string, extra = "", width = 600) => render(`state rows=${rows}\nchart "Revenue" kind=stacked items=rows x=m y=hw,sw,sv ${extra}\n`, { width });
const areaChart = (rows: string, y = "v", extra = "", width = 600) => render(`state rows=${rows}\nchart "Visits" kind=area items=rows x=w y=${y} ${extra}\n`, { width });

describe("stacked", () => {
  it("parses with several fields and labels, like bar", () => {
    expect(msgs(`state rows=${SALES}\nchart kind=stacked items=rows x=m y=hw,sw,sv labels="Hardware,Software,Services" format=money`)).toEqual([]);
    expect(msgs(`state rows=${SALES}\nchart kind=stacked items=rows x=m y=hw,sw labels="One"`)[0]).toMatch(/labels has 1 names for 2 y fields/);
    expect(msgs(`state rows=${SALES}\nchart kind=stacked items=rows x=m y=a,b,c,d,e,f,g`)[0]).toMatch(/at most 6 series/);
  });

  it("piles each item's fields into one bar, bottom up in the order written", () => {
    const d = geo(stackedChart(SALES));
    const s = d.custom as StackedGeometry;
    const jan = s.bars[0]!;
    expect(jan.map((g) => g.series)).toEqual([0, 1, 2]);
    // Each segment sits on the one before it, and the heights follow the values.
    expect(jan[1]!.rect.y + jan[1]!.rect.h).toBeCloseTo(jan[0]!.rect.y, 5);
    expect(jan[1]!.rect.h / jan[0]!.rect.h).toBeCloseTo(8 / 12, 5);
    expect(jan.map((g) => g.end)).toEqual([false, false, true]);
    expect(d.slots[0]!.value).toBe(24000);
    expect(d.legend.map((l) => l.label)).toEqual(["hw", "sw", "sv"]);
  });

  it("shows each total above its bar, and every part in the tooltip", () => {
    const ui = stackedChart(SALES, `labels="Hardware,Software,Services" format=money`);
    const d = geo(ui);
    expect((d.custom as StackedGeometry).totals).toEqual(["$24K", "$28K", "$28K"]);
    expect(d.slots[0]!.notes).toEqual(["Hardware: $12,000.00", "Software: $8,000.00", "Services: $4,000.00", "Total: $24,000.00"]);
    expect(d.slots[0]!.noteSeries).toEqual([0, 1, 2, null]);
    const bar = d.slots[1]!.bar!;
    expect(chartHoverAt(d, bar.x + bar.w / 2, bar.y + 2)).toEqual({ kind: "slot", index: 1 });
  });

  it("stacks negative values down from 0, never into the positives", () => {
    const d = geo(stackedChart(`[{m: "Q1", hw: 10, sw: -4, sv: 3}]`));
    const segs = (d.custom as StackedGeometry).bars[0]!;
    const neg = segs.find((g) => !g.up)!;
    expect(neg.series).toBe(1);
    expect(neg.rect.y).toBeCloseTo(d.zeroY!, 5);
    expect(segs.filter((g) => g.up).map((g) => g.series)).toEqual([0, 2]);
    expect(d.slots[0]!.value).toBe(9);
  });

  it("leaves a missing field out of its bar, never 0, and says so", () => {
    const ui = stackedChart(`[{m: "Jan", hw: 5, sv: 2}, {m: "Feb", hw: 4, sw: 1, sv: 2}]`);
    expect((geo(ui).custom as StackedGeometry).bars[0]!.map((g) => g.series)).toEqual([0, 2]);
    expect(ui.warnings.join()).toMatch(/1 of 2 items have no number in their sw field/);
  });

  it("says so when there's nothing to chart or no room", () => {
    expect(geo(stackedChart(`[]`)).message).toBe("No data to chart");
    const many = `[${Array.from({ length: 60 }, (_v, i) => `{m: "M${i}", hw: ${i}, sw: 1, sv: 1}`).join(", ")}]`;
    expect(geo(stackedChart(many, "", 240)).message).toMatch(/Too narrow/);
  });
});

describe("area", () => {
  const VISITS = `[{w: "W1", v: 30, l: 20}, {w: "W2", v: 40, l: 25}, {w: "W3", v: 35, l: 30}]`;

  it("parses with one or several fields", () => {
    expect(msgs(`state rows=${VISITS}\nchart kind=area items=rows x=w y=v`)).toEqual([]);
    expect(msgs(`state rows=${VISITS}\nchart kind=area items=rows x=w y=v,l labels="This year,Last year"`)).toEqual([]);
  });

  it("keeps 0 on the scale, so the fill is true to the amounts", () => {
    const d = geo(areaChart(`[{w: "W1", v: 90}, {w: "W2", v: 95}, {w: "W3", v: 100}]`));
    expect(d.min).toBe(0);
    expect(d.zeroY).not.toBeNull();
  });

  it("draws one run per series, broken at gaps", () => {
    const d = geo(areaChart(`[{w: "W1", v: 3}, {w: "W2", v: 4}, {w: "W3"}, {w: "W4", v: 5}, {w: "W5", v: 6}]`));
    const runs = (d.custom as AreaGeometry).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.map((r) => r.length)).toEqual([2, 2]);
  });

  it("names several series in a legend and the tooltip", () => {
    const d = geo(areaChart(VISITS, "v,l", `labels="This year,Last year"`));
    expect(d.legend.map((l) => l.label)).toEqual(["This year", "Last year"]);
    expect(d.slots[1]!.notes).toEqual(["This year: 40", "Last year: 25"]);
    const col = d.slots[1]!.bars![0]!;
    expect(chartHoverAt(d, col.x + col.w / 2, col.y + col.h / 2)).toEqual({ kind: "slot", index: 1 });
    expect(geo(areaChart(VISITS)).legend).toEqual([]);
  });

  it("draws a placeholder like a line while the data loads", () => {
    const ui = render(`chart "V" kind=area items=rows x=w y=v\n`);
    ui.sayshape.setLoading(["rows"]);
    ui.sayshape.renderNow();
    expect(geo(ui).loading).toBeDefined();
    expect(geo(ui).kind).toBe("line");
    ui.destroy();
  });
});

describe("bullet", () => {
  const KPIS = `[{name: "Revenue", actual: 1240000, goal: 1150000}, {name: "New customers", actual: 182, goal: 200}, {name: "Expansion", actual: 310000, goal: 400000}]`;
  const bullet = (rows: string, extra = "", width = 600) =>
    render(`state rows=${rows}\nchart "Q3 targets" kind=bullet items=rows x=name y=actual target=goal ${extra}\n`, { width });

  it("parses with target= and good=, and warns about them elsewhere", () => {
    expect(msgs(`state rows=${KPIS}\nchart kind=bullet items=rows x=name y=actual target=goal`)).toEqual([]);
    expect(msgs(`state rows=${KPIS}\nchart kind=bullet items=rows x=name y=actual target=goal good=down format=money`)).toEqual([]);
    expect(msgs(`state rows=${KPIS}\nchart kind=bullet items=rows x=name y=actual`)[0]).toMatch(/kind=bullet .* has no target=\. Add target=/);
    expect(msgs(`state rows=${KPIS}\nchart kind=bar items=rows x=name y=actual target=goal`)[0]).toMatch(/target= marks each item's goal on kind=bullet only/);
    expect(msgs(`state rows=${KPIS}\nchart kind=bar items=rows x=name y=actual good=down`)[0]).toMatch(/good= says which side .* kind=bullet only/);
    expect(msgs(`state rows=${KPIS}\nchart kind=bullet items=rows x=name y=actual,goal target=goal`)[0]).toMatch(/kind=bullet shows one field/);
  });

  it("teaches target= and good= in the model guide", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain("bullet gives each item a row with its bar against the goal");
    expect(guide).toContain("target=");
    expect(guide).toContain("good=");
  });

  it("draws a row per item, in list order, with the bar and the target on the row's own scale", () => {
    const ui = bullet(KPIS);
    const b = geo(ui).custom as BulletGeometry;
    expect(b.rows.map((r) => r.name)).toEqual(["Revenue", "New customers", "Expansion"]);
    for (let i = 1; i < b.rows.length; i++) expect(b.rows[i]!.track.y).toBeGreaterThan(b.rows[i - 1]!.track.y);
    // The larger of actual and target sits at the same place on every row.
    expect(b.rows[0]!.actual).toBeCloseTo(1 / 1.15);
    expect(b.rows[1]!.target).toBeCloseTo(1 / 1.15);
    expect(b.rows[1]!.actual! / b.rows[1]!.target!).toBeCloseTo(182 / 200);
    expect(ui.warnings).toEqual([]);
  });

  it("colors each row by how it's doing against its target", () => {
    const b = geo(bullet(KPIS)).custom as BulletGeometry;
    expect(b.rows.map((r) => r.tone)).toEqual(["good", "warn", "bad"]);
    expect(bulletTone(100, 100, false)).toBe("good");
    expect(bulletTone(85, 100, false)).toBe("warn");
    expect(bulletTone(84, 100, false)).toBe("bad");
    expect(bulletTone(5, null, false)).toBe("accent");
  });

  it("turns good round with good=down, for costs where under the target is good", () => {
    const costs = `[{name: "Cloud", actual: 84, goal: 90}, {name: "Hours", actual: 110, goal: 100}, {name: "Churn", actual: 4, goal: 3}]`;
    const b = geo(bullet(costs, "good=down")).custom as BulletGeometry;
    expect(b.rows.map((r) => r.tone)).toEqual(["good", "warn", "bad"]);
  });

  it("reads each row as actual of target, telling close numbers apart", () => {
    const ui = bullet(KPIS, "format=money");
    expect(texts(ui)).toEqual(expect.arrayContaining(["Revenue", "$1.24M of $1.15M", "$182 of $200", "$310K of $400K"]));
    expect(pairText(310000, 400000, "number")).toBe("310K of 400K");
    expect(pairText(1000, 1000, "number")).toBe("1,000 of 1,000");
    expect(pairText(1000001, 1000002, "number")).toBe("1,000,001 of 1,000,002");
  });

  it("puts actual, target and the share of it in the tooltip, for the whole row", () => {
    const d = geo(bullet(KPIS, "format=money"));
    expect(d.slots[1]!.notes).toEqual(["Actual: $182.00", "Target: $200.00", "91% of target"]);
    const row = d.slots[2]!.bars![0]!;
    expect(chartHoverAt(d, row.x + 4, row.y + row.h / 2)).toEqual({ kind: "slot", index: 2 });
    expect(d.noHoverOutline).toBe(true);
  });

  it("shows a missing actual as a gap and a missing target as unjudged", () => {
    const ui = bullet(`[{name: "A", actual: 10, goal: 12}, {name: "B", goal: 5}, {name: "C", actual: 7}]`);
    const b = geo(ui).custom as BulletGeometry;
    expect(b.rows[1]!.actual).toBeNull();
    expect(b.rows[1]!.detail).toBe("—");
    expect(b.rows[2]!.target).toBeNull();
    expect(b.rows[2]!.tone).toBe("accent");
    expect(b.rows[2]!.detail).toBe("7");
    expect(ui.warnings.join()).toMatch(/1 of 3 items have no number/);
  });

  it("says so for negative values, too many rows, or a target field nothing has", () => {
    expect(geo(bullet(`[{name: "A", actual: -1, goal: 5}]`)).message).toBe("A bullet chart can't show negative values");
    const many = `[${Array.from({ length: MAX_BULLET_ROWS + 1 }, (_v, i) => `{name: "K${i}", actual: ${i + 1}, goal: 10}`).join(", ")}]`;
    const tooMany = bullet(many);
    expect(geo(tooMany).message).toMatch(/at most 20/);
    expect(tooMany.warnings.join()).toMatch(/take\(\)/);
    expect(bullet(`[{name: "A", actual: 3}]`).warnings.join()).toMatch(/no item has a number in its goal field/);
    expect(geo(bullet(`[]`)).message).toBe("No data to chart");
  });

  it("stacks names above the bars at narrow widths and keeps everything inside the box", () => {
    for (const width of [240, 360, 600]) {
      const ui = bullet(`[{name: "Net revenue retention across every region", actual: 96, goal: 110}, {name: "NPS", actual: 41, goal: 40}]`, "", width);
      const b = geo(ui).custom as BulletGeometry;
      const w = ui.find("chart").box!.w;
      for (const r of b.rows) {
        expect(r.track.x + r.track.w).toBeLessThanOrEqual(w + 0.5);
        expect(r.track.w).toBeGreaterThan(0);
        if (w < 360) expect(r.track.y).toBeGreaterThan(r.detailY);
        else expect(r.track.x).toBeGreaterThan(0);
      }
      ui.destroy();
    }
  });

  it("draws a placeholder like hbar while the data loads", () => {
    const ui = render(`chart "K" kind=bullet items=rows x=name y=actual target=goal\n`);
    ui.sayshape.setLoading(["rows"]);
    ui.sayshape.renderNow();
    expect(geo(ui).kind).toBe("hbar");
    ui.destroy();
  });
});
