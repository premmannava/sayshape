/**
 * The chart toolkit: the types, scales, number formats, titles, legends and
 * bar painting that every kind of chart shares. chart.ts draws bar, hbar,
 * line, pie and donut with it; each kind in chart-kinds/ (funnel, waterfall)
 * is built from the same parts, so a new kind is one small module.
 *
 * Like the rest of a component, layout helpers here only measure (headless),
 * and paint helpers only use theme tokens.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { fitLines, wrapText, type TextMeasurer } from "../text";
import { fieldOf, isList, isRecord } from "../data";
import { mixColors, type Theme } from "../theme";
import type { Value } from "../types";
import { fillTint, themeFont } from "./util";

/** The most items one chart draws. Larger lists show a message instead. */
export const MAX_CHART_ITEMS = 200;

export const KINDS = ["bar", "hbar", "line", "pie", "donut", "funnel", "waterfall"] as const;
export const FORMATS = ["number", "money"] as const;
export type Kind = (typeof KINDS)[number];

export type Format = (typeof FORMATS)[number];
export const LOCALE = "en-US";

export interface Rect { x: number; y: number; w: number; h: number }

export interface ChartSlot {
  /** The label as written in the data ("—" when missing). */
  label: string;
  /** The label as drawn, cut to fit, or null when thinned out to make room. */
  shownLabel: string | null;
  /** Where the label's centre is drawn: the slot's centre, moved in if it would stick out of the box. */
  labelX: number;
  /** Centre of the slot along x. */
  cx: number;
  /** The first series' value, or null for a gap. */
  value: number | null;
  /** Every series' value, in y's order. */
  values: Array<number | null>;
  /** Bar charts: the first series' bar, from the zero line to the value. */
  bar?: Rect;
  /** Bar charts: each series' bar, side by side in the slot; null for a gap. */
  bars?: Array<Rect | null>;
  /** Line charts: where the first series' value is. */
  point?: { x: number; y: number };
  /** Line charts: each series' point; null for a gap. */
  points?: Array<{ x: number; y: number } | null>;
  /** Horizontal bars: the centre of the item's row along y. */
  cy?: number;
  /** The tooltip's lines for this slot, when a kind says more than "Value: 12". */
  notes?: string[];
  /** Horizontal bars: each series' value as drawn at the end of its bar; null for a gap. */
  valueLabels?: Array<{ text: string; x: number; y: number; align: "left" | "right" } | null>;
}

/** One entry of the legend below a chart, relative to the box. */
export interface LegendItem {
  /** Index into the theme's series colors. */
  color: number;
  /** Where the swatch is. */
  swatch: Rect;
  /** The name, as written and as drawn (cut to fit). */
  label: string;
  shownLabel: string;
  labelX: number;
  /** Pie and donut: the value and share ("$12K · 34%"), as drawn, right-aligned at detailX. */
  detail?: string;
  detailX?: number;
  /** Centre line of the entry's text. */
  y: number;
}

export interface PieSlice {
  label: string;
  value: number;
  /** Share of the total, 0 to 1. */
  share: number;
  /** Angles in radians, clockwise from the top. */
  start: number;
  end: number;
  color: number;
  /** True for the slice that sums the smallest items. */
  other?: boolean;
}

/** Everything paint needs, relative to the chart's box. */
export type ChartGeometry = {
  kind: Kind;
  title: string[];
  titleFont: string;
  titleLH: number;
  labelFont: string;
  /** Shown instead of a plot: no data, too many items, too narrow. */
  message?: string;
  /** The message as drawn: wrapped to the box, at most three lines. */
  messageLines?: string[];
  plot: Rect;
  /** Value axis ticks, top to bottom is not guaranteed; y is where each is drawn. */
  ticks: Array<{ value: number; y: number; label: string }>;
  /** Where 0 is, when it's on the scale. */
  zeroY: number | null;
  /** Horizontal bars: where 0 is across the plot. */
  zeroX?: number;
  /** Horizontal bars: each row's height. */
  rowH?: number;
  min: number;
  max: number;
  slots: ChartSlot[];
  /** Line charts: runs of neighbouring values of the first series, broken at gaps. */
  segments: Array<Array<{ x: number; y: number }>>;
  /** Line charts: the runs of every series, in y's order (the first is `segments`). */
  seriesSegments: Array<Array<Array<{ x: number; y: number }>>>;
  /** The series drawn, in y's order: their names and colors. */
  series: Array<{ field: string; label: string; color: number }>;
  labelY: number;
  /** Below the plot: series names (2 or more series), or slices with value and share. */
  legend: LegendItem[];
  legendFont: string;
  /** Data still loading: draw a placeholder of this shape (series: how many, for the legend). */
  loading?: { series: number };
  /** A kind from chart-kinds/: its own geometry, which only that kind's paint reads. */
  custom?: unknown;
  /** Hover: the kind draws its own highlight, so the tooltip shouldn't outline the slot's bars. */
  noHoverOutline?: boolean;
  /** Pie and donut. */
  pie?: {
    cx: number;
    cy: number;
    r: number;
    /** 0 for a pie; the hole's radius for a donut. */
    inner: number;
    slices: PieSlice[];
    total: number;
    /** Donut: the total in the middle, as drawn, and its font. */
    center?: { text: string; font: string; caption: string; captionFont: string; lh: number };
  };
};

// ---------------------------------------------------------------- scale

/**
 * A step of 1, 2 or 5 times a power of ten, nearest to raw. Rounding to the
 * nearest (not up) keeps the top of the scale close to the biggest value, at
 * the cost of up to half as many ticks again as asked for.
 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

/** Clean float noise (0.1 + 0.2) from a tick without toFixed, which fails past 100 digits. */
function cleanTick(v: number, step: number): number {
  if (Math.abs(v) < step * 1e-9) return 0;
  return Number(v.toPrecision(15));
}

/** The value range and ticks: bars include 0; a constant line gets room around it. */
export function chartScale(values: readonly number[], kind: Kind, target: number): { min: number; max: number; step: number; ticks: number[] } {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (kind === "bar") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) {
    // Constant values: never divide by zero; keep 0 as a bound when it is one.
    if (lo === 0) hi = 1;
    else if (kind === "bar") lo < 0 ? (hi = 0) : (lo = 0);
    else {
      // At least the smallest number, so even 5e-324 gets room; never past the largest.
      const pad = Math.max(Math.abs(lo) * 0.1, Number.MIN_VALUE);
      lo = Math.max(lo - pad, -Number.MAX_VALUE);
      hi = Math.min(hi + pad, Number.MAX_VALUE);
    }
  }
  // Halves, so a range like -1e308..1e308 doesn't overflow to Infinity.
  const step = niceStep((hi / 2 - lo / 2) / Math.max(1, target) * 2);
  const first = Math.floor(lo / step + 1e-9), last = Math.ceil(hi / step - 1e-9);
  const ticks: number[] = [];
  // Count steps with k, not first + k: past 2^53, adding 1 to first changes nothing.
  const count = last - first;
  for (let k = 0; k <= count && k <= 50; k++) {
    const v = cleanTick((first + k) * step, step);
    if (isFinite(v) && v !== ticks[ticks.length - 1]) ticks.push(v);
  }
  // Ticks that don't cover the values or can't be told apart (numbers past
  // what a double can step through, like 1e15 + 0.1): use the values' own bounds.
  if (ticks.length < 2 || ticks[0]! > lo || ticks[ticks.length - 1]! < hi) return { min: lo, max: hi, step: hi / 2 - lo / 2, ticks: [lo, hi] };
  return { min: ticks[0]!, max: ticks[ticks.length - 1]!, step, ticks };
}

/** The fewest decimals that show x exactly (2.5 → 1), or 21 when none up to 20 do. */
function decimalsOf(x: number): number {
  for (let d = 0; d <= 20; d++) {
    const s = x * 10 ** d;
    if (Math.abs(s - Math.round(s)) <= 1e-6 * Math.max(1, Math.abs(s))) return d;
  }
  return 21;
}

/**
 * Labels for a whole axis, in one format, chosen so every tick reads exactly
 * and no two read the same: compact ($12K) when the step allows it, then
 * plain numbers, then scientific notation for very large or small values.
 */
export function tickLabels(ticks: readonly number[], step: number, format: Format): string[] {
  const money = format === "money";
  const biggest = Math.max(...ticks.map(Math.abs));
  const tries: Intl.NumberFormatOptions[] = [];
  if (biggest >= 10_000 && biggest < 1e15) {
    const unit = 10 ** (3 * Math.floor(Math.log10(biggest) / 3));
    const f = decimalsOf(step / unit);
    if (f <= 2) tries.push({ notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: f });
  }
  const d = decimalsOf(step);
  if (biggest < 1e15 && d <= 6) {
    const digits = money && d > 0 ? Math.max(2, d) : d;
    tries.push({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  for (let f = 0; f <= 15; f++) tries.push({ notation: "scientific", minimumFractionDigits: 0, maximumFractionDigits: f });
  for (const opts of tries) {
    try {
      const nf = new Intl.NumberFormat(LOCALE, money ? { ...opts, style: "currency", currency: "USD" } : opts);
      // Zero reads as 0 in every format, not 0E0.
      const out = ticks.map((v) => (v === 0 && opts.notation === "scientific" ? (money ? "$0" : "0") : nf.format(Object.is(v, -0) ? 0 : v)));
      if (new Set(out).size === out.length) return out;
    } catch {
      // An option this runtime doesn't support: try the next.
    }
  }
  // JavaScript's own shortest form always tells two different numbers apart.
  return ticks.map((v) => (money ? "$" : "") + String(v));
}

// ---------------------------------------------------------------- layout

/** Cut text to fit a width, ending with an ellipsis. */
export function fit(text: string, width: number, font: string, m: TextMeasurer): string {
  if (m.width(text, font) <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (m.width(text.slice(0, mid) + "…", font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + "…" : "";
}

/** One value as it reads in a legend or a donut's middle: $12,000, 37.5, $1.2M. */
export function valueText(v: number, format: Format): string {
  const money = format === "money";
  const a = Math.abs(v);
  const whole = Number.isInteger(v);
  const opts: Intl.NumberFormatOptions =
    a >= 1e15 ? { notation: "scientific", minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : a >= 100_000 ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
    : { minimumFractionDigits: money && !whole ? 2 : 0, maximumFractionDigits: whole ? 0 : 2 };
  try {
    return new Intl.NumberFormat(LOCALE, money ? { ...opts, style: "currency", currency: "USD" } : opts).format(v);
  } catch {
    return (money ? "$" : "") + String(v);
  }
}

/** A value exactly, for a tooltip: 172,000 or $172,000.5, never shortened to $172K. */
export function preciseText(v: number, format: Format): string {
  const opts: Intl.NumberFormatOptions = { maximumFractionDigits: 6 };
  try {
    return new Intl.NumberFormat(LOCALE, format === "money" ? { ...opts, style: "currency", currency: "USD" } : opts).format(v);
  } catch {
    return (format === "money" ? "$" : "") + String(v);
  }
}

/** A share of a total as a whole percentage, with "<1%" for a sliver rather than "0%". */
export function shareText(share: number): string {
  const pct = share * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** Plot height for a width: wide enough to read, not taller than a phone screen wants. */
/** Room inside the plot so dots at the top and bottom stay within it. */
export const INSET = 5;

export const plotHeight = (w: number) => Math.round(Math.max(144, Math.min(238, w * 0.42)));

/** Legend swatches: size, and the space between a swatch and its name. */
export const SWATCH = 10;
export const SWATCH_GAP = 6;

export type Ctx = Pick<LayoutContext, "theme" | "measure" | "warn">;

/** The title and the parts every kind of chart shares. */
export function header(box: { w: number }, kind: Kind, title: string, ctx: Ctx) {
  const t = ctx.theme, m = ctx.measure;
  const titleFont = themeFont(t, 600, t.text.body), labelFont = themeFont(t, 400, t.text.caption);
  const titleLH = Math.round(t.text.body * 1.4);
  const titleLines = title ? wrapText(title, box.w, titleFont, m) : [];
  const top = titleLines.length ? titleLines.length * titleLH + t.space.sm : 0;
  const base: ChartGeometry = {
    kind, title: titleLines, titleFont, titleLH, labelFont,
    plot: { x: 0, y: top, w: box.w, h: 0 }, ticks: [], zeroY: null, min: 0, max: 0, slots: [], segments: [], seriesSegments: [],
    series: [], labelY: 0, legend: [], legendFont: themeFont(t, 400, t.text.caption + 1),
  };
  const say = (message: string): ChartGeometry => ({
    ...base, message, messageLines: fitLines(message, Math.max(0, box.w - 2 * t.space.sm), labelFont, m, 3), plot: { x: 0, y: top, w: box.w, h: 72 },
  });
  return { base, say, top };
}

/**
 * Series names side by side below the plot, starting a new line when the
 * next one doesn't fit; a name wider than the whole box is cut to fit.
 */
export function flowLegend(entries: Array<{ label: string; color: number }>, width: number, top: number, ctx: Ctx): { items: LegendItem[]; bottom: number } {
  const t = ctx.theme, m = ctx.measure;
  const font = themeFont(t, 400, t.text.caption + 1);
  const lh = Math.round(t.text.caption * 1.4);
  const lead = SWATCH + SWATCH_GAP;
  const items: LegendItem[] = [];
  let x = 0, y = top;
  for (const e of entries) {
    const shownLabel = fit(e.label, Math.max(0, width - lead), font, m);
    const w = lead + m.width(shownLabel, font);
    if (x > 0 && x + w > width) { x = 0; y += lh; }
    items.push({ color: e.color, swatch: { x, y: y + (lh - SWATCH) / 2, w: SWATCH, h: SWATCH }, label: e.label, shownLabel, labelX: x + lead, y: y + lh / 2 });
    x += w + t.space.md;
  }
  return { items, bottom: y + lh };
}


export type PaintCtx = Parameters<NonNullable<ComponentDef["paint"]>>[1];

/**
 * Paint a refined color surface in the existing bar path.
 * The strong color is at the free edge and softens gently toward the baseline;
 * the origin and the rounded free end still match the real data geometry.
 * We use the original series color as the first gradient stop so custom themes
 * and accessible category colors stay authoritative.
 */
export function paintPremiumBar(
  ctx: PaintCtx, rect: Rect, color: string,
  direction: "up" | "down" | "left" | "right", hover = 0,
): void {
  const { g, theme } = ctx;
  const endColor = mixColors(color, theme.colors.raised, 0.27) ?? color;
  const gradient = direction === "up"
    ? g.createLinearGradient(0, rect.y, 0, rect.y + rect.h)
    : direction === "down"
      ? g.createLinearGradient(0, rect.y + rect.h, 0, rect.y)
      : direction === "right"
        ? g.createLinearGradient(rect.x + rect.w, 0, rect.x, 0)
        : g.createLinearGradient(rect.x, 0, rect.x + rect.w, 0);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, endColor);
  g.fillStyle = gradient;
  g.fill();
  // Subtle edge definition and hover emphasis, without changing hit geometry.
  if (hover > 0) {
    fillTint(g, theme.colors.raised, 0.13 * hover);
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.globalAlpha *= 0.26 * hover;
    g.stroke();
    g.restore();
  }
}

/** A bar rounded only at its free end (the top of a rising bar, the bottom of a falling one), square on the axis. */
export function barPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, up: boolean): void {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  g.beginPath();
  if (up) {
    g.moveTo(x, y + h);
    g.lineTo(x, y + rr);
    g.arcTo(x, y, x + rr, y, rr);
    g.lineTo(x + w - rr, y);
    g.arcTo(x + w, y, x + w, y + rr, rr);
    g.lineTo(x + w, y + h);
  } else {
    g.moveTo(x, y);
    g.lineTo(x + w, y);
    g.lineTo(x + w, y + h - rr);
    g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    g.lineTo(x + rr, y + h);
    g.arcTo(x, y + h, x, y + h - rr, rr);
  }
  g.closePath();
}

export function paintLegend(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number, colorOf: (k: number) => string): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  g.font = d.legendFont;
  g.textBaseline = "middle";
  for (const it of d.legend) {
    ctx.roundRect(ox + it.swatch.x, oy + it.swatch.y, it.swatch.w, it.swatch.h, 3);
    g.fillStyle = colorOf(it.color);
    g.fill();
    g.textAlign = "left";
    g.fillStyle = d.pie ? c.ink : c.muted;
    if (it.shownLabel) g.fillText(it.shownLabel, ox + it.labelX, oy + it.y);
    if (it.detail && it.detailX !== undefined) {
      g.textAlign = "right";
      g.fillStyle = c.muted;
      g.fillText(it.detail, ox + it.detailX, oy + it.y);
    }
  }
}

/** The title above any chart, left-aligned, one line per wrapped line. */
export function paintTitle(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number): void {
  const { g, theme } = ctx;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.titleFont;
  g.fillStyle = theme.colors.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));
}

/** A chart that can't be drawn: its message centred in an outlined plot. */
export function paintMessage(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  ctx.roundRect(ox + 0.5, oy + d.plot.y + 0.5, d.plot.w - 1, d.plot.h - 1, theme.radius.md);
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  g.stroke();
  g.font = d.labelFont;
  g.fillStyle = c.muted;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const lines = d.messageLines ?? [d.message ?? ""];
  const lh = Math.round(theme.text.caption * 1.4);
  lines.forEach((l, i) => g.fillText(l, ox + d.plot.w / 2, oy + d.plot.y + d.plot.h / 2 + (i - (lines.length - 1) / 2) * lh));
}

/** Grid lines with their value labels on the left, and the zero line when 0 is on the scale. */
export function paintAxisGrid(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const px = ox + d.plot.x, pw = d.plot.w;
  g.lineWidth = 1;
  g.font = d.labelFont;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (const tk of d.ticks) {
    const ty = Math.round(oy + tk.y) + 0.5;
    g.beginPath();
    g.moveTo(px, ty);
    g.lineTo(px + pw, ty);
    g.strokeStyle = c.line;
    // Lighter than other lines: the grid is a guide, not part of the data.
    g.save();
    g.globalAlpha *= 0.55;
    g.stroke();
    g.restore();
    g.fillStyle = c.muted;
    g.fillText(tk.label, px - theme.space.sm, oy + tk.y);
  }
  if (d.zeroY !== null) {
    const zy = Math.round(oy + d.zeroY) + 0.5;
    g.beginPath();
    g.moveTo(px, zy);
    g.lineTo(px + pw, zy);
    // The zero line anchors the bars: firmer than the grid, quieter than the data.
    g.strokeStyle = c.muted;
    g.save();
    g.globalAlpha *= 0.45;
    g.stroke();
    g.restore();
  }
}

/** Each slot's label under the plot, centred where layout put it. */
export function paintSlotLabels(ctx: PaintCtx, d: ChartGeometry, ox: number, oy: number): void {
  const { g, theme } = ctx;
  g.font = d.labelFont;
  g.fillStyle = theme.colors.muted;
  g.textAlign = "center";
  g.textBaseline = "top";
  for (const s of d.slots) if (s.shownLabel) g.fillText(s.shownLabel, ox + s.labelX, oy + d.labelY);
  g.textBaseline = "middle";
}

/**
 * Category slots evenly across a plot, each with its label as drawn.
 * Prefer showing every category, shortened to its slot if necessary. Only thin
 * labels when slots are too small to show a useful name; a single long label
 * should not hide its neighbours (North America should not hide EMEA in a
 * five-bar chart). A label near an edge moves in so it stays inside the box.
 */
export function slotLabels(labels: readonly string[], plot: Rect, boxW: number, font: string, ctx: Ctx): Array<{ cx: number; shownLabel: string | null; labelX: number }> {
  const t = ctx.theme, m = ctx.measure;
  const slotW = plot.w / Math.max(1, labels.length);
  const widest = Math.min(Math.max(0, ...labels.map((l) => m.width(l, font))), 120);
  const every = slotW >= Math.max(52, t.text.caption * 4) ? 1 : Math.max(1, Math.ceil((widest + t.space.sm) / slotW));
  const room = Math.max(0, slotW * every - t.space.sm);
  return labels.map((label, i) => {
    const cx = plot.x + slotW * (i + 0.5);
    const shownLabel = i % every === 0 ? fit(label, room, font, m) : null;
    const half = shownLabel ? m.width(shownLabel, font) / 2 : 0;
    return { cx, shownLabel, labelX: Math.min(Math.max(cx, half), boxW - half) };
  });
}

// ---------------------------------------------------------------- data

export interface ChartData {
  slots: Array<{ label: string; value: number | null }>;
  /** Why nothing can be drawn, when that's the case. */
  problem?: "not-list" | "empty" | "no-values" | "too-many";
  /** Items whose y wasn't a finite number. */
  gaps: number;
}

export interface SeriesData {
  slots: Array<{ label: string; values: Array<number | null> }>;
  problem?: ChartData["problem"];
  /** For each field, the items whose value wasn't a finite number. */
  gaps: number[];
}

export function labelOf(v: Value | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && isFinite(v)) return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(v);
  if (typeof v === "boolean") return String(v);
  return "—";
}

export const numberAt = (item: Value, field: string): number | null => {
  const raw = isRecord(item) ? fieldOf(item, field) : undefined;
  return typeof raw === "number" && isFinite(raw) ? raw : null;
};

/** Read a list of records into slots with one value per field, without changing it. */
export function chartSeries(items: Value | undefined, x: string, ys: readonly string[]): SeriesData {
  const none = ys.map(() => 0);
  if (!isList(items)) return { slots: [], problem: "not-list", gaps: none };
  if (!items.length) return { slots: [], problem: "empty", gaps: none };
  if (items.length > MAX_CHART_ITEMS) return { slots: [], problem: "too-many", gaps: none };
  const gaps = ys.map(() => 0);
  const slots = items.map((item) => {
    const values = ys.map((y, k) => {
      const v = numberAt(item, y);
      if (v === null) gaps[k]!++;
      return v;
    });
    return { label: isRecord(item) ? labelOf(fieldOf(item, x)) : "—", values };
  });
  const empty = slots.every((s) => s.values.every((v) => v === null));
  return { slots, gaps, problem: empty ? "no-values" : undefined };
}

/** Read a list of records into slots for one field, without changing it. */
export function chartData(items: Value | undefined, x: string, y: string): ChartData {
  const d = chartSeries(items, x, [y]);
  const slots = d.slots.map((s) => ({ label: s.label, value: s.values[0] ?? null }));
  return { slots, gaps: d.gaps[0] ?? 0, ...(d.problem ? { problem: d.problem } : {}) };
}

