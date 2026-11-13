/**
 * chart kind=area: a trend with the space under its line filled, for
 * amounts over time where the size matters, not only the shape: visitors
 * a week, revenue a month.
 *
 *   chart "Weekly visitors" kind=area items=visits x=week y=visitors
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is a point, in list order, evenly spaced, like a line chart.
 * - Unlike a line, the scale always includes 0 and the fill reaches down to
 *   it, so the filled area is true to the amounts.
 * - Up to 6 fields in y= draw as overlapping areas in the series colors
 *   (each fill lighter, so the ones behind show through), with a legend.
 * - A missing number is a gap: the line and its fill stop there and start
 *   again after it.
 */
import { easeOut } from "../../ghost";
import { mixColors, seriesColors } from "../../theme";
import {
  chartScale, chartSeries, flowLegend, header, INSET, MAX_CHART_ITEMS, paintAxisGrid, paintLegend, paintSlotLabels, plotHeight,
  preciseText, slotLabels, tickLabels, traceSmoothLine, type ChartGeometry, type ChartSlot, type Rect,
} from "../chart-kit";
import type { ChartKindDef } from "./types";

/** The narrowest slot per point before the chart says it's too narrow. */
const MIN_AREA_SLOT = 3;
/** The radius of the dot at each series' last point, as on a line chart. */
const LAST_DOT = 2.75;

export interface AreaGeometry {
  /** For each series, its runs of neighbouring points (broken at gaps), relative to the box. */
  runs: Array<Array<Array<{ x: number; y: number }>>>;
}

export const area: ChartKindDef = {
  loadingAs: "line",
  multiField: true,
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "area", input.title, ctx);
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
      if (gaps) ctx.warn?.(`${where}: ${gaps} of ${d.slots.length} items have no number in their ${fields.length > 1 ? `${f} field` : "y field"}, so the area breaks there`);
    });
    const series = fields.map((field, k) => ({ field, label: input.labels[k] || field, color: k }));

    const n = d.slots.length;
    const plotH = plotHeight(box.w);
    const values = d.slots.flatMap((s) => s.values.flatMap((v) => (v === null ? [] : [v])));
    // "bar" keeps 0 on the scale: an area's fill reaches down to it.
    const scale = chartScale([0, ...values], "bar", Math.max(2, Math.min(6, Math.floor(plotH / 44))));
    const tickText = tickLabels(scale.ticks, scale.step, input.format);
    const axisW = Math.ceil(Math.max(...tickText.map((s) => m.width(s, labelFont)))) + t.space.sm;
    const plot: Rect = { x: axisW, y: top + Math.ceil(labelLH / 2), w: Math.max(0, box.w - axisW), h: plotH };
    const slotW = plot.w / n;
    if (slotW < MIN_AREA_SLOT) {
      ctx.warn?.(`${where}: ${n} points don't fit in ${Math.round(box.w)} pixels; at most ${Math.floor(plot.w / MIN_AREA_SLOT)} do`);
      return done(say(`Too narrow to chart ${n} items`));
    }
    const y = (v: number) => plot.y + INSET + (plot.h - 2 * INSET) * (1 - (v / 2 - scale.min / 2) / (scale.max / 2 - scale.min / 2));
    const placed = slotLabels(d.slots.map((s) => s.label), plot, box.w, labelFont, ctx);

    const slots: ChartSlot[] = d.slots.map((s, i) => {
      const { cx, shownLabel, labelX } = placed[i]!;
      const notes: string[] = [], noteSeries: number[] = [];
      s.values.forEach((v, k) => {
        if (v === null) return;
        notes.push(`${fields.length > 1 ? series[k]!.label : "Value"}: ${preciseText(v, input.format)}`);
        noteSeries.push(k);
      });
      const points = s.values.map((v) => (v === null ? null : { x: cx, y: y(v) }));
      // The whole column of the slot is its hover target, as on a line chart.
      const column: Rect = { x: plot.x + slotW * i, y: plot.y, w: slotW, h: plot.h };
      return {
        label: s.label, shownLabel, labelX, cx, value: s.values[0] ?? null, values: s.values, points,
        bars: [s.values.some((v) => v !== null) ? column : null], notes, noteSeries,
      };
    });
    const runs: AreaGeometry["runs"] = fields.map((_f, k) => {
      const out: Array<Array<{ x: number; y: number }>> = [];
      let run: Array<{ x: number; y: number }> = [];
      for (const s of slots) {
        const p = s.points?.[k];
        if (p) run.push(p);
        else if (run.length) { out.push(run); run = []; }
      }
      if (run.length) out.push(run);
      return out;
    });

    const labelY = plot.y + plot.h + t.space.xs;
    let h = labelY + labelLH;
    let legend: ChartGeometry["legend"] = [];
    if (fields.length > 1) {
      const l = flowLegend(series, box.w, h + t.space.sm, ctx);
      legend = l.items;
      h = l.bottom;
    }
    const zeroY = scale.min <= 0 && scale.max >= 0 ? y(0) : null;
    const geometry: AreaGeometry = { runs };
    return {
      g: {
        ...base, plot, slots, labelY, zeroY, min: scale.min, max: scale.max, series, legend, custom: geometry, noHoverOutline: true,
        ticks: scale.ticks.map((v, i) => ({ value: v, y: y(v), label: tickText[i]! })),
      },
      h,
    };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const a = d.custom as AreaGeometry;
    const many = a.runs.length > 1;
    const palette = seriesColors(theme);
    // One series draws in the accent, as a line chart does.
    const colorOf = (k: number) => (many ? palette[k % palette.length]! : c.accent);
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const fade = easeOut(reveal * 2.5);
    g.globalAlpha = base * fade;
    paintAxisGrid(ctx, d, ox, oy);
    g.globalAlpha = base;
    const floor = oy + (d.zeroY ?? d.plot.y + d.plot.h);

    g.save();
    // The areas run in from the left once the data arrives.
    if (reveal < 1) {
      g.beginPath();
      g.rect(ox + d.plot.x - 6, oy + d.plot.y - 6, (d.plot.w + 12) * easeOut(reveal), d.plot.h + 12);
      g.clip();
    }
    // Points follow their values as they change, on the shared clock.
    const drawn = a.runs.map((runs, k) => runs.map((run) => run.map((p) => ({
      x: p.x, y: ctx.tween(box.node, `area:${k}:${Math.round(p.x)}`, p.y, 440),
    }))));
    // Back to front: the first series behind the others, each fill lighter so the ones behind show through.
    drawn.forEach((runs, k) => {
      const color = colorOf(k);
      const gradient = g.createLinearGradient(0, oy + d.plot.y, 0, floor);
      gradient.addColorStop(0, mixColors(color, c.raised, many ? 0.55 : 0.5) ?? color);
      gradient.addColorStop(1, c.raised);
      for (const run of runs) {
        if (!run.length) continue;
        g.beginPath();
        if (run.length === 1) {
          // A single point between gaps: a thin column, so it still shows.
          g.rect(ox + run[0]!.x - 1.5, oy + run[0]!.y, 3, floor - (oy + run[0]!.y));
        } else {
          traceSmoothLine(g, run, ox, oy);
          g.lineTo(ox + run[run.length - 1]!.x, floor);
          g.lineTo(ox + run[0]!.x, floor);
          g.closePath();
        }
        g.save();
        g.fillStyle = gradient;
        g.globalAlpha *= many ? 0.55 : 0.85;
        g.fill();
        g.restore();
      }
    });
    g.lineJoin = "round";
    g.lineCap = "round";
    drawn.forEach((runs, k) => {
      for (const run of runs) {
        if (run.length < 2) continue;
        g.beginPath();
        traceSmoothLine(g, run, ox, oy);
        g.strokeStyle = colorOf(k);
        g.lineWidth = 2.25;
        g.stroke();
      }
    });
    // A dot only at each series' last point, as a line chart has; the hovered point gets its own below.
    drawn.forEach((runs, k) => {
      const run = runs[runs.length - 1];
      const last = run?.[run.length - 1];
      if (!last) return;
      g.beginPath();
      g.arc(ox + last.x, oy + last.y, LAST_DOT, 0, Math.PI * 2);
      g.fillStyle = c.raised;
      g.fill();
      g.lineWidth = 1.75;
      g.strokeStyle = colorOf(k);
      g.stroke();
    });
    g.restore();

    // The point under the pointer on every series, with a guide down to the floor.
    const hot = ctx.pointer && ctx.isHovered(box.node) ? ctx.pointer : null;
    const i = hot ? d.slots.findIndex((s) => { const b = s.bars?.[0]; return !!b && hot.x - ox >= b.x && hot.x - ox < b.x + b.w; }) : -1;
    const slot = i >= 0 ? d.slots[i] : undefined;
    if (slot && reveal >= 1) {
      g.save();
      g.beginPath();
      g.moveTo(ox + slot.cx + 0.5, oy + d.plot.y);
      g.lineTo(ox + slot.cx + 0.5, floor);
      g.strokeStyle = c.muted;
      g.globalAlpha *= 0.6;
      g.lineWidth = 1;
      g.setLineDash([3, 4]);
      g.stroke();
      g.restore();
      slot.points?.forEach((p, k) => {
        if (!p) return;
        g.beginPath();
        g.arc(ox + p.x, oy + p.y, 4.5, 0, Math.PI * 2);
        g.fillStyle = c.raised;
        g.fill();
        g.lineWidth = 2.25;
        g.strokeStyle = colorOf(k);
        g.stroke();
      });
    }

    g.globalAlpha = base * fade;
    paintSlotLabels(ctx, d, ox, oy);
    if (d.legend.length) paintLegend(ctx, d, ox, oy, colorOf);
    g.globalAlpha = base;
  },
};
