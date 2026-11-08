/**
 * chart kind=scatter: one dot per item at its x and y numbers, for how two
 * numbers relate: risk against return, price against rating.
 *
 *   chart "Funds" kind=scatter items=funds x=risk y=return label=name size=assets group=type format=percent
 *
 * Data rules, like every chart, never invent numbers:
 * - x and y are both numbers, each on its own scale running from its lowest
 *   to its highest value, rounded out to whole ticks (0 isn't forced in).
 * - An item without a number in x or y isn't drawn, and a warning says how
 *   many; label= names each dot in its tip and in the data table.
 * - size= scales each dot's area to a number (bubbles); group= colors dots
 *   by category, in the order groups first appear, at most MAX_SERIES of them,
 *   with a legend.
 * - format= is for y; x reads as a plain number. labels= names the two axes,
 *   x then y, e.g. labels="Risk,Return"; without it they're the field names.
 *
 * It's the one chart a keyboard enters: the dots are a list of options with
 * one Tab stop, the arrow keys move from dot to dot in x order, and the
 * focused dot shows its tip, as the pointer's does. Each group has its own
 * shape as well as its own color, so groups never rest on color alone.
 */
import type { PaintContext } from "../../component";
import { easeOut, staggered } from "../../ghost";
import { fieldOf, isList, isRecord } from "../../data";
import { seriesColors, SERIES_COUNT } from "../../theme";
import type { Value } from "../../types";
import {
  chartScale, fit, flowLegend, header, labelOf, MAX_CHART_ITEMS, numberAt, paintAxisGrid, plotHeight, preciseText, tickLabels,
  type ChartGeometry, type ChartSlot, type Rect,
} from "../chart-kit";
import type { ChartKindDef } from "./types";

/** The most groups (colors) one scatter draws. */
export const MAX_SCATTER_GROUPS = SERIES_COUNT;

export interface ScatterDot {
  /** Centre, relative to the box. */
  x: number;
  y: number;
  r: number;
  /** Index into the series colors, or -1 for the accent (no groups). */
  color: number;
  /** What a screen reader says for it: its label and numbers. */
  name: string;
}

/** Each group's shape, in order: color is never the only cue. */
export const SCATTER_SHAPES = ["circle", "square", "triangle", "diamond", "ring", "cross"] as const;
export type ScatterShape = (typeof SCATTER_SHAPES)[number];
export const shapeOf = (color: number): ScatterShape => (color < 0 ? "circle" : SCATTER_SHAPES[color % SCATTER_SHAPES.length]!);

/** Trace (and fill or stroke) one dot's shape at (x, y) with radius r. */
export function drawDot(g: CanvasRenderingContext2D, shape: ScatterShape, x: number, y: number, r: number, fill: () => void, stroke: () => void): void {
  g.beginPath();
  if (shape === "square") { const a = r * 0.9; g.rect(x - a, y - a, 2 * a, 2 * a); }
  else if (shape === "triangle") { const a = r * 1.15; g.moveTo(x, y - a); g.lineTo(x + a * 0.95, y + a * 0.65); g.lineTo(x - a * 0.95, y + a * 0.65); g.closePath(); }
  else if (shape === "diamond") { const a = r * 1.2; g.moveTo(x, y - a); g.lineTo(x + a, y); g.lineTo(x, y + a); g.lineTo(x - a, y); g.closePath(); }
  else if (shape === "cross") { const a = r, b = r * 0.38; g.moveTo(x - b, y - a); g.lineTo(x + b, y - a); g.lineTo(x + b, y - b); g.lineTo(x + a, y - b); g.lineTo(x + a, y + b); g.lineTo(x + b, y + b); g.lineTo(x + b, y + a); g.lineTo(x - b, y + a); g.lineTo(x - b, y + b); g.lineTo(x - a, y + b); g.lineTo(x - a, y - b); g.lineTo(x - b, y - b); g.closePath(); }
  else g.arc(x, y, r, 0, Math.PI * 2);
  if (shape === "ring") { stroke(); g.beginPath(); g.arc(x, y, r * 0.45, 0, Math.PI * 2); }
  fill();
  stroke();
}

export interface ScatterGeometry {
  dots: ScatterDot[];
  xTicks: Array<{ x: number; label: string | null }>;
  /** Where the x tick labels sit, and the axis names. */
  xLabelY: number;
  xTitle: { text: string; x: number; y: number };
  yTitle: { text: string; x: number; y: number };
  /** The dot the arrow keys are on, set in paint, for screen readers. */
  active?: number;
}

/** Each dot's radius: area in proportion to size=, between these. */
const MIN_R = 4, DOT_R = 5;

/**
 * The dots as keyboard stops: one region per dot, only the one the arrow
 * keys are on can take Tab (one stop for the whole chart). They never take
 * the pointer, which the whole chart's region turns into tips.
 */
function paintDotHits(box: Parameters<ChartKindDef["paint"]>[0], ctx: PaintContext, s: ScatterGeometry): void {
  if (!s.dots.length) return;
  const at = Math.max(0, Math.min(s.dots.length - 1, ctx.view(box.node).point ?? 0));
  s.active = at;
  s.dots.forEach((dot, i) => {
    const r = Math.max(dot.r, 4);
    ctx.addHit({ node: box.node, x: box.x + dot.x - r, y: box.y + dot.y - r, w: 2 * r, h: 2 * r, children: [], data: box.data }, { detail: `dot:${i}`, focusable: i === at });
  });
}

export const scatter: ChartKindDef = {
  loadingAs: "line",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "scatter", input.title, ctx);
    const font = base.labelFont;
    const labelLH = Math.round(t.text.caption * 1.4);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;
    const labelField = input.extra.label ?? "", sizeField = input.extra.size ?? "", groupField = input.extra.group ?? "";
    const [xName = "", yName = ""] = input.labels;
    const xTitle = xName || input.x || "x", yTitle = yName || input.y || "y";

    const items: Value | undefined = input.items;
    if (!isList(items) || !items.length) return done(say("No data to chart"));
    if (items.length > MAX_CHART_ITEMS) return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    type Raw = { label: string; x: number; y: number; size: number | null; group: string };
    const raw: Raw[] = [];
    let gaps = 0;
    items.forEach((item, i) => {
      const x = numberAt(item, input.x), y = numberAt(item, input.y);
      if (x === null || y === null) { gaps++; return; }
      const label = labelField && isRecord(item) ? labelOf(fieldOf(item, labelField)) : `Item ${i + 1}`;
      const size = sizeField ? numberAt(item, sizeField) : null;
      const group = groupField && isRecord(item) ? labelOf(fieldOf(item, groupField)) : "";
      raw.push({ label, x, y, size, group });
    });
    if (gaps) ctx.warn?.(`${where}: ${gaps} of ${items.length} items have no number in ${input.x} or ${input.y}, so they aren't drawn`);
    const negative = sizeField ? raw.filter((r) => r.size !== null && r.size < 0).length : 0;
    if (negative) ctx.warn?.(`${where}: ${negative} items have a size below 0 in ${sizeField}; they're drawn at the smallest size. size= is for amounts that can't be negative, like assets or population`);
    if (!raw.length) return done(say("No numbers to chart"));
    const groups = groupField ? [...new Set(raw.map((r) => r.group))] : [];
    if (groups.length > MAX_SCATTER_GROUPS) {
      ctx.warn?.(`${where}: group= has ${groups.length} groups; a scatter colors at most ${MAX_SCATTER_GROUPS}. Group by a field with fewer values, or filter() the list`);
      return done(say(`Too many groups to color: at most ${MAX_SCATTER_GROUPS}`));
    }

    // The y axis: its tick labels set the room on the left.
    const plotH = plotHeight(box.w);
    const yScale = chartScale(raw.map((r) => r.y), "line", Math.max(3, Math.round(plotH / 48)));
    const yLabels = tickLabels(yScale.ticks, yScale.step, input.format);
    const left = Math.ceil(Math.max(...yLabels.map((l) => m.width(l, font)))) + t.space.sm;
    const plotY = top + labelLH + t.space.xs;
    const plot: Rect = { x: left, y: plotY, w: Math.max(0, box.w - left - t.space.xs), h: plotH };
    if (plot.w < 80) return done(say("Too narrow to chart"));

    // Dot sizes, then room inside the plot so the biggest stays in it.
    const sizes = raw.flatMap((r) => (r.size === null || r.size <= 0 ? [] : [r.size]));
    const maxSize = Math.max(0, ...sizes);
    const maxR = sizeField && maxSize > 0 ? Math.max(MIN_R + 2, Math.min(22, plot.w / 18)) : DOT_R;
    const radius = (s: number | null) => (sizeField && maxSize > 0 ? (s === null || s <= 0 ? MIN_R : Math.max(MIN_R, maxR * Math.sqrt(s / maxSize))) : raw.length > 80 ? 3.5 : DOT_R);
    const inset = maxR + 2;
    const xScale = chartScale(raw.map((r) => r.x), "line", Math.max(2, Math.floor(plot.w / 90)));
    // Halves, as chartScale works, so a range near the largest doubles doesn't overflow.
    const share = (v: number, lo: number, hi: number) => { const span = hi / 2 - lo / 2; return span > 0 ? (v / 2 - lo / 2) / span : 0.5; };
    const xAt = (v: number) => plot.x + inset + share(v, xScale.min, xScale.max) * (plot.w - 2 * inset);
    const yAt = (v: number) => plot.y + plot.h - inset - share(v, yScale.min, yScale.max) * (plot.h - 2 * inset);

    // x tick labels under the plot, thinned when they'd touch.
    const xLabelsAll = tickLabels(xScale.ticks, xScale.step, "number");
    const spacing = xScale.ticks.length > 1 ? (plot.w - 2 * inset) / (xScale.ticks.length - 1) : plot.w;
    const widest = Math.max(...xLabelsAll.map((l) => m.width(l, font)));
    const every = Math.max(1, Math.ceil((widest + t.space.sm) / Math.max(1, spacing)));
    const xTicks = xScale.ticks.map((v, i) => ({ x: xAt(v), label: i % every === 0 ? xLabelsAll[i]! : null }));
    const xLabelY = plot.y + plot.h + t.space.xs + labelLH / 2;
    const titleY = xLabelY + labelLH;
    const xT = fit(`${xTitle} →`, plot.w, font, m);

    // Dots, and a slot per dot in x order, which is the order the keyboard and the data table go in.
    const order = raw.map((r, i) => i).sort((a, b) => raw[a]!.x - raw[b]!.x || raw[a]!.y - raw[b]!.y);
    const colorOf = (r: Raw) => (groups.length ? groups.indexOf(r.group) : -1);
    const dots: ScatterDot[] = [];
    const slots: ChartSlot[] = order.map((i) => {
      const r = raw[i]!;
      const notes = [`${xTitle}: ${preciseText(r.x, "number")}`, `${yTitle}: ${preciseText(r.y, input.format)}`];
      if (sizeField) notes.push(`${sizeField}: ${r.size === null ? "—" : preciseText(r.size, "number")}`);
      if (groupField) notes.push(`${groupField}: ${r.group}`);
      const dot: ScatterDot = { x: xAt(r.x), y: yAt(r.y), r: radius(r.size), color: colorOf(r), name: `${r.label}: ${notes.join(", ")}` };
      dots.push(dot);
      return {
        label: r.label, shownLabel: null, labelX: 0, cx: dot.x, value: r.y, values: [r.y],
        point: { x: dot.x, y: dot.y }, points: [{ x: dot.x, y: dot.y }], notes,
        noteSeries: notes.map(() => (dot.color < 0 ? null : dot.color)),
      };
    });

    // Dots on the same spot can't be told apart by the pointer: the tip says how many more are there.
    slots.forEach((slot, i) => {
      const here = dots.filter((o, j) => j !== i && Math.abs(o.x - dots[i]!.x) < 1 && Math.abs(o.y - dots[i]!.y) < 1).length;
      if (here) { slot.notes!.push(`and ${here} more here`); slot.noteSeries!.push(null); }
    });
    let bottom = titleY + labelLH / 2;
    let legend: ChartGeometry["legend"] = [];
    if (groups.length > 1) {
      const l = flowLegend(groups.map((g, k) => ({ label: g, color: k })), box.w, bottom + t.space.sm, ctx);
      legend = l.items;
      bottom = l.bottom;
    }
    const ticks = yScale.ticks.map((v, i) => ({ value: v, y: yAt(v), label: yLabels[i]! }));
    const geometry: ScatterGeometry = {
      dots, xTicks, xLabelY,
      xTitle: { text: xT, x: plot.x + plot.w, y: titleY },
      yTitle: { text: fit(yTitle, box.w, font, m), x: 0, y: top + labelLH / 2 },
    };
    const series = groups.length > 1 ? groups.map((g, k) => ({ field: g, label: g, color: k })) : [{ field: input.y, label: yTitle, color: 0 }];
    return {
      g: {
        ...base, plot, ticks, zeroY: null, min: yScale.min, max: yScale.max, slots, series, legend, labelY: xLabelY,
        noHoverOutline: true, custom: geometry,
      },
      h: bottom,
    };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const s = d.custom as ScatterGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const palette = seriesColors(theme);
    const colorOf = (k: number) => (k < 0 ? c.accent : palette[k % palette.length]!);
    const fade = easeOut(reveal * 2.5);

    g.globalAlpha = base * fade;
    paintAxisGrid(ctx, d, ox, oy);
    // Light upright lines at the x ticks, so a dot can be read against both axes.
    g.save();
    g.lineWidth = 1;
    g.strokeStyle = c.line;
    g.globalAlpha *= 0.4;
    for (const tk of s.xTicks) {
      const x = Math.round(ox + tk.x) + 0.5;
      g.beginPath();
      g.moveTo(x, oy + d.plot.y);
      g.lineTo(x, oy + d.plot.y + d.plot.h);
      g.stroke();
    }
    g.restore();
    g.font = d.labelFont;
    g.fillStyle = c.muted;
    g.textBaseline = "middle";
    g.textAlign = "center";
    const lastLabel = s.xTicks.length - 1;
    s.xTicks.forEach((tk, i) => {
      if (!tk.label) return;
      // The end labels keep inside the box.
      g.textAlign = i === 0 && tk.x - g.measureText(tk.label).width / 2 < 0 ? "left" : i === lastLabel && tk.x + g.measureText(tk.label).width / 2 > box.w ? "right" : "center";
      g.fillText(tk.label, ox + tk.x, oy + s.xLabelY);
    });
    g.textAlign = "right";
    g.fillText(s.xTitle.text, ox + s.xTitle.x, oy + s.xTitle.y);
    g.textAlign = "left";
    g.fillText(s.yTitle.text, ox + s.yTitle.x, oy + s.yTitle.y);

    // Dots: see-through, so where they crowd reads darker; each with a thin edge. The biggest
    // are drawn first, so a small dot is never hidden under a bubble.
    const bubbles = s.dots.some((dot) => dot.r > 6);
    const order = s.dots.map((_, i) => i).sort((a, b) => s.dots[b]!.r - s.dots[a]!.r);
    for (const i of order) {
      const dot = s.dots[i]!;
      const grow = reveal < 1 ? staggered(reveal, i, s.dots.length) : 1;
      if (grow <= 0) continue;
      g.globalAlpha = base;
      const color = colorOf(dot.color);
      drawDot(g, shapeOf(dot.color), ox + dot.x, oy + dot.y, dot.r * grow,
        () => { g.save(); g.globalAlpha *= bubbles ? 0.72 : 0.92; g.fillStyle = color; g.fill(); g.restore(); },
        () => { g.lineWidth = 1; g.strokeStyle = bubbles ? color : c.raised; g.stroke(); });
    }
    g.globalAlpha = base * fade;
    // The legend shows each group's shape in its color.
    g.font = d.legendFont;
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const item of d.legend) {
      const sw = item.swatch;
      drawDot(g, shapeOf(item.color), ox + sw.x + sw.w / 2, oy + sw.y + sw.h / 2, sw.w / 2, () => { g.fillStyle = colorOf(item.color); g.fill(); }, () => undefined);
      g.fillStyle = c.muted;
      g.fillText(item.shownLabel, ox + item.labelX, oy + item.y);
    }
    g.globalAlpha = base;
    paintDotHits(box, ctx, s);
  },
};
