/**
 * Layers on a bar or line chart: lines written under the chart that add to it.
 *
 *   chart "Revenue" kind=bar items=months x=month y=revenue format=money
 *     chart-line "Forecast" y=forecast
 *     chart-rule "Target" y=50000
 *     chart-note "Launch" at="Jun"
 *
 * chart-line draws another field of the same items as a line over the bars or
 * lines, chart-rule a level across the plot, chart-note a marker at one item.
 * Like table-column, they have no box of their own: the chart reads them,
 * fits its scale to them and draws them. Colors come from the theme.
 */
import type { ComponentDef, LayoutContext, PropReader } from "../component";
import type { SayShapeNode } from "../types";
import type { ChartGeometry, ChartLayers, Format, PaintCtx, SeriesData } from "./chart-kit";
import { numberAt, traceSmoothLine, valueText } from "./chart-kit";
import { isList } from "../data";
import type { Value } from "../types";

/** The most layers of each sort a chart draws; the rest are left out with a warning. */
export const MAX_CHART_LAYERS = 4;

export const LAYER_TYPES = ["chart-line", "chart-rule", "chart-note"] as const;

const leaf = {
  category: "data",
  parents: ["chart"],
  // No box of its own: the chart draws it and describes it.
  semantics: () => null,
  layout(box) { box.h = 0; },
} satisfies Partial<ComponentDef>;

export const chartLine: ComponentDef = {
  ...leaf,
  type: "chart-line",
  description: "Under a bar or line chart: another field of the same items drawn as a line on top, on the same scale, such as a forecast or last year over this year's bars.",
  text: { description: "Its name in the legend. Defaults to the field name." },
  props: {
    y: { type: "name", required: true, description: "The field holding each item's number, e.g. y=forecast." },
  },
  example: `chart-line "Forecast" y=forecast`,
};

export const chartRule: ComponentDef = {
  ...leaf,
  type: "chart-rule",
  description: "Under a bar or line chart: a level drawn across the plot, such as a target, a budget or an average.",
  text: { description: "What the level is, shown at its end, e.g. \"Target\"." },
  props: {
    y: { type: "expression", required: true, description: "The level, a number or a formula, e.g. y=50000 or y={avg(pluck(sales, 'revenue'))}." },
  },
  example: `chart-rule "Target" y=50000`,
};

export const chartNote: ComponentDef = {
  ...leaf,
  type: "chart-note",
  description: "Under a bar or line chart: a marker at one item with a few words, such as a launch or an outage.",
  text: { description: "The words, kept short, e.g. \"Launch\".", required: true },
  props: {
    at: { type: "string", required: true, description: "The item it marks: its x value as shown under the chart, e.g. at=\"Jun\"." },
  },
  example: `chart-note "Launch" at="Jun"`,
};

/** What a chart's layer lines ask for, read from its children. */
export interface LayerInput {
  lines: Array<{ field: string; label: string; values: Array<number | null> }>;
  rules: Array<{ value: number; label: string }>;
  notes: Array<{ at: string; label: string }>;
}

/** Read a chart's layer lines. Problems are warnings; a bad layer is left out. */
export function readLayers(
  kids: readonly SayShapeNode[], items: Value | undefined, props: (n: SayShapeNode) => PropReader, line: number, warn?: LayoutContext["warn"],
): LayerInput | null {
  const out: LayerInput = { lines: [], rules: [], notes: [] };
  const list = isList(items) ? items : [];
  const full = (what: string) => warn?.(`chart on line ${line}: at most ${MAX_CHART_LAYERS} ${what} are drawn; the rest were left out`);
  for (const k of kids) {
    const p = props(k);
    if (k.type === "chart-line") {
      if (out.lines.length >= MAX_CHART_LAYERS) { full("chart-line lines"); continue; }
      const field = p.str("y");
      const values = list.map((item) => numberAt(item, field));
      if (!values.some((v) => v !== null)) { warn?.(`chart-line on line ${k.line}: no item has a number in ${field || "y"}, so it isn't drawn. y= names a field of the chart's items, like y=forecast`); continue; }
      out.lines.push({ field, label: p.text() || field, values });
    } else if (k.type === "chart-rule") {
      if (out.rules.length >= MAX_CHART_LAYERS) { full("chart-rule lines"); continue; }
      const v = p.expr("y");
      const value = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(value)) { warn?.(`chart-rule on line ${k.line}: y isn't a number, so it isn't drawn. Write a number or a formula, like y=50000`); continue; }
      out.rules.push({ value, label: p.text() });
    } else if (k.type === "chart-note") {
      if (out.notes.length >= MAX_CHART_LAYERS) { full("chart-note lines"); continue; }
      out.notes.push({ at: p.str("at"), label: p.text() });
    }
  }
  return out.lines.length || out.rules.length || out.notes.length ? out : null;
}

/** Every number the layers add, so the chart's scale makes room for them. */
export function layerValues(l: LayerInput | null): number[] {
  if (!l) return [];
  return [...l.lines.flatMap((x) => x.values.flatMap((v) => (v === null ? [] : [v]))), ...l.rules.map((r) => r.value)];
}

/** Place the layers on a chart's plot. `first` is the color index after the chart's own series. */
export function placeLayers(
  l: LayerInput, d: SeriesData, slots: ChartGeometry["slots"], y: (v: number) => number,
  first: number, format: Format, line: number, warn?: LayoutContext["warn"],
): ChartLayers {
  const lines = l.lines.map((ln, i) => {
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    slots.forEach((s, k) => {
      const v = ln.values[k] ?? null;
      if (v !== null) run.push({ x: s.cx, y: y(v) });
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    return { label: ln.label, field: ln.field, color: first + i, runs, values: ln.values };
  });
  const rules = l.rules.map((r) => ({ y: y(r.value), value: r.value, label: r.label, text: r.label ? `${r.label} ${valueText(r.value, format)}` : valueText(r.value, format) }));
  const notes = l.notes.flatMap((n) => {
    const i = d.slots.findIndex((s) => s.label === n.at);
    if (i < 0) {
      warn?.(`chart on line ${line}: chart-note at="${n.at}" matches no item, so it isn't drawn. at= is an item's x value as shown, like at="${d.slots[0]?.label ?? "Jan"}"`);
      return [];
    }
    return [{ x: slots[i]!.cx, index: i, label: n.label }];
  });
  return { lines, rules, notes };
}

/** Draw a chart's layers over its bars or lines. */
export function paintLayers(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, colorAt: (k: number) => string, reveal: number): void {
  const L = d.layers;
  if (!L) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const left = ox + d.plot.x, right = ox + d.plot.x + d.plot.w, top = oy + d.plot.y, bottom = oy + d.plot.y + d.plot.h;
  g.save();
  g.globalAlpha *= Math.min(1, reveal * 2);

  // Notes first, behind everything: a quiet upright line with its words at the top.
  g.font = d.labelFont;
  g.textBaseline = "top";
  for (const n of L.notes) {
    const x = ox + n.x;
    g.beginPath();
    g.setLineDash([3, 3]);
    g.moveTo(x, top);
    g.lineTo(x, bottom);
    g.lineWidth = 1;
    g.strokeStyle = c.muted;
    g.stroke();
    g.setLineDash([]);
    // Cut to half the plot at most, so a long note can't run off the chart.
    const room = Math.max(24, d.plot.w / 2);
    let words = n.label;
    if (g.measureText(words).width > room) {
      while (words.length > 1 && g.measureText(words + "…").width > room) words = words.slice(0, -1);
      words += "…";
    }
    const w = g.measureText(words).width;
    const onLeft = x + 6 + w > right;
    g.textAlign = onLeft ? "right" : "left";
    g.fillStyle = c.ink;
    g.fillText(words, onLeft ? x - 6 : x + 6, top + 2);
  }

  // Levels: a dashed line across, named at its right end.
  g.textBaseline = "bottom";
  for (const r of L.rules) {
    const y = oy + r.y;
    g.beginPath();
    g.setLineDash([6, 4]);
    g.moveTo(left, y);
    g.lineTo(right, y);
    g.lineWidth = 1.5;
    g.strokeStyle = c.ink;
    g.stroke();
    g.setLineDash([]);
    g.font = d.labelFont;
    g.textAlign = "right";
    g.fillStyle = c.ink;
    // Above the line, or below it when the line is at the top of the plot.
    const above = y - top >= 16;
    g.textBaseline = above ? "bottom" : "top";
    g.fillText(r.text, right - 2, above ? y - 3 : y + 3);
  }

  // Lines over the bars, each in its own series color, with a dot on every point.
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const ln of L.lines) {
    const color = colorAt(ln.color);
    for (const run of ln.runs) {
      if (run.length >= 2) {
        g.beginPath();
        traceSmoothLine(g, run, ox, oy);
        g.strokeStyle = color;
        g.lineWidth = 2.25;
        g.stroke();
      }
      for (const pt of run) {
        g.beginPath();
        g.arc(ox + pt.x, oy + pt.y, 2.75, 0, Math.PI * 2);
        g.fillStyle = c.raised;
        g.fill();
        g.lineWidth = 1.75;
        g.strokeStyle = color;
        g.stroke();
      }
    }
  }
  g.restore();
}

/** The layers in words, for screen readers and copied text. */
export function layersSummary(L: ChartLayers | undefined, say: (n: number) => string): string {
  if (!L) return "";
  const parts: string[] = [];
  for (const r of L.rules) parts.push(`${r.label || "Level"}: ${say(r.value)}.`);
  for (const n of L.notes) parts.push(`${n.label} at item ${n.index + 1}.`);
  return parts.length ? " " + parts.join(" ") : "";
}
