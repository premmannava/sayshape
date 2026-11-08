/**
 * board: columns of cards by stage. Sales pipelines, task boards, hiring
 * stages, support tickets, order status.
 *
 *   board items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name detail=company value=amount format=money sum=amount
 *
 * A column per stage, in the order of stages=, with a count and an optional
 * total in its header; a card per record, built from fields. Pressing a card
 * selects it (bind=, on=). With move=true a card can be dragged to another
 * column, or moved with the Left and Right arrows while it has focus: that
 * writes the record's stage field where the record lives in state (found by
 * identity, as bind= on an item inside each is), then runs on=.
 *
 * Too wide for its space, it scrolls sideways (engine-held view state,
 * ctx.view, as table does). On a phone the columns don't stack: each is most
 * of the screen wide and the next one peeks in.
 */
import type { ComponentDef, DragContext, LayoutContext, PaintContext, PressContext } from "../component";
import type { PartSemantics } from "../a11y/semantics";
import { fieldOf, isList, isRecord, toNumber } from "../data";
import { stateLocate } from "../paths";
import { ellipsize, fitLines } from "../text";
import type { Theme } from "../theme";
import type { Box, Value } from "../types";
import { valueText } from "./chart-kit";
import { fillTint, onProp, partBox, runOn, themeFont, toneColor, TONES, type Tone } from "./util";

/** The most cards one board draws; more shows a message (filter the list, or show part of it with take()). */
export const MAX_BOARD_CARDS = 500;
/** The most stages, so columns stay readable. */
export const MAX_BOARD_STAGES = 12;
/** The narrowest a column gets before the board scrolls sideways. */
export const MIN_COLUMN_W = 180;
/** Below this width, a column takes most of the screen and the next one peeks in. */
const NARROW = 560;
/** The widest a column gets on a narrow screen, where one column is most of the width. */
const PHONE_COLUMN_MAX = 300;
const FORMATS = ["text", "number", "money"] as const;
type Format = (typeof FORMATS)[number];
const SCROLL_AREA = "scroll:area";
const DRAG_SLOP = 4;
const ARROW_STEP = 60;

interface Card {
  /** Index into items. */
  index: number;
  detail: string;
  key: string | number | null;
  stage: number;
  title: string[];
  /** The full title, for screen readers and Copy text. */
  fullTitle: string;
  sub: string;
  value: string;
  /** The value sits on the detail line, right-aligned, when beside the title it would squeeze it. */
  valueBelow: boolean;
  /** What its color stands for, in words (risk: bad), so it isn't told by color alone. */
  toneNote: string;
  color: string | null;
  /** Relative to the box, x within the scrolled content. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Column {
  stage: string;
  /** The stage as the records write it (a number stays a number), for moving a card here. */
  raw: Value;
  count: number;
  total: string;
  x: number;
  w: number;
}

export interface BoardGeometry {
  title: string[];
  titleLH: number;
  /** Top of the columns, relative to the box, and their height. */
  top: number;
  colH: number;
  headH: number;
  message?: string;
  columns: Column[];
  cards: Card[];
  contentW: number;
  viewW: number;
  bar: number;
  pressable: boolean;
  movable: boolean;
  /** How far it was scrolled when last painted, for where screen-reader nodes are. */
  scrolled?: number;
  /** The stage field, for moving cards. */
  stageField: string;
  fonts: { title: string; card: string; small: string; head: string; value: string };
  lineH: { card: number; small: number };
}

const textOf = (v: Value | undefined): string =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/**
 * A card's value as it reads: money and numbers in full ($125,000), text as
 * is. A column's total (short) is shortened from ten thousand up ($216K), so
 * headers stay one short line and alike.
 */
function shown(v: Value | undefined, format: Format, short = false): string {
  if (format === "text") return textOf(v);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? toNumber(v) : NaN;
  if (!isFinite(n)) return textOf(v);
  if (short && Math.abs(n) >= 10_000) return compactText(n, format);
  try {
    return new Intl.NumberFormat("en-US", { ...(format === "money" ? { style: "currency", currency: "USD" } : {}), maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: format === "money" && !Number.isInteger(n) ? 2 : 0 }).format(n);
  } catch {
    return valueText(n, format);
  }
}

/** $70K, $94.5K, $1.2M. */
function compactText(n: number, format: "number" | "money"): string {
  try {
    return new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1, ...(format === "money" ? { style: "currency", currency: "USD" } : {}) }).format(n);
  } catch {
    return valueText(n, format);
  }
}

function colorOf(theme: Theme, value: string, categories: string[]): string {
  if ((TONES as readonly string[]).includes(value)) return toneColor(theme, value === "default" ? "accent" : (value as Tone));
  let i = categories.indexOf(value);
  if (i < 0) { i = categories.length; categories.push(value); }
  const c = theme.colors;
  return [c.series1, c.series2, c.series3, c.series4, c.series5, c.series6][i % 6]!;
}

// ---------------------------------------------------------------- layout

type LayoutCtx = Pick<LayoutContext, "theme" | "measure" | "warn" | "props" | "isLoading">;

export function boardLayout(box: Box, ctx: LayoutCtx): BoardGeometry {
  const p = ctx.props(box.node);
  const t = ctx.theme, m = ctx.measure;
  const warn = (msg: string) => ctx.warn?.(`board on line ${box.node.line}: ${msg}`);
  const fonts = {
    title: themeFont(t, 600, t.text.body),
    card: themeFont(t, 600, t.text.body),
    small: themeFont(t, 400, t.text.caption + 1),
    head: themeFont(t, 600, t.text.body),
    value: themeFont(t, 600, t.text.caption + 1),
  };
  const lineH = { card: Math.round(t.text.body * 1.35), small: Math.round((t.text.caption + 1) * 1.4) };
  const titleLH = Math.round(t.text.body * 1.4);
  const title = p.text() ? fitLines(p.text(), box.w, fonts.title, m, 3) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const stageField = p.str("stage", "stage") || "stage";
  const field = (name: string, def: string) => p.str(name, def) || def;
  const titleF = field("title", "title"), keyF = field("key", "id");
  const detailF = p.has("detail") ? p.str("detail") : "";
  const valueF = p.has("value") ? p.str("value") : "";
  const sumF = p.has("sum") ? p.str("sum") : "";
  const toneF = p.has("tone") ? p.str("tone") : "";
  const format = p.oneOf("format", FORMATS, "text");
  const movable = p.bool("move", false);
  const pressable = movable || p.has("bind") || p.has("on");
  const base: BoardGeometry = {
    title, titleLH, top, colH: 0, headH: 0, columns: [], cards: [], contentW: box.w, viewW: box.w, bar: 0,
    pressable, movable, stageField, fonts, lineH,
  };
  const say = (message: string): BoardGeometry => ({ ...base, message, colH: Math.max(t.control.height * 2, 72) });

  const loading = !!ctx.isLoading?.(box.node);
  const raw = loading ? undefined : p.expr("items");
  if (!loading && p.has("items") && !isList(raw)) warn("items is not a list. Use a list of records, like items=deals");
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_BOARD_CARDS) {
    warn(`${items.length} cards is more than the ${MAX_BOARD_CARDS} a board draws. Filter the list or show part of it with take()`);
    return say(`Too many cards to draw: ${items.length}, at most ${MAX_BOARD_CARDS}`);
  }

  // The stages, in order: as listed in stages=, or as they first appear in the records.
  const listed = p.has("stages") ? p.str("stages").split(",").map((s) => s.trim()).filter(Boolean) : null;
  const stages = listed ? [...new Set(listed)] : [];
  if (!listed) for (const it of items) {
    const s = isRecord(it) ? textOf(fieldOf(it, stageField)) : "";
    if (s && !stages.includes(s)) stages.push(s);
  }
  if (stages.length > MAX_BOARD_STAGES) {
    warn(`${stages.length} stages is more than the ${MAX_BOARD_STAGES} a board shows. Group some stages together`);
    return say(`Too many stages to show: ${stages.length}, at most ${MAX_BOARD_STAGES}`);
  }
  if (!stages.length) return say(loading ? "" : items.length ? `No stages: give each record a ${stageField}, or list them with stages=` : "Nothing here yet");

  // Columns: as wide as the space allows; on a narrow screen most of its width, so the next one peeks in.
  const gap = t.space.sm + t.space.xs / 2;
  const n = stages.length;
  const fitW = (box.w - gap * (n - 1)) / n;
  const colW = fitW >= MIN_COLUMN_W ? fitW : box.w < NARROW ? Math.min(PHONE_COLUMN_MAX, Math.max(MIN_COLUMN_W, box.w * 0.8)) : MIN_COLUMN_W;
  const contentW = n * colW + (n - 1) * gap;
  const scrolls = contentW > box.w + 0.5;
  const bar = scrolls ? t.space.md : 0;
  const pad = t.space.sm;
  const cardPad = t.space.sm + t.space.xs;
  const headLine = Math.round(t.text.body * 1.4);
  const sumLine = Math.round((t.text.caption + 1) * 1.4);
  const headH = pad + headLine + (sumF ? sumLine : 0) + pad;

  const categories: string[] = [];
  const cols: Column[] = stages.map((stage, i) => ({ stage, raw: stage, count: 0, total: "", x: i * (colW + gap), w: colW }));
  const totals = stages.map(() => 0);
  const heights = stages.map(() => 0);
  const cards: Card[] = [];
  let unknown = 0;
  items.forEach((it, index) => {
    if (!isRecord(it)) { unknown++; return; }
    const stageName = textOf(fieldOf(it, stageField));
    const si = stages.indexOf(stageName);
    if (si < 0) { unknown++; return; }
    const col = cols[si]!;
    if (!col.count) col.raw = fieldOf(it, stageField) ?? stageName;
    col.count++;
    if (sumF) { const v = toNumber(fieldOf(it, sumF) ?? null); if (isFinite(v)) totals[si]! += v; }
    const fullTitle = textOf(fieldOf(it, titleF)) || "Untitled";
    const value = valueF ? shown(fieldOf(it, valueF), format) : "";
    const innerW = colW - 2 * pad - 2 * cardPad;
    const valueW = value ? Math.min(innerW * 0.45, m.width(value, fonts.value)) + t.space.sm : 0;
    const valueBelow = !!value && innerW - valueW < 110;
    const titleLines = fitLines(fullTitle, Math.max(30, innerW - (valueBelow ? 0 : valueW)), fonts.card, m, 2);
    const sub = detailF ? textOf(fieldOf(it, detailF)) : "";
    const h = cardPad + titleLines.length * lineH.card + (sub || valueBelow ? lineH.small + 2 : 0) + cardPad;
    const toneV = toneF ? textOf(fieldOf(it, toneF)) : "";
    const toneNote = toneV ? `${toneF}: ${toneV}` : "";
    const y = top + headH + heights[si]!;
    const k = isRecord(it) ? fieldOf(it, keyF) : undefined;
    cards.push({
      // Named by its key when it has one, so focus stays on the same record after it moves.
      index, detail: typeof k === "string" || (typeof k === "number" && isFinite(k)) ? `card:k:${typeof k}:${k}` : `card:${index}`,
      key: typeof k === "string" || (typeof k === "number" && isFinite(k)) ? k : null,
      stage: si, title: titleLines, fullTitle, sub, value, valueBelow, toneNote,
      color: toneV ? colorOf(t, toneV, categories) : null,
      x: col.x + pad, y, w: colW - 2 * pad, h,
    });
    heights[si]! += h + pad;
  });
  if (!loading && p.has("bind") && cards.length && cards.every((k) => k.key === null)) warn(`bind= needs each record's key, from the ${keyF} field, and no record has one. Add ${keyF} to each record, or set key= to the field that identifies it`);
  if (unknown && !loading) warn(`${unknown} of ${items.length} items have a ${stageField} that isn't one of the stages (${stages.join(", ")}), so they aren't shown. Add it to stages=, or check the spelling`);
  cols.forEach((c, i) => { if (sumF) c.total = shown(totals[i]!, format === "text" ? "number" : format, true); });
  const emptyH = t.control.height + pad;
  const colH = headH + Math.max(emptyH, ...heights) + pad;
  return { ...base, colH, headH, columns: cols, cards, contentW, viewW: box.w, bar };
}

// ---------------------------------------------------------------- scrolling

const maxScroll = (d: BoardGeometry) => Math.max(0, d.contentW - d.viewW);
function scrollTo(v: Record<string, number>, d: BoardGeometry, x: number): boolean {
  const before = v.x ?? 0;
  v.x = Math.max(0, Math.min(maxScroll(d), x));
  return Math.abs(v.x - before) > 0.01;
}

interface BoardPart { geo: BoardGeometry; x: number; y: number }
function geoOf(b: Box): BoardPart | null {
  const d = b.data as unknown as BoardPart | undefined;
  return d && "geo" in d ? d : null;
}
function part(box: Box, x: number, y: number, w: number, h: number): Box {
  return { ...partBox(box, x, y, w, h), data: { geo: box.data as unknown as BoardGeometry, x: box.x, y: box.y } as unknown as Box["data"] };
}

/** The column under a point, by its x within the scrolled content. */
function columnAt(d: BoardGeometry, contentX: number): number {
  let best = 0, dist = Infinity;
  d.columns.forEach((c, i) => {
    const dd = contentX < c.x ? c.x - contentX : contentX > c.x + c.w ? contentX - c.x - c.w : 0;
    if (dd < dist) { dist = dd; best = i; }
  });
  return best;
}

// ---------------------------------------------------------------- paint

function paintBoard(box: Box, ctx: PaintContext): void {
  const d = box.data as unknown as BoardGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const measure = { width: (s: string, f: string) => { g.font = f; return g.measureText(s).width; } };
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.fonts.title;
  g.fillStyle = c.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));

  if (d.message !== undefined) {
    const y = oy + d.top;
    ctx.roundRect(ox + 0.5, y + 0.5, box.w - 1, d.colH - 1, theme.radius.md);
    fillTint(g, c.ink, 0.03);
    if (d.message) {
      g.font = d.fonts.small;
      g.fillStyle = c.muted;
      g.textAlign = "center";
      g.fillText(ellipsize(d.message, box.w - 2 * theme.space.md, d.fonts.small, measure), ox + box.w / 2, y + d.colH / 2);
    }
    return;
  }

  const v = ctx.view(box.node);
  let sx = Math.max(0, Math.min(maxScroll(d), v.x ?? 0));
  // A focused card out of sight scrolls into view (not while one is being dragged).
  if (!v.dragging) for (const card of d.cards) {
    if (!ctx.isFocused(box.node, card.detail)) continue;
    if (card.x < sx) sx = card.x - theme.space.sm;
    else if (card.x + card.w > sx + d.viewW) sx = card.x + card.w - d.viewW + theme.space.sm;
    scrollTo(v, d, sx);
    sx = v.x ?? 0;
  }
  v.x = sx;
  d.scrolled = sx;
  const left = ox, right = ox + box.w;
  const cx = (x: number) => ox + x - sx;
  const scrolls = maxScroll(d) > 0;
  const top = oy + d.top;
  if (scrolls || d.movable) ctx.addHit(part(box, ox, top, box.w, d.colH + d.bar), { detail: SCROLL_AREA, focusable: false });

  const dragging = v.dragging ? d.cards.find((k) => k.index === v.dragIndex) : undefined;
  const dropCol = dragging ? columnAt(d, (v.px ?? 0) + sx) : -1;

  g.save();
  g.beginPath();
  g.rect(left, top - 4, box.w, d.colH + 8);
  g.clip();
  d.columns.forEach((col, i) => {
    const x = cx(col.x);
    if (x + col.w < left - 1 || x > right + 1) return;
    ctx.roundRect(x, top, col.w, d.colH, theme.radius.lg);
    fillTint(g, c.ink, 0.035);
    if (i === dropCol && dragging && dragging.stage !== i) {
      ctx.roundRect(x + 1, top + 1, col.w - 2, d.colH - 2, theme.radius.lg);
      fillTint(g, c.accent, 0.08);
      g.strokeStyle = c.accent;
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.stroke();
      g.setLineDash([]);
    }
    // Header: the stage, its count in a pill, and the total under it. Only the part in sight gets words.
    const l = Math.max(x, left), r = Math.min(x + col.w, right);
    if (r - l < 110) return;
    const hx = l + theme.space.md, hy = top + theme.space.sm + Math.round(theme.text.body * 0.7);
    const count = String(col.count);
    g.font = d.fonts.small;
    const pillW = measure.width(count, d.fonts.small) + 12, pillH = Math.round(theme.text.caption * 1.6);
    const nameW = r - l - 2 * theme.space.md - pillW - 8;
    g.font = d.fonts.head;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    const name = ellipsize(col.stage, Math.max(10, nameW), d.fonts.head, measure);
    g.fillText(name, hx, hy);
    const px = hx + measure.width(name, d.fonts.head) + 8;
    ctx.roundRect(px, hy - pillH / 2, pillW, pillH, pillH / 2);
    fillTint(g, c.ink, 0.08);
    g.font = d.fonts.small;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(count, px + pillW / 2, hy);
    if (col.total) {
      g.font = d.fonts.small;
      g.fillStyle = c.muted;
      g.textAlign = "left";
      g.fillText(ellipsize(col.total, r - l - 2 * theme.space.md, d.fonts.small, measure), hx, hy + Math.round(theme.text.body * 1.4));
    }
    if (!col.count) {
      g.font = d.fonts.small;
      g.fillStyle = c.muted;
      g.textAlign = "center";
      g.fillText("Nothing here", (l + r) / 2, top + d.headH + theme.control.height / 2);
    }
  });

  const selected = ctx.props(box.node).bound();
  for (const card of d.cards) {
    const x = cx(card.x), y = oy + card.y;
    if (x + card.w < left - 1 || x > right + 1) continue;
    const isSel = d.pressable && selected !== undefined && selected !== null && card.key !== null && card.key === selected;
    paintCard(ctx, d, card, x, y, {
      lifted: card === dragging, selected: isSel, hover: d.pressable && !dragging && ctx.isHovered(box.node, card.detail),
      focused: d.pressable && ctx.isFocused(box.node, card.detail), left, right,
    }, measure);
  }
  g.restore();

  if (d.pressable) {
    for (const card of d.cards) {
      const x = cx(card.x);
      const l = Math.max(x, left), r = Math.min(x + card.w, right);
      ctx.addHit(part(box, r > l ? l : x, oy + card.y, r > l ? r - l : card.w, card.h), { detail: card.detail });
    }
  }

  // The card being dragged, under the pointer, above everything.
  if (dragging) {
    const gx = ox + (v.px ?? 0) - (v.grabX ?? 0), gy = oy + (v.py ?? 0) - (v.grabY ?? 0);
    g.save();
    g.globalAlpha *= 0.94;
    paintCard(ctx, d, dragging, gx, gy, { lifted: false, selected: false, hover: true, focused: false, left: -Infinity, right: Infinity, ghost: true }, measure);
    g.restore();
  }

  if (scrolls) {
    const inset = 8;
    const trackW = Math.max(0, box.w - 2 * inset);
    const w = Math.min(trackW, Math.max(28, (trackW * d.viewW) / Math.max(1, d.contentW)));
    const tx = ox + inset + (trackW - w) * (sx / Math.max(1, maxScroll(d)));
    const yb = top + d.colH + d.bar / 2 + 2;
    ctx.roundRect(ox + inset, yb - 2, trackW, 4, 2);
    fillTint(g, c.ink, 0.06);
    ctx.roundRect(tx, yb - 2, w, 4, 2);
    g.fillStyle = c.control;
    g.fill();
  }
}

function paintCard(
  ctx: PaintContext, d: BoardGeometry, card: Card, x: number, y: number,
  s: { lifted: boolean; selected: boolean; hover: boolean; focused: boolean; left: number; right: number; ghost?: boolean },
  measure: { width(text: string, font: string): number },
): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const r = theme.radius.md;
  if (s.lifted) {
    // Where the dragged card was: an outline, so the column keeps its shape.
    ctx.roundRect(x + 0.5, y + 0.5, card.w - 1, card.h - 1, r);
    g.save();
    g.setLineDash([4, 4]);
    g.strokeStyle = c.control;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
    return;
  }
  if (s.ghost || s.hover) {
    ctx.roundRect(x, y + 2, card.w, card.h, r);
    g.fillStyle = c.shadow;
    g.fill();
  }
  ctx.roundRect(x + 0.5, y + 0.5, card.w - 1, card.h - 1, r);
  g.fillStyle = c.raised;
  g.fill();
  if (s.selected) fillTint(g, c.accent, 0.08);
  g.strokeStyle = s.selected ? c.accent : c.line;
  g.lineWidth = s.selected ? 1.5 : 1;
  g.stroke();
  if (card.color) {
    g.save();
    ctx.roundRect(x, y, card.w, card.h, r);
    g.clip();
    g.fillStyle = card.color;
    g.fillRect(x, y, 4, card.h);
    g.restore();
  }
  // Words only on the part of the card in sight, so they never run past the board's edges.
  const pad = theme.space.md - 2;
  const l = Math.max(x, s.left), rr = Math.min(x + card.w, s.right);
  if (rr - l >= 60) {
    const tx = l + pad, innerW = rr - l - 2 * pad;
    let ty = y + pad + d.lineH.card / 2;
    let valueW = 0;
    if (card.value && !card.valueBelow) {
      g.font = d.fonts.value;
      g.fillStyle = c.ink;
      g.textAlign = "right";
      const v = ellipsize(card.value, innerW * 0.45, d.fonts.value, measure);
      g.fillText(v, rr - pad, ty);
      valueW = measure.width(v, d.fonts.value) + theme.space.sm;
    }
    g.font = d.fonts.card;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    for (const line of card.title) {
      g.fillText(ellipsize(line, Math.max(10, innerW - valueW), d.fonts.card, measure), tx, ty);
      ty += d.lineH.card;
    }
    const subY = ty - d.lineH.card / 2 + d.lineH.small / 2 + 2;
    let belowW = 0;
    if (card.value && card.valueBelow) {
      g.font = d.fonts.value;
      g.fillStyle = c.ink;
      g.textAlign = "right";
      const v = ellipsize(card.value, innerW, d.fonts.value, measure);
      g.fillText(v, rr - pad, subY);
      belowW = measure.width(v, d.fonts.value) + theme.space.sm;
      g.textAlign = "left";
    }
    if (card.sub && innerW - belowW > 20) {
      g.font = d.fonts.small;
      g.fillStyle = c.muted;
      g.fillText(ellipsize(card.sub, innerW - belowW, d.fonts.small, measure), tx, subY);
    }
  }
  if (s.focused) {
    ctx.roundRect(x - 2, y - 2, card.w + 4, card.h + 4, r + 2);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  }
}

// ---------------------------------------------------------------- press and move

function cardOf(ctx: PressContext): { geo: BoardGeometry; card: Card } | null {
  const detail = ctx.target.detail;
  const geo = geoOf(ctx.target.box)?.geo;
  const card = typeof detail === "string" ? geo?.cards.find((k) => k.detail === detail) : undefined;
  return geo && card ? { geo, card } : null;
}

function selectCard(ctx: PressContext): void {
  const found = cardOf(ctx);
  if (!found) return;
  const bind = ctx.props(ctx.target.node).raw("bind");
  if (bind && found.card.key !== null) ctx.set(bind, found.card.key);
  runOn(ctx);
}

/**
 * Move a card to another stage: write the record's stage field where the
 * record lives in state, then run on=. The record is passed in as its own
 * name, so the engine finds it in state by identity even when items= is a
 * filtered or sorted list.
 */
function moveCard(ctx: PressContext, geo: BoardGeometry, card: Card, to: number): boolean {
  if (to < 0 || to >= geo.columns.length || to === card.stage) return false;
  const p = ctx.props(ctx.target.node);
  const items = p.expr("items");
  const item = isList(items) ? items[card.index] : undefined;
  if (!isRecord(item)) return false;
  if (ctx.inState && !ctx.inState(item)) {
    ctx.warn?.(`board on line ${ctx.target.node.line} can't move cards: its items aren't a list in state. Put the list in state (state deals=[…]) and use items=deals, or a list worked out from it`);
    return false;
  }
  const stage = geo.columns[to]!.raw;
  ctx.run(`set:__card.${geo.stageField}:{__stage}`, {
    scope: (name) => (name === "__card" ? item : name === "__stage" ? stage : undefined),
    locate: (name) => (name === "__card" ? null : stateLocate(name)),
  });
  const bind = p.raw("bind");
  if (bind && card.key !== null) ctx.set(bind, card.key);
  runOn(ctx);
  return true;
}

function dragBoard(ctx: DragContext): boolean {
  const v = ctx.view(ctx.target.node);
  const part0 = geoOf(ctx.target.box);
  const geo = part0?.geo;
  if (!part0 || !geo) return false;
  const px = ctx.x - part0.x, py = ctx.y - part0.y;
  const found = cardOf(ctx);
  if (ctx.phase === "start") {
    v.dragX = ctx.x; v.dragY = ctx.y; v.dragFrom = v.x ?? 0; v.dragMoved = 0;
    if (found && geo.movable) {
      v.dragIndex = found.card.index;
      v.grabX = px - (found.card.x - (v.x ?? 0));
      v.grabY = py - found.card.y;
    }
    return false;
  }
  const dx = ctx.x - (v.dragX ?? ctx.x), dy = ctx.y - (v.dragY ?? ctx.y);
  if (ctx.phase === "move") {
    if (!v.dragMoved && Math.hypot(dx, dy) < DRAG_SLOP) return false;
    v.dragMoved = 1;
    if (v.dragIndex !== undefined) {
      // Carrying a card: it follows the pointer, and the column under it is where it will land.
      v.dragging = 1;
      v.px = px; v.py = py;
    } else if (maxScroll(geo)) {
      scrollTo(v, geo, (v.dragFrom ?? 0) - dx);
    }
    return false;
  }
  const moved = !!v.dragMoved, carried = v.dragging ? geo.cards.find((k) => k.index === v.dragIndex) : undefined;
  for (const k of ["dragX", "dragY", "dragFrom", "dragMoved", "dragIndex", "dragging", "px", "py", "grabX", "grabY"]) delete v[k];
  // The browser took the gesture over (a page scroll): the card goes back, and nothing is pressed.
  if (ctx.cancelled) return false;
  if (carried) {
    // Dropped over the columns: it moves there. Anywhere else: it goes back.
    const over = py >= geo.top && py <= geo.top + geo.colH && px >= 0 && px <= geo.viewW;
    if (over) moveCard(ctx, geo, carried, columnAt(geo, px + (v.x ?? 0)));
    return false;
  }
  if (!moved) selectCard(ctx);
  return false;
}

// ---------------------------------------------------------------- definition

export const board: ComponentDef = {
  type: "board",
  category: "data",
  description: "Columns of cards by stage, from a list: a sales pipeline, a task board, hiring stages, support tickets. Each column shows its count and an optional total; move=true lets people drag a card to another stage.",
  text: { description: "The title above the board, e.g. Sales pipeline." },
  props: {
    items: { type: "expression", required: true, description: `The list of records, e.g. items=deals. At most ${MAX_BOARD_CARDS}.` },
    stage: { type: "name", required: true, description: "Field with each record's stage, e.g. stage=status." },
    stages: { type: "string", description: `The columns in order, separated by commas, e.g. stages="Lead,Qualified,Proposal,Won". At most ${MAX_BOARD_STAGES}. Default: the stages in the records, in the order they first appear.` },
    title: { type: "name", default: "title", description: "Field with each card's title, e.g. title=name." },
    detail: { type: "name", description: "Field with a quieter line under the title, e.g. detail=company." },
    value: { type: "name", description: "Field with a short value on the card's right, e.g. value=amount." },
    format: { type: "enum", values: FORMATS, default: "text", description: "How value= and sum= read: text as is, number (1,200) or money ($1,200, US dollars)." },
    sum: { type: "name", description: "Field to total in each column's header, e.g. sum=amount, written with format=." },
    tone: { type: "name", description: "Field that colors each card's edge: a value good, warn, bad, accent or muted uses that tone; other values each get their own color." },
    key: { type: "name", default: "id", description: "The field that identifies each record, e.g. key=id. Needed for bind=." },
    bind: { type: "state", description: "State that holds the selected card's key. Pressing a card sets it." },
    move: { type: "boolean", default: false, description: "true lets people move a card to another stage: drag it to another column, or focus it and press Left or Right. It changes the record's stage field, so items= must be a list in state (or worked out from one)." },
    on: onProp("after a card is pressed or moved, with bind= already set"),
  },
  picks: [
    { for: "a pipeline or task board by stage", write: "board stage=status move=true" },
  ],
  example: `state picked=0 deals=[{id: 1, name: "Fleet renewal", company: "Harbor Freight Co", status: "Lead", amount: 48000}, {id: 2, name: "Claims portal", company: "Northwind Mutual", status: "Proposal", amount: 125000}, {id: 3, name: "Warehouse sensors", company: "Larkspur Logistics", status: "Qualified", amount: 36500}]
board "Pipeline" items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name detail=company value=amount format=money sum=amount bind=picked`,
  minWidth: () => 220,
  layout(box, ctx) {
    const d = boardLayout(box, ctx);
    box.data = d as unknown as Box["data"];
    box.h = d.top + d.colH + d.bar;
  },
  fullWidth(box) {
    const d = box.data as unknown as BoardGeometry | undefined;
    return d && d.message === undefined ? d.contentW + 1 : box.w;
  },
  paint: paintBoard,
  hitTest(box, x, _y, detail) {
    // A card scrolled out of sight is still a Tab stop, but never takes a click outside the board.
    const d = box.data as unknown as BoardPart | undefined;
    if (!d?.geo || detail === SCROLL_AREA) return { detail };
    return x >= d.x && x <= d.x + d.geo.viewW ? { detail } : null;
  },
  press: selectCard,
  drag: dragBoard,
  wheel(ctx) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const dx = ctx.deltaX || (ctx.shiftKey ? ctx.deltaY : 0);
    if (!dx) return false;
    const v = ctx.view(ctx.target.node);
    return scrollTo(v, geo, (v.x ?? 0) + dx);
  },
  key(ctx, key) {
    const found = cardOf(ctx);
    // A movable card moves with Left and Right; otherwise the arrows scroll.
    if (found && found.geo.movable && (key === "ArrowLeft" || key === "ArrowRight")) {
      moveCard(ctx, found.geo, found.card, found.card.stage + (key === "ArrowRight" ? 1 : -1));
      return true;
    }
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const v = ctx.view(ctx.target.node);
    const x = v.x ?? 0;
    const to = key === "ArrowRight" ? x + ARROW_STEP : key === "ArrowLeft" ? x - ARROW_STEP : key === "Home" ? 0 : key === "End" ? maxScroll(geo) : null;
    return to !== null && scrollTo(v, geo, to);
  },
  cursor: (target) => (target.detail === SCROLL_AREA ? "default" : "pointer"),
  semantics(box, ctx) {
    const d = box.data as unknown as BoardGeometry | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message !== undefined) return d.message ? { role: "text", name: name ? `${name}: ${d.message}` : d.message } : null;
    const selected = ctx.props(box.node).bound();
    // Where things are now, after scrolling, cut to the board (a sliver at the edge when out of sight).
    const sx = d.scrolled ?? 0;
    const clip = (x: number, w: number, y: number, h: number) => {
      const l = Math.max(x, box.x), r = Math.min(x + w, box.x + box.w);
      return r > l ? { x: l, y, w: r - l, h } : { x: x + w <= box.x ? box.x : box.x + box.w - 1, y, w: 1, h };
    };
    const parts: PartSemantics[] = [];
    // The title is a heading of its own, so it's read (and copied) before the stages.
    if (d.title.length) parts.push({ detail: "title", role: "heading", level: 2, name: ctx.props(box.node).text(), rect: { x: box.x, y: box.y, w: box.w, h: d.top } });
    d.columns.forEach((col, i) => {
      const rect = clip(box.x + col.x - sx, col.w, box.y + d.top, d.headH);
      parts.push({ detail: `head:${i}`, role: "heading", level: 3, name: `${col.stage} (${col.count})${col.total ? ` · ${col.total}` : ""}`, rect });
      parts.push({ detail: `col:${i}`, role: "list", name: col.stage, rect: { ...rect, h: d.colH } });
      for (const card of d.cards.filter((k) => k.stage === i)) {
        parts.push({
          detail: d.pressable ? card.detail : `item:${card.index}`,
          within: `col:${i}`,
          role: "listitem",
          name: [card.fullTitle, card.value].filter(Boolean).join(", ") + (card.toneNote ? ` (${card.toneNote})` : ""),
          description: [card.sub, d.movable ? "Left and Right arrows move it to another stage" : ""].filter(Boolean).join(". ") || undefined,
          // aria-selected isn't allowed on a list item; the chosen card is the current one.
          current: d.pressable && card.key !== null && card.key === selected ? true : undefined,
          rect: clip(box.x + card.x - sx, card.w, box.y + card.y, card.h),
        });
      }
    });
    return { role: "region", name: name ?? "Board", roleDescription: "board", parts };
  },
};
