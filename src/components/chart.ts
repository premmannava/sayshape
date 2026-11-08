/**
 * chart: bar, horizontal bar and line charts of one or more fields of a list
 * of records, and pie and donut charts of one field.
 *
 *   chart "Monthly revenue" kind=bar items=sales x=month y=revenue format=money
 *   chart "Top artists" kind=hbar items={take(sort(artists, 'sales', 'desc'), 10)} x=name y=sales
 *   chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year
 *   chart "Sales by region" kind=donut items=regions x=name y=total format=money
 *
 * Everything is worked out in layout (headless, from ctx.measure), into a
 * ChartGeometry kept on box.data relative to the box, so it's testable in
 * Node and survives containers moving the box. paint only draws it.
 *
 * Data rules, deterministic and never inventing numbers:
 * - Bar and line: every item of the list is a category slot, in list order,
 *   equally spaced. Each field in y is a series, drawn in the theme's series
 *   colors in the order written; one field draws in the accent, as it always has.
 * - A value is its field when that is a finite number. Anything else (missing
 *   field, null, text, not a record) is a gap: no bar, and the line breaks
 *   there. Text like "12" is not read as a number.
 * - A slot's label is its x field (text or a number), or "—" when missing.
 * - Bars always include 0; negative values go below it. Lines span the
 *   lowest to highest value, rounded out to whole ticks. Every series shares
 *   one scale.
 * - Horizontal bars (hbar): one row per item, top to bottom in list order,
 *   with the label on the left and the value at the end of each bar. Bars
 *   grow from a zero line; negative values go left of it. Too many rows to
 *   fit MAX_HBAR_HEIGHT shows a message suggesting take().
 * - Pie and donut: one slice per item with a positive y, in list order. Zero
 *   and gaps are left out. More than MAX_SLICES slices keeps the largest
 *   MAX_SLICES - 1 and adds an "Other" slice holding the rest. A negative
 *   value, or nothing above zero, shows a message instead.
 * - More than MAX_CHART_ITEMS items, more than MAX_SERIES fields, or too
 *   little width for them, shows a message instead of a chart: nothing is
 *   dropped silently.
 */
import { chartSemantics } from "./chart-a11y";
import type { ComponentDef } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import { ellipsize } from "../text";
import { SERIES_COUNT, seriesColors, sliceColors, type Theme } from "../theme";
import type { Box, Value } from "../types";
import { easeOut, paintGhost, staggered } from "../ghost";
import { themeFont } from "./util";
import { CHART_KINDS, paintSankeyHover, sankeyLinkAt, type SankeyGeometry } from "./chart-kinds";
import {
  barPath, chartData, smoothLineControls, traceSmoothLine, chartSeries, chartScale, INSET, labelOf, numberAt, FORMATS, paintAxisGrid, paintMessage, paintSlotLabels, paintTitle, slotLabels, fit, flowLegend, header, KINDS, LOCALE, MAX_CHART_ITEMS, paintLegend, paintPremiumBar,
  plotHeight, shareText, SWATCH, SWATCH_GAP, tickLabels, valueText,
  formatter, type ChartData, type ChartGeometry, type ChartSlot, type SeriesData, type Ctx, type Format, type Kind, type LegendItem, type PaintCtx, type PieSlice, type Rect,
} from "./chart-kit";

// Kept importable from here, where they have always been.
export { chartData, chartSeries, chartScale, smoothLineControls, traceSmoothLine, MAX_CHART_ITEMS, niceStep, shareText, tickLabels, valueText } from "./chart-kit";
export type { ChartData, ChartGeometry, LineControl, SeriesData, ChartSlot, LegendItem, PieSlice, Rect } from "./chart-kit";

/** The most fields one bar or line chart draws, one color each. */
export const MAX_SERIES = SERIES_COUNT;
/** The most slices a pie or donut draws; past it, the smallest are summed into "Other". */
export const MAX_SLICES = SERIES_COUNT;
/** The narrowest slot per item, in pixels, before the chart says it's too narrow. */
export const MIN_SLOT = { bar: 4, line: 3 } as const;
/** The tallest a horizontal bar chart's rows get, in pixels; more rows show a message suggesting take(). */
export const MAX_HBAR_HEIGHT = 1200;
/** Horizontal bars: the most of the width the label column takes. */
export const HBAR_LABEL_SHARE = 0.4;
/** Horizontal bars: the narrowest the bars' own area gets before the chart says it's too narrow. */
const MIN_HBAR_AREA = 40;
/** Grouped bars: the narrowest bar, and the surface gap between bars in a group. */
const MIN_GROUP_BAR = 3;
const BAR_GAP = 2;

type AxisKind = "bar" | "line";
const isRound = (k: Kind): k is "pie" | "donut" => k === "pie" || k === "donut";

/** The fields named in y=, in order: "revenue,last_year" → ["revenue", "last_year"]. */
export function fieldsOf(y: string): string[] {
  return y.split(",").map((f) => f.trim()).filter(Boolean);
}

/** The names in labels=, in order; blanks stay blank so they line up with y. */
function labelsOf(raw: string): string[] {
  return raw ? raw.split(",").map((l) => l.trim()) : [];
}


/**
 * Interpolate a slice's weight rather than its start/end independently.
 * Normalize the visible weights before calculating boundaries: the ring
 * remains closed and contiguous during rapid updates and structural changes.
 * Targets, share labels and hit-test data remain authoritative in layout.
 */
export function morphPieSlices(
  slices: readonly PieSlice[],
  tween: (key: string, target: number) => number,
): PieSlice[] {
  if (!slices.length) return [];
  const weights = slices.map((slice, i) => {
    const value = tween(`pie:share:${i}:${slice.label}`, slice.share);
    return Number.isFinite(value) ? Math.max(0, value) : slice.share;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return slices.map((s) => ({ ...s }));
  let angle = 0;
  return slices.map((slice, i) => {
    const start = angle;
    angle = i === slices.length - 1 ? Math.PI * 2 : angle + (weights[i]! / sum) * Math.PI * 2;
    return { ...slice, start, end: angle };
  });
}

/** The datum beneath the pointer, with geometry relative to the chart box. */
export interface ChartHover {
  kind: "slot" | "slice";
  index: number;
}

/** Only actual bars, line plot slots, and donut/pie slices are interactive. */
export function chartHoverAt(d: ChartGeometry, x: number, y: number): ChartHover | null {
  if (d.message || d.loading || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (d.pie) {
    const p = d.pie;
    const dx = x - p.cx, dy = y - p.cy;
    const radius = Math.hypot(dx, dy);
    if (radius < p.inner || radius > p.r) return null;
    const turn = Math.PI * 2;
    const angle = ((Math.atan2(dy, dx) + Math.PI / 2) % turn + turn) % turn;
    const index = p.slices.findIndex((s) => angle >= s.start && angle < s.end);
    return index < 0 ? null : { kind: "slice", index };
  }
  if (d.kind === "line") {
    const p = d.plot;
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h || !d.slots.length || p.w <= 0) return null;
    const index = Math.min(d.slots.length - 1, Math.floor((x - p.x) / (p.w / d.slots.length)));
    return d.slots[index]?.values.some((v) => v !== null) ? { kind: "slot", index } : null;
  }
  if (d.kind === "sankey") {
    // A node (a little wider than drawn, as nodes are thin), else the band under the pointer.
    const s = d.custom as SankeyGeometry;
    const node = s.nodes.findIndex((n) => x >= n.rect.x - 3 && x <= n.rect.x + n.rect.w + 3 && y >= n.rect.y && y <= n.rect.y + n.rect.h);
    if (node >= 0) return { kind: "slot", index: node };
    const link = sankeyLinkAt(s, x, y);
    return link < 0 ? null : { kind: "slot", index: s.nodes.length + link };
  }
  if (d.kind === "scatter") {
    // The nearest dot within reach of the pointer: small dots get a forgiving target.
    let best = -1, bestD = Infinity;
    d.slots.forEach((slot, i) => {
      const pt = slot.point, r = (d.custom as { dots: Array<{ r: number }> }).dots[i]?.r ?? 5;
      if (!pt) return;
      const dist = Math.hypot(x - pt.x, y - pt.y);
      if (dist <= Math.max(r + 3, 10) && dist < bestD) { best = i; bestD = dist; }
    });
    return best < 0 ? null : { kind: "slot", index: best };
  }
  if (d.kind === "bar" || d.kind === "hbar" || d.custom !== undefined) {
    for (let i = 0; i < d.slots.length; i++) {
      for (const b of d.slots[i]!.bars ?? []) {
        if (b && b.w > 0 && b.h > 0 && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          return { kind: "slot", index: i };
        }
      }
    }
  }
  return null;
}

export interface PieData {
  slices: Array<{ label: string; value: number; other?: boolean }>;
  total: number;
  problem?: ChartData["problem"] | "negative" | "zero" | "overflow";
  /** Items whose y wasn't a finite number. */
  gaps: number;
  /** Items summed into the "Other" slice. */
  folded: number;
}

/**
 * Slices for a pie or donut: positive values in list order. Past MAX_SLICES,
 * the largest MAX_SLICES - 1 stay (still in list order) and the rest become
 * one "Other" slice, so nothing is left out of the total.
 */
export function pieData(items: Value | undefined, x: string, y: string): PieData {
  const base = { slices: [], total: 0, gaps: 0, folded: 0 };
  if (!isList(items)) return { ...base, problem: "not-list" };
  if (!items.length) return { ...base, problem: "empty" };
  if (items.length > MAX_CHART_ITEMS) return { ...base, problem: "too-many" };
  let gaps = 0;
  const all: Array<{ label: string; value: number }> = [];
  for (const item of items) {
    const value = numberAt(item, y);
    if (value === null) { gaps++; continue; }
    if (value < 0) return { ...base, gaps, problem: "negative" };
    if (value > 0) all.push({ label: isRecord(item) ? labelOf(fieldOf(item, x)) : "—", value });
  }
  if (gaps === items.length) return { ...base, gaps, problem: "no-values" };
  const total = all.reduce((t, s) => t + s.value, 0);
  if (!all.length) return { ...base, gaps, problem: "zero" };
  if (!isFinite(total)) return { ...base, gaps, problem: "overflow" };
  if (all.length <= MAX_SLICES) return { slices: all, total, gaps, folded: 0 };
  // Rank by size, ties in list order, then keep the biggest in list order.
  const keep = new Set(all.map((s, i) => [s.value, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, MAX_SLICES - 1).map(([, i]) => i));
  const kept = all.filter((_s, i) => keep.has(i));
  const rest = all.filter((_s, i) => !keep.has(i));
  const other = rest.reduce((t, s) => t + s.value, 0);
  return { slices: [...kept, { label: "Other", value: other, other: true }], total, gaps, folded: rest.length };
}


/** A pie's diameter for a width: a little smaller than a plot, and never wider than the box. */
const pieSize = (w: number) => Math.min(w, Math.round(Math.max(140, Math.min(220, w * 0.45))));
/** A donut's hole as a share of its radius: a slim ring reads as more refined than a thick one. */
const DONUT_INNER = 0.68;
/**
 * Slices in columns below a pie: name on the left, value and share on the
 * right. As many equal columns as the widest entry allows, at least one;
 * when one column is too narrow, the name is cut first, then the numbers.
 */
function gridLegend(entries: Array<{ label: string; detail: string; color: number }>, width: number, top: number, ctx: Ctx): { items: LegendItem[]; bottom: number } {
  const t = ctx.theme, m = ctx.measure;
  const font = themeFont(t, 400, t.text.caption + 1);
  const lh = Math.round((t.text.caption + 1) * 1.7);
  const lead = SWATCH + SWATCH_GAP, between = t.space.sm, colGap = t.space.md;
  const natural = Math.max(...entries.map((e) => lead + m.width(e.label, font) + between + m.width(e.detail, font)));
  const cols = Math.max(1, Math.min(entries.length, Math.floor((width + colGap) / (Math.min(width, natural) + colGap))));
  const colW = (width - colGap * (cols - 1)) / cols;
  const room = Math.max(0, colW - lead);
  const items = entries.map((e, i): LegendItem => {
    const x = (i % cols) * (colW + colGap), y = top + Math.floor(i / cols) * lh;
    const dw = m.width(e.detail, font);
    // Keep the numbers whole when the name can still show a few letters beside them.
    const detail = dw + between + 24 <= room ? e.detail : fit(e.detail, room / 2, font, m);
    const labelRoom = Math.max(0, room - m.width(detail, font) - between);
    return {
      color: e.color, swatch: { x, y: y + (lh - SWATCH) / 2, w: SWATCH, h: SWATCH },
      label: e.label, shownLabel: fit(e.label, labelRoom, font, m), labelX: x + lead,
      detail, detailX: x + colW, y: y + lh / 2,
    };
  });
  return { items, bottom: top + Math.ceil(entries.length / cols) * lh };
}

function axisGeometry(
  box: { w: number }, d: SeriesData, series: ChartGeometry["series"], kind: AxisKind, format: Format, title: string, line: number, ctx: Ctx,
): { g: ChartGeometry; h: number } {
  const t: Theme = ctx.theme;
  const m = ctx.measure;
  const { base, say, top } = header(box, kind, title, ctx);
  const labelFont = base.labelFont;
  const labelLH = Math.round(t.text.caption * 1.4);
  const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });

  if (d.problem === "not-list") return done(say("No data to chart"));
  if (d.problem === "empty") return done(say("No data to chart"));
  if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
  if (d.problem === "no-values") return done(say("No numbers to chart"));

  const ns = series.length;
  const values = d.slots.flatMap((s) => s.values.flatMap((v) => (v === null ? [] : [v])));
  const plotH = plotHeight(box.w);
  const scale = chartScale(values, kind, Math.max(2, Math.min(6, Math.floor(plotH / 44))));
  const tickText = tickLabels(scale.ticks, scale.step, format);
  const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
  const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
  const n = d.slots.length;
  const slotW = plot.w / n;
  // Grouped bars need room for every bar of a slot, with gaps, in 80% of it.
  const grouped = kind === "bar" && ns > 1;
  const minSlot = grouped ? (ns * MIN_GROUP_BAR + (ns - 1) * BAR_GAP) / 0.8 : MIN_SLOT[kind];
  if (slotW < minSlot) {
    const fits = Math.max(0, Math.floor(plot.w / minSlot));
    ctx.warn?.(`chart on line ${line}: ${n} items${grouped ? ` with ${ns} series` : ""} don't fit in ${Math.round(box.w)} pixels; at most ${fits} do`);
    return done(say(`Too narrow to chart ${n} items`));
  }

  // Halves again, so (max - min) can't overflow for values near the largest number.
  const y = (v: number) => plot.y + INSET + (plot.h - 2 * INSET) * (1 - (v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2));
  const zeroY = scale.min <= 0 && scale.max >= 0 ? y(0) : null;

  const placed = slotLabels(d.slots.map((s) => s.label), plot, box.w, labelFont, ctx);
  const barW = Math.min(slotW * 0.6, 44);
  const group = grouped ? Math.min(slotW * 0.74, ns * 34 + (ns - 1) * BAR_GAP) : barW;
  const each = grouped ? (group - (ns - 1) * BAR_GAP) / ns : barW;

  const slots: ChartSlot[] = d.slots.map((s, i) => {
    const { cx, shownLabel, labelX } = placed[i]!;
    const slot: ChartSlot = { label: s.label, shownLabel, labelX, cx, value: s.values[0] ?? null, values: s.values };
    if (kind === "bar") {
      const z = zeroY ?? y(scale.min);
      slot.bars = s.values.map((v, k) => {
        if (v === null) return null;
        const vy = y(v);
        return { x: cx - group / 2 + k * (each + BAR_GAP), y: Math.min(vy, z), w: each, h: Math.abs(vy - z) };
      });
      if (slot.bars[0]) slot.bar = slot.bars[0];
    } else {
      slot.points = s.values.map((v) => (v === null ? null : { x: cx, y: y(v) }));
      if (slot.points[0]) slot.point = slot.points[0];
    }
    return slot;
  });
  const seriesSegments: ChartGeometry["seriesSegments"] = [];
  if (kind === "line") {
    for (let k = 0; k < ns; k++) {
      const runs: ChartGeometry["segments"] = [];
      let run: Array<{ x: number; y: number }> = [];
      for (const s of slots) {
        const p = s.points?.[k];
        if (p) run.push(p);
        else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      seriesSegments.push(runs);
    }
  }
  series.forEach((sr, k) => {
    const gaps = d.gaps[k] ?? 0;
    if (!gaps) return;
    const where = ns > 1 ? ` ${sr.field} field` : " y field";
    ctx.warn?.(`chart on line ${line}: ${gaps} of ${n} items have no number in their${where}, so they're shown as gaps`);
  });

  const labelY = plot.y + plot.h + t.space.xs;
  let h = labelY + labelLH;
  let legend: LegendItem[] = [];
  if (ns > 1) {
    const l = flowLegend(series, box.w, h + t.space.sm, ctx);
    legend = l.items;
    h = l.bottom;
  }
  return {
    g: {
      ...base,
      plot,
      ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
      zeroY,
      min: scale.min,
      max: scale.max,
      slots,
      segments: seriesSegments[0] ?? [],
      seriesSegments,
      series,
      labelY,
      legend,
    },
    h,
  };
}

/** Horizontal bars: how thick each bar is and how tall each row is, for ns series side by side. */
export function hbarRows(t: Theme, ns: number): { rowH: number; barH: number; group: number } {
  const barH = ns === 1 ? Math.round(t.text.caption * 1.25) : t.text.caption;
  const group = ns * barH + (ns - 1) * BAR_GAP;
  return { barH, group, rowH: Math.max(Math.round((t.control.height * 2) / 3), group + t.space.sm) };
}

/** Rows a loading horizontal bar chart keeps room for. */
const GHOST_HBAR_ROWS = 5;

function hbarGeometry(
  box: { w: number }, d: SeriesData, series: ChartGeometry["series"], format: Format, title: string, line: number, ctx: Ctx,
): { g: ChartGeometry; h: number } {
  const t = ctx.theme, m = ctx.measure;
  const { base, say, top } = header(box, "hbar", title, ctx);
  const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
  const labelFont = base.labelFont;

  if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
  if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
  if (d.problem === "no-values") return done(say("No numbers to chart"));

  const ns = series.length, n = d.slots.length;
  const { rowH, barH, group } = hbarRows(t, ns);
  if (n * rowH > MAX_HBAR_HEIGHT) {
    const fits = Math.floor(MAX_HBAR_HEIGHT / rowH);
    ctx.warn?.(`chart on line ${line}: ${n} rows of horizontal bars are too tall to show; at most ${fits} fit. Show the top ones with take(), like items={take(sort(list, 'field', 'desc'), ${Math.min(10, fits)})}`);
    return done(say(`Too many rows to chart: at most ${fits}. Show the top ones with take()`));
  }

  // Values read at the end of each bar: room for them on the right, and on the left for negatives.
  const texts = d.slots.map((s) => s.values.map((v) => (v === null ? null : valueText(v, format))));
  const roomFor = (neg: boolean) => {
    let w = -1;
    d.slots.forEach((s, i) => s.values.forEach((v, k) => { if (v !== null && v < 0 === neg) w = Math.max(w, m.width(texts[i]![k]!, labelFont)); }));
    return w < 0 ? 0 : Math.ceil(w) + t.space.xs;
  };
  const right = roomFor(false), left = roomFor(true);
  const labelCol = Math.ceil(Math.min(Math.max(...d.slots.map((s) => m.width(s.label, labelFont))), box.w * HBAR_LABEL_SHARE));
  const plot: Rect = { x: labelCol + t.space.sm, y: top, w: Math.max(0, box.w - labelCol - t.space.sm), h: n * rowH };
  const area = plot.w - left - right;
  if (area < MIN_HBAR_AREA) {
    ctx.warn?.(`chart on line ${line}: ${Math.round(box.w)} pixels leave no room for horizontal bars beside their labels and values`);
    return done(say("Too narrow to chart these values"));
  }

  const values = d.slots.flatMap((s) => s.values.flatMap((v) => (v === null ? [] : [v])));
  const lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = 1;
  const ax = plot.x + left;
  // Halves, so (hi - lo) can't overflow for values near the largest number.
  const xOf = (v: number) => ax + area * ((v / 2 - lo / 2) / (hi / 2 - lo / 2));
  const zeroX = xOf(0);

  const slots: ChartSlot[] = d.slots.map((s, i) => {
    const cy = plot.y + rowH * (i + 0.5);
    const bars = s.values.map((v, k): Rect | null => {
      if (v === null) return null;
      const vx = xOf(v);
      return { x: Math.min(vx, zeroX), y: cy - group / 2 + k * (barH + BAR_GAP), w: Math.abs(vx - zeroX), h: barH };
    });
    const valueLabels = bars.map((b, k) => {
      const v = s.values[k];
      if (!b || v === null || v === undefined) return null;
      const neg = v < 0;
      return { text: texts[i]![k]!, x: neg ? b.x - t.space.xs : b.x + b.w + t.space.xs, y: b.y + b.h / 2, align: neg ? "right" as const : "left" as const };
    });
    const slot: ChartSlot = {
      label: s.label, shownLabel: ellipsize(s.label, labelCol, labelFont, m), labelX: 0, cx: zeroX, cy,
      value: s.values[0] ?? null, values: s.values, bars, valueLabels,
    };
    if (bars[0]) slot.bar = bars[0];
    return slot;
  });
  series.forEach((sr, k) => {
    const gaps = d.gaps[k] ?? 0;
    if (gaps) ctx.warn?.(`chart on line ${line}: ${gaps} of ${n} items have no number in their${ns > 1 ? ` ${sr.field} field` : " y field"}, so they're shown as gaps`);
  });

  let h = plot.y + plot.h;
  let legend: LegendItem[] = [];
  if (ns > 1) {
    const l = flowLegend(series, box.w, h + t.space.sm, ctx);
    legend = l.items;
    h = l.bottom;
  }
  return { g: { ...base, plot, zeroX, rowH, min: lo, max: hi, slots, series, labelY: plot.y, legend }, h };
}

function roundGeometry(box: { w: number }, d: PieData, kind: "pie" | "donut", format: Format, title: string, line: number, ctx: Ctx): { g: ChartGeometry; h: number } {
  const t = ctx.theme, m = ctx.measure;
  const { base, say, top } = header(box, kind, title, ctx);
  const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
  const name = kind === "pie" ? "Pie" : "Donut";

  if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
  if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
  if (d.problem === "no-values") return done(say("No numbers to chart"));
  if (d.problem === "negative") {
    ctx.warn?.(`chart on line ${line}: a ${kind} can't show negative values. Use kind=bar to show values below zero`);
    return done(say(`${name} charts can't show negative values`));
  }
  if (d.problem === "zero") return done(say("Every value is 0, so there's nothing to chart"));
  if (d.problem === "overflow") return done(say("These values are too large to add up"));
  if (d.gaps) ctx.warn?.(`chart on line ${line}: ${d.gaps} items have no number in their y field, so they're left out`);

  const size = pieSize(box.w);
  const r = size / 2;
  const cx = box.w / 2, cy = top + r;
  let a = 0;
  const slices: PieSlice[] = d.slices.map((s, i) => {
    const share = s.value / d.total;
    const slice: PieSlice = { label: s.label, value: s.value, share, start: a, end: i === d.slices.length - 1 ? Math.PI * 2 : a + share * Math.PI * 2, color: i, ...(s.other ? { other: true } : {}) };
    a = slice.end;
    return slice;
  });
  const inner = kind === "donut" ? Math.round(r * DONUT_INNER) : 0;

  let center: NonNullable<ChartGeometry["pie"]>["center"];
  if (inner) {
    const text = valueText(d.total, format);
    const width = inner * 2 * 0.85;
    const fonts = [themeFont(t, 600, t.text.title), themeFont(t, 600, t.text.lead), themeFont(t, 600, t.text.body)];
    const font = fonts.find((f) => m.width(text, f) <= width) ?? fonts[fonts.length - 1]!;
    const fontSize = font === fonts[0] ? t.text.title : font === fonts[1] ? t.text.lead : t.text.body;
    const captionFont = themeFont(t, 400, t.text.caption);
    const caption = m.width("Total", captionFont) <= width ? "Total" : "";
    center = { text: ellipsize(text, width, font, m), font, caption, captionFont, lh: Math.round(fontSize * 1.2) };
  }

  const legendTop = top + size + t.space.md;
  const l = gridLegend(
    slices.map((s) => ({ label: s.label, detail: `${valueText(s.value, format)} · ${shareText(s.share)}`, color: s.color })),
    box.w, legendTop, ctx,
  );
  return {
    g: {
      ...base,
      plot: { x: cx - r, y: top, w: size, h: size },
      legend: l.items,
      pie: { cx, cy, r, inner, slices, total: d.total, ...(center ? { center } : {}) },
    },
    h: l.bottom,
  };
}

/** Rows of legend a loading pie or donut keeps room for. */
const GHOST_LEGEND_ROWS = 4;

/** The shape of a chart whose data is on its way, at the size it will likely have, so little moves when it arrives. */
function loadingGeometry(box: { w: number }, kind: Kind, series: number, title: string, ctx: Ctx): { g: ChartGeometry; h: number } {
  const t = ctx.theme;
  const { base, top } = header(box, kind, title, ctx);
  const labelLH = Math.round(t.text.caption * 1.4);
  const rowH = Math.round(t.text.caption * 1.4) + t.space.xs;
  if (isRound(kind)) {
    const size = pieSize(box.w);
    const legendTop = top + size + t.space.md;
    return { g: { ...base, plot: { x: box.w / 2 - size / 2, y: top, w: size, h: size }, labelY: legendTop, loading: { series } }, h: legendTop + GHOST_LEGEND_ROWS * rowH };
  }
  if (kind === "hbar") {
    const { rowH } = hbarRows(t, Math.max(1, series));
    const labelCol = Math.round(Math.min(box.w * 0.3, 100));
    const plot: Rect = { x: labelCol + t.space.sm, y: top, w: Math.max(0, box.w - labelCol - t.space.sm), h: GHOST_HBAR_ROWS * rowH };
    const legend = series > 1 ? t.space.sm + rowH : 0;
    return { g: { ...base, plot, rowH, labelY: plot.y + plot.h, loading: { series } }, h: plot.y + plot.h + legend };
  }
  const axisW = 28;
  const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotHeight(box.w) };
  const labelY = plot.y + plot.h + t.space.xs;
  const legend = series > 1 ? t.space.sm + rowH : 0;
  return { g: { ...base, plot, labelY, loading: { series } }, h: labelY + labelLH + legend };
}

/** Heights of the placeholder bars and line, as shares of the plot: a gentle rise with some variety. */
const GHOST_SHAPE = [0.42, 0.58, 0.5, 0.72, 0.62, 0.84, 0.7, 0.9, 0.78, 0.66, 0.8, 0.6];

function paintChartLoading(box: Box, ctx: PaintCtx): void {
  const { g, theme } = ctx;
  const d = box.data as ChartGeometry | undefined;
  if (!d?.loading) return;
  const ox = box.x, oy = box.y;
  const c = theme.colors;
  paintTitle(ctx, d, ox, oy);
  const pillH = 8;
  const rowH = Math.round(theme.text.caption * 1.4) + theme.space.xs;
  const bounds = { x: ox, y: oy + d.plot.y, w: box.w, h: box.h - d.plot.y };

  if (isRound(d.kind)) {
    const r = d.plot.w / 2, cx = ox + d.plot.x + r, cy = oy + d.plot.y + r;
    paintGhost(ctx, bounds, (s) => {
      if (d.kind === "donut") {
        // A ring: the outer circle, then the hole the other way round.
        s.g.moveTo(cx + r, cy);
        s.g.arc(cx, cy, r, 0, Math.PI * 2);
        s.g.moveTo(cx + r * DONUT_INNER, cy);
        s.g.arc(cx, cy, r * DONUT_INNER, Math.PI * 2, 0, true);
        s.g.closePath();
      } else s.circle(cx, cy, r);
      for (let i = 0; i < GHOST_LEGEND_ROWS; i++) {
        const y = oy + d.labelY + i * rowH + rowH / 2;
        s.circle(ox + 5, y, 5);
        s.pill(ox + 18, y - pillH / 2, Math.min(box.w * 0.4, 70 + ((i * 37) % 60)), pillH);
        s.pill(ox + box.w - 64, y - pillH / 2, 64, pillH);
      }
    });
    return;
  }

  if (d.kind === "hbar") {
    paintHbarLoading(ctx, d, box, bounds, pillH, rowH);
    return;
  }

  // The baseline, as the real chart will have; grid lines would show through the shapes.
  const px = ox + d.plot.x, pw = d.plot.w, py = oy + d.plot.y, ph = d.plot.h;
  g.lineWidth = 1;
  g.strokeStyle = c.line;
  g.beginPath();
  g.moveTo(px, Math.round(py + ph) + 0.5);
  g.lineTo(px + pw, Math.round(py + ph) + 0.5);
  g.stroke();
  const ns = Math.max(1, d.loading.series);
  const n = Math.max(4, Math.min(GHOST_SHAPE.length, Math.floor(pw / (d.kind === "bar" ? 26 * ns + 14 : 40))));
  const slotW = pw / n;
  const bottom = py + ph;
  paintGhost(ctx, bounds, (s) => {
    for (let i = 0; i <= 3; i++) s.pill(ox, py + (ph * i) / 3 - pillH / 2, d.plot.x - 8, pillH);
    if (d.kind === "bar") {
      const group = Math.min(slotW * 0.7, ns * 40);
      const bw = (group - (ns - 1) * BAR_GAP) / ns;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < ns; k++) {
          const h = ph * GHOST_SHAPE[(i + k * 3) % GHOST_SHAPE.length]! * (k ? 0.8 : 1);
          s.rect(px + slotW * (i + 0.5) - group / 2 + k * (bw + BAR_GAP), bottom - h, bw, h, Math.min(theme.radius.sm, bw / 2));
        }
      }
    } else {
      // The area under a line that rises gently: the shape a trend will take.
      s.g.moveTo(px, bottom);
      s.g.lineTo(px, bottom - ph * GHOST_SHAPE[0]! * 0.85);
      for (let i = 0; i < n; i++) s.g.lineTo(px + slotW * (i + 0.5), bottom - ph * GHOST_SHAPE[i]! * 0.85);
      s.g.lineTo(px + pw, bottom - ph * GHOST_SHAPE[n - 1]! * 0.85);
      s.g.lineTo(px + pw, bottom);
      s.g.closePath();
    }
    for (let i = 0; i < n; i += slotW < 44 ? 2 : 1) s.pill(px + slotW * (i + 0.5) - 14, oy + d.labelY + 3, 28, pillH);
    if (ns > 1) {
      const y = oy + d.labelY + Math.round(theme.text.caption * 1.4) + theme.space.sm + rowH / 2;
      for (let k = 0; k < ns; k++) {
        const x = ox + k * 96;
        if (x + 80 > ox + box.w) break;
        s.rect(x, y - 5, 10, 10, 2);
        s.pill(x + 16, y - pillH / 2, 60, pillH);
      }
    }
  });
}

/** Rows of label pills and bars of varied lengths growing from the zero line. */
function paintHbarLoading(ctx: PaintCtx, d: ChartGeometry, box: Box, bounds: Rect, pillH: number, rowH: number): void {
  const { g, theme } = ctx;
  const ox = box.x, oy = box.y;
  const ns = Math.max(1, d.loading?.series ?? 1);
  const { barH, group } = hbarRows(theme, ns);
  const rows = d.rowH ? Math.round(d.plot.h / d.rowH) : GHOST_HBAR_ROWS;
  const px = ox + d.plot.x, pw = d.plot.w;
  // The zero line, as the real chart will have.
  g.lineWidth = 1;
  g.strokeStyle = theme.colors.line;
  g.beginPath();
  g.moveTo(Math.round(px) + 0.5, oy + d.plot.y);
  g.lineTo(Math.round(px) + 0.5, oy + d.plot.y + d.plot.h);
  g.stroke();
  paintGhost(ctx, bounds, (s) => {
    for (let i = 0; i < rows; i++) {
      const cy = oy + d.plot.y + (d.rowH ?? rowH) * (i + 0.5);
      // Longest first, as a ranking usually is.
      const share = GHOST_SHAPE[GHOST_SHAPE.length - 1 - ((i * 2) % GHOST_SHAPE.length)]! * (1 - i * 0.08);
      s.pill(ox, cy - pillH / 2, Math.max(24, (d.plot.x - theme.space.sm) * (0.55 + ((i * 37) % 40) / 100)), pillH);
      for (let k = 0; k < ns; k++) {
        const w = (pw - 48) * share * (k ? 0.8 : 1);
        s.rect(px, cy - group / 2 + k * (barH + BAR_GAP), Math.max(8, w), barH, Math.min(theme.radius.sm, barH / 2));
      }
    }
    if (ns > 1) {
      const y = oy + d.plot.y + d.plot.h + theme.space.sm + rowH / 2;
      for (let k = 0; k < ns; k++) {
        const x = ox + k * 96;
        if (x + 80 > ox + box.w) break;
        s.rect(x, y - 5, 10, 10, 2);
        s.pill(x + 16, y - pillH / 2, 60, pillH);
      }
    }
  });
}

/** Draw horizontal bars: labels on the left, bars growing from the zero line, values at their ends. */
function paintHbar(box: Box, ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, colorOf: (k: number) => string, reveal: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const base = g.globalAlpha;
  const fade = easeOut(reveal * 2.5);
  const n = d.slots.length;
  const zero = d.zeroX ?? d.plot.x;
  g.globalAlpha = base * fade;
  g.font = d.labelFont;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillStyle = c.ink;
  for (const s of d.slots) if (s.shownLabel && s.cy !== undefined) g.fillText(s.shownLabel, ox + s.labelX, oy + s.cy);
  g.lineWidth = 1;
  g.strokeStyle = d.min < 0 ? c.muted : c.line;
  g.beginPath();
  g.moveTo(Math.round(ox + zero) + 0.5, oy + d.plot.y);
  g.lineTo(Math.round(ox + zero) + 0.5, oy + d.plot.y + d.plot.h);
  g.stroke();

  g.globalAlpha = base;
  const hot = ctx.pointer && ctx.isHovered(box.node)
    ? chartHoverAt(d, ctx.pointer.x - ox, ctx.pointer.y - oy)
    : null;
  d.slots.forEach((s, i) => {
    // A wave from top to bottom: each bar grows out of the zero line.
    const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
    (s.bars ?? []).forEach((full, k) => {
      if (!full || full.w <= 0) return;
      const w = ctx.tween(box.node, `hbar:${i}:${k}`, full.w, 440) * grow;
      if (w <= 0.25) return;
      const right = full.x >= zero - 0.01;
      const b = { x: right ? full.x : full.x + full.w - w, y: full.y, w, h: full.h };
      ctx.roundRect(ox + b.x, oy + b.y, b.w, b.h, Math.min(6, b.w / 2, b.h / 2));
      const hover = ctx.tween(box.node, `hbar:highlight:${i}:${k}`,
        hot?.kind === "slot" && hot.index === i ? 1 : 0, 165);
      paintPremiumBar(ctx, { x: ox + b.x, y: oy + b.y, w: b.w, h: b.h },
        colorOf(k), right ? "right" : "left", hover);
    });
  });

  // Value labels follow the animated bar tips, rather than jumping to the new
  // end coordinate before the bar itself has finished moving.
  g.globalAlpha = base * fade;
  g.fillStyle = c.muted;
  d.slots.forEach((s, i) => {
    const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
    s.valueLabels?.forEach((v, k) => {
      if (!v) return;
      const bar = s.bars?.[k];
      const right = !!bar && bar.x >= zero - 0.01;
      const width = bar ? ctx.tween(box.node, `hbar:${i}:${k}`, bar.w, 440) * grow : 0;
      const x = bar ? (right ? bar.x + width + theme.space.xs : bar.x + bar.w - width - theme.space.xs) : v.x;
      g.textAlign = v.align;
      g.fillText(v.text, ox + x, oy + v.y);
    });
  });
  if (d.legend.length) paintLegend(ctx, d, ox, oy, colorOf);
  g.globalAlpha = base;
}

/** Warnings about props that only make sense together, shown by the parser. */
function check(props: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const kind = props.kind ?? "bar";
  const y = props.y;
  if (kind === "sankey" && (props.from === undefined || props.to === undefined)) {
    out.push(`chart kind=sankey needs from= and to= naming the fields with where each flow starts and where it goes, like from=source to=target`);
  }
  for (const prop of ["from", "to"] as const) {
    if (props[prop] !== undefined && kind !== "sankey") out.push(`${prop}= is for kind=sankey only, so it was ignored here; remove it, or use kind=sankey`);
  }
  // Expressions are worked out later; only what's written can be checked here.
  if (y === undefined || y.startsWith("{")) return out;
  const fields = fieldsOf(y);
  const own = CHART_KINDS[kind];
  const oneField = isRound(kind as Kind) || (!!own && !own.multiField);
  if (oneField && fields.length > 1) {
    out.push(`chart kind=${kind} shows one field, so only y=${fields[0]} is used. Write y=${fields[0]}, or use kind=bar, kind=hbar or kind=line to compare ${fields.join(", ")}`);
  }
  if (props.total !== undefined && kind !== "waterfall") {
    out.push(`total= adds a final bar to kind=waterfall only, so it was ignored here; remove it, or use kind=waterfall`);
  }
  if (kind === "bullet" && props.target === undefined) {
    out.push(`chart kind=bullet compares each item with its goal, but has no target=. Add target= naming the field with each item's goal, like target=goal`);
  }
  if (props.target !== undefined && kind !== "bullet") {
    out.push(`target= marks each item's goal on kind=bullet only, so it was ignored here; remove it, or use kind=bullet`);
  }
  if (kind === "heatmap" && props.rows === undefined) {
    out.push(`chart kind=heatmap needs rows= naming the field that picks each item's row, like rows=day; x= picks its column and y= its number`);
  }
  if (props.rows !== undefined && kind !== "heatmap") {
    out.push(`rows= picks each item's row on kind=heatmap only, so it was ignored here; remove it, or use kind=heatmap`);
  }
  for (const prop of ["label", "size", "group"] as const) {
    if (props[prop] !== undefined && kind !== "scatter") out.push(`${prop}= is for kind=scatter only, so it was ignored here; remove it, or use kind=scatter`);
  }
  if (props.good !== undefined && kind !== "bullet") {
    out.push(`good= says which side of the target is good on kind=bullet only, so it was ignored here; remove it, or use kind=bullet`);
  }
  if (!oneField && fields.length > MAX_SERIES) {
    out.push(`chart draws at most ${MAX_SERIES} series, and y lists ${fields.length}. Keep ${MAX_SERIES} fields or fewer, or make two charts`);
  }
  const labels = props.labels;
  if (labels !== undefined && !labels.includes("{") && kind === "scatter") {
    const n = labelsOf(labels).length;
    if (n === 1) out.push(`labels= names a scatter's two axes, x then y, like labels="Risk,Return". To name each dot, use label=${labels} (no s)`);
    else if (n !== 2) out.push(`labels= names a scatter's two axes, x then y, like labels="Risk,Return"; it has ${n} names`);
  } else if (labels !== undefined && !labels.includes("{")) {
    if (isRound(kind as Kind)) out.push(`labels= names the y fields of a bar or line chart; a ${kind}'s slices are named by x=, so labels= was ignored`);
    else if (oneField) out.push(`labels= names the y fields of a bar or line chart; a ${kind}'s items are named by x=, so labels= was ignored`);
    else if (labelsOf(labels).length !== fields.length) {
      out.push(`labels has ${labelsOf(labels).length} names for ${fields.length} y field${fields.length === 1 ? "" : "s"}; give one per field, in the same order, like labels="This year,Last year"`);
    }
  }
  return out;
}

export const chart: ComponentDef = {
  type: "chart",
  category: "data",
  description:
    "A chart of a list of records: bar or line for one or more numbers per item, such as revenue and last year's revenue by month, stacked for each item's total split into parts, such as revenue by product per month, area for an amount over time, hbar for a ranking with long names, such as top customers, pie or donut for how one number splits across items, such as sales by region, funnel for how many get through each stage, such as leads to won deals, waterfall for how changes add up to a total, such as revenue minus costs, bullet for each KPI against its target, such as quarterly goals, heatmap for one number across two dimensions, such as retention by cohort, scatter for how two numbers relate, such as price against rating, treemap for how a total splits across many parts, such as costs by line item, or sankey for how amounts flow from sources to where they end up, such as budget to departments to projects. It redraws when the list changes, and shows at most 200 items, 6 series and 6 slices (smaller slices are summed into Other).",
  text: { description: "A title above the chart." },
  props: {
    kind: {
      type: "enum", values: KINDS, default: "bar",
      description: "bar compares categories and always starts at 0; hbar draws the bars across, one row per item with its name on the left and its value at the end, for rankings and long names (top 10 artists or customers): sort the list and take() the top items, since rows are drawn in list order; line shows a trend in list order, scaled to the values; area is a line with the space under it filled down to 0, for amounts over time such as visitors a week; stacked piles each item's y fields into one bar, bottom up in the order written, with its total on top, for parts of a whole such as revenue by product per month; pie and donut show each item's share of the total, and donut puts the total in the middle; funnel shows stages top to bottom in list order, each with its share of the stage before; waterfall shows each item as a change from the running total, rises good and falls bad, with total= adding the final total as a last bar; bullet gives each item a row with its bar against the goal in target=, colored good when on target, warn when close and bad when far off, each row on its own scale so mixed units fit, at most 20 rows; heatmap draws a grid with a row per value of rows= and a column per value of x=, each cell shaded by its y number (darker is more), for patterns such as orders by weekday and hour; scatter puts a dot per item at its x and y numbers, both on number scales, with label= naming each dot, size= sizing it by a number and group= coloring it by category (at most 6), and labels= naming the axes, e.g. labels=\"Risk,Return\"; treemap splits a rectangle into one per item, its area its share of the total, biggest top left in the strongest color, with names where they fit, for when there are too many parts for a pie (up to 60; the smallest are drawn together as one). sankey draws bands between columns of places, each as thick as its amount, from one flow per item: from= and to= name the places and y= the amount; columns are worked out from the flows, and flows that go round in a circle show a message (at most 40 places and 120 flows). pie, donut, funnel, waterfall, bullet, heatmap, scatter, treemap and sankey take one y field; pie, donut, funnel, bullet, treemap and sankey take no negative values.",
    },
    items: { type: "expression", required: true, description: "The list of records to chart, e.g. items=sales or items={filter(sales, 'open')}." },
    x: { type: "name", required: true, unlessProp: { name: "kind", values: ["sankey"] }, description: "The field holding each item's label (each slice's name in a pie), e.g. x=month. For scatter, the field with each item's x number. Not used by sankey." },
    y: {
      type: "names", required: true,
      description: "The field holding each item's number, e.g. y=revenue. Bar, hbar and line can compare up to 6 fields on one scale, separated by commas with no spaces, e.g. y=revenue,last_year; each gets its own color and a legend. stacked and area take up to 6 fields too. Items without a number are shown as gaps, not zero.",
    },
    labels: {
      type: "string",
      description: "Bar, hbar, line, area and stacked with several y fields: the legend's names, in the same order, separated by commas, e.g. labels=\"This year,Last year\". Without it the legend shows the field names. Scatter: the two axes' names, x then y, e.g. labels=\"Risk,Return\".",
    },
    label: { type: "name", description: "Scatter only: the field naming each dot, shown in its tip and the data table, e.g. label=name." },
    size: { type: "name", description: "Scatter only: the field whose number sizes each dot (its area), for bubbles, e.g. size=assets." },
    group: { type: "name", description: "Scatter only: the field whose category colors each dot, with a legend, at most 6, e.g. group=type." },
    from: { type: "name", description: "Sankey only: the field naming where each flow starts, e.g. from=source." },
    to: { type: "name", description: "Sankey only: the field naming where each flow goes, e.g. to=target." },
    rows: { type: "name", description: "Heatmap only: the field holding each item's row, e.g. rows=day; x= holds its column and y= its number." },
    target: { type: "name", description: "Bullet only: the field holding each item's goal, drawn as a dark tick across its bar, e.g. target=goal." },
    good: { type: "enum", values: ["up", "down"], default: "up", description: "Bullet only: up when reaching or passing the target is good (sales, signups), down when staying under it is (costs, churn, response time)." },
    total: { type: "string", description: "Waterfall only: the name of an extra last bar showing the total the changes add up to, e.g. total=\"Net income\"." },
    format: { type: "enum", values: FORMATS, default: "number", description: "How values read on the axis, at the ends of hbar bars, in a pie's legend and in a donut's middle: number (37K), money ($37K) or percent (42%), for values that are already percentages, like a rate of 42 or a retention of 61.5. On a scatter it formats y only; x reads as a plain number." },
  },
  picks: [
    { for: "a ranking or a top 10 with long names", write: "chart kind=hbar" },
    { for: "parts of each total, such as revenue by product per month", write: "chart kind=stacked y=hardware,software" },
    { for: "an amount over time, such as visitors a week", write: "chart kind=area" },
    { for: "two or more series over the same time, such as daily users on web and on mobile", write: "chart kind=line y=web,mobile" },
    { for: "how one whole splits up, such as sales by region", write: "chart kind=donut" },
    { for: "stages people drop out of, such as leads to won deals", write: "chart kind=funnel" },
    { for: "changes adding up to a total, such as revenue minus costs", write: "chart kind=waterfall total=\"Net income\"" },
    { for: "several KPIs, quotas or budgets against their targets (good=down when under target is good)", write: "chart kind=bullet target=goal" },
    { for: "one number across two dimensions, such as retention by cohort or orders by weekday and hour", write: "chart kind=heatmap rows=day x=hour y=orders" },
    { for: "how two numbers relate, such as risk against return", write: "chart kind=scatter x=risk y=return label=name" },
    { for: "parts of a total when there are too many for a pie", write: "chart kind=treemap" },
    { for: "how amounts flow from sources to where they end up", write: "chart kind=sankey from=source to=target" },
  ],
  example: `state sales=[{month: "Jan", revenue: 12000, last_year: 10000}, {month: "Feb", revenue: 18000, last_year: 14000}, {month: "Mar", revenue: 15000, last_year: 16000}]
chart "Revenue vs last year" kind=line items=sales x=month y=revenue,last_year labels="This year,Last year" format=money`,
  check,
  minWidth: () => 200,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const kind = p.oneOf("kind", KINDS, "bar");
    const format = p.oneOf("format", FORMATS, "number");
    const x = p.str("x");
    const fields = fieldsOf(p.str("y"));
    const own = CHART_KINDS[kind];
    if (ctx.isLoading?.(box.node)) {
      const shape = own?.loadingAs ?? kind;
      const out = loadingGeometry(box, shape, isRound(shape) || (own && !own.multiField) ? 1 : Math.min(MAX_SERIES, Math.max(1, fields.length)), p.text(), ctx);
      box.data = out.g;
      box.h = out.h;
      return;
    }
    const items = p.expr("items");
    const line = box.node.line;
    if (p.has("items") && !isList(items)) ctx.warn?.(`chart on line ${line}: items is not a list, so there's nothing to chart. Use a list of records, like items=sales`);
    let out: { g: ChartGeometry; h: number };
    if (own) {
      const extra: Record<string, string> = {};
      if (p.has("total")) extra.total = p.str("total");
      if (p.has("target")) extra.target = p.str("target");
      if (p.has("rows")) extra.rows = p.str("rows");
      if (p.has("good")) extra.good = p.oneOf("good", ["up", "down"] as const, "up");
      for (const f of ["label", "size", "group", "from", "to"]) if (p.has(f)) extra[f] = p.str(f);
      out = own.layout(box, { items, x, y: fields[0] ?? "", fields, labels: labelsOf(p.str("labels")), format, title: p.text(), line, extra }, ctx);
    } else if (isRound(kind)) {
      out = roundGeometry(box, pieData(items, x, fields[0] ?? ""), kind, format, p.text(), line, ctx);
    } else if (fields.length > MAX_SERIES) {
      ctx.warn?.(`chart on line ${line}: y lists ${fields.length} fields; a chart draws at most ${MAX_SERIES}`);
      const { say } = header(box, kind, p.text(), ctx);
      const g = say(`Too many series to chart: at most ${MAX_SERIES}`);
      out = { g, h: g.plot.y + g.plot.h };
    } else {
      const ys = fields.length ? fields : [""];
      const labels = labelsOf(p.str("labels"));
      const series = ys.map((field, k) => ({ field, label: labels[k] || field, color: k }));
      const data = chartSeries(items, x, ys);
      out = kind === "hbar" ? hbarGeometry(box, data, series, format, p.text(), line, ctx) : axisGeometry(box, data, series, kind as AxisKind, format, p.text(), line, ctx);
    }
    box.data = out.g;
    box.h = out.h;
  },
  hitTest(box, x, y, detail) {
    // A scatter's dot regions are for the keyboard; the pointer goes to the whole chart's region.
    if (typeof detail === "string" && detail.startsWith("dot:")) return null;
    const d = box.data as ChartGeometry | undefined;
    const h = d && chartHoverAt(d, x - box.x, y - box.y);
    return h ? { detail: h.kind + ":" + h.index } : null;
  },
  cursor: () => "crosshair",
  key(ctx, key) {
    // Scatter only: the arrow keys move from dot to dot in x order, Home and End to the ends.
    const d = ctx.target.box.data as ChartGeometry | undefined;
    const detail = ctx.target.detail;
    if (!d || d.kind !== "scatter" || !d.slots.length || typeof detail !== "string" || !detail.startsWith("dot:")) return false;
    const v = ctx.view(ctx.target.node);
    const n = d.slots.length, at = Math.max(0, Math.min(n - 1, Number(detail.slice(4)) || 0));
    const next = key === "ArrowRight" || key === "ArrowDown" ? at + 1 : key === "ArrowLeft" || key === "ArrowUp" ? at - 1 : key === "Home" ? 0 : key === "End" ? n - 1 : null;
    if (next === null) return false;
    v.point = Math.max(0, Math.min(n - 1, next));
    // Focus moves to the dot itself, so a screen reader reads it out.
    ctx.focusPart?.(`dot:${v.point}`);
    return true;
  },
  paintLoading: paintChartLoading,
  semantics: chartSemantics,
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as ChartGeometry | undefined;
    if (!d) return;
    // Laid out while loading but painted after the data came: wait for the next layout.
    if (d.loading) return paintChartLoading(box, ctx);
    const ox = box.x, oy = box.y;
    const palette = seriesColors(theme);
    // Segments are neutral by default; only hovered slices take the accent.
    const slices = sliceColors(theme);
    // One series draws in the accent, exactly as before series existed.
    const colorOf = (k: number) => (d.series.length > 1 ? palette[k % palette.length]! : c.accent);
    g.textBaseline = "middle";

    paintTitle(ctx, d, ox, oy);
    if (d.message) return paintMessage(ctx, d, ox, oy);

    // The engine already tracks chart pointer hover and repaints when the datum changes.
    // This region is mouse-only: charts do not introduce meaningless keyboard tab stops.
    // A scatter is the exception: its dots have no other way to be read one by one, so they
    // are keyboard stops of their own (chart-kinds/scatter.ts), one Tab stop for them all.
    ctx.addHit(box, { focusable: false });

    // Just after its data arrived: marks grow into place while the rest fades in.
    const reveal = ctx.reveal(box.node);
    const fade = easeOut(reveal * 2.5);
    const base = g.globalAlpha;

    const own = d.custom !== undefined ? CHART_KINDS[d.kind] : undefined;
    if (own) {
      own.paint(box, ctx, d, reveal);
      g.globalAlpha = base;
      if (reveal >= 1) paintChartHover(box, ctx, d);
      return;
    }

    if (d.pie) {
      // Only paint geometry is interpolated. The model's data and legend
      // still reflect the latest values; hover resolves against visible arcs.
      const shown = {
        ...d,
        pie: {
          ...d.pie,
          slices: morphPieSlices(d.pie.slices, (key, target) => ctx.tween(box.node, key, target, 520)),
        },
      };
      paintRound(box, ctx, shown, ox, oy, slices, reveal);
      g.globalAlpha = base * fade;
      paintLegend(ctx, d, ox, oy, (k) => slices[k % slices.length]!);
      g.globalAlpha = base;
      if (reveal >= 1) paintChartHover(box, ctx, shown);
      return;
    }

    if (d.kind === "hbar") {
      paintHbar(box, ctx, d, ox, oy, colorOf, reveal);
      g.globalAlpha = base;
      if (reveal >= 1) paintChartHover(box, ctx, d);
      return;
    }

    const px = ox + d.plot.x, pw = d.plot.w;
    g.globalAlpha = base * fade;
    paintAxisGrid(ctx, d, ox, oy);

    g.globalAlpha = base;
    g.fillStyle = c.accent;
    g.strokeStyle = c.accent;
    if (d.kind === "bar") {
      const zero = d.zeroY ?? d.plot.y + d.plot.h;
      const hot = ctx.pointer && ctx.isHovered(box.node)
        ? chartHoverAt(d, ctx.pointer.x - ox, ctx.pointer.y - oy)
        : null;
      const showLabels = d.series.length === 1 && d.slots.length <= 7 && pw / d.slots.length >= 54;
      const format = ctx.props(box.node).oneOf("format", FORMATS, "number");
      d.slots.forEach((s, i) => {
        // A wave from left to right: each bar grows out of the zero line.
        const grow = reveal < 1 ? staggered(reveal, i, d.slots.length) : 1;
        (s.bars ?? []).forEach((full, k) => {
          if (!full || full.h <= 0) return;
          const up = full.y + full.h / 2 < zero;
          const h = ctx.tween(box.node, `bar:${i}:${k}`, full.h, 440) * grow;
          if (h <= 0.25) return;
          const b = { x: full.x, y: up ? full.y + full.h - h : full.y, w: full.w, h };
          barPath(g, ox + b.x, oy + b.y, b.w, b.h, Math.min(7, b.w / 2, b.h), up);
          const hover = ctx.tween(box.node, `bar:highlight:${i}:${k}`,
            hot?.kind === "slot" && hot.index === i ? 1 : 0, 165);
          paintPremiumBar(ctx, { x: ox + b.x, y: oy + b.y, w: b.w, h: b.h },
            colorOf(k), up ? "up" : "down", hover);
          if (showLabels && k === 0 && s.values[0] !== null) {
            let label = valueText(s.values[0]!, format);
            g.save();
            g.font = ctx.font(600, 11);
            const slotRoom = pw / d.slots.length - 8;
            const outside = up ? b.y - 9 : b.y + b.h + 9;
            const roomOutside = outside >= d.plot.y + 8 && outside <= d.plot.y + d.plot.h - 8;
            // Near the plot edge, place the value inside a tall bar instead
            // of dropping the label or letting it clip above the chart.
            const inside = !roomOutside && b.h >= 30;
            const labelY = roomOutside ? outside : up ? b.y + 14 : b.y + b.h - 14;
            // Inside, the bar is the room, not the slot: try the short form ($24K) before giving up.
            const room = inside ? b.w - 6 : slotRoom;
            if (inside && g.measureText(label).width >= room) label = shortValueText(s.values[0]!, format);
            if ((roomOutside || inside) && g.measureText(label).width < room) {
              g.textAlign = "center";
              g.textBaseline = "middle";
              g.fillStyle = inside ? c.onAccent : c.muted;
              g.globalAlpha *= 0.9;
              g.fillText(label, ox + b.x + b.w / 2, oy + labelY);
            }
            g.restore();
          }
        });
      });
    } else {
      // The lines run in from the left.
      g.save();
      if (reveal < 1) {
        g.beginPath();
        g.rect(px - 6, oy + d.plot.y - 6, (pw + 12) * easeOut(reveal), d.plot.h + 12);
        g.clip();
      }
      // Smooth state-driven point updates on one shared canvas clock.
      // Layout and pointer hit testing retain the authoritative new geometry.
      const drawnPoints = new Map<{ x: number; y: number }, { x: number; y: number }>();
      d.slots.forEach((s, i) => s.points?.forEach((pt, k) => {
        if (pt) drawnPoints.set(pt, { x: pt.x, y: ctx.tween(box.node, `line:${i}:${k}`, pt.y, 440) });
      }));
      const drawnSeries = d.seriesSegments.map((runs) => runs.map((run) => run.map((pt) => drawnPoints.get(pt) ?? pt)));
      // Restrained vertical gradient fills use only existing theme colors.
      // Limit overlapping washes to two series so larger comparisons stay clear.
      if (drawnSeries.length <= 2) {
        const floor = oy + d.plot.y + d.plot.h;
        drawnSeries.forEach((runs, k) => {
          const gradient = g.createLinearGradient(0, oy + d.plot.y, 0, floor);
          gradient.addColorStop(0, colorOf(k));
          gradient.addColorStop(1, c.raised);
          for (const run of runs) {
            if (run.length < 2) continue;
            g.beginPath();
            traceSmoothLine(g, run, ox, oy);
            g.lineTo(ox + run[run.length - 1]!.x, floor);
            g.lineTo(ox + run[0]!.x, floor);
            g.closePath();
            g.save();
            g.fillStyle = gradient;
            g.globalAlpha *= drawnSeries.length === 1 ? 0.17 : 0.085;
            g.fill();
            g.restore();
          }
        });
      }
      g.lineJoin = "round";
      g.lineCap = "round";
      drawnSeries.forEach((runs, k) => {
        for (const run of runs) {
          if (run.length < 2) continue;
          g.beginPath();
          traceSmoothLine(g, run, ox, oy);
          g.strokeStyle = colorOf(k);
          // A hair of colored depth below a crisp core, not a permanent glow.
          g.save();
          g.lineWidth = 5;
          g.globalAlpha *= 0.11;
          g.stroke();
          g.restore();
          g.lineWidth = 2.25;
          g.stroke();
        }
      });
      // Dots: on every point when there's room, and always on a point with no neighbours.
      const slotW = pw / Math.max(1, d.slots.length);
      drawnSeries.forEach((runs, k) => {
        for (const run of runs) {
          for (const pt of run) {
            if (slotW < 10 && run.length > 1) continue;
            g.beginPath();
            g.arc(ox + pt.x, oy + pt.y, run.length === 1 ? 3.5 : 2.75, 0, Math.PI * 2);
            g.fillStyle = c.raised;
            g.fill();
            g.lineWidth = 1.75;
            g.strokeStyle = colorOf(k);
            g.stroke();
          }
        }
      });
      g.restore();
    }

    g.globalAlpha = base * fade;
    paintSlotLabels(ctx, d, ox, oy);
    if (d.legend.length) paintLegend(ctx, d, ox, oy, colorOf);
    if (reveal >= 1) paintChartHover(box, ctx, d);
  },
};


function paintRound(box: Box, ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, palette: readonly string[], reveal = 1): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const pie = d.pie!;
  const cx = ox + pie.cx, cy = oy + pie.cy;
  // Angles are measured clockwise from the top; the canvas's 0 is at three o'clock.
  const at = (a: number) => a - Math.PI / 2;
  // Just after the data arrived, the slices sweep round from the top.
  const sweep = reveal < 1 ? Math.PI * 2 * easeOut(reveal) : Infinity;
  const base = g.globalAlpha;
  for (const s of pie.slices) {
    if (s.start >= sweep) break;
    const end = Math.min(s.end, sweep);
    if (end - s.start <= 1e-6) continue;
    g.beginPath();
    if (pie.inner) {
      g.arc(cx, cy, pie.r, at(s.start), at(end));
      g.arc(cx, cy, pie.inner, at(end), at(s.start), true);
    } else {
      g.moveTo(cx, cy);
      g.arc(cx, cy, pie.r, at(s.start), at(end));
    }
    g.closePath();
    g.fillStyle = palette[s.color % palette.length]!;
    g.fill();
  }
  // A thin surface line between slices, so neighbours read apart without relying on color.
  if (pie.slices.length > 1) {
    g.lineWidth = 2;
    g.lineCap = "butt";
    g.strokeStyle = c.raised;
    for (const s of pie.slices) {
      if (s.start >= sweep) break;
      if (s.end - s.start <= 1e-6) continue;
      const a = at(s.start);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * pie.inner, cy + Math.sin(a) * pie.inner);
      g.lineTo(cx + Math.cos(a) * (pie.r + 1), cy + Math.sin(a) * (pie.r + 1));
      g.stroke();
    }
  }
  if (pie.center) {
    const m = pie.center;
    g.globalAlpha = base * easeOut((reveal - 0.4) / 0.6);
    const capLH = Math.round(theme.text.caption * 1.4);
    const shift = m.caption ? capLH / 2 : 0;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = m.font;
    g.fillStyle = c.ink;
    const total = ctx.tween(box.node, "pie:center:total", pie.total, 520);
    const format = ctx.props(box.node).oneOf("format", FORMATS, "number");
    const moving = total === pie.total ? m.text : valueText(total, format);
    g.fillText(g.measureText(moving).width <= pie.inner * 1.7 ? moving : m.text, cx, cy - shift);
    if (m.caption) {
      g.font = m.captionFont;
      g.fillStyle = c.muted;
      g.fillText(m.caption, cx, cy - shift + m.lh / 2 + capLH / 2);
    }
  }
}



/** The dot the arrow keys are on while a scatter has focus, or -1. */
function scatterFocus(box: Box, ctx: PaintCtx, d: ChartGeometry): number {
  for (let i = 0; i < d.slots.length; i++) if (ctx.isFocused(box.node, `dot:${i}`)) return i;
  return -1;
}

/** Draw the active mark and an in-canvas tooltip. This works in sandboxed MCP Apps
 * without a DOM portal, network access, or a second UI layer. */
function paintChartHover(box: Box, ctx: PaintCtx, d: ChartGeometry): void {
  let hover: ChartHover | null = null;
  let anchor: { x: number; y: number; gap?: number } | null = null;
  if (ctx.pointer && ctx.isHovered(box.node)) {
    hover = chartHoverAt(d, ctx.pointer.x - box.x, ctx.pointer.y - box.y);
    anchor = ctx.pointer;
  }
  // A scatter with keyboard focus shows the tip of the dot the arrow keys are on.
  const focusedDot = d.kind === "scatter" && d.slots.length ? scatterFocus(box, ctx, d) : -1;
  if (!hover && focusedDot >= 0) {
    const pt = d.slots[focusedDot]!.point!;
    hover = { kind: "slot", index: focusedDot };
    // Clear of the dot and its ring, so the tip never covers what it describes.
    const r = ((d.custom as { dots: Array<{ r: number }> }).dots[focusedDot]?.r ?? 5) + 6;
    anchor = { x: box.x + pt.x + r - 13, y: box.y + pt.y, gap: r };
  }
  if (!hover || !anchor) return;
  const { g, theme } = ctx;
  const c = theme.colors, palette = seriesColors(theme);
  const ox = box.x, oy = box.y;
  const format = ctx.props(box.node).oneOf("format", FORMATS, "number");
  const precise = (value: number): string => {
    const opts: Intl.NumberFormatOptions = { maximumFractionDigits: 6 };
    return formatter(format, opts).format(value);
  };
  let heading = "";
  const rows: Array<{ text: string; color: string }> = [];
  g.save();
  if (hover.kind === "slice" && d.pie) {
    const s = d.pie.slices[hover.index]!;
    heading = s.label;
    rows.push({ text: precise(s.value) + " · " + shareText(s.share), color: c.accent });
    const p = d.pie, toCanvas = (a: number) => a - Math.PI / 2;
    g.beginPath();
    g.arc(ox + p.cx, oy + p.cy, p.r, toCanvas(s.start), toCanvas(s.end));
    if (p.inner) g.arc(ox + p.cx, oy + p.cy, p.inner, toCanvas(s.end), toCanvas(s.start), true);
    else g.lineTo(ox + p.cx, oy + p.cy);
    g.closePath();
    g.fillStyle = c.accent;
    g.fill();
    g.strokeStyle = c.raised;
    g.lineWidth = 2;
    g.stroke();
    // Keep the legend keyed to the active slice rather than leaving a gray marker.
    const swatch = d.legend[hover.index]?.swatch;
    if (swatch) {
      ctx.roundRect(ox + swatch.x, oy + swatch.y, swatch.w, swatch.h, 3);
      g.fillStyle = c.accent;
      g.fill();
    }
  } else if (hover.kind === "slot") {
    const s = d.slots[hover.index]!;
    heading = s.label;
    if (s.notes) {
      s.notes.forEach((text, i) => {
        const k = s.noteSeries?.[i];
        rows.push({ text, color: k === null || k === undefined ? c.accent : palette[k % palette.length]! });
      });
    }
    else s.values.forEach((v, k) => {
      if (v !== null) {
        rows.push({
          text: (d.series.length > 1 ? d.series[k]!.label : "Value") + ": " + precise(v),
          color: d.series.length > 1 ? palette[k % palette.length]! : c.accent,
        });
      }
    });
    if (d.kind === "line") {
      g.beginPath();
      const guideX = ctx.tween(box.node, "chart:crosshair", s.cx, 105);
      g.moveTo(ox + guideX + 0.5, oy + d.plot.y);
      g.lineTo(ox + guideX + 0.5, oy + d.plot.y + d.plot.h);
      g.strokeStyle = c.muted;
      g.globalAlpha *= 0.65;
      g.lineWidth = 1;
      g.setLineDash([3, 4]);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      s.points?.forEach((pt, k) => {
        if (!pt) return;
        const markerY = oy + ctx.tween(box.node, `line:${hover.index}:${k}`, pt.y, 440);
        const color = d.series.length > 1 ? palette[k % palette.length]! : c.accent;
        g.beginPath();
        g.arc(ox + pt.x, markerY, 10, 0, Math.PI * 2);
        g.fillStyle = color;
        const markerAlpha = g.globalAlpha;
        g.globalAlpha = markerAlpha * 0.16;
        g.fill();
        g.globalAlpha = markerAlpha;
        g.beginPath();
        g.arc(ox + pt.x, markerY, 5.25, 0, Math.PI * 2);
        g.fillStyle = c.raised;
        g.fill();
        g.lineWidth = 2.5;
        g.strokeStyle = d.series.length > 1 ? palette[k % palette.length]! : c.accent;
        g.stroke();
      });
    } else if (d.kind === "sankey") {
      paintSankeyHover(ctx, d, hover.index, ox, oy);
    } else if (d.kind === "scatter" && s.point) {
      // A ring around the dot, clear of it, in ink so it reads on any series color.
      const r = ((d.custom as { dots: Array<{ r: number }> }).dots[hover.index]?.r ?? 5) + 3.5;
      g.beginPath();
      g.arc(ox + s.point.x, oy + s.point.y, r, 0, Math.PI * 2);
      g.strokeStyle = c.ink;
      g.lineWidth = 2;
      g.stroke();
    } else if (!d.noHoverOutline) {
      for (const b of s.bars ?? []) {
        if (!b || b.w <= 0 || b.h <= 0) continue;
        ctx.roundRect(ox + b.x, oy + b.y, b.w, b.h, Math.min(4, b.w / 2, b.h / 2));
        g.strokeStyle = c.ink;
        g.globalAlpha *= 0.72;
        g.lineWidth = 2;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
  }
  g.restore();
  if (!rows.length) return;

  // A bounded floating surface that never escapes the chart, even in a narrow chat.
  const pad = 10, rowH = 18, titleH = 19;
  const widthLimit = Math.max(1, box.w - 12);
  const headingFont = themeFont(theme, 600, theme.text.caption + 1);
  const bodyFont = themeFont(theme, 400, theme.text.caption);
  g.save();
  g.font = headingFont;
  let needed = g.measureText(heading).width;
  g.font = bodyFont;
  for (const row of rows) needed = Math.max(needed, g.measureText(row.text).width + 14);
  const w = Math.min(widthLimit, Math.max(132, Math.ceil(needed) + pad * 2));
  const h = pad * 2 + titleH + rows.length * rowH;
  const minX = box.x + 6, maxX = box.x + box.w - w - 6;
  const x = Math.max(minX, Math.min(maxX, anchor.x + 13));
  const minY = box.y + 5, maxY = box.y + box.h - h - 5;
  const above = anchor.y - h - (anchor.gap ?? 10);
  const y = Math.max(minY, Math.min(maxY, above < minY ? anchor.y + (anchor.gap ?? 12) : above));
  ctx.roundRect(x, y, w, h, theme.radius.md);
  g.shadowColor = c.shadow;
  g.shadowBlur = 14;
  g.shadowOffsetY = 4;
  g.fillStyle = c.raised;
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  g.stroke();

  const fitText = (value: string, font: string, max: number): string => {
    g.font = font;
    if (g.measureText(value).width <= max) return value;
    let end = value.length;
    while (end > 0 && g.measureText(value.slice(0, end) + "…").width > max) end--;
    return end ? value.slice(0, end) + "…" : "";
  };
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = c.ink;
  g.font = headingFont;
  g.fillText(fitText(heading, headingFont, w - pad * 2), x + pad, y + pad + titleH / 2);
  rows.forEach((row, i) => {
    const lineY = y + pad + titleH + i * rowH + rowH / 2;
    g.beginPath();
    g.arc(x + pad + 3, lineY, 3, 0, Math.PI * 2);
    g.fillStyle = row.color;
    g.fill();
    g.fillStyle = c.muted;
    g.fillText(fitText(row.text, bodyFont, w - pad * 2 - 14), x + pad + 14, lineY);
  });
  g.restore();
}

/** A value in its shortest form, for a label that must fit inside a bar: $24K, 1.2M. */
function shortValueText(v: number, format: Format): string {
  const opts: Intl.NumberFormatOptions = { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 };
  try {
    return formatter(format, opts).format(v);
  } catch {
    return valueText(v, format);
  }
}
