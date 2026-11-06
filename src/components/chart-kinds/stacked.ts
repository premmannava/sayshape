/**
 * chart kind=stacked: each item's total split into its parts, such as
 * revenue per month split by product.
 *
 *   chart "Revenue by product" kind=stacked items=sales x=month y=hardware,software,services format=money
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is a bar, in list order; each field in y= is a segment, from
 *   the bottom up in the order written, in the theme's series colors, with
 *   a legend naming them (labels= or the field names).
 * - Positive values stack up from 0 and negative ones down from it, so a
 *   bar's height is never a sum of things going opposite ways.
 * - A field without a number is left out of that bar (a gap), never 0.
 * - The total sits above each bar when every bar has room for it.
 */
import { easeOut, staggered } from "../../ghost";
import {
  barPath, barText, chartScale, chartSeries, flowLegend, header, INSET, MAX_CHART_ITEMS, paintAxisGrid, paintLegend, paintSlotLabels,
  plotHeight, preciseText, slotLabels, tickLabels, type ChartGeometry, type ChartSlot, type Rect,
} from "../chart-kit";
import { fillTint } from "../util";
import { seriesColors } from "../../theme";
import type { ChartKindDef } from "./types";

/** The narrowest slot per bar before the chart says it's too narrow. */
const MIN_STACK_SLOT = 10;
/** The surface-colored line between two segments, so neighbouring colors stay apart. */
const SEAM = 1.5;

/** One segment of a bar: which series, and where it is relative to the box. */
export interface StackSegment {
  series: number;
  rect: Rect;
  /** True for the outermost segment above (or below) 0: it gets the rounded end. */
  end: boolean;
  /** Above 0 or below it. */
  up: boolean;
}

export interface StackedGeometry {
  /** Each bar's segments, bottom up, then the negative ones top down. */
  bars: StackSegment[][];
  /** Each bar's total as drawn above it, or null when there's no room. */
  totals: Array<string | null>;
}

export const stacked: ChartKindDef = {
  loadingAs: "bar",
  multiField: true,
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "stacked", input.title, ctx);
    const labelFont = base.labelFont;
    const labelLH = Math.round(t.text.caption * 1.4);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;

    const fields = input.fields.length ? input.fields : [input.y];
    const d = chartSeries(input.items, input.x, fields);
    if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
    if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    if (d.problem === "no-values") return done(say("No numbers to chart"));
    fields.forEach((f, k) => {
      const gaps = d.gaps[k] ?? 0;
      if (gaps) ctx.warn?.(`${where}: ${gaps} of ${d.slots.length} items have no number in their ${f} field, so that part is left out of their bars`);
    });

    const series = fields.map((field, k) => ({ field, label: input.labels[k] || field, color: k }));
    // How far each bar reaches above and below 0.
    const ends = d.slots.map((s) => {
      let pos = 0, neg = 0;
      for (const v of s.values) if (v !== null) { if (v >= 0) pos += v; else neg += v; }
      return { pos, neg };
    });
    const n = d.slots.length;
    const plotH = plotHeight(box.w);
    const scale = chartScale([0, ...ends.flatMap((e) => [e.pos, e.neg])], "bar", Math.max(2, Math.min(6, Math.floor(plotH / 44))));
    const tickText = tickLabels(scale.ticks, scale.step, input.format);
    const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
    const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
    const slotW = plot.w / n;
    if (slotW < MIN_STACK_SLOT) {
      const fits = Math.max(0, Math.floor(plot.w / MIN_STACK_SLOT));
      ctx.warn?.(`${where}: ${n} bars don't fit in ${Math.round(box.w)} pixels; at most ${fits} do`);
      return done(say(`Too narrow to chart ${n} items`));
    }
    // Halves, so (max - min) can't overflow for values near the largest number.
    const y = (v: number) => plot.y + INSET + (plot.h - 2 * INSET) * (1 - (v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2));
    const barW = Math.min(slotW * 0.6, 44);
    const placed = slotLabels(d.slots.map((s) => s.label), plot, box.w, labelFont, ctx);
    const showTotals = n <= 8 && slotW >= 54;
    const compact = ends.some((e) => Math.abs(e.pos) >= 10_000 || Math.abs(e.neg) >= 10_000);

    const bars: StackSegment[][] = [];
    const totals: Array<string | null> = [];
    const slots: ChartSlot[] = d.slots.map((s, i) => {
      const { cx, shownLabel, labelX } = placed[i]!;
      const segs: StackSegment[] = [];
      let up = 0, down = 0;
      s.values.forEach((v, k) => {
        if (v === null || v === 0) return;
        const from = v > 0 ? up : down, to = from + v;
        if (v > 0) up = to; else down = to;
        const y1 = y(from), y2 = y(to);
        segs.push({ series: k, rect: { x: cx - barW / 2, y: Math.min(y1, y2), w: barW, h: Math.abs(y2 - y1) }, end: false, up: v > 0 });
      });
      // The outermost segment on each side gets the rounded end.
      const lastUp = segs.filter((g) => g.up).at(-1), lastDown = segs.filter((g) => !g.up).at(-1);
      if (lastUp) lastUp.end = true;
      if (lastDown) lastDown.end = true;
      bars.push(segs);
      const total = s.values.reduce<number>((a, v) => a + (v ?? 0), 0);
      const known = s.values.some((v) => v !== null);
      totals.push(showTotals && known ? barText(total, input.format, compact) : null);
      const notes: string[] = [], noteSeries: Array<number | null> = [];
      s.values.forEach((v, k) => {
        if (v === null) return;
        notes.push(`${series[k]!.label}: ${preciseText(v, input.format)}`);
        noteSeries.push(k);
      });
      if (fields.length > 1 && known) { notes.push(`Total: ${preciseText(total, input.format)}`); noteSeries.push(null); }
      // One hover target for the whole bar, from its lowest point to its highest.
      const hit: Rect | null = segs.length
        ? { x: cx - barW / 2, y: Math.min(...segs.map((g) => g.rect.y)), w: barW, h: Math.max(...segs.map((g) => g.rect.y + g.rect.h)) - Math.min(...segs.map((g) => g.rect.y)) }
        : null;
      return { label: s.label, shownLabel, labelX, cx, value: known ? total : null, values: s.values, bars: [hit], ...(hit ? { bar: hit } : {}), notes, noteSeries };
    });

    const labelY = plot.y + plot.h + t.space.xs;
    let h = labelY + labelLH;
    const legend = flowLegend(series, box.w, h + t.space.sm, ctx);
    h = legend.bottom;
    const geometry: StackedGeometry = { bars, totals };
    const zeroY = scale.min <= 0 && scale.max >= 0 ? y(0) : null;
    return {
      g: {
        ...base, plot, slots, labelY, zeroY, min: scale.min, max: scale.max, series, legend: legend.items, custom: geometry, noHoverOutline: true,
        ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
      },
      h,
    };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const s = d.custom as StackedGeometry;
    const palette = seriesColors(theme);
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const fade = easeOut(reveal * 2.5);
    g.globalAlpha = base * fade;
    paintAxisGrid(ctx, d, ox, oy);
    g.globalAlpha = base;
    const zero = d.zeroY ?? d.plot.y + d.plot.h;
    const hot = ctx.pointer && ctx.isHovered(box.node) ? ctx.pointer : null;
    const n = s.bars.length;
    s.bars.forEach((segs, i) => {
      // Each bar grows out of 0, left to right; its parts keep their proportions as it grows.
      const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
      const hit = d.slots[i]?.bar;
      const over = !!hit && !!hot && hot.x - ox >= hit.x && hot.x - ox <= hit.x + hit.w && hot.y - oy >= hit.y && hot.y - oy <= hit.y + hit.h;
      const glow = ctx.tween(box.node, `stacked:hover:${i}`, over ? 1 : 0, 165);
      for (const seg of segs) {
        const r = seg.rect;
        // Scale toward the zero line, so a growing bar stays anchored on it.
        const y1 = zero + (r.y - zero) * grow, y2 = zero + (r.y + r.h - zero) * grow;
        const top = Math.min(y1, y2), h = Math.abs(y2 - y1);
        if (h <= 0.25) continue;
        if (seg.end) barPath(g, ox + r.x, oy + top, r.w, h, Math.min(6, r.w / 2, h), seg.up);
        else { g.beginPath(); g.rect(ox + r.x, oy + top, r.w, h); }
        g.fillStyle = palette[seg.series % palette.length]!;
        g.fill();
        if (glow > 0) fillTint(g, c.raised, 0.14 * glow);
        // A thin seam in the surface color where it meets the segment before it (not on the zero line).
        const joint = seg.up ? top + h : top;
        if (Math.abs(joint - zero) > 0.5) {
          g.fillStyle = c.raised;
          g.fillRect(ox + r.x, oy + joint - SEAM / 2, r.w, SEAM);
        }
      }
      const total = s.totals[i];
      if (total && hit) {
        const above = d.slots[i]!.value! >= 0;
        const ty = above ? zero + (hit.y - zero) * grow - 9 : zero + (hit.y + hit.h - zero) * grow + 9;
        if (ty >= d.plot.y + 2 && ty <= d.plot.y + d.plot.h - 2) {
          g.save();
          g.globalAlpha = base * fade * 0.9;
          g.font = ctx.font(600, 11);
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillStyle = c.muted;
          g.fillText(total, ox + hit.x + hit.w / 2, oy + ty);
          g.restore();
        }
      }
    });
    g.globalAlpha = base * fade;
    paintSlotLabels(ctx, d, ox, oy);
    paintLegend(ctx, d, ox, oy, (k) => palette[k % palette.length]!);
    g.globalAlpha = base;
  },
};
