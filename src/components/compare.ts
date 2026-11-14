/**
 * compare and compare-row: two to four options side by side, one row per
 * attribute, with the best value in each row marked and an optional
 * recommended option highlighted. For "Plan A vs B vs C", "iPhone vs Pixel".
 *
 *   compare items=plans name=name pick="Pro"
 *     compare-row "Price" field=price format=money best=low
 *     compare-row "Storage (GB)" field=storage format=number best=high
 *     compare-row "Support" field=support
 *
 * Like a table turned on its side: options are columns, attributes are rows.
 * Rows have no box of their own; compare lays them out and draws them.
 *
 * On a phone (narrower than BLOCKS_WIDTH, or too narrow for a label column
 * beside the options) each row is a block of its own: its label on top, then
 * a cell per option, in the same columns as the option names above, each
 * headed by its option's name, so a value says whose it is however far down
 * the list it is. The recommended option's cells are tinted and outlined.
 */
import type { PartSemantics } from "../a11y/semantics";
import type { ComponentDef, LayoutContext, PaintContext } from "../component";
import { fieldOf, isList, isRecord } from "../data";
import { drawIcon } from "../icons";
import { ellipsize, fitLines, wrapText } from "../text";
import type { Box, SayShapeNode, Value } from "../types";
import { cellText, EMPTY_CELL } from "./table";
import { fillTint, partBox, themeFont } from "./util";

export const MAX_COMPARE_OPTIONS = 4;
const FORMATS = ["text", "number", "money"] as const;
const BESTS = ["low", "high"] as const;
const PAD = 12, MIN_OPTION_W = 96, MIN_STACKED_W = 56, LINES = 2;
/**
 * Narrower than this, rows are drawn as blocks (see above). Measured in a
 * browser: below 480 px the label column beside two options is 84 to 134 px,
 * so labels like "Price a month" wrap, and three options' values wrap onto
 * two lines; every phone (up to 430 px) is under it.
 */
export const BLOCKS_WIDTH = 480;
/** Blocks: the space between a block's label and its cells. */
const BLOCK_GAP = 6;

interface Cell { lines: string[]; check?: boolean; best: boolean }
type CompareLayout = {
  title: string[];
  message?: string[];
  labelW: number;
  colW: number;
  /** Narrow: each row is a block, its label above a cell per option, each cell headed by its option's name. */
  blocks: boolean;
  /** Blocks: each option's name as it fits on one line above its cells. */
  heads: string[];
  /** Blocks: the line height of those names. */
  headLH: number;
  /** The option names' font at the top: a size smaller in blocks when a word wouldn't fit its column. */
  nameFont: string;
  top: number;
  headerH: number;
  names: string[][];
  pick: number;
  /** The recommended column's label, as long as fits: RECOMMENDED, TOP PICK or nothing. */
  badge: string;
  /** Each row, with its element and its tip= (shown from its label). */
  rows: Array<{ label: string[]; cells: Cell[]; y: number; h: number; node: SayShapeNode; tip: string }>;
  fonts: { title: string; name: string; label: string; cell: string; badge: string; block: string; head: string };
  lh: number;
  titleLH: number;
};

function rowsOf(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren">): SayShapeNode[] {
  return ctx.visibleChildren(node).filter((k) => k.type === "compare-row");
}

export const compare: ComponentDef = {
  type: "compare",
  category: "data",
  description: "Two to four options side by side with one row per attribute, marking the best value in each row: plans, products or choices to weigh up. Use compare-row children.",
  text: { description: "A title above the comparison." },
  props: {
    items: { type: "expression", required: true, description: "The options, a list of records, e.g. items=plans. Two to four." },
    name: { type: "name", default: "name", description: "The field holding each option's name, shown at the top of its column (default name)." },
    pick: { type: "string", description: "The name of the option to recommend: its column is highlighted and marked Recommended." },
  },
  children: ["compare-row"],
  picks: [
    { for: "2 to 4 options side by side, such as plans or products", write: "compare holding compare-row best=low" },
  ],
  example: `state plans=[{name: "Basic", price: 9, storage: 50, support: "Email"}, {name: "Pro", price: 19, storage: 500, support: "Chat"}, {name: "Team", price: 49, storage: 2000, support: "Phone"}]
compare items=plans pick="Pro"
  compare-row "Price a month" field=price format=money best=low
  compare-row "Storage (GB)" field=storage format=number best=high
  compare-row "Support" field=support`,
  minWidth: () => 200,
  partTip(box, detail) {
    const d = box.data as CompareLayout | undefined;
    const i = typeof detail === "string" && detail.startsWith("tip:") ? Number(detail.slice(4)) : -1;
    return d?.rows[i]?.node;
  },
  semantics(box, ctx) {
    const d = box.data as CompareLayout | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message) return { role: "text", name: [name, d.message.join(" ")].filter(Boolean).join(": ") };
    // Options are columns, rows are what they're compared on.
    const options = d.names.map((lines, i) => `${lines.join(" ")}${i === d.pick ? ", recommended" : ""}`);
    const parts: PartSemantics[] = [{ detail: "head", role: "row" }, { detail: "head:label", within: "head", role: "cell", name: "" }];
    options.forEach((o, i) => parts.push({ detail: `head:${i}`, within: "head", role: "columnheader", name: o }));
    d.rows.forEach((row, r) => {
      parts.push({ detail: `row:${r}`, role: "row", rect: { x: box.x, y: row.y, w: box.w, h: row.h } });
      // A label with a tip is a part of its own (a region to reach it), read with the tip.
      parts.push({ detail: row.tip ? `tip:${r}` : `row:${r}:label`, within: `row:${r}`, role: "rowheader", name: row.label.join(" "), ...(row.tip ? { description: row.tip } : {}) });
      row.cells.forEach((cell, i) => {
        const text = cell.check !== undefined ? (cell.check ? "Yes" : "No") : cell.lines.join(" ");
        parts.push({ detail: `cell:${r}:${i}`, within: `row:${r}`, role: "cell", name: `${text}${cell.best ? ", best" : ""}` });
      });
    });
    return { role: "table", name, detail: "compare", parts };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme, m = ctx.measure;
    const fonts = {
      title: themeFont(t, 600, t.text.body), name: themeFont(t, 600, t.text.body), label: themeFont(t, 400, t.text.caption + 1),
      cell: themeFont(t, 400, t.text.body), badge: themeFont(t, 600, 11),
      block: themeFont(t, 600, t.text.caption + 1), head: themeFont(t, 400, t.text.caption),
    };
    const lh = Math.round(t.text.body * 1.35), titleLH = Math.round(t.text.body * 1.4);
    const title = p.text() ? wrapText(p.text(), box.w, fonts.title, m) : [];
    const top = title.length ? title.length * titleLH + t.space.sm : 0;
    const items = p.expr("items");
    const headLH = Math.round(t.text.caption * 1.4);
    const base: CompareLayout = { title, labelW: 0, colW: 0, blocks: false, heads: [], headLH, nameFont: fonts.name, top, headerH: 0, names: [], pick: -1, badge: "", rows: [], fonts, lh, titleLH };
    const say = (message: string, warning?: string) => {
      if (warning) ctx.warn?.(`compare on line ${box.node.line}: ${warning}`);
      const lines = fitLines(message, Math.max(20, box.w - 2 * PAD), fonts.label, m, 3);
      box.data = { ...base, message: lines };
      box.h = top + Math.max(64, lines.length * lh + PAD * 2);
    };
    if (!isList(items)) return say("Nothing to compare", p.has("items") ? "items is not a list. Use a list of records, like items=plans" : undefined);
    const options = items.filter(isRecord);
    if (options.length < 2) return say("Add at least two options to compare");
    if (options.length > MAX_COMPARE_OPTIONS) return say(`Too many options: at most ${MAX_COMPARE_OPTIONS}`, `${options.length} options is more than the ${MAX_COMPARE_OPTIONS} a comparison shows`);

    const sideW = Math.round(Math.min(160, Math.max(84, box.w * 0.28)));
    const blocks = box.w < BLOCKS_WIDTH || (box.w - sideW) / options.length < MIN_OPTION_W;
    const labelW = blocks ? 0 : sideW;
    const colW = (box.w - labelW) / options.length;
    if (colW < MIN_STACKED_W) return say(`Too narrow to compare ${options.length} options`);
    const cellW = colW - (blocks ? 8 : PAD * 2);
    const nameField = p.str("name") || "name";
    const nameTexts = options.map((o) => String(fieldOf(o, nameField) ?? EMPTY_CELL));
    const splits = nameTexts.some((n) => n.split(/\s+/).some((word) => m.width(word, fonts.name) > cellW));
    const nameFont = blocks && splits ? fonts.block : fonts.name;
    const names = nameTexts.map((n) => fitLines(n, cellW, nameFont, m, LINES));
    const pickName = p.str("pick");
    const pick = pickName ? options.findIndex((o) => String(fieldOf(o, nameField) ?? "") === pickName) : -1;
    const heads = blocks ? nameTexts.map((n) => ellipsize(n, cellW, fonts.head, m)) : [];
    const badge = ["RECOMMENDED", "TOP PICK", "★"].find((b) => m.width(b, fonts.badge) <= colW - 8) ?? "";
    const headerH = (pick >= 0 ? 22 : 0) + Math.max(...names.map((n) => n.length)) * lh + PAD * 2;

    let y = box.y + top + headerH;
    const rows = rowsOf(box.node, ctx).map((r) => {
      const rp = ctx.props(r);
      const field = rp.str("field");
      const format = rp.oneOf("format", FORMATS, "text");
      const best = rp.has("best") ? rp.oneOf("best", BESTS, "high") : null;
      const values: Array<Value | undefined> = options.map((o) => fieldOf(o, field));
      const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const target = best && nums.length >= 2 && new Set(nums).size > 1 ? (best === "low" ? Math.min(...nums) : Math.max(...nums)) : null;
      const cells: Cell[] = values.map((v) => {
        if (typeof v === "boolean") return { lines: [], check: v, best: false };
        const text = cellText(v, format).text;
        return { lines: fitLines(text, cellW, fonts.cell, m, LINES), best: target !== null && v === target };
      });
      const label = fitLines(rp.text() || field, blocks ? box.w : labelW - PAD, blocks ? fonts.block : fonts.label, m, LINES);
      const valueLines = Math.max(...cells.map((c) => c.lines.length || 1));
      // A block: padding, its label, a gap, then cells of an option's name over its value, and padding.
      const h = blocks
        ? PAD + label.length * lh + BLOCK_GAP + headLH + valueLines * lh + PAD * 2
        : Math.max(label.length, valueLines) * lh + PAD * 2;
      const row = { label, cells, y, h, node: r, tip: rp.str("tip", "").trim() };
      y += h;
      return row;
    });
    box.data = { ...base, labelW, colW, blocks, heads, nameFont, headerH, names, pick, badge, rows };
    box.h = y - box.y;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as CompareLayout;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.font = d.fonts.title;
    g.fillStyle = c.ink;
    d.title.forEach((l, i) => g.fillText(l, box.x, box.y + i * d.titleLH + d.titleLH / 2));
    const top = box.y + d.top;
    if (d.message) {
      const h = box.y + box.h - top;
      ctx.roundRect(box.x + 0.5, top + 0.5, box.w - 1, h - 1, theme.radius.md);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      g.font = d.fonts.label;
      g.fillStyle = c.muted;
      g.textAlign = "center";
      const y0 = top + h / 2 - ((d.message.length - 1) * d.lh) / 2;
      d.message.forEach((l, i) => g.fillText(l, box.x + box.w / 2, y0 + i * d.lh));
      return;
    }
    if (d.blocks) return paintBlocks(box, ctx, d, top);
    const bottom = box.y + box.h;
    const colX = (i: number) => box.x + d.labelW + i * d.colW;
    // The recommended option: a tinted, outlined column with a label on top.
    if (d.pick >= 0) {
      ctx.roundRect(colX(d.pick) + 2, top, d.colW - 4, bottom - top, theme.radius.md);
      fillTint(g, c.accent, 0.07);
      g.lineWidth = 1.5;
      g.strokeStyle = c.accent;
      g.stroke();
      g.font = d.fonts.badge;
      g.fillStyle = c.accent;
      g.textAlign = "center";
      g.fillText(d.badge, colX(d.pick) + d.colW / 2, top + PAD + 6);
    }
    // Option names.
    const nameTop = top + PAD + (d.pick >= 0 ? 22 : 0);
    g.font = d.fonts.name;
    g.fillStyle = c.ink;
    g.textAlign = "center";
    d.names.forEach((lines, i) => lines.forEach((l, j) => g.fillText(l, colX(i) + d.colW / 2, nameTop + j * d.lh + d.lh / 2)));
    // Rows: a rule above each, the label on the left, values centred.
    for (const [ri, r] of d.rows.entries()) {
      g.fillStyle = c.line;
      g.fillRect(box.x, Math.round(r.y), box.w, 1);
      g.font = d.fonts.label;
      g.fillStyle = c.muted;
      g.textAlign = "left";
      // The label is centred on the row.
      const ly = r.y + r.h / 2 - ((r.label.length - 1) * d.lh) / 2;
      paintLabel(box, ctx, d, r, ri, ly);
      r.cells.forEach((cell, i) => paintCell(ctx, d, cell, colX(i) + d.colW / 2, r.y + r.h / 2));
    }
  },
};

type Row = CompareLayout["rows"][number];

/** A row's label from its first line's middle at ly; with a tip, underlined with dots and pressable for it. */
function paintLabel(box: Box, ctx: PaintContext, d: CompareLayout, r: Row, ri: number, ly: number): void {
  const g = ctx.g;
  r.label.forEach((l, j) => g.fillText(l, box.x, ly + j * d.lh));
  if (!r.tip) return;
  const w = Math.max(...r.label.map((l) => g.measureText(l).width));
  for (let j = 0; j < r.label.length; j++) {
    const lw = g.measureText(r.label[j]!).width;
    for (let x = 0; x < lw; x += 4) g.fillRect(box.x + x, ly + j * d.lh + d.lh / 2 - 2, 2, 1);
  }
  ctx.addHit(partBox(box, box.x, ly - d.lh / 2, w, r.label.length * d.lh), { detail: `tip:${ri}` });
}

/** One option's value, centred on (cx, cy): a check or a dash for true and false, the best in the good color. */
function paintCell(ctx: PaintContext, d: CompareLayout, cell: Cell, cx: number, cy: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  if (cell.check !== undefined) {
    drawIcon(g, cell.check ? "check" : "minus", cx - 9, cy - 9, 18, cell.check ? c.good : c.muted);
    return;
  }
  g.font = cell.best ? d.fonts.name : d.fonts.cell;
  g.fillStyle = cell.best ? c.good : cell.lines[0] === EMPTY_CELL ? c.muted : c.ink;
  g.textAlign = "center";
  const y0 = cy - ((cell.lines.length - 1) * d.lh) / 2;
  cell.lines.forEach((l, j) => g.fillText(l, cx, y0 + j * d.lh));
}

/**
 * Narrow: the option names across the top, then a block per row: a rule, its
 * label, and under it a cell per option in that option's column, headed by
 * its name. The recommended option's name and cells are tinted and outlined.
 */
function paintBlocks(box: Box, ctx: PaintContext, d: CompareLayout, top: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const colX = (i: number) => box.x + i * d.colW;
  const outline = (x: number, y: number, w: number, h: number) => {
    ctx.roundRect(x, y, w, h, theme.radius.md);
    fillTint(g, c.accent, 0.07);
    g.lineWidth = 1.5;
    g.strokeStyle = c.accent;
    g.stroke();
  };
  if (d.pick >= 0) {
    outline(colX(d.pick) + 2, top, d.colW - 4, d.headerH - 4);
    g.font = d.fonts.badge;
    g.fillStyle = c.accent;
    g.textAlign = "center";
    g.fillText(d.badge, colX(d.pick) + d.colW / 2, top + PAD + 6);
  }
  const nameTop = top + PAD + (d.pick >= 0 ? 22 : 0);
  g.font = d.nameFont;
  g.fillStyle = c.ink;
  g.textAlign = "center";
  d.names.forEach((lines, i) => lines.forEach((l, j) => g.fillText(l, colX(i) + d.colW / 2, nameTop + j * d.lh + d.lh / 2)));
  for (const [ri, r] of d.rows.entries()) {
    g.fillStyle = c.line;
    g.fillRect(box.x, Math.round(r.y), box.w, 1);
    g.font = d.fonts.block;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    paintLabel(box, ctx, d, r, ri, r.y + PAD + d.lh / 2);
    // The cells: from under the label to the block's bottom padding.
    const cellTop = r.y + PAD + r.label.length * d.lh + BLOCK_GAP;
    const cellH = r.y + r.h - PAD - cellTop;
    if (d.pick >= 0) outline(colX(d.pick) + 2, cellTop - 4, d.colW - 4, cellH + 8);
    d.heads.forEach((name, i) => {
      g.font = d.fonts.head;
      g.fillStyle = i === d.pick ? c.accent : c.muted;
      g.textAlign = "center";
      g.fillText(name, colX(i) + d.colW / 2, cellTop + d.headLH / 2);
    });
    const valueTop = cellTop + d.headLH;
    r.cells.forEach((cell, i) => paintCell(ctx, d, cell, colX(i) + d.colW / 2, valueTop + (cellH - d.headLH) / 2));
  }
}

export const compareRow: ComponentDef = {
  type: "compare-row",
  category: "data",
  description: "One row of a comparison: an attribute and the field each option's value comes from.",
  text: { description: "The attribute's name. Defaults to the field name." },
  props: {
    field: { type: "name", required: true, description: "The field of each option to show, e.g. field=price. true and false show as a check and a dash." },
    format: { type: "enum", values: FORMATS, default: "text", description: "text, number (1,200.5) or money ($1,200.00)." },
    best: { type: "enum", values: BESTS, description: "low or high: mark the lowest or highest number in the row as the best. Leave out when neither is better." },
  },
  parents: ["compare"],
  example: `compare-row "Price a month" field=price format=money best=low`,
  // Rows have no box of their own: compare lays them out and draws them.
  // Read as a row of its compare (compare describes its rows).
  semantics: () => null,
  layout(box) {
    box.h = 0;
  },
};
