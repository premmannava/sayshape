/**
 * chart kind=waterfall: how a total is built up from changes, such as
 * revenue minus costs, or how a budget moved from one month to the next.
 *
 *   chart "Q3 net income" kind=waterfall items=steps x=step y=amount total="Net income" format=money
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is a change, in list order. Its bar starts where the running
 *   total stands and ends where the change takes it: rises in the good
 *   color, falls in the bad one. The first item usually holds the starting
 *   amount, as a rise from 0.
 * - total="Name" adds one more bar, from 0 to where the changes end, in the
 *   accent. Without it, the chart shows only the changes.
 * - A thin line joins each bar's end to the next bar's start.
 * - An item without a number is a gap: no bar, and the running total
 *   carries on unchanged.
 * - The scale always includes 0, like a bar chart.
 */
import { easeOut, staggered } from "../../ghost";
import {
  barPath, barText, chartData, preciseText, chartScale, header, INSET, MAX_CHART_ITEMS, paintAxisGrid, paintPremiumBar, paintSlotLabels, plotHeight,
  slotLabels, tickLabels, valueText, type ChartGeometry, type ChartSlot, type Rect,
} from "../chart-kit";
import type { ChartKindDef } from "./types";

/** The narrowest slot per bar before the chart says it's too narrow. */
const MIN_WATERFALL_SLOT = 12;

/** One bar: which way it went, and what it shows above or below itself. */
export interface WaterfallBar {
  tone: "up" | "down" | "total";
  /** Whether it goes up from where it starts (a total below 0 goes down from 0). */
  rising: boolean;
  /** The value as written by the bar, signed for changes ("+$3K"), or null when there's no room. */
  label: string | null;
}

export interface WaterfallGeometry {
  bars: Array<WaterfallBar | null>;
  /** Thin lines from each bar's end to the next bar's start, relative to the box. */
  connectors: Array<{ x1: number; x2: number; y: number }>;
}

/** A change as it reads: always signed, so a rise and a fall can't be confused. */
export function changeText(v: number, format: "number" | "money", compact = false): string {
  const text = barText(v, format, compact);
  return v > 0 ? "+" + text : text;
}

export const waterfall: ChartKindDef = {
  loadingAs: "bar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "waterfall", input.title, ctx);
    const labelFont = base.labelFont;
    const labelLH = Math.round(t.text.caption * 1.4);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;

    const d = chartData(input.items, input.x, input.y);
    if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
    if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    if (d.problem === "no-values") return done(say("No numbers to chart"));
    if (d.gaps) ctx.warn?.(`${where}: ${d.gaps} of ${d.slots.length} items have no number in their y field, so they're shown as gaps and the total carries on without them`);

    // Where each change starts and ends, on the running total.
    let running = 0;
    const spans = d.slots.map((s) => {
      if (s.value === null) return null;
      const from = running;
      running += s.value;
      return { from, to: running };
    });
    if (!Number.isFinite(running)) return done(say("These numbers are too large to add up"));
    const totalName = input.extra.total?.trim();
    const entries = d.slots.map((s, i) => ({ label: s.label, value: s.value, span: spans[i]!, tone: (s.value !== null && s.value < 0 ? "down" : "up") as WaterfallBar["tone"] }));
    if (totalName) entries.push({ label: totalName, value: running, span: { from: 0, to: running }, tone: "total" });

    const n = entries.length;
    const plotH = plotHeight(box.w);
    const values = [0, ...entries.flatMap((e) => (e.span ? [e.span.from, e.span.to] : []))];
    const scale = chartScale(values, "bar", Math.max(2, Math.min(6, Math.floor(plotH / 44))));
    const tickText = tickLabels(scale.ticks, scale.step, input.format);
    const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
    const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
    const slotW = plot.w / n;
    if (slotW < MIN_WATERFALL_SLOT) {
      const fits = Math.max(0, Math.floor(plot.w / MIN_WATERFALL_SLOT));
      ctx.warn?.(`${where}: ${n} bars don't fit in ${Math.round(box.w)} pixels; at most ${fits} do. Group the smaller changes into one item`);
      return done(say(`Too narrow to chart ${n} items`));
    }

    // Halves, so (max - min) can't overflow for values near the largest number.
    const y = (v: number) => plot.y + INSET + (plot.h - 2 * INSET) * (1 - (v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2));
    const barW = Math.min(slotW * 0.6, 44);
    const placed = slotLabels(entries.map((e) => e.label), plot, box.w, labelFont, ctx);
    // Values by the bars only when every one has room to be read.
    const showValues = n <= 8 && slotW >= 54;
    const compact = entries.some((e) => e.value !== null && Math.abs(e.value) >= 10_000);
    const slots: ChartSlot[] = [];
    const bars: WaterfallGeometry["bars"] = [];
    entries.forEach((e, i) => {
      const { cx, shownLabel, labelX } = placed[i]!;
      const slot: ChartSlot = { label: e.label, shownLabel, labelX, cx, value: e.value, values: [e.value] };
      if (e.span && e.value !== null) {
        const y1 = y(e.span.from), y2 = y(e.span.to);
        // A change of 0 still shows as a hairline, so the step isn't mistaken for a gap.
        const h = Math.max(1, Math.abs(y2 - y1));
        const bar: Rect = { x: cx - barW / 2, y: Math.min(y1, y2) - (Math.abs(y2 - y1) < 1 ? 0.5 : 0), w: barW, h };
        slot.bars = [bar];
        slot.bar = bar;
        slot.notes = e.tone === "total"
          ? [`Total: ${preciseText(e.value, input.format)}`]
          : [`Change: ${e.value > 0 ? "+" : ""}${preciseText(e.value, input.format)}`, `Running total: ${preciseText(e.span.to, input.format)}`];
        bars.push({ tone: e.tone, rising: e.span.to >= e.span.from, label: showValues ? (e.tone === "total" ? barText(e.value, input.format, compact) : changeText(e.value, input.format, compact)) : null });
      } else {
        slot.bars = [null];
        slot.notes = ["No number"];
        bars.push(null);
      }
      slots.push(slot);
    });

    // Join each bar's end to the next bar that starts there, across gaps; the total joins at its top.
    const connectors: WaterfallGeometry["connectors"] = [];
    let last: { x: number; v: number } | null = null;
    entries.forEach((e, i) => {
      const b = slots[i]!.bars?.[0];
      if (!b || !e.span) return;
      const meets = last && (last.v === e.span.from || (e.tone === "total" && last.v === e.span.to));
      if (last && meets) connectors.push({ x1: last.x, x2: b.x, y: y(last.v) });
      last = { x: b.x + b.w, v: e.span.to };
    });

    const labelY = plot.y + plot.h + t.space.xs;
    const geometry: WaterfallGeometry = { bars, connectors };
    const zeroY = scale.min <= 0 && scale.max >= 0 ? y(0) : null;
    return {
      g: {
        ...base, plot, slots, labelY, zeroY, min: scale.min, max: scale.max, custom: geometry,
        ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
      },
      h: labelY + labelLH,
    };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const w = d.custom as WaterfallGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const fade = easeOut(reveal * 2.5);
    g.globalAlpha = base * fade;
    paintAxisGrid(ctx, d, ox, oy);

    // Connectors first, quiet and dashed, so the bars sit on top of them.
    g.save();
    g.strokeStyle = c.muted;
    g.globalAlpha *= 0.5;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    for (const k of w.connectors) {
      const ky = Math.round(oy + k.y) + 0.5;
      g.beginPath();
      g.moveTo(ox + k.x1, ky);
      g.lineTo(ox + k.x2, ky);
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
    g.globalAlpha = base;

    const n = d.slots.length;
    const hot = ctx.pointer && ctx.isHovered(box.node) ? ctx.pointer : null;
    d.slots.forEach((s, i) => {
      const full = s.bars?.[0];
      const bar = w.bars[i];
      if (!full || !bar) return;
      const color = bar.tone === "total" ? c.accent : bar.tone === "down" ? c.bad : c.good;
      // A rise grows up from where it starts; a fall grows down.
      const up = bar.rising;
      const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
      const h = ctx.tween(box.node, `waterfall:${i}`, full.h, 440) * grow;
      if (h <= 0.25) return;
      const b = { x: full.x, y: up ? full.y + full.h - h : full.y, w: full.w, h };
      barPath(g, ox + b.x, oy + b.y, b.w, b.h, Math.min(5, b.w / 2, b.h), up);
      const over = !!hot && hot.x - ox >= full.x && hot.x - ox <= full.x + full.w && hot.y - oy >= full.y && hot.y - oy <= full.y + full.h;
      paintPremiumBar(ctx, { x: ox + b.x, y: oy + b.y, w: b.w, h: b.h }, color, up ? "up" : "down", ctx.tween(box.node, `waterfall:hover:${i}`, over ? 1 : 0, 165));
      if (bar.label) {
        g.save();
        g.globalAlpha = base * fade * 0.9;
        g.font = ctx.font(600, 11);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = c.muted;
        const outside = up ? oy + b.y - 9 : oy + b.y + b.h + 9;
        const inPlot = outside >= oy + d.plot.y + 4 && outside <= oy + d.plot.y + d.plot.h - 4;
        if (inPlot) g.fillText(bar.label, ox + b.x + b.w / 2, outside);
        g.restore();
      }
    });

    g.globalAlpha = base * fade;
    paintSlotLabels(ctx, d, ox, oy);
    g.globalAlpha = base;
  },
};
