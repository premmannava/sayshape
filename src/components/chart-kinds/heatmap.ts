/**
 * chart kind=heatmap: one number across two dimensions, as a grid of cells
 * shaded by the number, for patterns a table hides: retention by signup
 * month, orders by weekday and hour, sales by region and quarter.
 *
 *   chart "Retention" kind=heatmap items=cohorts rows=cohort x=month y=rate format=percent
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is one cell: rows= names its row, x= its column and y= its
 *   number. Rows and columns are in the order they first appear in the list.
 * - Darker is more. The scale runs from 0 (or the lowest value, when some
 *   are negative) to the highest, in the accent, so it reads the same in
 *   light and dark, and a key below says what the ends are.
 * - A cell no item fills is left empty, and so is an item without a number
 *   (a gap, never 0). Two items for the same cell: the first is shown and
 *   the line says so.
 * - Numbers sit in the cells when every one of them fits.
 */
import { easeOut, staggered } from "../../ghost";
import { ellipsize } from "../../text";
import type { Value } from "../../types";
import { fieldOf, isList, isRecord } from "../../data";
import { fillTint, themeFont } from "../util";
import { barText, formatter, header, labelOf, MAX_CHART_ITEMS, numberAt, preciseText, valueText, type ChartGeometry, type ChartSlot, type Rect } from "../chart-kit";
import { mixColors, parseColor, type Theme } from "../../theme";
import type { ChartKindDef } from "./types";

/** The narrowest a cell may be before the chart says it's too narrow. */
export const MIN_HEATMAP_CELL = 12;
/** Steps in the key below the grid. */
const KEY_STEPS = 5;
/** Space between neighbouring cells, so each reads as its own. */
const GAP = 2;

export interface HeatCell {
  row: number;
  col: number;
  /** The cell, relative to the box. */
  rect: Rect;
  value: number | null;
  /** How dark, 0 to 1, or null for a gap. */
  shade: number | null;
  /** The number as written in the cell, or null when numbers aren't shown. */
  text: string | null;
}

export interface HeatmapGeometry {
  cells: HeatCell[];
  rows: Array<{ label: string; y: number }>;
  cols: Array<{ label: string | null; x: number }>;
  /** Where the column labels and the row labels are drawn. */
  colLabelY: number;
  rowLabelW: number;
  /** The grid's own area, relative to the box. */
  grid: Rect;
  key: { swatches: Rect[]; low: { text: string; x: number }; high: { text: string; x: number }; y: number } | null;
  cellFont: string;
  colCount: number;
}

/** How dark a value is drawn: its place between low and high, never below a faint tint. */
export function heatShade(v: number, low: number, high: number): number {
  if (high <= low) return v > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, (v / 2 - low / 2) / (high / 2 - low / 2)));
}

/** The alpha a shade is painted at: 0 is a faint tint, so a 0 still reads as a cell. */
const alphaOf = (shade: number) => 0.08 + 0.92 * shade;

/** Relative luminance (WCAG) of a color, or null when it can't be read. */
function luminance(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/**
 * The text color for a cell at this alpha: ink or the accent's own text
 * color, whichever stands out more against the cell as it's drawn (the
 * accent over the surface). In a dark theme the accent is light, so its
 * darkest cells are the light ones.
 */
export function cellInk(colors: Theme["colors"], alpha: number): string {
  const cell = luminance(mixColors(colors.surface, colors.accent, alpha) ?? colors.accent);
  const ink = luminance(colors.ink), on = luminance(colors.onAccent);
  if (cell === null || ink === null || on === null) return alpha > 0.55 ? colors.onAccent : colors.ink;
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(cell, ink) >= ratio(cell, on) ? colors.ink : colors.onAccent;
}

export const heatmap: ChartKindDef = {
  loadingAs: "bar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "heatmap", input.title, ctx);
    const labelFont = base.labelFont;
    const labelLH = Math.round(t.text.caption * 1.4);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;
    const rowsField = input.extra.rows ?? "";

    const items: Value | undefined = input.items;
    if (!isList(items) || !items.length) return done(say("No data to chart"));
    if (items.length > MAX_CHART_ITEMS) return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    // Rows and columns in the order they first appear; the first item for a cell wins.
    const rowIndex = new Map<string, number>(), colIndex = new Map<string, number>();
    const seen = new Map<string, number>();
    const picked: Array<{ row: number; col: number; value: number | null }> = [];
    let dupes = 0, gaps = 0;
    for (const item of items) {
      const rowLabel = rowsField && isRecord(item) ? labelOf(fieldOf(item, rowsField)) : "—";
      const colLabel = isRecord(item) ? labelOf(fieldOf(item, input.x)) : "—";
      if (!rowIndex.has(rowLabel)) rowIndex.set(rowLabel, rowIndex.size);
      if (!colIndex.has(colLabel)) colIndex.set(colLabel, colIndex.size);
      const row = rowIndex.get(rowLabel)!, col = colIndex.get(colLabel)!;
      const key = `${row}:${col}`;
      if (seen.has(key)) { dupes++; continue; }
      seen.set(key, picked.length);
      const value = numberAt(item, input.y);
      if (value === null) gaps++;
      picked.push({ row, col, value });
    }
    const values = picked.flatMap((p) => (p.value === null ? [] : [p.value]));
    if (!values.length) return done(say("No numbers to chart"));
    if (dupes) ctx.warn?.(`${where}: ${dupes} item${dupes === 1 ? "" : "s"} repeat a row and column already in the chart, so only the first is shown. Give each ${rowsField || "row"} and ${input.x} pair one item, or add them up with group() first`);
    if (gaps) ctx.warn?.(`${where}: ${gaps} of ${picked.length} items have no number in their y field, so their cells are left empty`);

    const rowLabels = [...rowIndex.keys()], colLabels = [...colIndex.keys()];
    const nRows = rowLabels.length, nCols = colLabels.length;
    const rowLabelW = Math.ceil(Math.min(Math.max(...rowLabels.map((l) => m.width(l, labelFont))), box.w * 0.3)) + t.space.sm;
    const gridW = Math.max(0, box.w - rowLabelW);
    const cellW = gridW / nCols;
    if (cellW < MIN_HEATMAP_CELL) {
      ctx.warn?.(`${where}: ${nCols} columns don't fit in ${Math.round(box.w)} pixels; at most ${Math.floor(gridW / MIN_HEATMAP_CELL)} do. Show fewer with take() or filter()`);
      return done(say(`Too narrow to chart ${nCols} columns`));
    }
    const cellH = Math.round(Math.max(22, Math.min(36, cellW * 0.75)));

    // Column labels on top, thinned to every k-th when they'd run into each other.
    const widest = Math.max(...colLabels.map((l) => m.width(l, labelFont)));
    const every = Math.max(1, Math.ceil((Math.min(widest, cellW * 4) + t.space.xs) / cellW));
    const colLabelY = top + labelLH / 2;
    const gridY = top + labelLH + t.space.xs;
    const cols = colLabels.map((l, i) => ({
      label: i % every === 0 ? ellipsize(l, cellW * every - t.space.xs, labelFont, m) : null,
      x: rowLabelW + cellW * i + cellW / 2,
    }));
    const rows = rowLabels.map((l, i) => ({ label: ellipsize(l, rowLabelW - t.space.sm, labelFont, m), y: gridY + cellH * i + cellH / 2 }));

    // 0 stays on the scale for amounts; negatives stretch it down.
    const low = Math.min(0, ...values), high = Math.max(...values);
    const cellFont = themeFont(t, 500, t.text.caption);
    const compact = values.some((v) => Math.abs(v) >= 10_000);
    // The numbers as written; then whole numbers (53% for 53.3%) when those don't all fit.
    const fits = (list: string[]) => cellH >= 20 && list.every((s) => m.width(s, cellFont) <= cellW - GAP - 4);
    const whole = formatter(input.format, { notation: compact ? "compact" : "standard", maximumFractionDigits: 0 });
    const full = picked.map((p) => (p.value === null ? "—" : barText(p.value, input.format, compact)));
    const short = picked.map((p) => (p.value === null ? "—" : whole.format(p.value)));
    const texts = fits(full) ? full : fits(short) ? short : null;

    const cells: HeatCell[] = [];
    const slots: ChartSlot[] = picked.map((p, i) => {
      const rect: Rect = { x: rowLabelW + cellW * p.col + GAP / 2, y: gridY + cellH * p.row + GAP / 2, w: cellW - GAP, h: cellH - GAP };
      cells.push({
        row: p.row, col: p.col, rect, value: p.value,
        shade: p.value === null ? null : heatShade(p.value, low, high),
        text: texts ? texts[i]! : null,
      });
      return {
        label: `${rowLabels[p.row]} · ${colLabels[p.col]}`, shownLabel: null, labelX: 0, cx: rect.x + rect.w / 2,
        value: p.value, values: [p.value], bars: [rect],
        notes: [p.value === null ? "No number" : preciseText(p.value, input.format)],
      };
    });

    const grid: Rect = { x: rowLabelW, y: gridY, w: gridW, h: cellH * nRows };
    // The key: the scale's two ends with the shades between them.
    let bottom = grid.y + grid.h;
    let key: HeatmapGeometry["key"] = null;
    if (high > low) {
      const y = bottom + t.space.sm + labelLH / 2;
      const lowText = valueText(low, input.format), highText = valueText(high, input.format);
      const sw = 16, sg = 2;
      const lowX = grid.x;
      const startX = lowX + m.width(lowText, labelFont) + t.space.xs;
      const swatches = Array.from({ length: KEY_STEPS }, (_v, k) => ({ x: startX + k * (sw + sg), y: y - 5, w: sw, h: 10 }));
      const highX = startX + KEY_STEPS * (sw + sg) - sg + t.space.xs;
      if (highX + m.width(highText, labelFont) <= box.w) {
        key = { swatches, low: { text: lowText, x: lowX }, high: { text: highText, x: highX }, y };
        bottom = y + labelLH / 2;
      }
    }
    const geometry: HeatmapGeometry = { cells, rows, cols, colLabelY, rowLabelW, grid, key, cellFont, colCount: nCols };
    const plot: Rect = { x: 0, y: top, w: box.w, h: bottom - top };
    return { g: { ...base, plot, slots, labelY: bottom, min: low, max: high, custom: geometry }, h: bottom };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const h = d.custom as HeatmapGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const fade = easeOut(reveal * 2.5);
    const radius = Math.min(4, theme.radius.sm);

    // Cells fade in column by column once the data arrives.
    for (const cell of h.cells) {
      const r = cell.rect;
      const grow = reveal < 1 ? staggered(reveal, cell.col, h.colCount) : 1;
      if (grow <= 0) continue;
      g.globalAlpha = base * grow;
      ctx.roundRect(ox + r.x, oy + r.y, r.w, r.h, Math.min(radius, r.w / 3, r.h / 3));
      if (cell.shade === null) fillTint(g, c.ink, 0.04);
      else {
        const shade = ctx.tween(box.node, `heat:${cell.row}:${cell.col}`, cell.shade, 440);
        fillTint(g, c.accent, alphaOf(shade));
      }
      if (cell.text) {
        g.font = h.cellFont;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = cell.shade === null ? c.muted : cellInk(c, alphaOf(cell.shade));
        g.fillText(cell.text, ox + r.x + r.w / 2, oy + r.y + r.h / 2);
      }
    }

    g.globalAlpha = base * fade;
    g.font = d.labelFont;
    g.fillStyle = c.muted;
    g.textBaseline = "middle";
    g.textAlign = "center";
    for (const col of h.cols) if (col.label) g.fillText(col.label, ox + col.x, oy + h.colLabelY);
    g.textAlign = "left";
    for (const row of h.rows) g.fillText(row.label, ox, oy + row.y);
    if (h.key) {
      g.fillText(h.key.low.text, ox + h.key.low.x, oy + h.key.y);
      g.fillText(h.key.high.text, ox + h.key.high.x, oy + h.key.y);
      h.key.swatches.forEach((s, k) => {
        ctx.roundRect(ox + s.x, oy + s.y, s.w, s.h, 2);
        fillTint(g, c.accent, alphaOf(k / (KEY_STEPS - 1)));
      });
    }
    g.globalAlpha = base;
  },
};
