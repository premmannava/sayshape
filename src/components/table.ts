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
 * Rules (also in the README):
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
 *   below MIN_TEXT_COLUMN) to fit. When even that doesn't fit, the table
 *   scrolls sideways instead: every column keeps a readable width, the first
 *   column stays pinned at the left, and a scrollbar shows under the rows.
 *   It scrolls with a sideways swipe or Shift and the wheel, by dragging the
 *   rows or the scrollbar, and with the arrow keys, Home and End. The offset
 *   is view state (ctx.view), never app state.
 * - At most MAX_TABLE_ROWS rows and MAX_TABLE_COLUMNS columns; otherwise a
 *   message replaces the table.
 */
import type { ComponentDef, ElementView, LayoutContext, PaintContext, PressContext, PropReader } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import type { TextMeasurer } from "../text";
import { wrapText } from "../text";
import type { Theme } from "../theme";
import type { Box, SayShapeNode, Value } from "../types";
import { chevron, fillTint, onProp, partBox, runOn, themeFont } from "./util";
import { paintGhost, staggered } from "../ghost";
import { MOTION } from "../design";

/** The most rows one table shows. Larger lists show a message: page them with take() or pagination. */
export const MAX_TABLE_ROWS = 200;
/**
 * The most columns one table shows. Wide tables scroll sideways, so this is
 * only a safety bound (a whole property schedule of values has about 56).
 */
export const MAX_TABLE_COLUMNS = 64;
/** The placeholder for a missing or unusable value. */
export const EMPTY_CELL = "—";

const FORMATS = ["text", "number", "money"] as const;
const ALIGNS = ["left", "right"] as const;
type Format = (typeof FORMATS)[number];
type Align = (typeof ALIGNS)[number];
const LOCALE = "en-US";
/** Text columns shrink to this before the table gives up (numbers never shrink). */
const MIN_TEXT_COLUMN = 72;
/** Room for the sort arrow beside a header. */
const ARROW = 14;
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
  /** Each cell's text as drawn (cut to fit), and in full. */
  cells: Array<{ text: string; full: string }>;
}

/** Everything paint and press need, relative to the table's box. */
export type TableGeometry = {
  title: string[];
  titleFont: string;
  titleLH: number;
  headerFont: string;
  cellFont: string;
  /** Shown instead of rows and columns: too many, too narrow, no columns. */
  message?: string;
  /** The bordered area: header, rows and any empty message. */
  frame: Rect;
  headerH: number;
  columns: TableColumn[];
  rows: TableRow[];
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

function formatNumber(v: number, money: boolean): string {
  const huge = Math.abs(v) >= 1e15, tiny = !money && v !== 0 && Math.abs(v) < 0.01;
  // Very large or small numbers in scientific form, so they're never cut or shown as 0.
  const opts: Intl.NumberFormatOptions = huge || tiny ? { notation: "scientific", maximumFractionDigits: 3 } : money ? {} : { maximumFractionDigits: 2 };
  if (money) Object.assign(opts, { style: "currency", currency: "USD" });
  return new Intl.NumberFormat(LOCALE, opts).format(v);
}

/** A cell's text, and whether the value didn't suit its column (for one warning). */
export function cellText(v: Value | undefined, format: Format): { text: string; incompatible: boolean } {
  if (v === undefined || v === null) return { text: EMPTY_CELL, incompatible: false };
  if (format === "text") {
    if (typeof v === "string") return { text: v, incompatible: false };
    if (typeof v === "number") return { text: formatNumber(v, false), incompatible: false };
    if (typeof v === "boolean") return { text: v ? "Yes" : "No", incompatible: false };
    return { text: EMPTY_CELL, incompatible: true };
  }
  // A number column never reads text like "12" as a number.
  if (typeof v === "number") return { text: formatNumber(v, format === "money"), incompatible: false };
  return { text: EMPTY_CELL, incompatible: true };
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
const sortDetail = (field: string) => `sort:${field}`;

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

interface ColumnSpec { field: string; label: string; format: Format; align: Align }

function readColumns(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren" | "props">): ColumnSpec[] {
  return ctx.visibleChildren(node).filter((c) => c.type === "table-column").map((c) => {
    const p = ctx.props(c);
    const field = p.str("field");
    const format = p.oneOf("format", FORMATS, "text");
    return { field, label: p.text(field), format, align: p.oneOf("align", ALIGNS, format === "text" ? "left" : "right") };
  });
}

function tableLayout(box: { w: number; node: SayShapeNode }, p: PropReader, ctx: Pick<LayoutContext, "theme" | "measure" | "warn" | "visibleChildren" | "props">, loading = false): TableGeometry {
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
  const base: TableGeometry = { title, titleFont, titleLH, headerFont, cellFont, frame: { x: 0, y: top, w: box.w, h: 0 }, headerH, columns: [], rows: [], sortable: false };
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
    warn(`${items.length} rows is more than the ${MAX_TABLE_ROWS} a table shows. Show a page with take() or pagination`);
    return say(`Too many rows to show: ${items.length}, at most ${MAX_TABLE_ROWS}`);
  }

  // Sorting: only by a field one of the columns shows.
  const sortable = p.has("sort");
  const sortValue = p.bound("sort");
  const sortField = typeof sortValue === "string" && specs.some((c) => c.field === sortValue) ? sortValue : null;
  const direction = p.bound("direction") === "desc" ? "desc" : "asc";
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
  const texts = order.map((i) => {
    const item = items[i]!;
    if (!isRecord(item)) malformed++;
    return specs.map((c) => {
      const r = cellText(isRecord(item) ? fieldOf(item, c.field) : undefined, c.format);
      if (r.incompatible && isRecord(item)) incompatible++;
      return r.text;
    });
  });
  if (malformed) warn(`${malformed} items aren't records, so their cells show ${EMPTY_CELL}`);
  if (incompatible) warn(`${incompatible} cells hold a value their column can't show (number and money columns need numbers), so they show ${EMPTY_CELL}`);

  // Column widths from what they hold.
  const headerW = specs.map((c) => m.width(c.label, headerFont) + (sortable ? ARROW : 0) + 2 * pad);
  const cellW = specs.map((_, ci) => Math.max(0, ...texts.map((row) => m.width(row[ci]!, cellFont))) + 2 * pad);
  const natural = specs.map((_, ci) => Math.max(headerW[ci]!, cellW[ci]!));
  // Numbers are never cut short; text and headers can be.
  const minimum = specs.map((c, ci) => (c.format === "text" ? Math.min(natural[ci]!, MIN_TEXT_COLUMN) : Math.max(cellW[ci]!, Math.min(headerW[ci]!, MIN_TEXT_COLUMN))));
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

  let x = 0;
  const columns: TableColumn[] = specs.map((c, ci) => {
    const w = widths[ci]!;
    const col: TableColumn = {
      ...c, x, w,
      shownLabel: fit(c.label, w - 2 * pad - (sortable ? ARROW : 0), headerFont, m),
      sorted: sortField === c.field ? direction : null,
    };
    x += w;
    return col;
  });

  const rowsTop = top + headerH;
  const rows: TableRow[] = order.map((i, r) => {
    const key = usable[i] ? keys[i]! : null;
    const selectable = bindable && key !== null;
    return {
      index: i,
      y: rowsTop + r * rowH,
      h: rowH,
      key,
      selectable,
      selected: selectable && selectedValue === key,
      detail: selectable ? rowDetail(key) : null,
      cells: texts[r]!.map((full, ci) => ({ full, text: fit(full, columns[ci]!.w - 2 * pad, cellFont, m) })),
    };
  });
  const strip = scrollParts ? SCROLLBAR_STRIP : 0;
  const withBar = (frame: Rect): TableScroll | undefined =>
    scrollParts && { ...scrollParts, bar: { x: frame.x + scrollParts.pinned, y: frame.y + frame.h - strip, w: scrollParts.view, h: strip } };
  if (loading) {
    const frame = { x: 0, y: top, w: box.w, h: headerH + GHOST_ROWS * rowH + strip };
    return { ...base, frame, columns, rows: [], sortable: false, loading: { rows: GHOST_ROWS, h: rowH }, scroll: withBar(frame) };
  }
  const emptyH = items.length ? 0 : rowH * 1.5;
  const frame = { x: 0, y: top, w: box.w, h: headerH + rows.length * rowH + emptyH + strip };
  return {
    ...base,
    frame,
    columns,
    rows,
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
export function tableValueTone(value: string, format: "text" | "number" | "money"): "positive" | "negative" | null {
  if (format === "text" || value === EMPTY_CELL) return null;
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
    const detail = sortDetail(col.field);
    const hovered = d!.sortable && ctx.isHovered(box.node, detail);
    if (d!.sortable) ctx.addHit(cell, { detail });
    // A sorted column says so quietly: its label in ink with a small arrow, no box
    // or underline. Hover previews the same, with the arrow faint.
    const shown = ctx.tween(box.node, "table:header:" + col.field, hovered || !!col.sorted ? 1 : 0, MOTION.hover);
    g.font = d!.headerFont;
    g.fillStyle = col.sorted || hovered ? c.ink : c.muted;
    // The label lines up with the cells; the arrow goes on its far side from that edge.
    const right = col.align === "right";
    g.textAlign = right ? "right" : "left";
    const tx = right ? cx + col.w - pad : cx + pad;
    g.fillText(col.shownLabel, tx, hy + d!.headerH / 2);
    if (shown > 0) {
      const labelW = g.measureText(col.shownLabel).width;
      const ax = right ? tx - labelW - 8 : tx + labelW + 8;
      g.save();
      g.globalAlpha *= col.sorted ? shown : 0.45 * shown;
      chevron(g, ax, hy + d!.headerH / 2, 7, col.sorted === "desc" ? "down" : "up", col.sorted ? c.ink : c.muted);
      g.restore();
    }
    if (d!.sortable && ctx.isFocused(box.node, detail)) focusRing(cell.x, cell.y, cell.w, cell.h);
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
        g.fillStyle = cell.full === EMPTY_CELL ? c.muted : tone === "negative" ? c.bad : tone === "positive" ? c.good : c.ink;
        const right = col.align === "right";
        g.textAlign = right ? "right" : "left";
        g.fillText(cell.text, right ? x + col.w - pad : x + pad, ry + row.h / 2);
      });
    });
    if (!last || s) rule(row.y + row.h);
    if (row.detail && ctx.isFocused(box.node, row.detail)) focusRing(ox + f.x, ry, f.w, row.h);
  });
  g.globalAlpha = base;

  if (d.empty) {
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(d.empty, ox + f.w / 2, oy + f.y + d.headerH + (f.h - d.headerH - strip) / 2);
  }

  if (s) paintScroll(box, ctx, d, s, sx);
}

/** The pinned column's edge and the scrollbar of a table that scrolls sideways. */
function paintScroll(box: Box, ctx: PaintContext, d: TableGeometry, s: TableScroll, sx: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y, f = d.frame;
  // Soft fades where columns run out of sight, so it's clear there's more to scroll to.
  const top = oy + f.y + 1, bottom = oy + f.y + f.h - s.bar.h;
  const fade = (edge: number, inward: 1 | -1) => {
    const steps = 8, step = 2;
    g.save();
    ctx.roundRect(ox + f.x + 1, oy + f.y + 1, f.w - 2, f.h - 2, theme.radius.md - 1);
    g.clip();
    for (let i = 0; i < steps; i++) {
      g.beginPath();
      g.rect(inward > 0 ? edge + i * step : edge - (i + 1) * step, top, step, bottom - top);
      fillTint(g, c.raised, 1 - i / steps);
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
    items: { type: "expression", required: true, description: `The list of records, e.g. items=equipment. At most ${MAX_TABLE_ROWS} rows; show a page of a longer list with take() or pagination.` },
    key: { type: "name", description: "The field that identifies each row, e.g. key=id. Needed for bind=." },
    bind: { type: "state", description: "State that holds the selected row's key. Pressing a row sets it." },
    sort: { type: "state", description: "State that holds the field to sort by. Pressing a header sets it; missing values sort last." },
    direction: { type: "state", description: "State that holds asc or desc. Pressing the sorted header again flips it." },
    on: onProp("after a row is selected, with bind= already set"),
  },
  children: ["table-column"],
  example: `state gear=[{id: "tent", name: "Tent", price: 180}, {id: "stove", name: "Stove", price: 45}] picked="" by="name" dir="asc"
table items=gear key=id bind=picked sort=by direction=dir
  table-column "Item" field=name
  table-column "Price" field=price format=money`,
  minWidth: () => 200,
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
    if (moved) return false;
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
  const p = ctx.props(ctx.target.node);
  if (detail.startsWith("sort:")) {
    const field = detail.slice(5);
    const sortPath = p.raw("sort"), dirPath = p.raw("direction");
    if (!sortPath) return;
    if (p.bound("sort") === field && dirPath) {
      ctx.set(dirPath, p.bound("direction") === "desc" ? "asc" : "desc");
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
  category: "data",
  description: "One column of a table: its header and the field it shows.",
  text: { description: "The header. Defaults to the field name." },
  props: {
    field: { type: "name", required: true, description: "The field of each record to show, e.g. field=price." },
    format: { type: "enum", values: FORMATS, default: "text", description: "text, number (1,200.5) or money ($1,200.00, US dollars). number and money show only numbers; other values show —." },
    align: { type: "enum", values: ALIGNS, description: "left or right. Default: right for number and money, left for text." },
  },
  parents: ["table"],
  example: `table-column "Price" field=price format=money`,
  // Columns have no box of their own: the table lays them out and draws them.
  layout(box) {
    box.h = 0;
  },
};
