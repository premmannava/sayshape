/**
 * tile: a small fixed-size face with a value, an optional icon and a detail
 * line. Playing cards, dice, seats, keyboard keys, lottery numbers, periodic
 * table cells.
 *
 *   tile "4" icon=club label="4 of clubs"
 *
 * A tile keeps its size from the theme whatever room it's given: in a row it
 * takes its own width (rows of only tiles sit together in the middle) and
 * wraps onto more lines when they don't fit. Only when a single tile is wider
 * than its space does it shrink, keeping its shape.
 */
import type { ComponentDef, PaintContext } from "../component";
import type { Theme } from "../theme";
import type { Box } from "../types";
import { MOTION } from "../design";
import { drawIcon, isIconName, type IconName } from "../icons";
import { ellipsize } from "../text";
import { fillTint, iconProblems, onProp, themeFont, toneColor, toneProp, TONES } from "./util";

const SHAPES = ["card", "square"] as const;
const SIZES = ["sm", "md", "lg"] as const;
const VARIANTS = ["raised", "outline"] as const;
type Shape = (typeof SHAPES)[number];
type Size = (typeof SIZES)[number];

/** A playing card's sides are about 5:7. */
const CARD_RATIO = 1.4;

/** A tile's full size, from the theme's control height, so it follows the theme's scale. */
export function tileSize(theme: Theme, shape: Shape, size: Size): { w: number; h: number } {
  const unit = theme.control.height;
  if (shape === "square") {
    const side = Math.round(unit * { sm: 1, md: 1.4, lg: 1.9 }[size]);
    return { w: side, h: side };
  }
  const w = Math.round(unit * { sm: 1.1, md: 1.5, lg: 2 }[size]);
  return { w, h: Math.round(w * CARD_RATIO) };
}

/** Type sizes for a tile's value, from the theme. */
function valueSize(theme: Theme, shape: Shape, size: Size): number {
  const t = theme.text;
  return shape === "card" ? { sm: t.body, md: t.lead + 2, lg: t.title + 2 }[size] : { sm: t.lead, md: t.title, lg: t.display }[size];
}

interface TileData {
  shape: Shape;
  /** 1 at full size; less only when the tile had to shrink to fit its space. */
  scale: number;
  value: number;
  detail: number;
}

const readShape = (p: ReturnType<PaintContext["props"]>) => p.oneOf("shape", SHAPES, "card");
const readSize = (p: ReturnType<PaintContext["props"]>) => p.oneOf("size", SIZES, "md");

function iconOf(raw: string): IconName | null {
  return isIconName(raw) ? raw : null;
}

const SUITS: Readonly<Record<string, string>> = { club: "clubs", spade: "spades", heart: "hearts", diamond: "diamonds" };

/** What a tile is called to a screen reader and in Copy text: label=, or its value (with its suit, "Q of hearts") and detail. */
function tileName(p: ReturnType<PaintContext["props"]>): string {
  const label = p.str("label");
  if (label) return label;
  const icon = p.str("icon"), value = p.text();
  const suit = Object.hasOwn(SUITS, icon) ? SUITS[icon] : undefined;
  const words = [value && suit ? `${value} of ${suit}` : value, p.str("detail")].filter(Boolean).join(", ");
  return words || icon;
}

export const tile: ComponentDef = {
  type: "tile",
  category: "content",
  description: "A small fixed-size face with a value, an optional icon and a detail line, for playing cards, seats, dice, keys or lottery numbers. Several in a row keep their size and wrap.",
  text: { description: "The value on its face, e.g. A, 10 or B4. Keep it short." },
  props: {
    icon: { type: "string", description: "An icon on its face, by name from icon's list, e.g. icon=club. The suits are club, spade, heart and diamond." },
    shape: { type: "enum", values: SHAPES, default: "card", description: "card (portrait, like a playing card) or square (a seat, a key, a die)." },
    size: { type: "enum", values: SIZES, default: "md", description: "sm, md or lg." },
    detail: { type: "string", description: "A small line under the value, e.g. a price or an atomic weight. Keep it to a few characters at size=sm." },
    tone: { ...toneProp, description: "Color of the value and icon: default, muted, accent, good, warn or bad (red suits use bad)." },
    variant: { type: "enum", values: VARIANTS, default: "raised", description: "raised (a lifted face) or outline." },
    selected: { type: "condition", description: "Expression; when true the tile is marked as chosen, e.g. selected={s.picked}." },
    disabled: { type: "condition", description: "Expression; when true it's greyed out and can't be pressed, e.g. a seat that's taken." },
    on: onProp("when pressed"),
    label: { type: "string", description: "What screen readers and Copy text say for it, e.g. label=\"Seat B4\". Default: its value (with its suit, as in Q of hearts) and detail." },
  },
  picks: [{ for: "playing cards, seats, dice or keys", write: "tile \"A\" icon=spade" }],
  example: `row gap=8
  tile "4" icon=club label="4 of clubs"
  tile "Q" icon=heart tone=bad label="Queen of hearts"
  tile "A" icon=spade label="Ace of spades"
  tile "B4" shape=square detail="$14" selected=true on=emit:seat`,
  check: (props) => iconProblems(props.icon, "icon"),
  minWidth(node, ctx) {
    const p = ctx.props(node);
    return tileSize(ctx.theme, readShape(p), readSize(p)).w;
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const shape = readShape(p), size = readSize(p);
    const full = tileSize(ctx.theme, shape, size);
    // Never stretched; shrunk, keeping its shape, only when its space is narrower than it.
    const scale = Math.min(1, box.w / full.w);
    box.w = full.w * scale;
    box.h = full.h * scale;
    // Type shrinks with the tile, so a squeezed tile still holds its words.
    const data: TileData = { shape, scale, value: valueSize(ctx.theme, shape, size) * scale, detail: ctx.theme.text.caption * Math.min(1, scale + 0.15) };
    box.data = data as unknown as Box["data"];
    if (!tileName(p)) ctx.warn?.(`tile on line ${box.node.line} has nothing on its face, so it can't be read or pressed. Give it a value, icon= or label=, e.g. tile "A" icon=spade`);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const d = box.data as unknown as TileData | undefined;
    if (!d) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    const disabled = p.cond("disabled");
    const selected = p.cond("selected");
    const pressable = p.has("on") && !disabled;
    const variant = p.oneOf("variant", VARIANTS, "raised");
    const hot = pressable && ctx.isHovered(box.node);
    const down = pressable && ctx.isPressed(box.node);
    const hover = ctx.tween(box.node, "tile:hover", hot ? 1 : 0, MOTION.hover);
    const press = ctx.tween(box.node, "tile:press", down ? 1 : 0, MOTION.press);
    const tone = p.oneOf("tone", TONES, "default");
    const ink = disabled ? c.muted : selected && tone === "default" ? c.accent : toneColor(theme, tone);
    const radius = Math.max(theme.radius.sm / 2, theme.radius.md * Math.min(1, d.scale + 0.2));
    const { x, y, w, h } = box;

    g.save();
    const s = 1 - press * 0.03;
    g.translate(x + w / 2, y + h / 2);
    g.scale(s, s);
    g.translate(-x - w / 2, -y - h / 2);
    // The face.
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
    g.save();
    if (variant === "raised" && !disabled) {
      g.shadowColor = c.shadow;
      g.shadowBlur = (3 + 5 * hover) * (1 - press);
      g.shadowOffsetY = (1 + hover) * (1 - press);
    }
    g.fillStyle = c.raised;
    if (variant === "raised" || disabled || selected) g.fill();
    g.restore();
    if (disabled) fillTint(g, c.ink, 0.07);
    // A light wash, so a red or amber value on a chosen tile still reads (AA).
    else if (selected) fillTint(g, c.accent, 0.08);
    else if (hover) fillTint(g, c.ink, 0.03 * hover);
    // A tile that can be pressed shows its edge in the control color, as fields and checks do.
    g.strokeStyle = selected && !disabled ? c.accent : variant === "outline" || pressable ? c.control : c.line;
    g.lineWidth = selected && !disabled ? 2 : variant === "outline" ? 1.25 : 1;
    g.stroke();

    // What's on it.
    const icon = iconOf(p.str("icon"));
    const value = p.text();
    const detail = p.str("detail");
    const measure = { width: (t: string, f: string) => { g.font = f; return g.measureText(t).width; } };
    const valueFont = themeFont(theme, 700, d.value);
    const pad = Math.max(theme.space.xs / 2, Math.round(Math.min(w, h) * 0.1));
    const inner = w - 2 * pad;
    // The detail line gets smaller, down to three quarters, before it's cut.
    let detailSize = d.detail;
    while (detail && detailSize > d.detail * 0.75 && measure.width(detail, themeFont(theme, 500, detailSize)) > inner) detailSize -= 0.5;
    const detailFont = themeFont(theme, 500, detailSize);
    g.textBaseline = "middle";
    g.textAlign = "center";
    const detailH = detail ? detailSize * 1.3 : 0;
    if (detail) {
      g.font = detailFont;
      g.fillStyle = disabled ? c.muted : c.muted;
      g.fillText(ellipsize(detail, inner, detailFont, measure), x + w / 2, y + h - pad - detailH / 2 + 1);
    }
    if (d.shape === "card" && value && icon) {
      // A playing card: the value and a small icon in the corner, a large icon in the middle.
      g.textAlign = "left";
      g.font = valueFont;
      g.fillStyle = ink;
      const vy = y + pad + d.value * 0.55;
      g.fillText(ellipsize(value, inner, valueFont, measure), x + pad, vy);
      const small = Math.round(d.value * 0.8);
      // The corner icon only where it fits above the bottom edge.
      const corner = vy + d.value * 0.55 + small <= y + h - pad - detailH;
      if (corner) drawIcon(g, icon, x + pad - small * 0.08, vy + d.value * 0.55, small, ink);
      const top = vy + d.value * 0.55 + (corner ? small : 0);
      const room = y + h - pad - detailH - top;
      const big = Math.max(0, Math.min(w * 0.5, room * 0.9));
      if (big >= theme.text.caption) drawIcon(g, icon, x + (w - big) / 2, top + (room - big) / 2, big, ink);
    } else {
      // Everything centred: an icon above the value, or either alone.
      const room = h - 2 * pad - detailH;
      const valueH = value ? d.value * 1.15 : 0;
      const gap = value && icon ? Math.max(2, d.value * 0.2) : 0;
      const iconS = icon ? Math.max(0, Math.min(inner, room - valueH - gap, value ? d.value * 1.25 : Math.min(w, h) * 0.55)) : 0;
      const show = iconS >= theme.text.caption * 0.8;
      const total = valueH + (show ? iconS + gap : 0);
      let cy = y + pad + (room - total) / 2;
      if (icon && show) { drawIcon(g, icon, x + (w - iconS) / 2, cy, iconS, ink); cy += iconS + gap; }
      if (value) {
        g.font = valueFont;
        g.fillStyle = ink;
        g.fillText(ellipsize(value, inner, valueFont, measure), x + w / 2, cy + valueH / 2 + 1);
      }
    }
    g.restore();
    if (pressable && tileName(p)) ctx.addHit(box);
  },
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const name = tileName(p);
    if (!name) return false;
    const selected = p.has("selected") ? p.cond("selected") : undefined;
    if (p.has("on")) return { role: "button", name, pressed: selected, disabled: p.cond("disabled") || undefined };
    // A tile that only shows something reads as its words; chosen or unavailable is said after them.
    const state = [selected ? "selected" : "", p.cond("disabled") ? "unavailable" : ""].filter(Boolean).join(", ");
    return { role: "text", name: state ? `${name} (${state})` : name };
  },
};
