/**
 * schedule: blocks laid out on time. Week calendars, shift rotas, room
 * bookings, itineraries by hour and project plans (Gantt).
 *
 *   schedule "Support rota" items=shifts date=day start=from end=to label=name view=week
 *   schedule "Rooms, Tue" items=bookings start=from end=to label=title rows=room view=day
 *   schedule "Launch plan" items=tasks start=from end=to label=task rows=team view=timeline
 *
 * day and week: times (HH:MM) down a time axis; a column per lane (day) or
 * per day (week); blocks that overlap in a column sit side by side.
 * timeline: dates (YYYY-MM-DD) across; a row per item or per lane, a bar per
 * item, and a "Today" line from the engine's today().
 *
 * Times and dates are worked out as text (src/dates.ts), never with Date, and
 * there are no time zones. Too wide for its space, it scrolls sideways with
 * the time axis or lane names pinned, the offset kept as engine-held view
 * state (ctx.view), as table does.
 */
import type { ComponentDef, LayoutContext, PaintContext, PressContext } from "../component";
import type { PartSemantics } from "../a11y/semantics";
import { fieldOf, isList, isRecord } from "../data";
import { displayDate, formatDate, fromDays, MONTHS, parseDate, toDays, weekday, WEEKDAYS } from "../dates";
import { ellipsize, wrapText } from "../text";
import type { Theme } from "../theme";
import type { Box, Value } from "../types";
import { flowLegend, type LegendItem } from "./chart-kit";
import { fillTint, onProp, partBox, runOn, themeFont, toneColor, TONES, type Tone } from "./util";

export const VIEWS = ["day", "week", "timeline"] as const;
export type ScheduleView = (typeof VIEWS)[number];

/** The most items one schedule draws. More shows a message: filter the list or take() a part of it. */
export const MAX_SCHEDULE_ITEMS = 200;
/** The most days a week view shows side by side. */
export const MAX_WEEK_DAYS = 7;
/** The most days a timeline spans (about two years). */
export const MAX_TIMELINE_DAYS = 732;
/** The narrowest a day or lane column gets before the schedule scrolls sideways. */
export const MIN_COLUMN_W = 96;
/** The narrowest a block gets when blocks sit side by side; a crowded column widens (and scrolls) instead. */
export const MIN_BLOCK_W = 80;
/** The narrowest a day gets on a timeline before it scrolls sideways. */
export const MIN_DAY_W = 14;
/** The fewest hours the time axis shows, so a single short meeting isn't a sliver. */
const MIN_HOURS = 4;
/** The detail of the hit region behind everything, which takes the wheel and drags when the schedule scrolls. */
const SCROLL_AREA = "scroll:area";
/** How far a press must move before it scrolls instead of pressing. */
const DRAG_SLOP = 4;
/** How far an arrow key scrolls. */
const ARROW_STEP = 48;

interface Block {
  /** Index into items. */
  index: number;
  /** The hit region's detail and the a11y part's: "item:<index>". */
  detail: string;
  key: string | number | null;
  label: string;
  lane: string;
  /** Day and week: minutes from midnight. Timeline: day numbers (toDays), end inclusive. */
  from: number;
  to: number;
  /** What the a11y table and Copy text say in its Date and Time (or Start and End) cells. */
  cells: [string, string];
  /** A short time or date range drawn on the block. */
  when: string;
  /** A timeline item that starts and ends on one day, drawn as a diamond. */
  milestone?: boolean;
  /** Index of its color: -1 for a tone, else a series 0 to 5. */
  color: number;
  tone: Tone | null;
  /** Where it's drawn, relative to the box, before any sideways scrolling (x within the scrolled content). */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Column {
  label: string;
  /** Left edge within the scrolled content (0 = first column), and width. */
  x: number;
  w: number;
}

interface Lane {
  label: string;
  y: number;
  h: number;
}

interface Tick {
  /** Within the scrolled content (timeline) or the box's top (time axis). */
  at: number;
  label: string;
  /** A month or hour line rather than a day. */
  strong: boolean;
}

export interface ScheduleGeometry {
  view: ScheduleView;
  title: string[];
  titleFont: string;
  titleLH: number;
  /** The bordered area, relative to the box. */
  frame: { y: number; h: number };
  message?: string;
  /** Width of the pinned left part (time axis or lane names). */
  axisW: number;
  /** Height of the header band above the body. */
  headH: number;
  /** Top and height of the body, relative to the box. */
  bodyY: number;
  bodyH: number;
  /** How wide the scrolled content is, and how much of it shows. */
  contentW: number;
  viewW: number;
  /** Height of the scrollbar strip at the bottom of the frame, 0 when it doesn't scroll. */
  bar: number;
  columns: Column[];
  lanes: Lane[];
  /** Hour lines (day, week) at y; or day and month marks (timeline) at x. */
  ticks: Tick[];
  /** Timeline: its first day (a toDays number) and how wide a day is. */
  firstDay: number;
  dayW: number;
  /** Timeline: where today's line is, within the content, or null when today isn't in range. */
  todayX: number | null;
  blocks: Block[];
  /** How far it was scrolled when last painted, for where screen-reader rows are. */
  scrolled?: number;
  /** Whether pressing a block does anything (bind= or on=). */
  pressable: boolean;
  /** Header names for the a11y table: Date, Time, What and the lane field. */
  heads: string[];
  laneHead: string | null;
  legend: LegendItem[];
  legendFont: string;
  fonts: { label: string; small: string; head: string };
}

// ---------------------------------------------------------------- text times

/** Minutes from midnight for "HH:MM" text (00:00 to 24:00), or null. */
export function parseTime(v: Value | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** "09:05" for 545 minutes. */
export function formatTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

const shortDay = (n: number) => {
  const c = fromDays(n);
  return `${MONTHS[c.m - 1]!.slice(0, 3)} ${c.d}`;
};
const weekdayLabel = (n: number) => {
  const c = fromDays(n);
  return `${WEEKDAYS[weekday(c)]!.slice(0, 3)} ${MONTHS[c.m - 1]!.slice(0, 3)} ${c.d}`;
};

/** Readable header for a field name: room → Room, start_date → Start date. */
const headOf = (field: string) => {
  const s = field.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const textOf = (v: Value | undefined): string =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

const keyOfItem = (item: Value, field: string): string | number | null => {
  const k = isRecord(item) ? fieldOf(item, field) : undefined;
  return typeof k === "string" || (typeof k === "number" && isFinite(k)) ? k : null;
};

/** The color a series index or tone stands for. */
function blockColor(theme: Theme, b: { color: number; tone: Tone | null }): string {
  if (b.tone) return toneColor(theme, b.tone === "default" ? "accent" : b.tone);
  const c = theme.colors;
  return [c.series1, c.series2, c.series3, c.series4, c.series5, c.series6][((b.color % 6) + 6) % 6]!;
}

// ---------------------------------------------------------------- layout

const loadingOf = (box: Box, ctx: LayoutCtx) => !!ctx.isLoading?.(box.node);

type LayoutCtx = Pick<LayoutContext, "theme" | "measure" | "warn" | "props" | "today" | "isLoading">;

export function scheduleLayout(box: Box, ctx: LayoutCtx): ScheduleGeometry {
  const p = ctx.props(box.node);
  const t = ctx.theme, m = ctx.measure;
  const warn = (msg: string) => ctx.warn?.(`schedule on line ${box.node.line}: ${msg}`);
  const viewAsked = p.has("view") ? p.oneOf("view", VIEWS, "week") : null;
  let view: ScheduleView = viewAsked ?? "week";
  const titleFont = themeFont(t, 600, t.text.body);
  const titleLH = Math.round(t.text.body * 1.4);
  const title = p.text() ? wrapText(p.text(), box.w, titleFont, m) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const fonts = {
    label: themeFont(t, 600, t.text.caption + 1),
    small: themeFont(t, 400, t.text.caption),
    head: themeFont(t, 600, t.text.caption),
  };
  const legendFont = themeFont(t, 400, t.text.caption + 1);
  const field = (name: string, def: string) => p.str(name, def) || def;
  const dateF = field("date", "date"), startF = field("start", "start"), endF = field("end", "end");
  const labelF = field("label", "title"), keyF = field("key", "id");
  const laneF = p.has("rows") ? p.str("rows") || null : null;
  const toneF = p.has("tone") ? p.str("tone") || null : null;
  const pressable = p.has("bind") || p.has("on");
  const dateF0 = p.str("date", "date") || "date";
  // No view= and no dates in the items: one day of times is what they are.
  if (!viewAsked && !loadingOf(box, ctx)) {
    const raw0 = p.expr("items");
    if (isList(raw0) && raw0.length && !raw0.some((it) => isRecord(it) && parseDate(fieldOf(it, dateF0)))) view = "day";
  }
  const heads = view === "timeline" ? ["Start", "End", "What"] : ["Date", "Time", "What"];
  const laneHead = laneF ? headOf(laneF) : null;
  const headH = Math.round(t.text.caption * 1.4) + 2 * t.space.sm;
  const base: ScheduleGeometry = {
    view, title, titleFont, titleLH, frame: { y: top, h: 0 }, axisW: 0, headH, bodyY: top, bodyH: 0, contentW: 0, viewW: box.w, bar: 0,
    columns: [], lanes: [], ticks: [], firstDay: 0, dayW: 0, todayX: null, blocks: [], pressable, heads, laneHead, legend: [], legendFont, fonts,
  };
  const say = (message: string): ScheduleGeometry => ({ ...base, message, frame: { y: top, h: Math.max(t.control.height * 2, 72) } });

  const loading = !!ctx.isLoading?.(box.node);
  const raw = loading ? undefined : p.expr("items");
  if (!loading && p.has("items") && !isList(raw)) warn("items is not a list. Use a list of records, like items=shifts");
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_SCHEDULE_ITEMS) {
    warn(`${items.length} items is more than the ${MAX_SCHEDULE_ITEMS} a schedule draws. Filter the list or show part of it with take()`);
    return say(`Too many items to draw: ${items.length}, at most ${MAX_SCHEDULE_ITEMS}`);
  }

  // Colors: a tone name picks that tone; any other value of tone= (or of rows=, with no tone=) gets a series color.
  const categories: string[] = [];
  const colorOf = (item: Value, lane: string): { color: number; tone: Tone | null } => {
    const v = toneF ? textOf(isRecord(item) ? fieldOf(item, toneF) : undefined) : laneF ? lane : "";
    if (toneF && (TONES as readonly string[]).includes(v)) return { color: -1, tone: v as Tone };
    if (!v) return { color: 0, tone: null };
    let i = categories.indexOf(v);
    if (i < 0) { i = categories.length; categories.push(v); }
    // Six colors at most: the rest share the last one, keyed as Other.
    return { color: Math.min(i, 5), tone: null };
  };

  // Read every item; count the ones that can't be placed.
  type Raw = { index: number; key: string | number | null; label: string; lane: string; date: number | null; from: number; to: number; color: number; tone: Tone | null };
  const rows: Raw[] = [];
  let skipped = 0;
  items.forEach((item, index) => {
    if (!isRecord(item)) { skipped++; return; }
    const get = (f: string) => fieldOf(item, f);
    const lane = laneF ? textOf(get(laneF)) : "";
    const label = textOf(get(labelF)) || "Untitled";
    const key = keyOfItem(item, keyF);
    const dateV = parseDate(get(dateF));
    if (view === "timeline") {
      const s = parseDate(get(startF)) ?? dateV;
      if (!s) { skipped++; return; }
      const e = parseDate(get(endF));
      const from = toDays(s);
      const to = e ? Math.max(from, toDays(e)) : from;
      rows.push({ index, key, label, lane, date: from, from, to, ...colorOf(item, lane) });
      return;
    }
    const from = parseTime(get(startF));
    // 24:00 ends a day; nothing starts then.
    if (from === null || from >= 24 * 60) { skipped++; return; }
    const endV = parseTime(get(endF));
    // No end: an hour. Ending at or before the start (overnight): drawn to midnight.
    const to = endV === null ? Math.min(24 * 60, from + 60) : endV > from ? endV : 24 * 60;
    rows.push({ index, key, label, lane, date: dateV ? toDays(dateV) : null, from, to: Math.max(to, from + 1), ...colorOf(item, lane) });
  });
  if (!loading && toneF && items.length && !items.some((it) => isRecord(it) && fieldOf(it, toneF) !== undefined)) {
    warn(`tone=${toneF} names the field that colors each block, but no item has a "${toneF}" field. Give the field, like tone=status, or leave tone= out`);
  }
  if (!loading && p.has("bind") && rows.length && rows.every((r) => r.key === null)) {
    warn(`bind= needs each item's key, from the ${keyF} field, and no item has one. Add ${keyF} to each item, or set key= to the field that identifies it`);
  }
  if (skipped && !loading) {
    const how = view === "timeline"
      ? `a start date as YYYY-MM-DD in ${startF} (or ${dateF})`
      : `a start time as HH:MM in ${startF}, like 09:30 (for dates like 2026-11-09, use view=timeline)`;
    warn(`${skipped} of ${items.length} ${skipped === 1 ? "item has" : "items have"} no ${how}, so ${skipped === 1 ? "it isn't" : "they aren't"} shown`);
  }

  const legendBelow = (frameBottom: number): { legend: LegendItem[]; bottom: number } => {
    if (categories.length < 2 || !(toneF || laneF) || (laneF && !toneF && view !== "week")) return { legend: [], bottom: frameBottom };
    const keyed = categories.length > 6 ? [...categories.slice(0, 5), "Other"] : categories;
    const r = flowLegend(keyed.map((label, i) => ({ label, color: i })), box.w, frameBottom + t.space.sm, ctx);
    return { legend: r.items, bottom: r.bottom };
  };

  if (!rows.length) {
    if (loading) return { ...base, frame: { y: top, h: headH + t.control.height * 4 } };
    return say(items.length ? "Nothing here has a time to show" : "Nothing scheduled");
  }

  const g = view === "timeline" ? timelineLayout(box, ctx, base, rows) : timeLayout(box, ctx, base, rows, warn);
  if (g.message) return g;
  const frameBottom = g.frame.y + g.frame.h;
  const lg = legendBelow(frameBottom);
  return { ...g, legend: lg.legend };
}

type RawItem = { index: number; key: string | number | null; label: string; lane: string; date: number | null; from: number; to: number; color: number; tone: Tone | null };

/** Day and week: a time axis down the left, a column per lane or per day, blocks side by side where they overlap. */
function timeLayout(box: Box, ctx: LayoutCtx, base: ScheduleGeometry, all: RawItem[], warn: (m: string) => void): ScheduleGeometry {
  const t = ctx.theme, m = ctx.measure;
  // The earliest real date first; items with no date go with whatever day is shown.
  const dates = [...new Set(all.map((r) => r.date))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  let rows = all;
  let columns: Array<{ label: string; match: (r: RawItem) => boolean }>;
  if (base.view === "day") {
    const day = dates[0] ?? null;
    rows = all.filter((r) => r.date === day || r.date === null);
    if (rows.length < all.length) warn(`view=day shows one day (${day === null ? "items with no date" : formatDate(fromDays(day))}); ${all.length - rows.length} items on other days aren't shown. Use view=week, or filter the list to one day`);
    const lanes = base.laneHead ? [...new Set(rows.map((r) => r.lane))] : [""];
    columns = lanes.map((l) => ({ label: l, match: (r: RawItem) => !base.laneHead || r.lane === l }));
  } else {
    const dated = all.filter((r) => r.date !== null);
    if (dated.length < all.length) warn(`${all.length - dated.length} items have no date as YYYY-MM-DD, which view=week needs to place them`);
    rows = dated;
    if (!rows.length) return { ...base, message: "Nothing here has a date to show", frame: { y: base.frame.y, h: Math.max(t.control.height * 2, 72) } };
    const first = Math.min(...rows.map((r) => r.date!)), last = Math.max(...rows.map((r) => r.date!));
    if (last - first + 1 > MAX_WEEK_DAYS) {
      warn(`view=week shows at most ${MAX_WEEK_DAYS} days, and these items span ${last - first + 1}. Filter the list to one week, or use view=timeline`);
      return { ...base, message: `More than ${MAX_WEEK_DAYS} days to show: filter to one week`, frame: { y: base.frame.y, h: Math.max(t.control.height * 2, 72) } };
    }
    columns = [];
    for (let d = first; d <= last; d++) columns.push({ label: weekdayLabel(d), match: (r: RawItem) => r.date === d });
  }

  // The hours to show: from the earliest start to the latest end, at least MIN_HOURS.
  let h0 = Math.floor(Math.min(...rows.map((r) => r.from)) / 60), h1 = Math.ceil(Math.max(...rows.map((r) => r.to)) / 60);
  if (h1 - h0 < MIN_HOURS) { h1 = Math.min(24, h0 + MIN_HOURS); h0 = Math.max(0, h1 - MIN_HOURS); }
  const hourH = t.control.height + t.space.sm;
  const axisW = Math.ceil(m.width("00:00", base.fonts.small)) + 2 * t.space.sm;
  const hasHead = columns.length > 1 || columns.some((c) => c.label);
  const headH = hasHead ? base.headH : 0;
  const viewW = Math.max(0, box.w - axisW);
  const crowd = Math.max(1, ...columns.map((col) => mostAtOnce(rows.filter(col.match))));
  const colW = Math.max(MIN_COLUMN_W, crowd * MIN_BLOCK_W, viewW / columns.length);
  const contentW = colW * columns.length;
  const scrolls = contentW > viewW + 0.5;
  const bar = scrolls ? t.space.md : 0;
  const bodyY = base.frame.y + headH;
  const bodyH = (h1 - h0) * hourH;
  const pad = t.space.xs / 2;
  // A short block is drawn at least this tall, so packing uses where it ends as drawn.
  const minMinutes = ((t.text.caption + 8) / hourH) * 60;
  const drawnEnd = (r: RawItem) => Math.max(r.to, r.from + minMinutes);

  const blocks: Block[] = [];
  columns.forEach((col, ci) => {
    const mine = rows.filter(col.match).sort((a, b) => a.from - b.from || b.to - a.to || a.index - b.index);
    // Clusters of blocks that overlap (directly or through others) share the column's width.
    let cluster: Array<{ r: RawItem; sub: number }> = [];
    let clusterEnd = -1;
    const place = () => {
      const subs = Math.max(1, ...cluster.map((c) => c.sub + 1));
      for (const { r, sub } of cluster) {
        const w = colW / subs;
        const y = bodyY + ((r.from - h0 * 60) / 60) * hourH;
        const h = ((r.to - r.from) / 60) * hourH;
        const dateCell = r.date === null ? "" : displayDate(fromDays(r.date));
        blocks.push({
          index: r.index, detail: `item:${r.index}`, key: r.key, label: r.label, lane: r.lane, from: r.from, to: r.to,
          cells: [dateCell, `${formatTime(r.from)}–${formatTime(r.to)}`], when: `${formatTime(r.from)}–${formatTime(r.to)}`,
          color: r.color, tone: r.tone,
          x: ci * colW + sub * w + pad, y: y + 1, w: Math.max(4, w - 2 * pad), h: Math.max(t.text.caption + 8, h - 2),
        });
      }
      cluster = [];
    };
    const ends: number[] = [];
    for (const r of mine) {
      if (r.from >= clusterEnd && cluster.length) { place(); ends.length = 0; }
      let sub = ends.findIndex((e) => e <= r.from);
      if (sub < 0) { sub = ends.length; ends.push(drawnEnd(r)); } else ends[sub] = drawnEnd(r);
      cluster.push({ r, sub });
      clusterEnd = Math.max(clusterEnd, drawnEnd(r));
    }
    if (cluster.length) place();
  });
  // Tab order and the a11y table: by day, then time, then lane.
  blocks.sort((a, b) => {
    const da = all.find((r) => r.index === a.index)!.date ?? -1, db = all.find((r) => r.index === b.index)!.date ?? -1;
    return da - db || a.from - b.from || a.x - b.x;
  });

  const ticks: Tick[] = [];
  for (let h = h0; h <= h1; h++) ticks.push({ at: bodyY + (h - h0) * hourH, label: formatTime(h * 60), strong: true });
  return {
    ...base, axisW, headH, bodyY, bodyH, contentW, viewW, bar,
    frame: { y: base.frame.y, h: headH + bodyH + bar },
    columns: columns.map((c, i) => ({ label: c.label, x: i * colW, w: colW })),
    ticks, blocks,
  };
}

/** The most blocks that run at the same moment in a column. */
function mostAtOnce(rows: readonly RawItem[]): number {
  const marks = rows.flatMap((r) => [[r.from, 1], [r.to, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, most = 0;
  for (const [, d] of marks) { now += d; most = Math.max(most, now); }
  return most;
}

/** Timeline: dates across, a row per item (or per lane, overlapping bars stacked), a Today line. */
function timelineLayout(box: Box, ctx: LayoutCtx, base: ScheduleGeometry, rows: RawItem[]): ScheduleGeometry {
  const t = ctx.theme, m = ctx.measure;
  const first = Math.min(...rows.map((r) => r.from)), last = Math.max(...rows.map((r) => r.to));
  const days = last - first + 1;
  if (days > MAX_TIMELINE_DAYS) {
    ctx.warn?.(`schedule on line ${box.node.line}: a timeline spans at most ${MAX_TIMELINE_DAYS} days, and these items span ${days}. Filter the list to a shorter period`);
    return { ...base, message: `Too long a period to draw: ${days} days, at most ${MAX_TIMELINE_DAYS}`, frame: { y: base.frame.y, h: Math.max(t.control.height * 2, 72) } };
  }
  const ordered = [...rows].sort((a, b) => a.from - b.from || a.to - b.to || a.index - b.index);
  // Rows: one per lane in first-seen order (bars that overlap in a lane stack), or one per item.
  const laneNames = base.laneHead ? [...new Set(ordered.map((r) => r.lane))] : ordered.map((r) => r.label);
  const nameFont = themeFont(t, 400, t.text.caption + 1);
  const widest = Math.max(...laneNames.map((n) => m.width(n, nameFont)));
  const axisW = Math.round(Math.min(Math.max(widest + 2 * t.space.md + 8, 72), box.w * 0.38, 200));
  const viewW = Math.max(0, box.w - axisW);
  const dayW = Math.max(MIN_DAY_W, viewW / days);
  const contentW = dayW * days;
  const scrolls = contentW > viewW + 0.5;
  const bar = scrolls ? t.space.md : 0;
  const headH = 2 * (Math.round(t.text.caption * 1.4) + t.space.xs) + t.space.xs;
  const bodyY = base.frame.y + headH;
  const rowH = t.control.height;
  const barH = Math.round(rowH * 0.62);

  const lanes: Lane[] = [];
  const blocks: Block[] = [];
  let y = bodyY;
  const addBlock = (r: RawItem, top: number) => {
    const s = fromDays(r.from), e = fromDays(r.to);
    blocks.push({
      index: r.index, detail: `item:${r.index}`, key: r.key, label: r.label, lane: r.lane, from: r.from, to: r.to,
      cells: [displayDate(s), displayDate(e)],
      when: r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} – ${shortDay(r.to)}`,
      color: r.color, tone: r.tone,
      ...(r.from === r.to
        // A one-day item is a milestone: a diamond on its day.
        ? { x: (r.from - first + 0.5) * dayW - barH * 0.4, y: top + rowH / 2 - barH * 0.4, w: barH * 0.8, h: barH * 0.8, milestone: true }
        : { x: (r.from - first) * dayW + 1, y: top + (rowH - barH) / 2, w: Math.max(4, (r.to - r.from + 1) * dayW - 2), h: barH }),
    });
  };
  if (base.laneHead) {
    for (const name of laneNames) {
      const mine = ordered.filter((r) => r.lane === name);
      const ends: number[] = [];
      const subOf = mine.map((r) => {
        let s = ends.findIndex((e) => e < r.from);
        if (s < 0) { s = ends.length; ends.push(r.to); } else ends[s] = r.to;
        return s;
      });
      const h = Math.max(1, ends.length) * rowH;
      lanes.push({ label: name, y, h });
      mine.forEach((r, i) => addBlock(r, y + subOf[i]! * rowH));
      y += h;
    }
  } else {
    for (const r of ordered) {
      lanes.push({ label: r.label, y, h: rowH });
      addBlock(r, y);
      y += rowH;
    }
  }
  // Tab order and the screen reader's table: by time, then lane.
  blocks.sort((a, b) => a.from - b.from || a.y - b.y);
  // Day numbers when there's room for them, else the first day of each week; months above.
  const ticks: Tick[] = [];
  const dayLabels = dayW >= 22;
  const weekLabels = !dayLabels && dayW * 7 >= 30;
  for (let d = first; d <= last; d++) {
    const c = fromDays(d);
    const at = (d - first) * dayW;
    if (c.d === 1 || d === first) ticks.push({ at, label: `${MONTHS[c.m - 1]!.slice(0, 3)}${c.m === 1 || d === first ? ` ${c.y}` : ""}`, strong: true });
    if (dayLabels || (weekLabels && weekday(c) === 1)) ticks.push({ at, label: String(c.d), strong: false });
  }
  const today = parseDate(ctx.today());
  const td = today ? toDays(today) : null;
  const todayX = td !== null && td >= first && td <= last ? (td - first + 0.5) * dayW : null;
  return {
    ...base, axisW, headH, bodyY, bodyH: y - bodyY, contentW, viewW, bar,
    frame: { y: base.frame.y, h: headH + (y - bodyY) + bar },
    columns: [{ label: "", x: 0, w: contentW }], lanes, ticks, firstDay: first, dayW, todayX, blocks,
  };
}

// ---------------------------------------------------------------- scrolling

const maxScroll = (d: ScheduleGeometry) => Math.max(0, d.contentW - d.viewW);

function scrollTo(v: Record<string, number>, d: ScheduleGeometry, x: number): boolean {
  const before = v.x ?? 0;
  v.x = Math.max(0, Math.min(maxScroll(d), x));
  return Math.abs(v.x - before) > 0.01;
}

/** The scrollbar thumb, in box coordinates. */
function thumb(d: ScheduleGeometry, sx: number, inset: number): { x: number; w: number; trackX: number; trackW: number } {
  const trackX = d.axisW + inset, trackW = Math.max(0, d.viewW - 2 * inset);
  const w = Math.min(trackW, Math.max(28, (trackW * d.viewW) / Math.max(1, d.contentW)));
  const max = maxScroll(d);
  return { trackX, trackW, x: trackX + (trackW - w) * (max ? sx / max : 0), w };
}

/** The schedule a pressed part belongs to, carried on its hit box. */
interface SchedulePart { geo: ScheduleGeometry; x: number; y: number; hidden?: boolean }
function geoOf(b: Box): SchedulePart | null {
  const d = b.data as unknown as SchedulePart | undefined;
  return d && "geo" in d ? d : null;
}
function part(box: Box, x: number, y: number, w: number, h: number, hidden = false): Box {
  return { ...partBox(box, x, y, w, h), data: { geo: box.data as unknown as ScheduleGeometry, x: box.x, y: box.y, hidden } as unknown as Box["data"] };
}

/** A rectangle's x span cut to [left, right]; one pixel at the nearer edge when none of it shows. */
function clipRect(x: number, w: number, left: number, right: number, y: number, h: number): { x: number; y: number; w: number; h: number } {
  const l = Math.max(x, left), r = Math.min(x + w, right);
  if (r > l) return { x: l, y, w: r - l, h };
  return { x: x + w <= left ? left : right - 1, y, w: 1, h };
}

// ---------------------------------------------------------------- paint

function paintSchedule(box: Box, ctx: PaintContext): void {
  const d = box.data as unknown as ScheduleGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.titleFont;
  g.fillStyle = c.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));

  const fy = oy + d.frame.y, fh = d.frame.h;
  ctx.roundRect(ox + 0.5, fy + 0.5, box.w - 1, fh - 1, theme.radius.md);
  g.fillStyle = c.raised;
  g.fill();
  g.save();
  g.strokeStyle = c.line;
  g.lineWidth = 1;
  g.globalAlpha *= 0.72;
  g.stroke();
  g.restore();

  if (d.message) {
    g.font = d.fonts.label;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(ellipsize(d.message, box.w - 2 * theme.space.md, d.fonts.label, { width: (s, f) => { g.font = f; return g.measureText(s).width; } }), ox + box.w / 2, fy + fh / 2);
    return;
  }

  const v = ctx.view(box.node);
  // A timeline too wide for its space opens with today in the middle of the view.
  if (v.x === undefined && d.todayX !== null) v.x = d.todayX - d.viewW / 2;
  let sx = Math.max(0, Math.min(maxScroll(d), v.x ?? 0));
  // When focus moves to a block out of sight, it scrolls into view, once: the arrows and
  // the wheel can still scroll away from it. One wider than the view shows its start.
  const focused = d.blocks.findIndex((b) => ctx.isFocused(box.node, b.detail));
  if (focused >= 0 && v.focusedBlock !== focused) {
    const b = d.blocks[focused]!, margin = theme.space.sm;
    if (b.x < sx || b.w > d.viewW) sx = b.x - margin;
    else if (b.x + b.w > sx + d.viewW) sx = b.x + b.w - d.viewW + margin;
    scrollTo(v, d, sx);
    sx = v.x ?? 0;
  }
  if (focused >= 0) v.focusedBlock = focused; else delete v.focusedBlock;
  v.x = sx;
  // What a screen reader's row positions are measured against (semantics runs after paint).
  d.scrolled = sx;
  const scrolls = maxScroll(d) > 0;
  const left = ox + d.axisW, right = ox + box.w;
  const cx = (x: number) => left + x - sx;

  // Behind everything: the wheel and drags scroll a schedule that's wider than its space.
  // With no pressable blocks, the schedule itself is the Tab stop, so the arrow keys can scroll it.
  if (scrolls) ctx.addHit(part(box, ox, fy, box.w, fh), { detail: SCROLL_AREA, focusable: !d.pressable });
  if (scrolls && !d.pressable && ctx.isFocused(box.node, SCROLL_AREA)) {
    ctx.roundRect(ox - 2, fy - 2, box.w + 4, fh + 4, theme.radius.md + 2);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  }

  // Header band.
  g.save();
  ctx.roundRect(ox + 1, fy + 1, box.w - 2, fh - 2, theme.radius.md - 1);
  g.clip();
  if (d.headH) {
    g.beginPath();
    g.rect(ox, fy, box.w, d.headH);
    fillTint(g, c.ink, 0.018);
  }
  g.restore();

  const by = oy + d.bodyY;
  const clipContent = (draw: () => void) => {
    g.save();
    g.beginPath();
    g.rect(left, fy, Math.max(0, right - left - 1), fh);
    g.clip();
    draw();
    g.restore();
  };
  const hline = (y: number, x0: number, x1: number, alpha: number) => {
    g.beginPath();
    g.moveTo(x0, Math.round(y) + 0.5);
    g.lineTo(x1, Math.round(y) + 0.5);
    g.save();
    g.globalAlpha *= alpha;
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  };
  const vline = (x: number, y0: number, y1: number, alpha: number, color = c.line) => {
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, y0);
    g.lineTo(Math.round(x) + 0.5, y1);
    g.save();
    g.globalAlpha *= alpha;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  };
  const measure = { width: (s: string, f: string) => { g.font = f; return g.measureText(s).width; } };

  if (d.view !== "timeline") {
    // Hour lines across the body, and the hour beside each on the pinned axis.
    g.font = d.fonts.small;
    for (const tk of d.ticks) {
      hline(oy + tk.at, left, right - 1, 0.9);
      if (oy + tk.at < by + d.bodyH - 2) {
        g.fillStyle = c.muted;
        g.textAlign = "right";
        g.fillText(tk.label, left - theme.space.sm, oy + tk.at + t8(theme));
      }
    }
    clipContent(() => {
      d.columns.forEach((col, i) => {
        if (i) vline(cx(col.x), fy + (d.headH ? 0 : 0), by + d.bodyH, 0.9);
        // A label stays on the part of its column that shows, so it never runs past the edges.
        const l = Math.max(cx(col.x), left), r = Math.min(cx(col.x) + col.w, right);
        if (col.label && d.headH && r - l >= 30 + 2 * theme.space.sm) {
          g.font = d.fonts.head;
          g.fillStyle = c.ink;
          g.textAlign = "left";
          g.fillText(ellipsize(col.label, r - l - 2 * theme.space.sm, d.fonts.head, measure), l + theme.space.sm, fy + d.headH / 2);
        }
      });
    });
    if (d.headH) hline(fy + d.headH, ox + 1, right - 1, 1);
    vline(left, fy + d.headH, by + d.bodyH, 1);
  } else {
    // Month and day marks across the header; month lines down the body.
    const rowA = fy + d.headH * 0.3, rowB = fy + d.headH * 0.72;
    clipContent(() => {
      for (const tk of d.ticks) {
        const x = cx(tk.at);
        // A mark's label is drawn only when it starts in sight, so none is cut at the left edge.
        const labelled = x >= left - 1;
        if (tk.strong) {
          vline(x, fy + 4, by + d.bodyH, 0.9);
          if (!labelled) continue;
          g.font = d.fonts.head;
          g.fillStyle = c.ink;
          g.textAlign = "left";
          g.fillText(tk.label, x + 6, rowA);
        } else if (labelled) {
          g.font = d.fonts.small;
          g.fillStyle = c.muted;
          g.textAlign = "left";
          g.fillText(tk.label, x + 3, rowB);
        }
      }
      // Scrolled past a month's mark: its name stays at the left, unless the next mark is right there.
      const shownDay = d.firstDay + Math.floor(sx / Math.max(1, d.dayW));
      const nearMark = d.ticks.some((tk) => tk.strong && cx(tk.at) >= left - 1 && cx(tk.at) < left + 80);
      const mc = fromDays(shownDay);
      const monthLabel = `${MONTHS[mc.m - 1]!.slice(0, 3)} ${mc.y}`;
      g.font = d.fonts.head;
      const todayPillAt = d.todayX === null ? Infinity : cx(d.todayX) - (measure.width("Today", d.fonts.head) + 12) / 2;
      if (sx > 0 && !nearMark && left + 6 + measure.width(monthLabel, d.fonts.head) + 8 < todayPillAt) {
        g.fillStyle = c.ink;
        g.textAlign = "left";
        g.fillText(monthLabel, left + 6, rowA);
      }
      if (d.todayX !== null) {
        // A line down from a small "Today" pill in the month row, drawn over any month name there.
        const x = cx(d.todayX);
        if (x < left || x > right) return;
        vline(x, rowA, by + d.bodyH, 1, c.accent);
        g.font = d.fonts.head;
        const w = measure.width("Today", d.fonts.head) + 12, h = Math.round(theme.text.caption * 1.5);
        const px = Math.max(left + 2, Math.min(right - w - 2, x - w / 2));
        ctx.roundRect(px, rowA - h / 2, w, h, h / 2);
        g.fillStyle = c.accent;
        g.fill();
        g.fillStyle = c.onAccent;
        g.textAlign = "center";
        g.fillText("Today", px + w / 2, rowA);
      }
    });
    hline(fy + d.headH, ox + 1, right - 1, 1);
    vline(left, fy, by + d.bodyH, 1);
    // Lane names on the pinned left, a line under each lane.
    g.font = themeFont(theme, 400, theme.text.caption + 1);
    d.lanes.forEach((ln, i) => {
      if (i) hline(oy + ln.y, ox + 1, right - 1, 0.7);
      g.fillStyle = c.ink;
      g.textAlign = "left";
      g.fillText(ellipsize(ln.label, d.axisW - 2 * theme.space.md, g.font, measure), ox + theme.space.md, oy + ln.y + theme.control.height / 2);
    });
  }

  // The blocks.
  const selected = ctx.props(box.node).bound();
  const radius = theme.radius.sm;
  clipContent(() => {
    for (const b of d.blocks) {
      const x = cx(b.x), y = oy + b.y;
      if (x + b.w < left - 2 || x > right + 2) continue;
      const color = blockColor(theme, b);
      const isSel = d.pressable && selected !== undefined && selected !== null && b.key !== null && selected === b.key;
      const hover = d.pressable && ctx.isHovered(box.node, b.detail);
      if (b.milestone) {
        paintMilestone(g, d, b, x, y, color, isSel || hover, theme, measure, Math.min(cx(d.contentW), right), ctx.roundRect, left);
        if (d.pressable && ctx.isFocused(box.node, b.detail)) {
          ctx.roundRect(x - 3, y - 3, b.w + 6, b.h + 6, radius + 2);
          g.strokeStyle = c.focus;
          g.lineWidth = 2;
          g.stroke();
        }
        continue;
      }
      ctx.roundRect(x, y, b.w, b.h, radius);
      g.fillStyle = c.raised;
      g.fill();
      fillTint(g, color, isSel ? 0.32 : hover ? 0.26 : 0.18);
      // A bar of the full color down the left edge (or across, for a timeline bar's start).
      g.save();
      ctx.roundRect(x, y, b.w, b.h, radius);
      g.clip();
      g.fillStyle = color;
      g.fillRect(x, y, Math.min(4, b.w), b.h);
      g.restore();
      if (isSel) {
        ctx.roundRect(x + 0.5, y + 0.5, b.w - 1, b.h - 1, radius);
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.stroke();
      }
      paintBlockText(g, d, b, x, y, theme, measure, left, right);
      if (d.pressable && ctx.isFocused(box.node, b.detail)) {
        ctx.roundRect(x - 2, y - 2, b.w + 4, b.h + 4, radius + 2);
        g.strokeStyle = c.focus;
        g.lineWidth = 2;
        g.stroke();
      }
    }
  });
  // Pressable blocks: one region each, in time order (the Tab order), cut to what shows.
  if (d.pressable) {
    for (const b of d.blocks) {
      const x = cx(b.x);
      // Out of sight: still a Tab stop (focusing it scrolls it into view), as a sliver at the
      // nearer edge that never takes a click, so its screen-reader node stays on the canvas.
      const r = clipRect(x, b.w, left, right, oy + b.y, b.h);
      ctx.addHit(part(box, r.x, r.y, r.w, r.h, r.w <= 1 && (x + b.w <= left || x >= right)), { detail: b.detail });
    }
  }

  if (scrolls) {
    const th = thumb(d, sx, theme.space.sm);
    const yb = fy + fh - d.bar / 2;
    ctx.roundRect(ox + th.trackX, yb - 2, th.trackW, 4, 2);
    fillTint(g, c.ink, 0.06);
    ctx.roundRect(ox + th.x, yb - 2, th.w, 4, 2);
    g.fillStyle = c.control;
    g.fill();
  }

  // The legend: what each color stands for.
  g.font = d.legendFont;
  g.textAlign = "left";
  for (const it of d.legend) {
    ctx.roundRect(ox + it.swatch.x, oy + it.swatch.y, it.swatch.w, it.swatch.h, theme.radius.sm / 2);
    g.fillStyle = blockColor(theme, { color: it.color, tone: null });
    g.fill();
    g.fillStyle = c.muted;
    g.fillText(it.shownLabel, ox + it.labelX, oy + it.y);
  }
}

/** A milestone: a diamond in the item's color, its label beside it (right, or left near the end). */
function paintMilestone(g: CanvasRenderingContext2D, d: ScheduleGeometry, b: Block, x: number, y: number, color: string, strong: boolean, theme: Theme, measure: { width(s: string, f: string): number }, contentRight: number, roundRect: PaintContext["roundRect"], left: number): void {
  const mx = x + b.w / 2, my = y + b.h / 2, r = b.w / 2;
  g.beginPath();
  g.moveTo(mx, my - r);
  g.lineTo(mx + r, my);
  g.lineTo(mx, my + r);
  g.lineTo(mx - r, my);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  if (strong) {
    g.strokeStyle = theme.colors.ink;
    g.lineWidth = 1.5;
    g.stroke();
  }
  if (!d.laneHead) return;
  g.font = d.fonts.label;
  g.fillStyle = theme.colors.ink;
  const text = b.label, w = measure.width(text, d.fonts.label), gap = 6;
  const room = contentRight - (mx + r + gap) - 4;
  if (mx - r - gap - 4 - left < 40 && room < 40) return;
  if (w <= room || room > 60) {
    g.textAlign = "left";
    g.fillText(ellipsize(text, Math.max(20, room), d.fonts.label, measure), mx + r + gap, my);
  } else {
    // Near the end, the label goes on the left, on a chip of its own, since a bar may run under it.
    const shown = ellipsize(text, Math.max(20, mx - r - gap - 8 - left), d.fonts.label, measure);
    const sw = measure.width(shown, d.fonts.label), h = b.h + 4, cr = mx - r - gap + 4;
    roundRect(cr - sw - 8, my - h / 2, sw + 8, h, theme.radius.sm);
    g.fillStyle = theme.colors.raised;
    g.fill();
    g.strokeStyle = theme.colors.line;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = theme.colors.ink;
    g.textAlign = "right";
    g.fillText(shown, mx - r - gap, my);
  }
}

/** Half a caption line: where an hour's label sits below its line. */
const t8 = (theme: Theme) => Math.round(theme.text.caption * 0.75);

/** The words on a block: its label, then its time (and lane, in week view) when there's room. */
function paintBlockText(g: CanvasRenderingContext2D, d: ScheduleGeometry, b: Block, bx: number, y: number, theme: Theme, measure: { width(s: string, f: string): number }, left: number, right: number): void {
  const c = theme.colors;
  // Words go on the part of the block that shows, so they never run past the edges while it scrolls.
  const padX = theme.space.sm;
  const x = Math.max(bx, left), innerW = Math.min(bx + b.w, right) - x - padX - 6;
  if (innerW < 24) return;
  const lineH = Math.round(theme.text.caption * 1.35);
  g.textAlign = "left";
  if (d.view === "timeline") {
    // Lanes name the row; the bar names the item. One row per item: the row already says it.
    if (!d.laneHead) return;
    g.font = d.fonts.label;
    g.fillStyle = c.ink;
    const s = ellipsize(b.label, innerW, d.fonts.label, measure);
    if (s.length > 1) g.fillText(s, x + padX, y + b.h / 2);
    return;
  }
  const lines: Array<{ text: string; font: string; color: string }> = [{ text: b.label, font: d.fonts.label, color: c.ink }];
  lines.push({ text: b.when, font: d.fonts.small, color: c.muted });
  if (d.view === "week" && d.laneHead && b.lane) lines.push({ text: b.lane, font: d.fonts.small, color: c.muted });
  const fit = Math.max(1, Math.floor((b.h - 6) / lineH));
  let ty = y + 4 + lineH / 2;
  if (fit === 1) ty = y + b.h / 2;
  for (const l of lines.slice(0, fit)) {
    g.font = l.font;
    g.fillStyle = l.color;
    g.fillText(ellipsize(l.text, innerW, l.font, measure), x + padX, ty);
    ty += lineH;
  }
}

// ---------------------------------------------------------------- press

function pressSchedule(ctx: PressContext): void {
  const detail = ctx.target.detail;
  if (typeof detail !== "string" || !detail.startsWith("item:")) return;
  const geo = geoOf(ctx.target.box)?.geo;
  const b = geo?.blocks.find((x) => x.detail === detail);
  if (!b) return;
  const p = ctx.props(ctx.target.node);
  const bind = p.raw("bind");
  if (bind && b.key !== null) ctx.set(bind, b.key);
  runOn(ctx);
}

// ---------------------------------------------------------------- definition

export const schedule: ComponentDef = {
  type: "schedule",
  category: "data",
  description: "Blocks laid out on time from a list: a week of shifts, the day's room bookings, an itinerary by hour (times as HH:MM), or a project plan across dates (view=timeline, dates as YYYY-MM-DD). Overlapping blocks sit side by side; it scrolls sideways when wide.",
  text: { description: "The title above it, e.g. Support rota." },
  props: {
    items: { type: "expression", required: true, description: `The list of records, e.g. items=shifts. At most ${MAX_SCHEDULE_ITEMS}.` },
    view: { type: "enum", values: VIEWS, default: "week", description: `day: one day down a time axis, a column per rows= value. week: a column per day, at most ${MAX_WEEK_DAYS}. timeline: dates across, a bar per item, with a Today line.` },
    date: { type: "name", default: "date", description: "Field with each item's day as YYYY-MM-DD. In a timeline, used for an item with no start date (a one-day bar)." },
    start: { type: "name", default: "start", description: "Field with the start: a time as HH:MM (09:30) in day and week, a date as YYYY-MM-DD in a timeline." },
    end: { type: "name", default: "end", description: "Field with the end, written the same way. Missing: an hour after the start, or the same day in a timeline." },
    label: { type: "name", default: "title", description: "Field with what each block says, e.g. label=name." },
    rows: { type: "name", description: "Field that splits blocks into lanes, e.g. rows=room: a column each in day view, a row each in a timeline; shown on the block in week view." },
    tone: { type: "name", description: "Field that colors each block: a value good, warn, bad, accent or muted uses that tone; other values (a team, a type) each get their own color, with a key." },
    key: { type: "name", default: "id", description: "The field that identifies each item, e.g. key=id. Needed for bind=." },
    bind: { type: "state", description: "State that holds the selected item's key. Pressing a block sets it." },
    on: onProp("after a block is pressed, with bind= already set"),
  },
  picks: [
    { for: "shifts, bookings or a project plan (Gantt) on a calendar", write: "schedule view=week|day|timeline" },
  ],
  example: `state picked=0 shifts=[{id: 1, day: "2026-11-09", from: "08:00", to: "16:00", name: "Ana Ruiz", tier: "Tier 1"}, {id: 2, day: "2026-11-09", from: "12:00", to: "20:00", name: "Ben Okafor", tier: "Tier 2"}, {id: 3, day: "2026-11-10", from: "08:00", to: "16:00", name: "Chloe Park", tier: "Tier 1"}]
schedule "Support rota" items=shifts date=day start=from end=to label=name tone=tier view=week bind=picked`,
  minWidth: () => 220,
  layout(box, ctx) {
    const d = scheduleLayout(box, ctx);
    box.data = d as unknown as Box["data"];
    const legendBottom = d.legend.length ? Math.max(...d.legend.map((l) => l.y)) + Math.round(ctx.theme.text.caption * 0.7) : 0;
    box.h = Math.max(d.frame.y + d.frame.h, legendBottom);
  },
  fullWidth(box) {
    const d = box.data as unknown as ScheduleGeometry | undefined;
    return d && !d.message ? d.axisW + d.contentW + 1 : box.w;
  },
  paint: paintSchedule,
  hitTest(box, x, _y, detail) {
    // Blocks scrolled out of sight are still Tab stops, but never take a click outside the scrolled area.
    const d = box.data as unknown as SchedulePart | undefined;
    const geo = d?.geo;
    if (!d || !geo || detail === SCROLL_AREA) return { detail };
    if (d.hidden) return null;
    return x >= d.x + geo.axisW && x <= d.x + geo.axisW + geo.viewW ? { detail } : null;
  },
  press: pressSchedule,
  drag(ctx) {
    const v = ctx.view(ctx.target.node);
    const geo = geoOf(ctx.target.box)?.geo;
    if (ctx.phase === "start") {
      v.dragX = ctx.x;
      v.dragFrom = v.x ?? 0;
      v.dragMoved = 0;
      return false;
    }
    const dx = ctx.x - (v.dragX ?? ctx.x);
    if (ctx.phase === "move") {
      if (!geo || !maxScroll(geo) || (!v.dragMoved && Math.abs(dx) < DRAG_SLOP)) return false;
      v.dragMoved = 1;
      scrollTo(v, geo, (v.dragFrom ?? 0) - dx);
      return false;
    }
    const moved = !!v.dragMoved;
    delete v.dragX; delete v.dragFrom; delete v.dragMoved;
    if (!moved) pressSchedule(ctx);
    return false;
  },
  wheel(ctx) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    // Only sideways movement scrolls it; up and down still scroll the page.
    const dx = ctx.deltaX || (ctx.shiftKey ? ctx.deltaY : 0);
    if (!dx) return false;
    return scrollTo(ctx.view(ctx.target.node), geo, (ctx.view(ctx.target.node).x ?? 0) + dx);
  },
  key(ctx, key) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const v = ctx.view(ctx.target.node);
    const x = v.x ?? 0;
    const to = key === "ArrowRight" ? x + ARROW_STEP : key === "ArrowLeft" ? x - ARROW_STEP : key === "Home" ? 0 : key === "End" ? maxScroll(geo) : null;
    return to !== null && scrollTo(v, geo, to);
  },
  cursor: (target) => (target.detail === SCROLL_AREA ? "default" : "pointer"),
  semantics(box, ctx) {
    const d = box.data as unknown as ScheduleGeometry | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message) return { role: "text", name: name ? `${name}: ${d.message}` : d.message };
    // A day of times with no dates has no Date column (it would be empty in every row).
    const dated = d.view === "timeline" || d.blocks.some((b) => b.cells[0]);
    const pick = <T,>(cols: T[]) => (dated ? cols : cols.slice(1));
    const heads = pick(d.laneHead ? [...d.heads, d.laneHead] : d.heads);
    const frame = { x: box.x, y: box.y + d.frame.y, w: box.w, h: d.headH || 1 };
    const parts: PartSemantics[] = [{ detail: "head", role: "row", rect: frame }];
    heads.forEach((h, i) => parts.push({ detail: `col:${i}`, within: "head", role: "columnheader", name: h }));
    const selected = ctx.props(box.node).bound();
    const sx = d.scrolled ?? 0;
    const left = box.x + d.axisW, right = box.x + d.axisW + d.viewW;
    for (const b of d.blocks) {
      const cells = pick([b.cells[0], b.cells[1], b.label, ...(d.laneHead ? [b.lane] : [])]);
      const what = dated ? 2 : 1;
      const rowDetail = d.pressable ? b.detail : `row:${b.index}`;
      parts.push({
        detail: rowDetail,
        role: "row",
        name: d.pressable ? cells.filter(Boolean).join(", ") : undefined,
        selected: d.pressable ? b.key !== null && selected === b.key : undefined,
        // Where it shows now, cut to the scrolled area (a sliver at the edge when it's out of sight).
        rect: clipRect(box.x + d.axisW + b.x - sx, b.w, left, right, box.y + b.y, b.h),
      });
      cells.forEach((cell, ci) => parts.push({ detail: `cell:${b.index}:${ci}`, within: rowDetail, role: ci === what ? "rowheader" : "cell", name: cell }));
    }
    const focusable = maxScroll(d) > 0 && !d.pressable;
    return { role: "table", name, detail: focusable ? SCROLL_AREA : "table", parts };
  },
};
