/**
 * meter: one number against its range, drawn as a ring or a gauge.
 *
 *   meter "Goal reached" value={done} max=100 format=percent
 *   meter "Health score" kind=gauge value={score} max=100 bands="60,85"
 *
 * - The value is placed between min= and max=. Past either end, the mark
 *   stops at the end while the number still shows the real value.
 * - bands= splits the range at one or two values into bad, warn and good
 *   zones (good=down turns them round, for costs or risk). The mark takes
 *   the color of the zone its value is in; a gauge also shows the zones.
 *   Without bands the mark is the accent.
 * - A value that isn't a number shows "—" and an empty mark, never 0.
 *
 * Like chart, everything is worked out in layout (headless) into box.data,
 * relative to the box; paint only draws it.
 */
import type { ComponentDef, LayoutContext } from "../component";
import { ellipsize, fitLines } from "../text";
import type { Theme } from "../theme";
import type { Value } from "../types";
import { easeOut } from "../ghost";
import { valueText } from "./chart-kit";
import { themeFont } from "./util";

const KINDS = ["ring", "gauge"] as const;
const FORMATS = ["number", "money", "percent"] as const;
const GOOD_WAYS = ["up", "down"] as const;
type Kind = (typeof KINDS)[number];
type Format = (typeof FORMATS)[number];
type Zone = "bad" | "warn" | "good" | "accent";

/** The widest a ring or gauge grows: a key figure, not a hero image. */
const MAX_RING = 168;
const MAX_GAUGE = 260;

/** Where the value sits in its range, and the zones, as fractions of the range from 0 to 1. */
export interface MeterGeometry {
  kind: Kind;
  /** 0..1 along the range, or null when the value isn't a number. */
  frac: number | null;
  zone: Zone;
  /** The zones a gauge shows, in order; empty without bands. */
  zones: Array<{ from: number; to: number; zone: Zone }>;
  /** The number as drawn, and its font. */
  text: string;
  textFont: string;
  /** The label under the mark, as drawn. */
  label: string[];
  labelFont: string;
  labelLH: number;
  /** Centre of the ring or of the gauge's arc, its radius and stroke, relative to the box. */
  cx: number;
  cy: number;
  r: number;
  stroke: number;
  /** Where the number's centre is drawn. */
  textY: number;
  /** Gauge: min and max under the arc's ends. */
  ends?: { min: string; max: string; y: number; font: string };
  /** Where the label's first line starts. */
  labelY: number;
}

/** Thresholds from bands="60,85": one or two numbers, ascending. Anything else is null. */
export function parseBands(raw: string): number[] | null {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2 && !(nums[0]! < nums[1]!)) return null;
  return nums;
}

/** The zone for each stretch of the range, low to high: bad, (warn,) good, or the reverse for good=down. */
function zonesFor(bands: number[], good: "up" | "down"): Zone[] {
  const up: Zone[] = bands.length === 1 ? ["bad", "good"] : ["bad", "warn", "good"];
  return good === "up" ? up : [...up].reverse();
}

/** The number in its format: 37, $1,200, $1.2M, or the share of the range for percent. */
export function meterText(v: number | null, min: number, max: number, format: Format): string {
  if (v === null) return "—";
  if (format === "percent") return `${Math.round(((v - min) / (max - min)) * 100)}%`;
  return valueText(v, format);
}

const asNumber = (v: Value | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function check(props: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const bands = props.bands;
  if (bands !== undefined && !bands.includes("{") && !parseBands(bands)) {
    out.push(`bands="${bands}" should be one or two numbers in the meter's range, low to high, separated by a comma, like bands="60,85"`);
  }
  const min = props.min, max = props.max;
  if (min !== undefined && max !== undefined && !min.includes("{") && !max.includes("{") && !(Number(min) < Number(max))) {
    out.push(`min=${min} should be less than max=${max}; the meter uses 0 to 100 instead`);
  }
  return out;
}

export function meterLayout(box: { w: number; node: { line: number } }, ctx: Pick<LayoutContext, "theme" | "measure" | "warn">, p: {
  kind: Kind; value: number | null; min: number; max: number; bands: number[] | null; good: "up" | "down"; format: Format; label: string;
}): { g: MeterGeometry; h: number } {
  const t: Theme = ctx.theme, m = ctx.measure;
  const { kind, value, format } = p;
  let { min, max } = p;
  if (!(min < max)) {
    ctx.warn?.(`meter on line ${box.node.line}: min=${min} isn't less than max=${max}, so it shows 0 to 100`);
    min = 0;
    max = 100;
  }
  const span = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const frac = value === null ? null : span(value);

  let zone: Zone = "accent";
  const zones: MeterGeometry["zones"] = [];
  if (p.bands) {
    const names = zonesFor(p.bands, p.good);
    const cuts = [0, ...p.bands.map(span), 1];
    names.forEach((z, i) => zones.push({ from: cuts[i]!, to: cuts[i + 1]!, zone: z }));
    if (value !== null) zone = names[p.bands.filter((b) => value >= b).length]!;
  }

  const labelFont = themeFont(t, 400, t.text.caption + 1);
  const labelLH = Math.round((t.text.caption + 1) * 1.4);
  const label = p.label ? fitLines(p.label, box.w, labelFont, m, 2) : [];
  const text = meterText(value, min, max, format);

  if (kind === "ring") {
    const d = Math.min(box.w, MAX_RING);
    const stroke = Math.round(Math.max(8, d * 0.085));
    const r = (d - stroke) / 2;
    const size = d >= 140 ? t.text.display : t.text.title;
    const textFont = themeFont(t, 700, size);
    // The number sits inside the ring, so it must fit the hole.
    const shown = ellipsize(text, Math.max(0, 2 * r - stroke * 2), textFont, m);
    const labelY = d + (label.length ? t.space.sm : 0);
    return {
      g: { kind, frac, zone, zones, text: shown, textFont, label, labelFont, labelLH, cx: box.w / 2, cy: d / 2, r, stroke, textY: d / 2, labelY },
      h: labelY + label.length * labelLH,
    };
  }

  const gw = Math.min(box.w, MAX_GAUGE);
  const stroke = Math.round(Math.max(10, gw * 0.07));
  const r = (gw - stroke) / 2;
  const cy = stroke / 2 + r;
  const size = gw >= 200 ? t.text.display : t.text.title;
  const textFont = themeFont(t, 700, size);
  const shown = ellipsize(text, Math.max(0, 2 * (r - stroke)), textFont, m);
  const endFont = themeFont(t, 400, t.text.caption);
  const endLH = Math.round(t.text.caption * 1.4);
  const fmt = (v: number) => (format === "percent" ? meterText(v, min, max, "percent") : valueText(v, format));
  // The ends' labels sit under the arc's ends, each in half the arc's width.
  const half = Math.max(0, gw / 2 - t.space.sm);
  const ends = { min: ellipsize(fmt(min), half, endFont, m), max: ellipsize(fmt(max), half, endFont, m), y: cy + t.space.xs + endLH / 2, font: endFont };
  const labelY = cy + t.space.xs + endLH + (label.length ? t.space.sm : 0);
  return {
    g: { kind, frac, zone, zones, text: shown, textFont, label, labelFont, labelLH, cx: box.w / 2, cy, r, stroke, textY: cy - size * 0.45, ends, labelY },
    h: labelY + label.length * labelLH,
  };
}

export const meter: ComponentDef = {
  type: "meter",
  category: "data",
  description:
    "One number against its range, as a ring or a gauge: progress toward a goal, a score, utilization or a budget used. Add bands= to color it bad, warn or good by where the value falls.",
  text: { description: "A short label under the meter, e.g. \"Goal reached\"." },
  props: {
    value: { type: "expression", required: true, description: "The number to show, e.g. value=score or value={round(spent / budget * 100)}." },
    kind: { type: "enum", values: KINDS, default: "ring", description: "ring is a full circle, for progress toward a goal; gauge is a half circle, for a score or a level, and shows min and max at its ends and its bands." },
    min: { type: "number", default: 0, description: "The low end of the range (default 0), a number or an {expression}." },
    max: { type: "number", default: 100, description: "The high end of the range (default 100), e.g. max=500 or max={budget}." },
    bands: {
      type: "string",
      description: "One or two values that split the range into bad, warn and good, low to high, e.g. bands=\"60,85\": below 60 is bad, 60 to 85 warn, 85 and above good. One value splits it into bad and good.",
    },
    good: { type: "enum", values: GOOD_WAYS, default: "up", description: "Which end of bands is good: up (default), or down for costs, risk or load, where low is good." },
    format: { type: "enum", values: FORMATS, default: "number", description: "How the number reads: number (1,200), money ($1,200) or percent, the value's share of the range (82%)." },
  },
  example: `state score=72
meter "Health score" kind=gauge value=score max=100 bands="60,85"`,
  check,
  minWidth: () => 120,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const raw = p.expr("value");
    const value = asNumber(raw);
    if (p.has("value") && value === null && raw !== undefined && !ctx.isLoading?.(box.node)) {
      ctx.warn?.(`meter on line ${box.node.line}: value isn't a number, so it shows —. Give it a number, like value={done}`);
    }
    let bands: number[] | null = null;
    if (p.has("bands")) {
      bands = parseBands(p.str("bands"));
      if (!bands) ctx.warn?.(`meter on line ${box.node.line}: bands should be one or two numbers, low to high, like bands="60,85"; they were ignored`);
    }
    const out = meterLayout(box, ctx, {
      kind: p.oneOf("kind", KINDS, "ring"), value, min: p.num("min", 0), max: p.num("max", 100), bands,
      good: p.oneOf("good", GOOD_WAYS, "up"), format: p.oneOf("format", FORMATS, "number"), label: p.text(),
    });
    box.data = { ...out.g };
    box.h = out.h;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as MeterGeometry | undefined;
    if (!d) return;
    const ox = box.x, oy = box.y;
    const cx = ox + d.cx, cy = oy + d.cy;
    const colorOf = (z: Zone) => (z === "accent" ? c.accent : c[z]);
    // Draws in once its data arrives, then follows the value as it changes.
    const reveal = easeOut(ctx.reveal(box.node));
    const frac = d.frac === null ? 0 : ctx.tween(box.node, "meter", d.frac, 600) * reveal;
    const base = g.globalAlpha;
    g.lineCap = "round";
    g.lineWidth = d.stroke;

    if (d.kind === "ring") {
      g.beginPath();
      g.arc(cx, cy, d.r, 0, Math.PI * 2);
      g.strokeStyle = c.line;
      g.stroke();
      if (frac > 0.001) {
        g.beginPath();
        g.arc(cx, cy, d.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        g.strokeStyle = colorOf(d.zone);
        g.stroke();
      }
    } else {
      // The zones as a quiet track, so the value's own arc stands out against them.
      const from = Math.PI, sweep = Math.PI;
      g.lineCap = "butt";
      if (d.zones.length) {
        for (const z of d.zones) {
          if (z.to <= z.from) continue;
          g.beginPath();
          g.arc(cx, cy, d.r, from + sweep * z.from, from + sweep * z.to);
          g.strokeStyle = colorOf(z.zone);
          g.globalAlpha = base * 0.28;
          g.stroke();
        }
        g.globalAlpha = base;
      } else {
        g.beginPath();
        g.arc(cx, cy, d.r, from, from + sweep);
        g.strokeStyle = c.line;
        g.stroke();
      }
      if (frac > 0.001) {
        g.beginPath();
        g.arc(cx, cy, d.r, from, from + sweep * frac);
        g.strokeStyle = colorOf(d.zone);
        g.stroke();
      }
      if (d.frac !== null) {
        // A knob at the value: easier to read than the arc's end alone.
        const a = from + sweep * frac;
        const kx = cx + Math.cos(a) * d.r, ky = cy + Math.sin(a) * d.r;
        g.beginPath();
        g.arc(kx, ky, d.stroke * 0.42, 0, Math.PI * 2);
        g.fillStyle = c.raised;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = colorOf(d.zone);
        g.stroke();
      }
      if (d.ends) {
        g.font = d.ends.font;
        g.fillStyle = c.muted;
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.fillText(d.ends.min, cx - d.r - d.stroke / 2, oy + d.ends.y);
        g.textAlign = "right";
        g.fillText(d.ends.max, cx + d.r + d.stroke / 2, oy + d.ends.y);
      }
    }
    g.lineCap = "butt";

    g.globalAlpha = base * easeOut(ctx.reveal(box.node) * 2.5);
    g.font = d.textFont;
    g.fillStyle = d.frac === null ? c.muted : c.ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(d.text, cx, oy + d.textY);
    g.font = d.labelFont;
    g.fillStyle = c.muted;
    d.label.forEach((l, i) => g.fillText(l, cx, oy + d.labelY + i * d.labelLH + d.labelLH / 2));
    g.globalAlpha = base;
  },
};
