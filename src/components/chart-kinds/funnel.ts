/**
 * chart kind=funnel: how many items make it through each stage, such as
 * leads → qualified → proposal → won.
 *
 *   chart "Pipeline" kind=funnel items=stages x=stage y=count
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is a stage, top to bottom in list order; the model sorts nothing.
 * - A stage's width is its value against the largest value, centred, and
 *   each band narrows to the next stage's width, so the drop between
 *   stages reads as a slope.
 * - Beside each band: the stage's name, its value, and its share of the
 *   stage before it (conversion), like "640 · 53%".
 * - A stage without a number is a gap: its name and "—", no band.
 * - Negative values, more than MAX_FUNNEL_STAGES stages, or too little width
 *   show a message instead of a funnel.
 */
import { mixColors } from "../../theme";
import { staggered, easeOut } from "../../ghost";
import { fillTint, themeFont } from "../util";
import { chartData, fit, preciseText, header, MAX_CHART_ITEMS, shareText, valueText, type ChartGeometry, type ChartSlot } from "../chart-kit";
import type { ChartKindDef } from "./types";

/** A funnel past this many stages stops reading as a funnel; the model should group them. */
export const MAX_FUNNEL_STAGES = 12;
/** The narrowest the bands' area gets before the funnel says it's too narrow. */
const MIN_FUNNEL_AREA = 60;
/** The space between two stages' bands. */
const STAGE_GAP = 3;
/** How far the last stage's color moves toward the surface: stages step down gently in one hue. */
const FADE = 0.55;

/** One stage as drawn, relative to the box. */
export interface FunnelStage {
  label: string;
  shownLabel: string;
  detail: string;
  value: number | null;
  /** The band: its top and bottom widths, centred on cx, from y to y + h. */
  top: number;
  bottom: number;
  y: number;
  h: number;
  /** Where the stage's name and numbers start. */
  textX: number;
}

export interface FunnelGeometry {
  cx: number;
  stages: FunnelStage[];
  nameFont: string;
  detailFont: string;
  nameLH: number;
}

export const funnel: ChartKindDef = {
  loadingAs: "hbar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "funnel", input.title, ctx);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;

    const d = chartData(input.items, input.x, input.y);
    if (d.problem === "not-list" || d.problem === "empty") return done(say("No data to chart"));
    if (d.problem === "too-many") return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    if (d.problem === "no-values") return done(say("No numbers to chart"));
    const n = d.slots.length;
    if (n > MAX_FUNNEL_STAGES) {
      ctx.warn?.(`${where}: a funnel shows at most ${MAX_FUNNEL_STAGES} stages, and items has ${n}. Combine stages, or show the first ones with take()`);
      return done(say(`Too many stages for a funnel: at most ${MAX_FUNNEL_STAGES}`));
    }
    if (d.slots.some((s) => s.value !== null && s.value < 0)) {
      ctx.warn?.(`${where}: a funnel can't show negative values; use kind=bar or kind=waterfall for changes that go down`);
      return done(say("A funnel can't show negative values"));
    }
    const largest = Math.max(...d.slots.map((s) => s.value ?? 0));
    if (largest <= 0) return done(say("Nothing to chart: every stage is 0"));
    if (d.gaps) ctx.warn?.(`${where}: ${d.gaps} of ${n} stages have no number in their y field, so they're shown as gaps`);

    const nameFont = themeFont(t, 600, t.text.caption + 1), detailFont = themeFont(t, 400, t.text.caption);
    const nameLH = Math.round((t.text.caption + 1) * 1.3), detailLH = Math.round(t.text.caption * 1.3);
    const rowH = Math.max(t.control.height, nameLH + detailLH + t.space.sm);

    // Each stage's numbers: its value, and from the second stage on, its share of the stage before.
    const details = d.slots.map((s, i) => {
      if (s.value === null) return "—";
      const prev = i > 0 ? d.slots[i - 1]!.value : null;
      return prev ? `${valueText(s.value, input.format)} · ${shareText(s.value / prev)}` : valueText(s.value, input.format);
    });
    const natural = Math.max(...d.slots.map((s, i) => Math.max(m.width(s.label, nameFont), m.width(details[i]!, detailFont))));
    const textW = Math.ceil(Math.min(natural, box.w * 0.42));
    const area = box.w - textW - t.space.sm;
    if (area < MIN_FUNNEL_AREA) {
      ctx.warn?.(`${where}: ${Math.round(box.w)} pixels leave no room for a funnel beside its stage names`);
      return done(say("Too narrow to chart these stages"));
    }

    const cx = area / 2;
    const widthOf = (v: number | null) => (v === null ? 0 : v > 0 ? Math.max(3, (area * v) / largest) : 0);
    const plot = { x: 0, y: top, w: box.w, h: n * rowH + (n - 1) * STAGE_GAP };
    const stages: FunnelStage[] = [];
    const slots: ChartSlot[] = [];
    d.slots.forEach((s, i) => {
      const topW = widthOf(s.value);
      const next = d.slots[i + 1];
      const bottom = next && next.value !== null ? widthOf(next.value) : topW;
      const y = top + i * (rowH + STAGE_GAP);
      stages.push({
        label: s.label, shownLabel: fit(s.label, textW, nameFont, m), detail: fit(details[i]!, textW, detailFont, m),
        value: s.value, top: topW, bottom, y, h: rowH, textX: cx + topW / 2 + t.space.sm,
      });
      const prev = i > 0 ? d.slots[i - 1] : undefined;
      const notes = s.value === null ? ["No number"] : [preciseText(s.value, input.format)];
      if (s.value !== null && prev?.value) notes.push(`${shareText(s.value / prev.value)} of ${prev.label}`);
      // A hover target as wide as the band's wider end, and never too thin to find.
      const hitW = Math.max(16, topW, bottom);
      slots.push({
        label: s.label, shownLabel: null, labelX: 0, cx, value: s.value, values: [s.value], notes,
        bars: [s.value === null ? null : { x: cx - hitW / 2, y, w: hitW, h: rowH }],
      });
    });
    const geometry: FunnelGeometry = { cx, stages, nameFont, detailFont, nameLH };
    return done({ ...base, plot, slots, labelY: plot.y + plot.h, custom: geometry, noHoverOutline: true });
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const f = d.custom as FunnelGeometry;
    const ox = box.x, oy = box.y;
    const n = f.stages.length;
    const base = g.globalAlpha;
    const hovered = ctx.pointer && ctx.isHovered(box.node) ? ctx.pointer : null;
    f.stages.forEach((s, i) => {
      const color = mixColors(c.accent, c.raised, n > 1 ? (FADE * i) / (n - 1) : 0) ?? c.accent;
      // Bands open out from the middle, top stage first.
      const grow = reveal < 1 ? staggered(reveal, i, n) : 1;
      const tw = ctx.tween(box.node, `funnel:top:${i}`, s.top, 440) * grow;
      const bw = ctx.tween(box.node, `funnel:bottom:${i}`, s.bottom, 440) * grow;
      if (tw > 0.25 || bw > 0.25) {
        const x = ox + f.cx, y = oy + s.y;
        g.beginPath();
        g.moveTo(x - tw / 2, y);
        g.lineTo(x + tw / 2, y);
        g.lineTo(x + bw / 2, y + s.h);
        g.lineTo(x - bw / 2, y + s.h);
        g.closePath();
        const gradient = g.createLinearGradient(0, y, 0, y + s.h);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, mixColors(color, c.raised, 0.18) ?? color);
        g.fillStyle = gradient;
        g.fill();
        const slot = d.slots[i]?.bars?.[0];
        const hot = !!slot && !!hovered && hovered.x - ox >= slot.x && hovered.x - ox <= slot.x + slot.w && hovered.y - oy >= slot.y && hovered.y - oy <= slot.y + slot.h;
        const glow = ctx.tween(box.node, `funnel:hover:${i}`, hot ? 1 : 0, 165);
        if (glow > 0) fillTint(g, c.raised, 0.16 * glow);
      }
      g.globalAlpha = base * easeOut(reveal * 2.5);
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      const textTop = oy + s.y + (s.h - f.nameLH * 2) / 2;
      g.font = f.nameFont;
      g.fillStyle = c.ink;
      g.fillText(s.shownLabel, ox + s.textX, textTop + f.nameLH * 0.8);
      g.font = f.detailFont;
      g.fillStyle = c.muted;
      g.fillText(s.detail, ox + s.textX, textTop + f.nameLH * 1.85);
      g.globalAlpha = base;
    });
    g.textBaseline = "middle";
  },
};
