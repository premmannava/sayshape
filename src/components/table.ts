/**
 * table and table-column: a list of records as rows, one declared column per
 * field, with optional sorting and single-row selection kept in state.
 *
 *   state equipment=[{id: "laptop", name: "Laptop", price: 1200}] picked="" by="name" dir="asc"
 *   table "Equipment" items=equipment key=id bind=picked sort=by direction=dir
 *     table-column "Item" field=name
 *     table-column "Price" field=price format=money
 *
 * Layout works out everything (column widths, which rows are where, the text
 * each cell shows, which rows can be selected) into a TableGeometry on
 * box.data, relative to the box. paint draws it and registers hit regions;
 * press writes state. Nothing is written during layout or paint, and the
 * source list is never changed: sorting orders a list of indices.
 *
 * Rules (also in the docs, docs/components.md):
 * - Cells: text columns show text as is, numbers as 1,200.5 and true/false
 *   as Yes/No. number and money columns show only numbers; anything else is
 *   the placeholder "—", as are missing fields, null and lists or records.
 *   0 and false are values, not missing. Money is US dollars, like money().
 * - Sorting: ascending puts numbers (by value), then text (by en-US
 *   collation, numbers inside text compared as numbers), then true/false;
 *   descending reverses that. Missing values always go last. Equal values
 *   keep their list order.
 * - Selection stores the row's key= field (text or a finite number, 0
 *   included). Rows whose key is missing or repeats an earlier row's can't
 *   be selected. A selected key no row has selects nothing; state is left as
 *   it is.
 * - Width: columns get their natural widths, and text columns narrow (never
 *   below MIN_TEXT_COLUMN, nor below their longest word up to
 *   MAX_SCROLL_TEXT_COLUMN, so words aren't split) to fit. Text cells that no longer fit on one line
 *   wrap, in full; only text longer than MAX_CELL_LINES lines is shortened, ending with "…" and a
 *   "Show all" toggle under it (its own Tab stop, a button with expanded state) that shows the
 *   rest, kept as view state (ctx.view, "e:<item>:<column>"); a row is
 *   as tall as its tallest cell (never shorter than one line), and numbers
 *   stay on one line. When even the narrowest columns don't fit, the table
 *   scrolls sideways instead: every column keeps a readable width, the first
 *   column stays pinned at the left, and a scrollbar shows under the rows.
 *   It scrolls with a sideways swipe or Shift and the wheel, by dragging the
 *   rows or the scrollbar, and with the arrow keys, Home and End. The offset
 *   is view state (ctx.view), never app state.
 * - At most MAX_TABLE_ROWS rows and MAX_TABLE_COLUMNS columns; otherwise a
 *   message replaces the table.
 */
import type { PartSemantics } from "../a11y/semantics";
import type { ComponentDef, ElementView, LayoutContext, PaintContext, PressContext, PropReader } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import type { TextMeasurer } from "../text";
import { fitLines, wrapText } from "../text";
import type { Theme } from "../theme";
import type { Box, SayShapeNode, Value } from "../types";
import { chevron, fillTint, onProp, partBox, runOn, themeFont, toneColor, type Tone } from "./util";
import { EMPTY_CELL, FORMAT_NAMES, formatValue, isNumericFormat, needsCents, type FormatName } from "./formats";
import { paintGhost, staggered } from "../ghost";
import { MOTION } from "../design";

/** The most rows one table shows. Larger lists show a message: page them with slice() and pagination. */
export const MAX_TABLE_ROWS = 200;
/**
 * The most columns one table shows. Wide tables scroll sideways, so this is
 * only a safety bound (a whole property schedule of values has about 56).
 */
export const MAX_TABLE_COLUMNS = 64;
export { EMPTY_CELL, needsCents };

const FORMATS = FORMAT_NAMES;
const ALIGNS = ["left", "right"] as const;
type Format = FormatName;
/** Tones a row's field can name to draw a cell as a badge. */
const BADGE_TONES = ["good", "warn", "bad", "accent", "muted"] as const;
/** Padding either side of a badge's text, and extra room a bar needs in its column. */
const BADGE_PAD = 10;
const BAR_ROOM = 48;
/** Gap between a bar's track and the numbers, and the narrowest track worth drawing. */
const BAR_GAP = 8;
const MIN_BAR_TRACK = 24;
/** How far a scroll fade reaches, in pixels. */
const FADE_W = 28;
type Align = (typeof ALIGNS)[number];
const LOCALE = "en-US";
/** Text columns shrink to this before the table scrolls instead (numbers never shrink): enough for a short name, not "Ac…". */
const MIN_TEXT_COLUMN = 96;
/** Room for the sort arrow beside a header. */
const ARROW = 14;
/**
 * A text cell wraps in full up to this many lines; past that it's shortened to them, ending with an
 * ellipsis, and a "Show all" toggle under it shows the rest (nothing is lost, only folded).
 */
export const MAX_CELL_LINES = 8;
/** How visible a sortable header's neutral arrow is at rest, and under the pointer or focus. */
const ARROW_REST = 0.4;
const ARROW_HOVER = 0.8;
/** When the table scrolls, text columns are at most this wide, so one long value doesn't take the screen. */
const MAX_SCROLL_TEXT_COLUMN = 260;
/** The pinned first column takes at most this share of the width, so there's room left to scroll. */
const PIN_SHARE = 0.4;
/** Height of the strip under the rows that holds the scrollbar. */
const SCROLLBAR_STRIP = 14;
/** How far an arrow key scrolls, in pixels. */
const ARROW_STEP = 48;
/** How far the pointer moves before pressing the rows becomes dragging them. */
const DRAG_SLOP = 5;

export interface Rect { x: number; y: number; w: number; h: number }

export interface TableColumn {
  field: string;
  label: string;
  /** The header as drawn, cut to fit. */
  shownLabel: string;
  format: Format;
  align: Align;
  x: number;
  w: number;
  /** The direction shown on this column's header, when the table is sorted by it. */
  sorted: "asc" | "desc" | null;
  /** Its table-column, and that column's tip= (shown from its header). */
  node: SayShapeNode;
  tip?: string;
  /** tone=: "sign" colours by sign, otherwise the row field whose value names a badge tone. */
  tone?: string;
  /** bar=true: an in-cell bar; the largest positive and negative values it is scaled to. */
  bar?: { pos: number; neg: number; /** The track's left edge and width inside the column, clear of the numbers. */ x: number; w: number };
}

export interface TableCell {
  lines: string[];
  full: string;
  /** The number behind a numeric cell. */
  n?: number;
  /** Drawn as a badge in this tone (tone= naming a field). */
  badge?: Tone;
  /** tone=sign: good for positive, bad for negative. */
  sign?: "good" | "bad";
  /** The bar's length as a fraction of its scale, negative to the left of zero. */
  bar?: number;
  /** Text longer than MAX_CELL_LINES lines: folded ("closed", lines cut with "…") or unfolded ("open"); a toggle line under it. */
  more?: "closed" | "open";
}

export interface TableRow {
  /** The item's position in the list (not on screen). */
  index: number;
  y: number;
  h: number;
  /** The key= value, or null when it's missing, not text or a number, or a repeat. */
  key: string | number | null;
  selectable: boolean;
  selected: boolean;
  /** The hit-region detail for a selectable row. */
  detail: string | null;
  /** Each cell's lines as drawn (wrapped or cut to fit its column), and its text in full. */
  cells: TableCell[];
}

/** The pinned totals row under the rows. */
export interface TableTotals { y: number; h: number; cells: Array<{ lines: string[]; full: string }> }

/** Everything paint and press need, relative to the table's box. */
export type TableGeometry = {
  title: string[];
  titleFont: string;
  titleLH: number;
  headerFont: string;
  cellFont: string;
  badgeFont: string;
  /** Height of one line of cell text. */
  cellLH: number;
  /** Shown instead of rows and columns: too many, too narrow, no columns. */
  message?: string;
  /** The bordered area: header, rows and any empty message. */
  frame: Rect;
  headerH: number;
  columns: TableColumn[];
  rows: TableRow[];
  /** total=: a row of sums under the rows. */
  totals?: TableTotals;
  /** Shown under the header when there are no rows. */
  empty?: string;
  sortable: boolean;
  /** The surrounding card supplies the outer panel, so no second frame is needed. */
  embeddedInCard?: boolean;
  /** Data still loading: placeholder rows of this height under the real header. */
  loading?: { rows: number; h: number };
  /** Set when the columns are wider than the table, which then scrolls sideways. */
  scroll?: TableScroll;
};

/**
 * Sideways scrolling. Column x values are where each column sits when the
 * table isn't scrolled; columns after the pinned one move left by the offset.
 */
export interface TableScroll {
  /** Width of the pinned first column, or 0 when nothing is pinned. */
  pinned: number;
  /** Width of the area the other columns scroll in. */
  view: number;
  /** Total width of the columns that scroll. */
  content: number;
  /** The furthest it scrolls: content - view. */
  max: number;
  /** The scrollbar's strip at the bottom of the frame, relative to the box. */
  bar: Rect;
}

/** Placeholder rows a loading table shows. */
const GHOST_ROWS = 5;

// ---------------------------------------------------------------- cells

/** A cell's text, and whether the value didn't suit its column (for one warning). cents: false drops .00 from whole money amounts. */
export function cellText(v: Value | undefined, format: Format, cents = true): { text: string; incompatible: boolean } {
  return formatValue(v, format, cents);
}

// ---------------------------------------------------------------- sorting

const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: "base" });
const rank = (v: Value | undefined) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);

function compareValues(a: Value | undefined, b: Value | undefined): number {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}

/**
 * The order to show items in, as indices into the list: by a field, with
 * missing values last either way and ties in list order. The list itself is
 * never changed.
 */
export function sortedOrder(items: readonly Value[], field: string | null, direction: "asc" | "desc"): number[] {
  const order = items.map((_, i) => i);
  if (!field) return order;
  const values = items.map((item) => (isRecord(item) ? fieldOf(item, field) : undefined));
  const sign = direction === "desc" ? -1 : 1;
  return order.sort((i, j) => {
    const a = values[i], b = values[j];
    const ma = rank(a) === 3, mb = rank(b) === 3;
    if (ma || mb) return ma === mb ? i - j : ma ? 1 : -1;
    return sign * compareValues(a, b) || i - j;
  });
}

// ---------------------------------------------------------------- keys

/** A row's selection key: text or a finite number, else null. */
export function keyOf(item: Value, field: string): string | number | null {
  if (!isRecord(item)) return null;
  const k = fieldOf(item, field);
  return typeof k === "string" || (typeof k === "number" && isFinite(k)) ? k : null;
}

const rowDetail = (key: string | number) => `row:${typeof key === "number" ? "n" : "s"}:${key}`;
/** A long cell's Show all toggle, by item (its place in the list) and column, and where it's kept open in view state. */
const moreDetail = (item: number, ci: number) => `more:${item}:${ci}`;
const foldKey = (item: number, ci: number) => `e:${item}:${ci}`;
const MORE_LABEL = { closed: "Show all", open: "Show less" } as const;
const sortDetail = (field: string) => `sort:${field}`;

/**
 * The field the table is sorted by. sort= names state that holds it; while
 * that state is unset, a sort= that is itself one of the fields is the
 * starting sort, since models often write sort=open meaning "by open".
 */
function sortedBy(p: PropReader, isField: (name: string) => boolean): string | null {
  const v = p.bound("sort");
  if (typeof v === "string") return isField(v) ? v : null;
  const raw = p.raw("sort");
  return v === undefined && raw !== undefined && isField(raw) ? raw : null;
}

/** The sort direction: direction= state's asc or desc, or, while that state is unset, direction=asc or direction=desc as written. */
function sortDirection(p: PropReader): "asc" | "desc" {
  const v = p.bound("direction");
  const word = v === undefined ? p.raw("direction") : v;
  return word === "desc" ? "desc" : "asc";
}

/** The key a row detail stands for. */
function keyFromDetail(detail: string): string | number | null {
  const m = /^row:([ns]):([\s\S]*)$/.exec(detail);
  if (!m) return null;
  return m[1] === "n" ? Number(m[2]) : m[2]!;
}

// ---------------------------------------------------------------- layout

/** Cut text to fit a width, ending with an ellipsis. */
function fit(text: string, width: number, font: string, m: TextMeasurer): string {
  if (m.width(text, font) <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (m.width(text.slice(0, mid) + "…", font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + "…" : "";
}

/**
 * Column widths for the space there is: their natural widths when they fit
 * (with the extra shared out), otherwise text columns are narrowed, widest
 * first, but never below their minimum. null when even the minimums don't fit.
 */
export function fitColumns(natural: readonly number[], minimum: readonly number[], width: number, grow?: readonly boolean[]): number[] | null {
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= width) {
    // Spare room goes to the columns that grow (text), so numbers stay snug; else to all.
    const growing = natural.map((n, i) => (grow?.some(Boolean) ? (grow[i] ? n : 0) : n));
    const share = growing.reduce((a, b) => a + b, 0);
    const extra = width - total;
    return natural.map((n, i) => n + (share > 0 ? (extra * growing[i]!) / share : extra / natural.length));
  }
  if (minimum.reduce((a, b) => a + b, 0) > width + 1e-6) return null;
  // The widest a column may be so that everything fits (a cap on the wide ones).
  const widths = (cap: number) => natural.map((n, i) => Math.max(minimum[i]!, Math.min(n, cap)));
  let lo = 0, hi = Math.max(...natural);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (widths(mid).reduce((a, b) => a + b, 0) <= width) lo = mid;
    else hi = mid;
  }
  const w = widths(lo);
  // Give back what rounding left, to the columns that were narrowed.
  const left = width - w.reduce((a, b) => a + b, 0);
  const cut = w.map((x, i) => (x < natural[i]! ? 1 : 0));
  const n = cut.reduce<number>((a, b) => a + b, 0);
  return n && left > 0 ? w.map((x, i) => x + (cut[i] ? left / n : 0)) : w;
}

/**
 * The width of the longest word in column ci. A cell with no space is one word, already
 * measured; a cell no wider than the longest so far can't hold a longer word, so it's skipped.
 */
function longestWord(texts: readonly string[][], textW: readonly number[][], ci: number, font: string, m: TextMeasurer): number {
  let best = 0;
  texts.forEach((row, r) => {
    const s = row[ci]!, w = textW[r]![ci]!;
    if (w <= best) return;
    if (!/\s/.test(s)) { best = w; return; }
    for (const word of s.split(/\s+/)) if (word) best = Math.max(best, m.width(word, font));
  });
  return best;
}

interface ColumnSpec { field: string; label: string; format: Format; align: Align; node: SayShapeNode; tip?: string; tone?: string; bar: boolean }

function readColumns(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren" | "props">): ColumnSpec[] {
  return ctx.visibleChildren(node).filter((c) => c.type === "table-column").map((c) => {
    const p = ctx.props(c);
    const field = p.str("field");
    const format = p.oneOf("format", FORMATS, "text");
    const tip = p.str("tip", "").trim();
    const tone = p.str("tone", "").trim();
    const leftAligned = format === "text" || format === "date";
    return { field, label: p.text(field), format, align: p.oneOf("align", ALIGNS, leftAligned ? "left" : "right"), node: c, bar: p.bool("bar") && isNumericFormat(format), ...(tone ? { tone } : {}), ...(tip ? { tip } : {}) };
  });
}

function tableLayout(box: { w: number; node: SayShapeNode }, p: PropReader, ctx: Pick<LayoutContext, "theme" | "measure" | "warn" | "visibleChildren" | "props" | "view">, loading = false): TableGeometry {
  const t: Theme = ctx.theme, m = ctx.measure;
  const line = box.node.line;
  const warn = (msg: string) => ctx.warn?.(`table on line ${line}: ${msg}`);
  const titleFont = themeFont(t, 600, t.text.body), headerFont = themeFont(t, 600, t.text.caption), cellFont = themeFont(t, 400, t.text.body);
  const titleLH = Math.round(t.text.body * 1.4);
  const pad = t.space.md;
  const headerH = Math.round(t.text.caption * 1.4) + 2 * t.space.sm;
  const rowH = Math.round(t.text.body * 1.4) + 2 * t.space.sm;
  const title = p.text() ? wrapText(p.text(), box.w, titleFont, m) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const cellLH = Math.round(t.text.body * 1.4);
  const base: TableGeometry = { title, titleFont, titleLH, headerFont, cellFont, badgeFont: themeFont(t, 600, t.text.caption), cellLH, frame: { x: 0, y: top, w: box.w, h: 0 }, headerH, columns: [], rows: [], sortable: false };
  const say = (message: string): TableGeometry => ({ ...base, message, frame: { x: 0, y: top, w: box.w, h: Math.max(rowH * 2, 64) } });

  const specs = readColumns(box.node, ctx);
  // No columns yet is normal while a spec streams in, so it isn't a warning.
  if (!specs.length) return say("No columns yet");
  if (specs.length > MAX_TABLE_COLUMNS) {
    warn(`${specs.length} columns is more than the ${MAX_TABLE_COLUMNS} a table shows. Keep the most useful ones, or split it into two tables`);
    return say(`Too many columns: at most ${MAX_TABLE_COLUMNS}`);
  }

  const raw = loading ? undefined : p.expr("items");
  if (!loading && p.has("items") && !isList(raw)) warn(`items is not a list. Use a list of records, like items=equipment`);
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_TABLE_ROWS) {
    warn(`${items.length} rows is more than the ${MAX_TABLE_ROWS} a table shows. Show a page with slice() and pagination`);
    return say(`Too many rows to show: ${items.length}, at most ${MAX_TABLE_ROWS}`);
  }

  // Sorting: only by a field one of the columns shows.
  const sortable = p.has("sort");
  const sortField = sortedBy(p, (name) => specs.some((c) => c.field === name));
  const direction = sortDirection(p);
  const order = sortedOrder(items, sortField, direction);

  // Keys, in list order, so the first of two rows with one key keeps it however they're sorted.
  const keyField = p.has("key") ? p.str("key") : "";
  const bindable = p.has("bind");
  if (bindable && !keyField) warn(`bind= needs key= naming a field that identifies each row, like key=id`);
  const keys = items.map((item) => (keyField ? keyOf(item, keyField) : null));
  const seen = new Set<string>();
  let missingKeys = 0, duplicates = 0;
  const usable = keys.map((k) => {
    if (k === null) { if (keyField) missingKeys++; return false; }
    const id = `${typeof k}:${k}`;
    if (seen.has(id)) { duplicates++; return false; }
    seen.add(id);
    return true;
  });
  if (bindable && missingKeys) warn(`${missingKeys} rows have no text or number in "${keyField}", so they can't be selected`);
  if (bindable && duplicates) warn(`${duplicates} rows repeat another row's "${keyField}", so only the first of each can be selected. Keys should be unique`);
  const selectedValue = p.bound("bind");

  // Cell text, in the order shown.
  let malformed = 0, incompatible = 0;
  const valueAt = (item: Value | undefined, field: string) => (isRecord(item) ? fieldOf(item, field) : undefined);
  const cents = specs.map((c) => c.format === "money" && needsCents(order.map((i) => valueAt(items[i], c.field))));
  const numbers: Array<Array<number | undefined>> = [];
  const badges: Array<Array<Tone | undefined>> = [];
  const texts = order.map((i) => {
    const item = items[i]!;
    if (!isRecord(item)) malformed++;
    const nums: Array<number | undefined> = [], tones: Array<Tone | undefined> = [];
    numbers.push(nums);
    badges.push(tones);
    return specs.map((c, ci) => {
      const v = valueAt(item, c.field);
      const r = cellText(v, c.format, cents[ci]);
      if (r.incompatible && isRecord(item)) incompatible++;
      nums.push(isNumericFormat(c.format) && typeof v === "number" ? v : undefined);
      const t = isRecord(item) && c.tone && c.tone !== "sign" ? fieldOf(item, c.tone) : undefined;
      tones.push(typeof t === "string" && (BADGE_TONES as readonly string[]).includes(t) && r.text !== EMPTY_CELL ? (t as Tone) : undefined);
      return r.text;
    });
  });
  if (malformed) warn(`${malformed} items aren't records, so their cells show ${EMPTY_CELL}`);
  if (incompatible) warn(`${incompatible} cells hold a value their column can't show (number and money columns need numbers), so they show ${EMPTY_CELL}`);

  // bar=true: each column's largest positive and negative values, so bars share one scale.
  const bars = specs.map((c, ci) => {
    if (!c.bar) return undefined;
    let pos = 0, neg = 0;
    numbers.forEach((row) => { const n = row[ci]; if (n !== undefined) { if (n > pos) pos = n; if (-n > neg) neg = -n; } });
    return { pos, neg };
  });

  // total=: sums of the numeric columns (percent can't be summed), the first cell the label.
  const totalRaw = p.has("total") ? p.str("total").trim() : "";
  const totalLabel = totalRaw === "" || totalRaw === "false" ? null : totalRaw === "true" ? "Total" : totalRaw;
  const totalTexts = totalLabel === null ? null : specs.map((c, ci) => {
    if (ci === 0) return totalLabel;
    if (!isNumericFormat(c.format) || c.format === "percent") return "";
    const vals = numbers.map((row) => row[ci]).filter((n): n is number => n !== undefined);
    return vals.length ? cellText(vals.reduce((a, b) => a + b, 0), c.format, cents[ci]).text : "";
  });

  // Column widths from what they hold.
  const headerW = specs.map((c) => m.width(c.label, headerFont) + (sortable ? ARROW : 0) + 2 * pad);
  const badgeFont = themeFont(t, 600, t.text.caption);
  const textW = texts.map((row, r) => row.map((s, ci) => (badges[r]![ci] ? m.width(s, badgeFont) + 2 * BADGE_PAD : m.width(s, cellFont))));
  const totalW = totalTexts ? totalTexts.map((s) => m.width(s, themeFont(t, 600, t.text.body))) : [];
  const cellW = specs.map((c, ci) => Math.max(0, totalW[ci] ?? 0, ...textW.map((row) => row[ci]!)) + 2 * pad + (c.bar ? BAR_ROOM : 0));
  const natural = specs.map((_, ci) => Math.max(headerW[ci]!, cellW[ci]!));
  // A text column is never narrower than its longest word (up to MAX_SCROLL_TEXT_COLUMN), so
  // wrapping happens between words; when that can't fit, the table scrolls instead of splitting
  // "Healthy" into "Healt / hy". Numbers are never cut short; headers can be.
  const wordW = specs.map((c, ci) => (c.format === "text" ? Math.min(MAX_SCROLL_TEXT_COLUMN, Math.max(longestWord(texts, textW, ci, cellFont, m), totalW[ci] ?? 0) + 2 * pad) : 0));
  const minimum = specs.map((c, ci) => (c.format === "text" ? Math.max(Math.min(natural[ci]!, MIN_TEXT_COLUMN), wordW[ci]!) : Math.max(cellW[ci]!, Math.min(headerW[ci]!, MIN_TEXT_COLUMN))));
  let widths = fitColumns(natural, minimum, box.w, specs.map((c) => c.format === "text"));
  let scrollParts: Omit<TableScroll, "bar"> | undefined;
  if (!widths) {
    // Too wide even squeezed: keep every column readable and scroll sideways instead.
    const w = specs.map((c, ci) => (c.format === "text" ? Math.max(minimum[ci]!, Math.min(natural[ci]!, MAX_SCROLL_TEXT_COLUMN)) : natural[ci]!));
    // The first column (usually what each row is: a name, a team) stays put, when it can be narrow enough.
    let pinned = 0;
    if (specs.length > 1) {
      const first = Math.min(w[0]!, Math.max(minimum[0]!, box.w * PIN_SHARE));
      if (first <= box.w * 0.5) { w[0] = first; pinned = first; }
    }
    const content = w.reduce((a, b) => a + b, 0) - pinned;
    const view = box.w - pinned;
    widths = w;
    scrollParts = { pinned, view, content, max: Math.max(0, content - view) };
  }

  // A bar has its own track beside the widest value, so it never runs under a number.
  const barTrack = (b: { pos: number; neg: number } | undefined, w: number, ci: number): NonNullable<TableColumn["bar"]> | undefined => {
    if (!b) return undefined;
    const widest = Math.max(totalW[ci] ?? 0, ...textW.map((row) => row[ci]!));
    const right = specs[ci]!.align === "right";
    const x = right ? pad : pad + widest + BAR_GAP;
    const room = w - 2 * pad - widest - BAR_GAP;
    return room >= MIN_BAR_TRACK ? { ...b, x, w: room } : undefined;
  };
  let x = 0;
  const columns: TableColumn[] = specs.map((c, ci) => {
    const w = widths[ci]!;
    const { bar: _wanted, ...spec } = c;
    const col: TableColumn = {
      ...spec, x, w,
      shownLabel: fit(c.label, w - 2 * pad - (sortable ? ARROW : 0), headerFont, m),
      ...(barTrack(bars[ci], w, ci) ? { bar: barTrack(bars[ci], w, ci)! } : {}),
      sorted: sortField === c.field ? direction : null,
    };
    x += w;
    return col;
  });

  // Each row is as tall as its tallest cell, and never shorter than one line.
  let rowY = top + headerH;
  const view = ctx.view?.(box.node);
  const rows: TableRow[] = order.map((i, r) => {
    const key = usable[i] ? keys[i]! : null;
    const selectable = bindable && key !== null;
    const cells = texts[r]!.map((full, ci) => {
      const room = columns[ci]!.w - 2 * pad;
      // Only text wraps; numbers keep to one line (their column is never narrower than they are).
      const badge = badges[r]![ci], n = numbers[r]![ci], col = columns[ci]!;
      let more: TableCell["more"];
      let lines: string[];
      if (badge) lines = [fit(full, room - 2 * BADGE_PAD, badgeFont, m)];
      else if (col.format !== "text") lines = [fit(full, room, cellFont, m)];
      else {
        lines = wrapText(full, room, cellFont, m);
        if (lines.length > MAX_CELL_LINES) {
          more = view?.[foldKey(i, ci)] ? "open" : "closed";
          if (more === "closed") lines = fitLines(full, room, cellFont, m, MAX_CELL_LINES);
        }
      }
      const cell: TableCell = { full, lines };
      if (more) cell.more = more;
      if (n !== undefined) cell.n = n;
      if (badge) cell.badge = badge;
      if (col.tone === "sign" && n !== undefined && n !== 0) cell.sign = n > 0 ? "good" : "bad";
      if (col.bar && n !== undefined) {
        const scale = Math.max(col.bar.pos, col.bar.neg);
        cell.bar = scale > 0 ? n / scale : 0;
      }
      return cell;
    });
    // A folded cell has its toggle as one more line under its text.
    const h = Math.max(rowH, Math.max(1, ...cells.map((c) => c.lines.length + (c.more ? 1 : 0))) * cellLH + 2 * t.space.sm);
    const y = rowY;
    rowY += h;
    return {
      index: i,
      y,
      h,
      key,
      selectable,
      selected: selectable && selectedValue === key,
      detail: selectable ? rowDetail(key) : null,
      cells,
    };
  });
  let totals: TableTotals | undefined;
  if (totalTexts) {
    const th = rowH;
    totals = { y: rowY, h: th, cells: totalTexts.map((full, ci) => ({ full, lines: [fit(full, columns[ci]!.w - 2 * pad, themeFont(t, 600, t.text.body), m)] })) };
    rowY += th;
  }
  const rowsH = rowY - top - headerH;
  const strip = scrollParts ? SCROLLBAR_STRIP : 0;
  const withBar = (frame: Rect): TableScroll | undefined =>
    scrollParts && { ...scrollParts, bar: { x: frame.x + scrollParts.pinned, y: frame.y + frame.h - strip, w: scrollParts.view, h: strip } };
  if (loading) {
    const frame = { x: 0, y: top, w: box.w, h: headerH + GHOST_ROWS * rowH + strip };
    return { ...base, frame, columns, rows: [], sortable: false, loading: { rows: GHOST_ROWS, h: rowH }, scroll: withBar(frame) };
  }
  const emptyH = items.length ? 0 : rowH * 1.5;
  const frame = { x: 0, y: top, w: box.w, h: headerH + rowsH + emptyH + strip };
  return {
    ...base,
    frame,
    columns,
    rows,
    ...(totals ? { totals } : {}),
    empty: items.length ? undefined : isList(raw) ? "Nothing to show" : "No data",
    sortable,
    scroll: withBar(frame),
  };
}

// ---------------------------------------------------------------- scrolling

const SCROLL_AREA = "scroll:area";
const SCROLL_BAR = "scroll:bar";

/** How far the table is scrolled, kept in range (the columns may have changed since). */
function scrollOf(v: ElementView, s: TableScroll | undefined): number {
  if (!s) return 0;
  const x = Math.max(0, Math.min(s.max, v.x ?? 0));
  v.x = x;
  return x;
}

/** Scroll to x (kept in range). Returns whether it moved. */
function scrollTo(v: ElementView, s: TableScroll, x: number): boolean {
  const before = v.x ?? 0;
  v.x = Math.max(0, Math.min(s.max, x));
  return Math.abs(v.x - before) > 0.01;
}

/** The scrollbar's track and thumb, in box coordinates, for an offset. */
export function scrollThumb(s: TableScroll, x: number): { trackX: number; trackW: number; x: number; w: number } {
  const inset = 8;
  const trackX = s.bar.x + inset, trackW = Math.max(0, s.bar.w - 2 * inset);
  const w = Math.min(trackW, Math.max(28, (trackW * s.view) / Math.max(1, s.content)));
  return { trackX, trackW, x: trackX + (trackW - w) * (s.max ? x / s.max : 0), w };
}

/** What a table's hit regions carry, so press, drag, wheel and key can find the table they're part of. */
interface TablePart { table: TableGeometry; x: number; y: number }

/** A pressable part of a table: a header, a row, the scrollbar. */
function tablePart(box: Box, x: number, y: number, w: number, h: number): Box {
  const part: TablePart = { table: box.data as TableGeometry, x: box.x, y: box.y };
  return { ...partBox(box, x, y, w, h), data: part as unknown as Box["data"] };
}

/** The table a pressed part belongs to, and where its box is. */
function partOf(box: Box): TablePart | null {
  const d = box.data as unknown as TablePart | undefined;
  return d && "table" in d ? d : null;
}

/** Whether column ci moves when the table scrolls (everything but the pinned first column). */
const scrolls = (s: TableScroll | undefined, ci: number) => !!s && (s.pinned === 0 || ci > 0);

// ---------------------------------------------------------------- paint

/** Explicitly signed numeric values get semantic ink; unsigned data stays neutral. */
export function tableValueTone(value: string, format: Format): "positive" | "negative" | null {
  if (format === "text" || format === "date" || value === EMPTY_CELL) return null;
  if (/^[−-]\s*(?:[$€£¥])?\d/.test(value)) return "negative";
  if (/^\+\s*(?:[$€£¥])?\d/.test(value)) return "positive";
  return null;
}

function paintTable(box: Box, ctx: PaintContext): void {
  const d = box.data as TableGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const pad = theme.space.md;
  g.textBaseline = "middle";

  g.font = d.titleFont;
  g.fillStyle = c.ink;
  g.textAlign = "left";
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));

  const f = d.frame;
  ctx.roundRect(ox + f.x + 0.5, oy + f.y + 0.5, f.w - 1, f.h - 1, theme.radius.md);
  g.fillStyle = c.raised;
  g.fill();
  if (!d.embeddedInCard) {
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.save();
    g.globalAlpha *= 0.72;
    g.stroke();
    g.restore();
  }

  if (d.message) {
    g.font = d.cellFont;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(d.message, ox + f.w / 2, oy + f.y + f.h / 2);
    return;
  }

  // Sideways scrolling: where each column is drawn, and the area the moving ones are clipped to.
  const s = d.scroll;
  const view = ctx.view(box.node);
  let sx = scrollOf(view, s);
  // Keyboard focus on a header that's scrolled out of sight brings it into view.
  if (s) {
    d.columns.forEach((col, ci) => {
      if (!scrolls(s, ci) || !ctx.isFocused(box.node, sortDetail(col.field))) return;
      const left = col.x - s.pinned, right = left + col.w;
      if (left < sx) sx = left;
      else if (right > sx + s.view) sx = right - s.view;
      scrollTo(view, s, sx);
      sx = view.x ?? 0;
    });
  }
  const colX = (ci: number) => d.columns[ci]!.x - (scrolls(s, ci) ? sx : 0);
  const clipLeft = ox + f.x + (s?.pinned ?? 0), clipRight = ox + f.x + f.w;
  const clipped = (ci: number, draw: () => void) => {
    if (!scrolls(s, ci)) { draw(); return; }
    g.save();
    g.beginPath();
    g.rect(clipLeft, oy + f.y, clipRight - clipLeft, f.h);
    g.clip();
    draw();
    g.restore();
  };
  /** The part of column ci that shows, in canvas x, or null when it's scrolled out of sight. */
  const visiblePart = (ci: number): { x: number; w: number } | null => {
    const x = ox + colX(ci), w = d.columns[ci]!.w;
    if (!scrolls(s, ci)) return { x, w };
    const l = Math.max(x, clipLeft), r = Math.min(x + w, clipRight);
    return r - l > 1 ? { x: l, w: r - l } : null;
  };
  // Anywhere on a scrolling table takes the wheel and a drag (registered first, so its parts sit on top).
  if (s) ctx.addHit(tablePart(box, ox + f.x, oy + f.y, f.w, f.h), { detail: SCROLL_AREA, focusable: false });
  const strip = s ? s.bar.h : 0;

  // A faint band behind the header sets it apart from the rows, inside the frame's rounded corners.
  g.save();
  ctx.roundRect(ox + f.x + 1, oy + f.y + 1, f.w - 2, f.h - 2, theme.radius.md - 1);
  g.clip();
  g.beginPath();
  g.rect(ox + f.x, oy + f.y, f.w, d.headerH);
  fillTint(g, c.ink, 0.018);
  g.restore();

  // Rules between rows are lighter than the frame: they guide the eye without boxing every row.
  const rule = (y: number, light = true) => {
    g.beginPath();
    g.moveTo(ox + f.x + 1, Math.round(oy + y) + 0.5);
    g.lineTo(ox + f.x + f.w - 1, Math.round(oy + y) + 0.5);
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.save();
    g.globalAlpha *= light ? 0.42 : 0.7;
    g.stroke();
    g.restore();
  };
  const focusRing = (x: number, y: number, w: number, h: number) => {
    ctx.roundRect(x + 2, y + 2, w - 4, h - 4, theme.radius.sm);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  };

  // Header: a pressable cell per column when the table sorts.
  const hy = oy + f.y;
  g.font = d.headerFont;
  d.columns.forEach((col, ci) => {
    const part = visiblePart(ci);
    if (!part) return;
    clipped(ci, () => paintHeader(col, ci, part));
  });
  function paintHeader(col: TableColumn, ci: number, part: { x: number; w: number }) {
    const cell = tablePart(box, part.x, hy, part.w, d!.headerH);
    const cx = ox + colX(ci);
    // A header that doesn't sort but has a tip is pressable for its tip alone.
    const detail = d!.sortable ? sortDetail(col.field) : `tip:${ci}`;
    const hovered = d!.sortable && ctx.isHovered(box.node, detail);
    if (d!.sortable || col.tip) ctx.addHit(cell, { detail });
    // A sorted column says so quietly: its label in ink with a small arrow, no box
    // or underline. Every other sortable header keeps a faint up-and-down arrow,
    // since a phone has no hover to reveal that it can be pressed.
    const shown = ctx.tween(box.node, "table:header:" + col.field, hovered || !!col.sorted ? 1 : 0, MOTION.hover);
    g.font = d!.headerFont;
    g.fillStyle = col.sorted || hovered ? c.ink : c.muted;
    // The label lines up with the cells; the arrow goes on its far side from that edge.
    const right = col.align === "right";
    g.textAlign = right ? "right" : "left";
    const tx = right ? cx + col.w - pad : cx + pad;
    g.fillText(col.shownLabel, tx, hy + d!.headerH / 2);
    const labelW = g.measureText(col.shownLabel).width;
    if (col.tip) {
      // A header with a tip is underlined with dots, like a row label in compare or details.
      const lx = right ? tx - labelW : tx, ly = hy + d!.headerH / 2 + Math.round(d!.headerH / 4);
      for (let x = 0; x < labelW; x += 4) g.fillRect(lx + x, ly, 2, 1);
    }
    if (d!.sortable) {
      const ax = right ? tx - labelW - 8 : tx + labelW + 8;
      const ay = hy + d!.headerH / 2;
      g.save();
      if (col.sorted) {
        g.globalAlpha *= shown;
        chevron(g, ax, ay, 7, col.sorted === "desc" ? "down" : "up", c.ink);
      } else {
        g.globalAlpha *= ARROW_REST + (ARROW_HOVER - ARROW_REST) * shown;
        chevron(g, ax, ay - 3, 5, "up", c.muted);
        chevron(g, ax, ay + 3, 5, "down", c.muted);
      }
      g.restore();
    }
    if ((d!.sortable || col.tip) && ctx.isFocused(box.node, detail)) focusRing(cell.x, cell.y, cell.w, cell.h);
  }
  rule(f.y + d.headerH, false);

  if (d.loading) {
    // Placeholder cells, a little shorter than their columns and of varied lengths.
    const { rows, h } = d.loading;
    for (let r = 1; r < rows; r++) rule(f.y + d.headerH + r * h);
    const pillH = 10;
    g.save();
    g.beginPath();
    g.rect(ox + f.x, oy + f.y, f.w, f.h);
    g.clip();
    paintGhost(ctx, { x: ox, y: oy + f.y + d.headerH, w: f.w, h: rows * h }, (ghost) => {
      for (let r = 0; r < rows; r++) {
        const cy = oy + f.y + d.headerH + r * h + h / 2;
        d.columns.forEach((col, ci) => {
          if (!visiblePart(ci)) return;
          const room = col.w - 2 * pad;
          const w = Math.max(12, room * (col.align === "right" ? 0.5 : 0.55 + 0.35 * (((r * 7 + ci * 3) % 5) / 4)));
          const x = ox + colX(ci);
          ghost.pill(col.align === "right" ? x + col.w - pad - w : x + pad, cy - pillH / 2, Math.min(room, w), pillH);
        });
      }
    });
    g.restore();
    return;
  }

  // Rows. Just after the data arrived, they slide in one after another.
  const reveal = ctx.reveal(box.node);
  const base = g.globalAlpha;
  g.font = d.cellFont;
  d.rows.forEach((row, r) => {
    const shown = reveal < 1 ? staggered(reveal, r, d.rows.length, 0.5) : 1;
    g.globalAlpha = base * shown;
    const ry = oy + row.y + (1 - shown) * 6;
    const last = r === d.rows.length - 1;
    // The scrollbar's strip sits under the last row, so its corners stay square.
    const roundLast = last && !s;
    const hovered = row.detail ? ctx.isHovered(box.node, row.detail) : false;
    const highlight = row.detail ? ctx.tween(box.node, "table:hover:" + String(row.detail), hovered ? 1 : 0, MOTION.hover) : 0;
    const selected = row.detail ? ctx.tween(box.node, "table:selected:" + String(row.detail), row.selected ? 1 : 0, MOTION.selection) : 0;
    if (r % 2 || highlight > 0 || selected > 0) {
      if (roundLast) ctx.roundRect(ox + f.x + 1, ry, f.w - 2, row.h - 1, theme.radius.md - 1);
      else { g.beginPath(); g.rect(ox + f.x + 1, ry, f.w - 2, row.h); }
      if (r % 2) fillTint(g, c.ink, 0.012);
      if (highlight) fillTint(g, c.ink, 0.032 * highlight);
      if (selected) fillTint(g, c.accent, 0.075 * selected);
    }
    if (selected > 0 || row.selected) {
      ctx.roundRect(ox + f.x + 3, ry + 7, 2, Math.max(0, row.h - 14), 1);
      g.save();
      // Keep the selection rail fully visible immediately; tint eases in.
      g.globalAlpha *= row.selected ? 1 : selected;
      g.fillStyle = c.accent;
      g.fill();
      g.restore();
    }
    if (row.detail) ctx.addHit(tablePart(box, ox + f.x, ry, f.w, row.h), { detail: row.detail });
    d.columns.forEach((col, ci) => {
      if (!visiblePart(ci)) return;
      const cell = row.cells[ci]!;
      const tone = tableValueTone(cell.full, col.format);
      const x = ox + colX(ci);
      clipped(ci, () => {
        const right = col.align === "right";
        g.textAlign = right ? "right" : "left";
        // Lines sit centred in the row, so a short cell next to a tall one lines up with its middle.
        if (cell.bar !== undefined && col.bar) paintBar(ctx, col, cell.bar, x, ry, row.h);
        if (cell.badge) {
          // A badge: the tone's own color at low opacity behind its text, like details.
          const color = toneColor(theme, cell.badge);
          g.font = d.badgeFont;
          const text = cell.lines[0] ?? "";
          const bw = g.measureText(text).width + 2 * BADGE_PAD, bh = Math.round(d.cellLH * 0.95);
          const bx = right ? x + col.w - pad - bw : x + pad;
          ctx.roundRect(bx, ry + row.h / 2 - bh / 2, bw, bh, bh / 2);
          fillTint(g, color, 0.14);
          g.fillStyle = color;
          g.textAlign = "left";
          g.fillText(text, bx + BADGE_PAD, ry + row.h / 2 + 0.5);
          g.font = d.cellFont;
          return;
        }
        g.fillStyle = cell.full === EMPTY_CELL ? c.muted : cell.sign ? c[cell.sign] : col.tone === "sign" ? c.ink : tone === "negative" ? c.bad : tone === "positive" ? c.good : c.ink;
        const n = cell.lines.length + (cell.more ? 1 : 0);
        const first = ry + (row.h - n * d.cellLH) / 2;
        cell.lines.forEach((line, li) => g.fillText(line, right ? x + col.w - pad : x + pad, first + li * d.cellLH + d.cellLH / 2));
        if (cell.more) paintMore(cell.more, row.index, ci, x, first + cell.lines.length * d.cellLH, col.w);
      });
    });
    if (!last || s) rule(row.y + row.h);
    if (row.detail && ctx.isFocused(box.node, row.detail)) focusRing(ox + f.x, ry, f.w, row.h);
  });
  g.globalAlpha = base;

  if (d.totals) paintTotals(box, ctx, d, colX, clipped, visiblePart, !!s);

  /** A long cell's toggle: a line of accent text under it, pressable on its own (above the row). */
  function paintMore(state: "closed" | "open", item: number, ci: number, x: number, y: number, w: number) {
    const detail = moreDetail(item, ci);
    const label = MORE_LABEL[state];
    g.font = d!.headerFont;
    g.textAlign = "left";
    g.fillStyle = c.accent;
    g.fillText(label, x + pad, y + d!.cellLH / 2);
    const lw = g.measureText(label).width;
    if (ctx.isHovered(box.node, detail)) g.fillRect(x + pad, Math.round(y + d!.cellLH * 0.8), lw, 1);
    const part = tablePart(box, x + pad / 2, y, Math.min(w - pad, lw + pad), d!.cellLH);
    ctx.addHit(part, { detail });
    if (ctx.isFocused(box.node, detail)) focusRing(part.x - 2, part.y - 2, part.w + 4, part.h + 4);
    g.font = d!.cellFont;
  }

  if (d.empty) {
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(d.empty, ox + f.w / 2, oy + f.y + d.headerH + (f.h - d.headerH - strip) / 2);
  }

  if (s) paintScroll(box, ctx, d, s, sx);
}

/** An in-cell bar, behind the number: from the left edge, or from a zero line when some values are negative. */
function paintBar(ctx: PaintContext, col: TableColumn, frac: number, x: number, ry: number, rowH: number): void {
  const { g, theme } = ctx;
  const bar = col.bar;
  if (!bar) return;
  const hasNeg = bar.neg > 0;
  const h = Math.max(6, Math.round(rowH * 0.5));
  // With negatives, zero sits where the two sides' scales meet; otherwise at the track's left.
  const total = bar.pos + bar.neg;
  const scale = Math.max(bar.pos, bar.neg);
  const zero = x + bar.x + (hasNeg && total > 0 ? (bar.w * bar.neg) / total : 0);
  // Pixels per unit of value: both sides share one scale.
  const unit = scale > 0 ? (hasNeg ? bar.w / total : bar.w / scale) : 0;
  const len = Math.abs(frac) * scale * unit;
  if (len < 0.5) return;
  const bx = frac < 0 ? zero - len : zero;
  ctx.roundRect(bx, ry + (rowH - h) / 2, len, h, Math.min(theme.radius.sm, h / 2));
  fillTint(g, frac < 0 ? theme.colors.bad : theme.colors.accent, 0.2);
}

/** The totals row: a firmer rule above it, a faint band and bold sums, pinned under the rows. */
function paintTotals(
  box: Box, ctx: PaintContext, d: TableGeometry,
  colX: (ci: number) => number, clipped: (ci: number, draw: () => void) => void,
  visiblePart: (ci: number) => { x: number; w: number } | null, scrolls: boolean,
): void {
  const tot = d.totals!;
  const { g, theme } = ctx;
  const c = theme.colors, pad = theme.space.md;
  const ox = box.x, oy = box.y, f = d.frame;
  const y = oy + tot.y;
  // The band stays inside the frame's rounded corners when nothing sits under it.
  g.save();
  if (scrolls) { g.beginPath(); g.rect(ox + f.x + 1, y, f.w - 2, tot.h); }
  else ctx.roundRect(ox + f.x + 1, y, f.w - 2, tot.h - 1, theme.radius.md - 1);
  fillTint(g, c.ink, 0.04);
  g.restore();
  g.beginPath();
  g.moveTo(ox + f.x + 1, Math.round(y) + 0.5);
  g.lineTo(ox + f.x + f.w - 1, Math.round(y) + 0.5);
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  g.stroke();
  g.font = themeFont(theme, 600, theme.text.body);
  g.textBaseline = "middle";
  d.columns.forEach((col, ci) => {
    if (!visiblePart(ci)) return;
    const cell = tot.cells[ci]!;
    const x = ox + colX(ci);
    clipped(ci, () => {
      const right = col.align === "right";
      g.textAlign = right ? "right" : "left";
      g.fillStyle = c.ink;
      g.fillText(cell.lines[0] ?? "", right ? x + col.w - pad : x + pad, y + tot.h / 2);
    });
  });
  g.font = d.cellFont;
}

/** The pinned column's edge and the scrollbar of a table that scrolls sideways. */
function paintScroll(box: Box, ctx: PaintContext, d: TableGeometry, s: TableScroll, sx: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y, f = d.frame;
  // Soft fades where columns run out of sight, so it's clear there's more to scroll to.
  const top = oy + f.y + 1, bottom = oy + f.y + f.h - s.bar.h;
  const fade = (edge: number, inward: 1 | -1) => {
    // From the surface colour at the cut edge to nothing, in 1px steps eased so no band shows.
    g.save();
    ctx.roundRect(ox + f.x + 1, oy + f.y + 1, f.w - 2, f.h - 2, theme.radius.md - 1);
    g.clip();
    for (let i = 0; i < FADE_W; i++) {
      g.beginPath();
      g.rect(inward > 0 ? edge + i : edge - i - 1, top, 1, bottom - top);
      fillTint(g, c.raised, (1 - i / FADE_W) ** 2);
    }
    g.restore();
  };
  if (sx < s.max - 0.5) fade(ox + f.x + f.w, -1);
  if (sx > 0.5) fade(ox + f.x + s.pinned + (s.pinned ? 1 : 0), 1);

  // A rule at the pinned column's edge, firmer with a soft shadow once columns slide under it.
  if (s.pinned) {
    const ex = Math.round(ox + f.x + s.pinned) + 0.5;
    if (sx > 0) {
      for (let i = 1; i <= 3; i++) {
        g.beginPath();
        g.rect(ex + 0.5, top, 2 * i, bottom - top);
        fillTint(g, c.ink, 0.012);
      }
    }
    g.beginPath();
    g.moveTo(ex, top);
    g.lineTo(ex, bottom);
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.save();
    g.globalAlpha *= sx > 0 ? 0.9 : 0.5;
    g.stroke();
    g.restore();
  }

  // The scrollbar: a faint track and a thumb, thicker under the pointer or while dragged.
  const bar = tablePart(box, ox + s.bar.x, oy + s.bar.y, s.bar.w, s.bar.h);
  const t = scrollThumb(s, sx);
  const active = ctx.isHovered(box.node, SCROLL_BAR) || ctx.isPressed(box.node, SCROLL_BAR);
  const grow = ctx.tween(box.node, "table:scrollbar", active ? 1 : 0, MOTION.hover);
  const h = 4 + 2 * grow;
  const cy = oy + s.bar.y + s.bar.h / 2;
  ctx.roundRect(ox + t.trackX, cy - h / 2, t.trackW, h, h / 2);
  fillTint(g, c.ink, 0.05);
  ctx.roundRect(ox + t.x, cy - h / 2, t.w, h, h / 2);
  fillTint(g, c.ink, 0.22 + 0.14 * grow);
  ctx.addHit(bar, { detail: SCROLL_BAR });
  if (ctx.isFocused(box.node, SCROLL_BAR)) {
    ctx.roundRect(ox + t.trackX - 4, oy + s.bar.y + 1, t.trackW + 8, s.bar.h - 2, theme.radius.sm);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  }
}

// ---------------------------------------------------------------- components

export const table: ComponentDef = {
  type: "table",
  category: "data",
  description:
    "Rows of a list of records, one table-column per field, for things like inventory, orders or expenses. With sort= and direction=, pressing a header sorts by it; with bind= and key=, pressing a row selects it; columns too wide for the space scroll sideways, the first one staying in view.",
  text: { description: "A title above the table." },
  props: {
    items: { type: "expression", required: true, description: `The list of records, e.g. items=equipment. At most ${MAX_TABLE_ROWS} rows; show a page of a longer list with slice() and pagination.` },
    key: { type: "name", description: "The field that identifies each row, e.g. key=id. Needed for bind=." },
    bind: { type: "state", description: "State that holds the selected row's key. Pressing a row sets it." },
    sort: { type: "state", description: "State that holds the field to sort by. Pressing a header sets it; missing values sort last." },
    direction: { type: "state", description: "State that holds asc or desc. Pressing the sorted header again flips it." },
    on: onProp("after a row is selected, with bind= already set"),
    total: { type: "string", description: "Add a totals row summing number, money and compact columns: true, or text for its first cell." },
  },
  children: ["table-column"],
  picks: [
    { for: "many rows with several columns", write: "table items=rows holding table-column field=name" },
  ],
  example: `state gear=[{id: "tent", name: "Tent", price: 180}, {id: "stove", name: "Stove", price: 45}] picked="" by="name" dir="asc"
table items=gear key=id bind=picked sort=by direction=dir
  table-column "Item" field=name
  table-column "Price" field=price format=money`,
  minWidth: () => 200,
  // Scrolled sideways, it needs as much more room as it can scroll.
  fullWidth: (box) => box.w + ((box.data as TableGeometry | undefined)?.scroll?.max ?? 0),
  partTip(box, detail) {
    const cols = (box.data as TableGeometry | undefined)?.columns ?? [];
    if (typeof detail !== "string") return undefined;
    if (detail.startsWith("tip:")) return cols[Number(detail.slice(4))]?.node;
    return detail.startsWith("sort:") ? cols.find((c) => sortDetail(c.field) === detail)?.node : undefined;
  },
  semantics(box, ctx) {
    const d = box.data as TableGeometry | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message) return { role: "text", name: name ? `${name}: ${d.message}` : d.message };
    // Rows are drawn by the table itself: header, rows and cells are parts,
    // each placed where it's drawn (before any sideways scrolling).
    const parts: PartSemantics[] = [{ detail: "head", role: "row", rect: { x: box.x + d.frame.x, y: box.y + d.frame.y, w: d.frame.w, h: d.headerH } }];
    d.columns.forEach((col, ci) => parts.push({
      detail: d.sortable ? sortDetail(col.field) : col.tip ? `tip:${ci}` : `col:${ci}`,
      within: "head",
      role: "columnheader",
      name: col.label,
      ...(col.tip ? { description: col.tip } : {}),
      sort: col.sorted === "asc" ? "ascending" : col.sorted === "desc" ? "descending" : undefined,
    }));
    if (!d.rows.length && d.empty) {
      parts.push({ detail: "empty", role: "row" }, { detail: "empty:cell", within: "empty", role: "cell", name: d.empty });
    }
    d.rows.forEach((row) => {
      const rowDetail = row.detail ?? `row:${row.index}`;
      parts.push({
        detail: rowDetail,
        role: "row",
        // A row that can be focused and chosen is named by its cells, read when focus lands on it.
        name: row.selectable ? row.cells.map((c) => c.full).join(", ") : undefined,
        selected: row.selectable ? row.selected : undefined,
        rect: { x: box.x + d.frame.x, y: box.y + row.y, w: d.frame.w, h: row.h },
      });
      row.cells.forEach((cell, ci) => {
        parts.push({ detail: `cell:${row.index}:${ci}`, within: rowDetail, role: ci === 0 ? "rowheader" : "cell", name: cell.full });
        // The whole text is the cell's name either way; the toggle is for eyes, and named for its column.
        if (cell.more) parts.push({ detail: moreDetail(row.index, ci), within: `cell:${row.index}:${ci}`, role: "button", name: `${MORE_LABEL[cell.more]} of ${d.columns[ci]!.label}`, expanded: cell.more === "open" });
      });
    });
    if (d.totals) {
      parts.push({ detail: "total", role: "row", rect: { x: box.x + d.frame.x, y: box.y + d.totals.y, w: d.frame.w, h: d.totals.h } });
      d.totals.cells.forEach((cell, ci) => parts.push({ detail: `total:${ci}`, within: "total", role: ci === 0 ? "rowheader" : "cell", name: cell.full }));
    }
    return { role: "table", name, detail: "table", parts };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const geo = tableLayout(box, p, ctx, !!ctx.isLoading?.(box.node));
    box.data = geo;
    box.h = geo.frame.y + geo.frame.h;
  },
  paint: paintTable,
  // The header is real while rows load; paintTable draws placeholder rows under it.
  paintLoading: paintTable,
  press: pressTable,
  // Dragging the rows or the scrollbar scrolls a wide table; a press that doesn't move still sorts or selects.
  drag(ctx) {
    const v = ctx.view(ctx.target.node);
    const s = partOf(ctx.target.box)?.table.scroll;
    if (ctx.phase === "start") {
      v.dragX = ctx.x;
      v.dragFrom = v.x ?? 0;
      v.dragMoved = 0;
      return false;
    }
    const dx = ctx.x - (v.dragX ?? ctx.x);
    const onBar = ctx.target.detail === SCROLL_BAR;
    if (ctx.phase === "move") {
      if (!s || (!v.dragMoved && Math.abs(dx) < DRAG_SLOP)) return false;
      v.dragMoved = 1;
      // The thumb follows the pointer; the rows move with it, the other way round.
      const t = scrollThumb(s, 0);
      const perPixel = onBar ? s.max / Math.max(1, t.trackW - t.w) : -1;
      scrollTo(v, s, (v.dragFrom ?? 0) + dx * perPixel);
      return false;
    }
    const moved = !!v.dragMoved;
    delete v.dragX; delete v.dragFrom; delete v.dragMoved;
    // Moved, or taken over by the browser (a page scroll): nothing is pressed.
    if (moved || ctx.cancelled) return false;
    if (onBar && s) {
      // A click on the track centres the thumb there.
      const t = scrollThumb(s, 0);
      const at = ctx.x - (partOf(ctx.target.box)?.x ?? 0) - t.trackX - t.w / 2;
      scrollTo(v, s, (at / Math.max(1, t.trackW - t.w)) * s.max);
      return false;
    }
    pressTable(ctx);
    return false;
  },
  wheel(ctx) {
    const s = partOf(ctx.target.box)?.table.scroll;
    if (!s) return false;
    // Only sideways movement scrolls the table; up and down still scroll the page.
    const dx = ctx.deltaX || (ctx.shiftKey ? ctx.deltaY : 0);
    if (!dx) return false;
    const v = ctx.view(ctx.target.node);
    return scrollTo(v, s, (v.x ?? 0) + dx);
  },
  key(ctx, key) {
    const s = partOf(ctx.target.box)?.table.scroll;
    if (!s) return false;
    const v = ctx.view(ctx.target.node);
    const x = v.x ?? 0;
    const to = key === "ArrowRight" ? x + ARROW_STEP : key === "ArrowLeft" ? x - ARROW_STEP : key === "Home" ? 0 : key === "End" ? s.max : null;
    return to !== null && scrollTo(v, s, to);
  },
  cursor: (target) => (target.detail === SCROLL_AREA ? "default" : "pointer"),
};

/** Pressing a header sorts by it; pressing a row selects it. */
function pressTable(ctx: PressContext): void {
  const detail = ctx.target.detail;
  if (typeof detail !== "string" || detail.startsWith("scroll:")) return;
  const fold = /^more:(\d+):(\d+)$/.exec(detail);
  if (fold) {
    const v = ctx.view(ctx.target.node), k = foldKey(Number(fold[1]), Number(fold[2]));
    if (v[k]) delete v[k];
    else v[k] = 1;
    ctx.relayout?.();
    return;
  }
  const p = ctx.props(ctx.target.node);
  if (detail.startsWith("sort:")) {
    const field = detail.slice(5);
    const sortPath = p.raw("sort"), dirPath = p.raw("direction");
    if (!sortPath) return;
    if (sortedBy(p, (name) => name === field) === field && dirPath) {
      ctx.set(dirPath, sortDirection(p) === "desc" ? "asc" : "desc");
    } else {
      ctx.set(sortPath, field);
      if (dirPath) ctx.set(dirPath, "asc");
    }
    return;
  }
  const key = keyFromDetail(detail);
  const bind = p.raw("bind");
  if (key === null || !bind) return;
  ctx.set(bind, key);
  runOn(ctx);
}

export const tableColumn: ComponentDef = {
  type: "table-column",
  noBox: true,
  category: "data",
  description: "One column of a table: its header and the field it shows.",
  text: { description: "The header. Defaults to the field name." },
  props: {
    field: { type: "name", required: true, description: "The field of each record to show, e.g. field=price." },
    format: { type: "enum", values: FORMATS, default: "text", description: "text, number (1,200.5), money ($1,200, with cents when an amount has them), percent (42 reads 42%), compact (1.25M) or date (YYYY-MM-DD reads Mar 3, 2026). Number formats show only numbers; other values show —." },
    align: { type: "enum", values: ALIGNS, description: "left or right. Default: right for numbers, left for text and date." },
    tone: { type: "name", description: "sign (negative bad, positive good) or a row field holding good, warn, bad, accent or muted to draw a badge." },
    bar: { type: "boolean", default: false, description: "A bar behind each number, sized to the column's largest." },
  },
  parents: ["table"],
  example: `table-column "Price" field=price format=money`,
  // Columns have no box of their own: the table lays them out and draws them.
  // Read as part of its table (table describes its columns).
  semantics: () => null,
  layout(box) {
    box.h = 0;
  },
};
