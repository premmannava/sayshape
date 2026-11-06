/**
 * details and detail: one record shown as label and value rows, for "show me
 * this customer", an order, a policy or a ticket.
 *
 *   details "Ada Lovelace" subtitle="Analytical Engines Ltd · London"
 *     detail "Plan" value="Enterprise · 240 seats"
 *     detail "Renewal" value={renewal}
 *     detail "Status" value="At risk" tone=bad
 *
 * - Labels sit in a column on the left, as wide as the longest needs, up to
 *   40% of the width; values take the rest. Below NARROW wide, or when the
 *   labels leave too little room, each label sits above its value instead.
 * - Values wrap to at most three lines, labels to two; longer text ends
 *   with an ellipsis.
 * - A value with a tone (good, warn, bad, accent, muted) is drawn as a
 *   colored badge, for a status. An empty value shows "—", never nothing.
 * - Rows have no box of their own, like compare-row: details lays them out
 *   and draws them, so each, if= and else work around them as usual.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { ellipsize, fitLines, wrapText } from "../text";
import type { SayShapeNode } from "../types";
import { fillTint, themeFont, toneColor, TONES, type Tone } from "./util";

/** Narrower than this, labels go above their values. */
export const NARROW = 300;
/** The least room values keep beside the labels before the rows stack. */
const MIN_VALUE_W = 140;
const VALUE_LINES = 3, LABEL_LINES = 2;
const EMPTY = "—";

interface Row {
  label: string[];
  value: string[];
  /** Set when the value is a badge. */
  tone?: Tone;
  y: number;
  h: number;
  /** The whole row as a screen reader reads it, uncut: "Plan: Pro". */
  spoken: string;
}

type DetailsLayout = {
  title: string[];
  subtitle: string[];
  /** Label column width; 0 when the rows are stacked. */
  labelW: number;
  stacked: boolean;
  /** Where the first row starts, relative to the box. */
  top: number;
  rows: Row[];
  fonts: { title: string; subtitle: string; label: string; value: string; badge: string };
  lh: number;
  titleLH: number;
  pad: number;
};

function rowsOf(node: SayShapeNode, ctx: Pick<LayoutContext, "visibleChildren">): SayShapeNode[] {
  return ctx.visibleChildren(node).filter((k) => k.type === "detail");
}

export const details: ComponentDef = {
  type: "details",
  category: "data",
  description:
    "One record as label and value rows, for a single customer, order, policy or ticket: its fields one per line, with an optional status badge. Use detail children; for many records use a table.",
  text: { description: "A title above the rows, usually the record's name." },
  props: {
    subtitle: { type: "string", description: "A muted line under the title, e.g. the company and city." },
  },
  children: ["detail"],
  picks: [
    { for: "one record's fields, such as an order, a customer or a flight", write: "details \"Order #1042\" holding detail \"Status\" value=\"Shipped\"" },
  ],
  example: `state renewal="Jan 14, 2027"
details "Ada Lovelace" subtitle="Analytical Engines Ltd · London"
  detail "Plan" value="Enterprise · 240 seats"
  detail "Renewal" value={renewal}
  detail "Status" value="At risk" tone=bad`,
  minWidth: () => 160,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    // Its rows are drawn by details itself, not laid out as children: each is a part.
    const rows = (box.data as DetailsLayout | undefined)?.rows ?? [];
    return {
      role: "group",
      name: p.text() || undefined,
      description: p.str("subtitle") || undefined,
      parts: rows.map((r, i) => ({ detail: `row:${i}`, role: "text" as const, name: r.spoken })),
    };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme, m = ctx.measure;
    const fonts = {
      title: themeFont(t, 600, t.text.title),
      subtitle: themeFont(t, 400, t.text.body),
      label: themeFont(t, 400, t.text.body),
      value: themeFont(t, 400, t.text.body),
      badge: themeFont(t, 600, t.text.caption),
    };
    const lh = Math.round(t.text.body * 1.45), titleLH = Math.round(t.text.title * 1.3);
    const pad = t.space.sm + 2;
    const title = p.text() ? wrapText(p.text(), box.w, fonts.title, m) : [];
    const subtitle = p.has("subtitle") ? fitLines(p.str("subtitle"), box.w, fonts.subtitle, m, 2) : [];
    let top = title.length * titleLH + subtitle.length * lh;
    if (top) top += t.space.sm;

    const nodes = rowsOf(box.node, ctx);
    const labels = nodes.map((r) => ctx.props(r).text());
    const natural = Math.max(0, ...labels.map((l) => m.width(l, fonts.label))) + t.space.lg;
    const labelW = Math.ceil(Math.min(natural, box.w * 0.4));
    const stacked = box.w < NARROW || box.w - labelW < MIN_VALUE_W;
    const valueX = stacked ? 0 : labelW;
    const valueW = box.w - valueX;

    let y = top;
    const rows: Row[] = nodes.map((r, i) => {
      const rp = ctx.props(r);
      const raw = rp.str("value").trim();
      const text = raw === "" ? EMPTY : raw;
      const tone = rp.has("tone") ? rp.oneOf("tone", TONES, "default") : "default";
      const badge = tone !== "default" && raw !== "";
      // A badge is one line, cut to fit with its padding; plain values wrap.
      const value = badge ? [ellipsize(text, Math.max(0, valueW - 20), fonts.badge, m)] : fitLines(text, valueW, fonts.value, m, VALUE_LINES);
      const label = fitLines(labels[i] ?? "", stacked ? box.w : labelW - t.space.lg, fonts.label, m, LABEL_LINES);
      const lines = stacked ? label.length + value.length : Math.max(label.length, value.length);
      const h = lines * lh + pad * 2;
      const row: Row = { label, value, y, h, spoken: `${labels[i] ?? ""}: ${text}`, ...(badge ? { tone } : {}) };
      y += h;
      return row;
    });
    const data: DetailsLayout = { title, subtitle, labelW: stacked ? 0 : labelW, stacked, top, rows, fonts, lh, titleLH, pad };
    box.data = data;
    box.h = y;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as DetailsLayout | undefined;
    if (!d) return;
    const ox = box.x, oy = box.y;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.font = d.fonts.title;
    g.fillStyle = c.ink;
    d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));
    g.font = d.fonts.subtitle;
    g.fillStyle = c.muted;
    const subTop = oy + d.title.length * d.titleLH;
    d.subtitle.forEach((l, i) => g.fillText(l, ox, subTop + i * d.lh + d.lh / 2));

    for (const [i, r] of d.rows.entries()) {
      const ry = oy + r.y;
      // A hairline above every row but a first one with nothing over it.
      if (i > 0 || d.top > 0) {
        g.beginPath();
        g.moveTo(ox, Math.round(ry) + 0.5);
        g.lineTo(ox + box.w, Math.round(ry) + 0.5);
        g.strokeStyle = c.line;
        g.lineWidth = 1;
        g.stroke();
      }
      const first = ry + d.pad + d.lh / 2;
      g.font = d.fonts.label;
      g.fillStyle = c.muted;
      r.label.forEach((l, k) => g.fillText(l, ox, first + k * d.lh));
      const vx = ox + d.labelW;
      const vy = d.stacked ? first + r.label.length * d.lh : first;
      if (r.tone) {
        const color = toneColor(theme, r.tone);
        g.font = d.fonts.badge;
        const text = r.value[0] ?? "";
        const w = g.measureText(text).width + 20, h = Math.round(d.lh * 0.95);
        ctx.roundRect(vx, vy - h / 2, w, h, h / 2);
        // The tone's own color at low opacity, like badge: a theme color, never a mixed one.
        fillTint(g, color, 0.14);
        g.fillStyle = color;
        g.fillText(text, vx + 10, vy + 0.5);
        continue;
      }
      g.font = d.fonts.value;
      g.fillStyle = r.value.length === 1 && r.value[0] === EMPTY ? c.muted : c.ink;
      r.value.forEach((l, k) => g.fillText(l, vx, vy + k * d.lh));
    }
  },
};

export const detail: ComponentDef = {
  type: "detail",
  category: "data",
  description: "One row of details: a field's name and its value.",
  text: { description: "The field's name, e.g. \"Plan\".", required: true },
  props: {
    value: { type: "string", required: true, description: "The value to show, usually an {expression}, e.g. value={order.total} or value=\"{money(total)}\". Empty shows —." },
    tone: {
      type: "enum", values: TONES, default: "default",
      description: "Show the value as a colored badge, for a status: good, warn, bad, accent or muted. Leave out for plain text.",
    },
  },
  parents: ["details"],
  example: `detail "Status" value="At risk" tone=bad`,
  // Rows have no box of their own: details lays them out and draws them.
  // Read as one of its details' rows (details describes them).
  semantics: () => null,
  layout(box) {
    box.h = 0;
  },
};
