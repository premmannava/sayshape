/**
 * chart kind=bullet: each KPI against its target, one compact row each, for
 * "are we on track?".
 *
 *   chart "Q3 targets" kind=bullet items=kpis x=name y=actual target=goal
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is a row, top to bottom in list order: its name and "actual of
 *   target" on the left, a bar for the actual and a dark tick at the target.
 * - Each row has its own scale, from 0 to a little past the larger of its
 *   actual and target, since KPIs come in different units (dollars, scores,
 *   percentages) and one shared scale would flatten most of them.
 * - Color says how it's going: good at or past the target, warn within
 *   WARN_SHARE of it, bad further off. good=down turns that round, for costs,
 *   churn or response times, where under the target is good.
 * - An item with no target gets the accent and no tick: it isn't judged.
 *   One with no actual is a gap ("—"), never 0. Negative values show a
 *   message, and so do more than MAX_BULLET_ROWS rows.
 */
import { easeOut, staggered } from "../../ghost";
import { ellipsize } from "../../text";
import { fillTint, themeFont } from "../util";
import { chartData, header, LOCALE, MAX_CHART_ITEMS, numberAt, preciseText, valueText, type ChartGeometry, type ChartSlot, type Format, type Rect } from "../chart-kit";
import type { ChartKindDef } from "./types";

/** More rows than this stop reading as a scorecard: show the important ones with take(). */
export const MAX_BULLET_ROWS = 20;
/** Within this share of the target (on the wrong side) is "close": warn, not bad. */
export const WARN_SHARE = 0.15;
/** Below this width, each row's name and numbers sit above its bar. */
const STACK_UNDER = 360;
/** How far past the larger of actual and target each row's scale reaches. */
const HEADROOM = 1.15;

export type BulletTone = "good" | "warn" | "bad" | "accent";

/** One row as drawn, relative to the box. */
export interface BulletRow {
  name: string;
  detail: string;
  /** The track the bar runs in. */
  track: Rect;
  /** The bar's length along the track, and the target's position, as shares of the track (0..1). */
  actual: number | null;
  target: number | null;
  tone: BulletTone;
  /** Where the name's and the detail's first lines are drawn. */
  textX: number;
  nameY: number;
  detailY: number;
}

export interface BulletGeometry {
  rows: BulletRow[];
  nameFont: string;
  detailFont: string;
}

/**
 * "actual of target", short ($1.2M of $1.5M), with more digits when the
 * short forms would read the same though the numbers differ ($1.24M of
 * $1.15M, not $1.2M of $1.2M), and exact as a last resort.
 */
export function pairText(actual: number, target: number, format: Format): string {
  const a = valueText(actual, format), t = valueText(target, format);
  if (a !== t || actual === target) return `${a} of ${t}`;
  const opts: Intl.NumberFormatOptions = { notation: "compact", maximumSignificantDigits: 3 };
  try {
    const nf = new Intl.NumberFormat(LOCALE, format === "money" ? { ...opts, style: "currency", currency: "USD" } : opts);
    const a3 = nf.format(actual), t3 = nf.format(target);
    if (a3 !== t3) return `${a3} of ${t3}`;
  } catch { /* fall through to exact */ }
  return `${preciseText(actual, format)} of ${preciseText(target, format)}`;
}

/** How a value is doing against its target, from the side that's good. */
export function bulletTone(actual: number, target: number | null, goodDown: boolean): BulletTone {
  if (target === null) return "accent";
  const ahead = goodDown ? actual <= target : actual >= target;
  if (ahead) return "good";
  const off = Math.abs(actual - target) / Math.max(Math.abs(target), Number.MIN_VALUE);
  return off <= WARN_SHARE ? "warn" : "bad";
}

export const bullet: ChartKindDef = {
  loadingAs: "hbar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "bullet", input.title, ctx);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;
    const targetField = input.extra.target ?? "";
    const goodDown = input.extra.good === "down";

    const d = chartData(input.items, input.x, input.y);
    if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
    if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    if (d.problem === "no-values") return done(say("No numbers to chart"));
    const n = d.slots.length;
    if (n > MAX_BULLET_ROWS) {
      ctx.warn?.(`${where}: a bullet chart shows at most ${MAX_BULLET_ROWS} rows, and items has ${n}. Show the important ones with take()`);
      return done(say(`Too many rows for a bullet chart: at most ${MAX_BULLET_ROWS}`));
    }
    // Each item's target, read the way y= is: a finite number or nothing.
    const items = Array.isArray(input.items) ? input.items : [];
    const targets = items.map((it) => (targetField ? numberAt(it, targetField) : null));
    if (d.slots.some((s, i) => (s.value ?? 0) < 0 || (targets[i] ?? 0) < 0)) {
      ctx.warn?.(`${where}: a bullet chart can't show negative values or targets; use kind=bar for values that go below 0`);
      return done(say("A bullet chart can't show negative values"));
    }
    if (d.gaps) ctx.warn?.(`${where}: ${d.gaps} of ${n} items have no number in their y field, so they're shown as gaps`);
    // A missing target= is reported by chart's check, when the spec is parsed.
    if (targetField && targets.every((v) => v === null)) ctx.warn?.(`${where}: no item has a number in its ${targetField} field, so no row is compared with a goal`);

    const nameFont = themeFont(t, 600, t.text.body), detailFont = themeFont(t, 400, t.text.caption);
    const nameLH = Math.round(t.text.body * 1.35), detailLH = Math.round(t.text.caption * 1.4);
    const textH = nameLH + detailLH;
    const trackH = Math.round(t.text.caption * 1.6);
    const details = d.slots.map((s, i) => {
      if (s.value === null) return "—";
      const target = targets[i] ?? null;
      return target === null ? valueText(s.value, input.format) : pairText(s.value, target, input.format);
    });
    const stacked = box.w < STACK_UNDER;
    const natural = Math.max(...d.slots.map((s, i) => Math.max(m.width(s.label, nameFont), m.width(details[i]!, detailFont))));
    const labelW = stacked ? box.w : Math.ceil(Math.min(natural, box.w * 0.36));
    const trackX = stacked ? 0 : labelW + t.space.lg;
    const trackW = Math.max(0, box.w - trackX);
    const rowH = stacked ? textH + t.space.xs + trackH + t.space.md : Math.max(textH, trackH) + t.space.md + t.space.sm;

    const rows: BulletRow[] = [];
    const slots: ChartSlot[] = d.slots.map((s, i) => {
      const y0 = top + i * rowH;
      const target = targets[i] ?? null;
      const max = Math.max(s.value ?? 0, target ?? 0) * HEADROOM || 1;
      const textTop = stacked ? y0 : y0 + (rowH - textH) / 2;
      const trackY = stacked ? y0 + textH + t.space.xs : y0 + (rowH - trackH) / 2;
      const track: Rect = { x: trackX, y: trackY, w: trackW, h: trackH };
      const tone = s.value === null ? "accent" : bulletTone(s.value, target, goodDown);
      rows.push({
        name: ellipsize(s.label, labelW, nameFont, m), detail: ellipsize(details[i]!, labelW, detailFont, m), track,
        actual: s.value === null ? null : s.value / max, target: target === null ? null : target / max, tone,
        textX: 0, nameY: textTop + nameLH / 2, detailY: textTop + nameLH + detailLH / 2,
      });
      const notes = s.value === null ? ["No number"] : [`Actual: ${preciseText(s.value, input.format)}`];
      if (target !== null) {
        notes.push(`Target: ${preciseText(target, input.format)}`);
        if (s.value !== null && target > 0) notes.push(`${Math.round((s.value / target) * 100)}% of target`);
      }
      return {
        label: s.label, shownLabel: null, labelX: 0, cx: trackX + trackW / 2, value: s.value, values: [s.value], notes,
        bars: [{ x: 0, y: y0, w: box.w, h: rowH }],
      };
    });
    const plot: Rect = { x: 0, y: top, w: box.w, h: n * rowH };
    const geometry: BulletGeometry = { rows, nameFont, detailFont };
    return done({ ...base, plot, slots, labelY: plot.y + plot.h, custom: geometry, noHoverOutline: true });
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const b = d.custom as BulletGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const fade = easeOut(reveal * 2.5);
    const hot = ctx.pointer && ctx.isHovered(box.node) ? ctx.pointer : null;
    const n = b.rows.length;
    b.rows.forEach((r, i) => {
      const color = r.tone === "accent" ? c.accent : c[r.tone];
      const tr = r.track;
      const row = d.slots[i]?.bars?.[0];
      const over = !!row && !!hot && hot.y - oy >= row.y && hot.y - oy < row.y + row.h;
      const glow = ctx.tween(box.node, `bullet:hover:${i}`, over ? 1 : 0, 165);
      if (glow > 0 && row) {
        ctx.roundRect(ox + row.x - 6, oy + row.y + 2, row.w + 12, row.h - 4, theme.radius.md);
        fillTint(g, c.ink, 0.035 * glow);
      }
      // The track: the whole scale, quiet.
      ctx.roundRect(ox + tr.x, oy + tr.y, tr.w, tr.h, theme.radius.sm);
      fillTint(g, c.ink, 0.07);
      // The actual: thinner than the track, growing in from the left, row by row.
      if (r.actual !== null) {
        const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
        const share = ctx.tween(box.node, `bullet:${i}`, r.actual, 440) * grow;
        const bh = Math.round(tr.h * 0.5), w = tr.w * share;
        if (w > 0.5) {
          ctx.roundRect(ox + tr.x, oy + tr.y + (tr.h - bh) / 2, w, bh, Math.min(bh / 2, w / 2));
          g.fillStyle = color;
          g.fill();
        }
      }
      // The target: a dark tick across the track, a little taller than it.
      if (r.target !== null) {
        g.globalAlpha = base * fade;
        g.fillStyle = c.ink;
        g.fillRect(Math.round(ox + tr.x + tr.w * r.target) - 1.5, oy + tr.y - 4, 3, tr.h + 8);
        g.globalAlpha = base;
      }
      g.globalAlpha = base * fade;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.font = b.nameFont;
      g.fillStyle = c.ink;
      g.fillText(r.name, ox + r.textX, oy + r.nameY);
      g.font = b.detailFont;
      g.fillStyle = c.muted;
      g.fillText(r.detail, ox + r.textX, oy + r.detailY);
      g.globalAlpha = base;
    });
  },
};
