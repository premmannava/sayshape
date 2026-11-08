/**
 * chart kind=treemap: one number split across many items, as rectangles whose
 * areas are the items' shares of the total, for where the money or space
 * goes when there are too many parts for a pie: costs by line item, storage
 * by folder, sales by product.
 *
 *   chart "Where the budget goes" kind=treemap items=costs x=category y=amount format=money
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item with a number above 0 is a rectangle, its area in proportion to
 *   its share; the biggest sits top left. Items without a number, or with 0,
 *   aren't drawn, and a negative number shows a message (a share can't be
 *   below nothing).
 * - More than MAX_TREEMAP_ITEMS items: the largest MAX_TREEMAP_ITEMS - 1 stay
 *   and the rest are summed into one "Other" rectangle, so the total is kept.
 * - The layout is squarified (Bruls, Huizing and van Wijk), written here:
 *   rows of rectangles kept as close to square as they can be, so areas are
 *   easy to compare.
 * - A stronger color is bigger: the accent, from faint for the smallest to
 *   full for the largest, never at a strength where the words on it would
 *   miss AA contrast. Names and values sit inside where they fit; every item
 *   is in the tip and the data table.
 * - An item too small to see (under MIN_CELL across) is folded into Other
 *   too, so nothing is left out silently.
 */
import { easeOut, staggered } from "../../ghost";
import { ellipsize } from "../../text";
import type { Value } from "../../types";
import { fieldOf, isList, isRecord } from "../../data";
import { fillTint, themeFont } from "../util";
import { header, labelOf, numberAt, plotHeight, preciseText, shareText, valueText, MAX_CHART_ITEMS, type ChartGeometry, type ChartSlot, type Rect } from "../chart-kit";
import { cellInk } from "./heatmap";
import { mixColors, parseColor, type Theme } from "../../theme";
import type { ChartKindDef } from "./types";

/** The most rectangles one treemap draws; past it, the smallest are summed into "Other". */
export const MAX_TREEMAP_ITEMS = 60;
/** Space between neighbouring rectangles. */
const GAP = 2;
/** The narrowest a rectangle may be across; smaller items are folded into Other. */
const MIN_CELL = 6;

export interface TreemapCell {
  rect: Rect;
  label: string;
  value: number;
  share: number;
  /** How dark, 0 to 1: the item's place between the smallest and the largest. */
  shade: number;
  other?: boolean;
  /** What's written inside, line by line, or none when nothing fits. */
  lines: string[];
  /** The fill's strength and the words' color on it. */
  alpha: number;
  ink: string;
  /** Stable across frames, for the shade's animation: its label and how many before it share that label. */
  key: string;
}

export interface TreemapGeometry {
  cells: TreemapCell[];
  /** How many items are drawn together as Other (0 when none). */
  folded: number;
  nameFont: string;
  valueFont: string;
  lineH: number;
}

/** The alpha a shade is painted at: never so faint that a cell disappears. */
const alphaOf = (shade: number) => 0.22 + 0.78 * shade;

function luminance(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** The lower contrast of the words on the accent at this alpha, over the page and over a card. */
function contrastAt(colors: Theme["colors"], alpha: number): number {
  const ink = cellInk(colors, alpha);
  const l = luminance(ink);
  if (l === null) return 21;
  let worst = 21;
  for (const under of [colors.surface, colors.raised]) {
    const bg = luminance(mixColors(under, colors.accent, alpha) ?? colors.accent);
    if (bg === null) continue;
    worst = Math.min(worst, (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05));
  }
  return worst;
}

/**
 * The fill strength for a shade, moved to the nearest strength where the
 * words on it reach AA contrast (4.5:1): in a middle band neither ink nor
 * the accent's own text color does, on any theme.
 */
export function readableAlpha(colors: Theme["colors"], shade: number): number {
  const want = alphaOf(shade);
  if (contrastAt(colors, want) >= 4.5) return want;
  for (let d = 0.01; d <= 1; d += 0.01) {
    for (const a of [want - d, want + d]) if (a >= 0.12 && a <= 1 && contrastAt(colors, a) >= 4.5) return a;
  }
  return want;
}

/**
 * Squarified treemap: lay out values (largest first) in a rectangle, filling
 * rows along its shorter side and starting a new row whenever adding the next
 * value would make the row's worst aspect ratio worse. Returns one rect per
 * value, in the same order. Values must be positive and sorted descending.
 */
export function squarify(values: readonly number[], area: Rect): Rect[] {
  const out: Rect[] = new Array(values.length);
  const total = values.reduce((a, v) => a + v, 0);
  if (!(total > 0) || area.w <= 0 || area.h <= 0) return values.map(() => ({ x: area.x, y: area.y, w: 0, h: 0 }));
  const scale = (area.w * area.h) / total;
  let free: Rect = { ...area };
  let i = 0;
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((a, v) => a + v, 0);
    if (!(sum > 0) || side <= 0) return Infinity;
    const max = Math.max(...row), min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (i < values.length) {
    const side = Math.min(free.w, free.h);
    const row: number[] = [values[i]! * scale];
    let j = i + 1;
    while (j < values.length) {
      const next = [...row, values[j]! * scale];
      if (worst(next, side) > worst(row, side)) break;
      row.push(values[j]! * scale);
      j++;
    }
    // Lay the row along the shorter side, taking a strip off the free area.
    const sum = row.reduce((a, v) => a + v, 0);
    const thick = side > 0 ? sum / side : 0;
    let at = 0;
    const across = free.w >= free.h;
    row.forEach((v, k) => {
      const len = thick > 0 ? v / thick : 0;
      out[i + k] = across
        ? { x: free.x, y: free.y + at, w: thick, h: len }
        : { x: free.x + at, y: free.y, w: len, h: thick };
      at += len;
    });
    free = across
      ? { x: free.x + thick, y: free.y, w: Math.max(0, free.w - thick), h: free.h }
      : { x: free.x, y: free.y + thick, w: free.w, h: Math.max(0, free.h - thick) };
    i = j;
  }
  return out;
}

export const treemap: ChartKindDef = {
  loadingAs: "bar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "treemap", input.title, ctx);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;

    const items: Value | undefined = input.items;
    if (!isList(items) || !items.length) return done(say("No data to chart"));
    if (items.length > MAX_CHART_ITEMS) {
      ctx.warn?.(`${where}: ${items.length} items is more than the ${MAX_CHART_ITEMS} a chart reads. Keep the largest with take(sort(list, '${input.y}', 'desc'), ${MAX_CHART_ITEMS})`);
      return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    }
    let gaps = 0;
    const all: Array<{ label: string; value: number; other?: boolean }> = [];
    for (const item of items) {
      const value = numberAt(item, input.y);
      if (value === null || value === 0) { gaps++; continue; }
      if (value < 0) {
        ctx.warn?.(`${where}: a treemap shows shares of a total, and ${labelOf(isRecord(item) ? fieldOf(item, input.x) : undefined)} is below 0. Use kind=waterfall for changes up and down, or filter() out the negatives`);
        return done(say("A treemap can't show negative values"));
      }
      all.push({ label: isRecord(item) ? labelOf(fieldOf(item, input.x)) : "—", value });
    }
    if (gaps) ctx.warn?.(`${where}: ${gaps} of ${items.length} items have no number above 0 in ${input.y}, so they aren't drawn`);
    if (!all.length) return done(say("No values above 0 to chart"));
    all.sort((a, b) => b.value - a.value);
    const total = all.reduce((a, r) => a + r.value, 0);
    if (!Number.isFinite(total)) {
      ctx.warn?.(`${where}: the values add up to more than a number can hold, so they can't be split into shares. Use smaller units, like thousands`);
      return done(say("Values too large to chart"));
    }

    // A bit taller than the other charts: a treemap's areas need room to compare.
    const h = Math.round(plotHeight(box.w) * 1.25);
    const plot: Rect = { x: 0, y: top, w: box.w, h };
    // Keep the largest; fold the rest into one rectangle when there are too many, or when
    // they'd be too small to see. Folding changes the layout, so try again (a few times at most).
    let keep = Math.min(all.length, MAX_TREEMAP_ITEMS);
    let shown: Array<{ label: string; value: number; other?: boolean }> = [];
    let rects: Rect[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const folded = all.length > keep ? all.slice(keep - 1) : [];
      shown = folded.length
        ? [...all.slice(0, keep - 1), { label: `${folded.length} others`, value: folded.reduce((a, r) => a + r.value, 0), other: true }]
        : all.slice(0, keep);
      shown.sort((a, b) => b.value - a.value);
      rects = squarify(shown.map((s) => s.value), plot);
      const tiny = shown.filter((s, i) => !s.other && Math.min(rects[i]!.w, rects[i]!.h) < MIN_CELL).length;
      if (!tiny || keep <= 2) break;
      keep = Math.max(2, keep - tiny);
    }
    const otherCell = shown.find((s) => s.other);
    const folded = otherCell ? all.length - (shown.length - 1) : 0;
    if (folded) ctx.warn?.(`${where}: the smallest ${folded} of ${all.length} items are too many or too small to draw on their own, so they're drawn together as one rectangle (${otherCell!.label})`);
    const nameFont = themeFont(t, 600, t.text.caption);
    const valueFont = themeFont(t, 400, t.text.caption);
    const lineH = Math.round(t.text.caption * 1.35);
    // Shades run over the real items; the folded rectangle is drawn grey and doesn't set the scale.
    const real = shown.filter((s) => !s.other);
    const max = Math.max(...real.map((s) => s.value)), min = Math.min(...real.map((s) => s.value));
    const pad = 6;
    const seen = new Map<string, number>();

    const cells: TreemapCell[] = [];
    const slots: ChartSlot[] = shown.map((s, i) => {
      const r = rects[i]!;
      // The gap between neighbours comes off each rectangle's own edges.
      const rect: Rect = { x: r.x + GAP / 2, y: r.y + GAP / 2, w: Math.max(0, r.w - GAP), h: Math.max(0, r.h - GAP) };
      const share = s.value / total;
      const value = valueText(s.value, input.format);
      // The name and value where both fit, the name alone where only it does, else nothing.
      const room = rect.w - 2 * pad;
      const fits = (text: string, font: string) => room > 0 && m.width(text, font) <= room;
      const cut = room >= 24 ? ellipsize(s.label, room, nameFont, m) : "";
      // A name cut to a stub ("So…") says nothing: leave it to the tip.
      const kept = cut.endsWith("…") ? cut.length - 1 : cut.length;
      const name = kept >= Math.min(4, s.label.length) && kept >= s.label.length / 2 ? cut : "";
      const lines = !name ? [] : rect.h >= lineH * 2 + 2 * pad - 2 && fits(value, valueFont) ? [name, value] : rect.h >= lineH + 2 * pad - 4 ? [name] : [];
      const shade = s.other ? 0 : max > min ? (s.value - min) / (max - min) : 1;
      const alpha = s.other ? 0.12 : readableAlpha(t.colors, shade);
      const n = seen.get(s.label) ?? 0;
      seen.set(s.label, n + 1);
      cells.push({ rect, label: s.label, value: s.value, share, shade, lines, alpha, ink: s.other ? t.colors.ink : cellInk(t.colors, alpha), key: `${s.other ? "other" : "item"}:${s.label}#${n}`, ...(s.other ? { other: true } : {}) });
      return {
        label: s.label, shownLabel: null, labelX: 0, cx: rect.x + rect.w / 2,
        value: s.value, values: [s.value], bars: [rect],
        notes: [`${preciseText(s.value, input.format)} · ${shareText(share)} of the total`, ...(s.other ? [`The ${folded} smallest items, together`] : [])],
      };
    });
    const geometry: TreemapGeometry = { cells, folded, nameFont, valueFont, lineH };
    return { g: { ...base, plot, slots, labelY: plot.y + plot.h, min: 0, max, custom: geometry }, h: plot.y + plot.h };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const tm = d.custom as TreemapGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const radius = Math.min(4, theme.radius.sm);
    tm.cells.forEach((cell, i) => {
      const r = cell.rect;
      if (r.w <= 0 || r.h <= 0) return;
      const grow = reveal < 1 ? staggered(reveal, i, tm.cells.length) : 1;
      if (grow <= 0) return;
      g.globalAlpha = base * grow;
      ctx.roundRect(ox + r.x, oy + r.y, r.w, r.h, Math.min(radius, r.w / 3, r.h / 3));
      const alpha = ctx.tween(box.node, `tree:${cell.key}`, cell.alpha, 440);
      if (cell.other) fillTint(g, c.ink, alpha);
      else fillTint(g, c.accent, alpha);
      if (!cell.lines.length) return;
      // Words come in with their own rectangle, never before it.
      g.globalAlpha = base * Math.min(grow, easeOut(reveal * 2.5));
      g.textAlign = "left";
      g.textBaseline = "middle";
      const ink = cell.ink;
      cell.lines.forEach((line, k) => {
        g.font = k === 0 ? tm.nameFont : tm.valueFont;
        g.fillStyle = ink;
        g.fillText(line, ox + r.x + 6, oy + r.y + 6 + tm.lineH * k + tm.lineH / 2);
      });
    });
    g.globalAlpha = base;
  },
};
