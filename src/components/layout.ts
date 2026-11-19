import type { ComponentDef, PaintContext } from "../component";
import type { Box, SayShapeNode } from "../types";
import { ellipsize, fitLines, wrapText } from "../text";
import { drawIcon, isIconName } from "../icons";
import { isDarkTheme, mixColors, parseColor, PHONE_WIDTH, sizesOf, type Theme } from "../theme";
import { contrastRatio, isForcedColors } from "../scrim";
import { GLASS_BLUR, glassAlpha, glassTheme } from "../glass";
import { MOTION } from "../design";
import { FILLS, fillGradient, fillSource, isFillName, onFillTheme, type FillName } from "../fills";
import { chevron, detailProp, fillTint, gapProp, iconProblems, iconProp, onProp, padProp, paintPill, partBox, PILL_TONES, pillWidth, row as rowLayout, ROW_ALIGN, ROW_JUSTIFY, rowMinWidth, runOn, stack, themeFont, toneColor } from "./util";

/** A parent card is already the frame; let nested tables and lists use its surface (a list keeps only its row lines). */
function markTablesInsideCard(box: Box): void {
  for (const child of box.children) {
    if (child.node.type === "table" || child.node.type === "list") child.data = { ...child.data, embeddedInCard: true };
    markTablesInsideCard(child);
  }
}

export const column: ComponentDef = {
  type: "column",
  category: "layout",
  description: "Stacks its children vertically.",
  props: { gap: gapProp(8), pad: padProp(0) },
  children: "any",
  example: `column gap=6
  text "First"
  text "Second"`,
  semantics: () => null,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    stack(box, ctx, p.num("pad", 0), p.num("gap", ctx.theme.gaps?.column ?? 8));
  },
};

const OVERLAP_AT = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
/** Space between things placed on top, when there are several. */
const OVERLAP_GAP = 4;

export const overlap: ComponentDef = {
  type: "overlap",
  category: "layout",
  description: "Puts its later children on top of its first one, at a corner, an edge or the middle: a Sale badge on a picture, a count on an icon, a label over a card. The first child sets the size.",
  props: {
    at: { type: "enum", values: OVERLAP_AT, default: "top-right", description: "Where the children on top sit: top-left, top, top-right, left, center, right, bottom-left, bottom or bottom-right." },
    inset: { type: "number", default: 8, description: "How far in from the edges they sit, in pixels (default 8)." },
  },
  children: "any",
  picks: [{ for: "a badge over a card", write: "overlap" }],
  example: `overlap at=top-right
  card
    text "Trail runner socks" weight=semibold
    text "Three pairs" tone=muted
  badge "Sale" tone=bad`,
  // Only layout: what's inside describes itself.
  semantics: () => null,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const kids = ctx.visibleChildren(box.node);
    const first = kids[0];
    if (!first) { box.h = 0; return; }
    const at = p.oneOf("at", OVERLAP_AT, "top-right");
    const inset = Math.max(0, Math.min(p.num("inset", 8), box.w / 4));
    const base = ctx.layout(first, box.x, box.y, box.w);
    // Laid out in the room inside the inset; an element that hugs its words (a badge) comes back narrower.
    const room = Math.max(0, box.w - inset * 2);
    const tops = kids.slice(1).map((k) => ctx.layout(k, box.x, box.y, room));
    const tall = tops.reduce((sum, b) => sum + b.h, 0) + OVERLAP_GAP * Math.max(0, tops.length - 1);
    // Never smaller than what sits on top, so nothing is drawn outside the box.
    box.h = Math.max(base.h, tops.length ? tall + inset * 2 : 0);
    let y = at.startsWith("top") ? box.y + inset : at.startsWith("bottom") ? box.y + box.h - inset - tall : box.y + (box.h - tall) / 2;
    for (const b of tops) {
      const x = at.endsWith("left") ? box.x + inset : at.endsWith("right") ? box.x + box.w - inset - b.w : box.x + (box.w - b.w) / 2;
      ctx.shift(b, x - b.x, y - b.y);
      y += b.h + OVERLAP_GAP;
    }
    box.children = [base, ...tops];
  },
};

/** row's and grid's stretch prop. */
const STRETCH = { type: "boolean", default: false, description: "Cards side by side share the tallest one's height, for panels that should line up." } as const;

export const row: ComponentDef = {
  type: "row",
  category: "layout",
  description: "Places children side by side, splitting the width equally. On narrow screens they wrap; cards keep their own height, top-aligned.",
  props: {
    gap: gapProp(10),
    pad: padProp(0),
    align: { type: "enum", values: ROW_ALIGN, default: "center", description: "Vertical alignment of children: top, center or bottom." },
    wrap: { type: "boolean", default: true, description: "Move children onto more lines when they don't fit side by side (default true). Set false to always keep them on one line." },
    fit: { type: "boolean", default: false, description: "Keep children at their natural width." },
    justify: { type: "enum", values: ROW_JUSTIFY, description: "Where children sit: start, end, or between (spread). Implies fit." },
    stretch: STRETCH,
  },
  children: "any",
  example: `row gap=10
  button "Cancel" variant=secondary
  button "Save"`,
  semantics: () => null,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    rowLayout(box, ctx, p.num("pad", 0), p.num("gap", ctx.theme.gaps?.row ?? 10), p.oneOf("align", ROW_ALIGN, "center"), p.bool("wrap", true), {
      fit: p.bool("fit", false),
      justify: ROW_JUSTIFY.find((v) => v === p.str("justify")),
      stretch: p.bool("stretch", ctx.theme.stretchCards ?? false),
      aligned: p.has("align"),
    });
  },
  minWidth(node, ctx) {
    const p = ctx.props(node);
    return rowMinWidth(node, ctx, p.num("pad", 0), p.num("gap", ctx.theme.gaps?.row ?? 10), p.bool("wrap", true));
  },
};

export const each: ComponentDef = {
  type: "each",
  category: "layout",
  description: "Repeats what's inside it once per item of a list, in place, with no look of its own; inside, the current item is called item (or the name given by as=). if= on each keeps only the items it's true for: each items=tasks as=t if={owner == 'All' || t.owner == owner}.",
  props: {
    items: { type: "expression", required: true, description: "The list to repeat over, like todos or {cart}." },
    as: { type: "name", default: "item", description: "Name for the current item, used inside: as=t makes {t.text} work." },
    index: { type: "name", description: "Name for the item's position, counting from 0." },
    key: { type: "expression", description: "A value unique to each item, like {t.id}, so focus stays with the item when the list changes. Defaults to the position." },
  },
  children: "any",
  example: `state gear=[{name: "Tent", kg: 2.1}, {name: "Stove", kg: 0.4}, {name: "Headlamp", kg: 0.1}]
column gap=6
  each items=gear as=g index=i key={g.name}
    text "{i + 1}. {g.name}, {g.kg} kg"`,
  // Containers replace each with its copies before laying out, so this only
  // runs if an each is laid out directly; it takes no space then.
  // Stands for its copies, which are laid out in its place.
  semantics: () => null,
  layout(box) {
    box.h = 0;
  },
};

const CARD_VARIANTS = ["raised", "hero", "tinted", "outline", "glass"] as const;
type CardVariant = (typeof CARD_VARIANTS)[number];

/** How strongly a card's variant tints it toward the accent, light and dark: its wash, and for a hero the glow in its top corner. */
function cardTint(variant: CardVariant, dark: boolean, bold = false): { wash: number; glow: number } | null {
  // Under look mood=bold the hero's accent gradient is meant to show, not read as a flat tint:
  // a wash about three times as strong (text contrast on it is checked in test/hero-bold.test.ts).
  if (variant === "hero" && bold) return dark ? { wash: HERO_BOLD_WASH.dark, glow: 0.24 } : { wash: HERO_BOLD_WASH.light, glow: 0.16 };
  if (variant === "hero") return dark ? { wash: 0.13, glow: 0.2 } : { wash: 0.075, glow: 0.12 };
  if (variant === "tinted") return dark ? { wash: 0.07, glow: 0 } : { wash: 0.075, glow: 0 };
  return null;
}

/** How strongly a hero card under look mood=bold lays its accent gradient over the card. */
export const HERO_BOLD_WASH = { light: 0.22, dark: 0.3 } as const;

/** Under look mood=bold, unless a forced-colors mode has put the person's own colors in. */
const isBold = (theme: Theme) => theme.mood === "bold" && !theme.name.endsWith("-forced-colors");

const boldHero = new WeakMap<Theme, Theme>();
/** The theme a bold hero's lifted theme came from, for drawing the card itself. */
const heroBase = new WeakMap<Theme, Theme>();
/** The text colors a bold hero lifts: muted words and the tones (tone=accent, good, warn, bad). */
const BOLD_HERO_TONES = ["muted", "accent", "good", "warn", "bad"] as const;
/**
 * The theme inside a hero card under look mood=bold: its muted and tone
 * colors (accent, good, warn, bad) each moved toward ink (5% at a time) until it reads at AA (4.55, as the scrim checks)
 * on both ends of the wash and on the glowing corner. Ink already does.
 */
export function boldHeroTheme(theme: Theme): Theme {
  let out = boldHero.get(theme);
  if (out) return out;
  const c = theme.colors;
  const dark = isDarkTheme(theme);
  const wash = dark ? HERO_BOLD_WASH.dark : HERO_BOLD_WASH.light;
  const ends = [c.accent, c.accent2].map((a) => mixColors(c.raised, a, wash) ?? c.raised);
  const bgs = [...ends, mixColors(ends[0]!, c.accent, dark ? 0.24 : 0.16) ?? ends[0]!];
  const reads = (color: string) => bgs.every((bg) => (contrastRatio(color, bg) ?? 0) >= 4.55);
  const lifted: Partial<Theme["colors"]> = {};
  for (const k of BOLD_HERO_TONES) {
    let color = c[k];
    for (let t = 0.05; !reads(color) && t <= 1.0001; t += 0.05) color = mixColors(c[k], c.ink, t) ?? c.ink;
    if (color !== c[k]) lifted[k] = color;
  }
  out = Object.keys(lifted).length ? { ...theme, colors: { ...c, ...lifted } } : theme;
  if (out !== theme) heroBase.set(out, theme);
  boldHero.set(theme, out);
  return out;
}

/** The fill a card paints, when it has one and the theme gives it (not in a forced-colors mode): the theme it's worked out from, and its name. */
function cardFill(box: Box, theme: Theme): { base: Theme; name: FillName } | null {
  const name = box.node.props.fill;
  if (!isFillName(name)) return null;
  const src = fillSource(theme);
  return src && src.name === name ? src : null;
}

/** A color at no opacity, for a gradient that fades it out (the same color at 0 avoids fading through gray). */
function clearOf(color: string): string {
  const c = parseColor(color);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)` : "rgba(0, 0, 0, 0)";
}

/**
 * A glass card's surface: what's behind, blurred (where the engine can), under
 * a tint of the raised color strong enough that its text reads over any
 * backdrop; a stronger tint where nothing is blurred, and solid for a person
 * who prefers less transparency.
 */
function paintGlass(box: Box, ctx: PaintContext): void {
  const { g, theme } = ctx;
  const path = () => ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
  const tint = glassAlpha(theme);
  const alpha = ctx.reducedTransparency ? 1 : ctx.backdrop?.(box, path, GLASS_BLUR) ? tint.blur : tint.fallback;
  path();
  g.save();
  g.fillStyle = theme.colors.raised;
  g.globalAlpha *= alpha;
  g.fill();
  g.restore();
}

/** A raised card's fill: the raised color, a shade toward ink at the bottom. */
function raisedFinish(g: CanvasRenderingContext2D, box: Box, theme: Theme): CanvasGradient {
  const c = theme.colors;
  const finish = g.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  finish.addColorStop(0, c.raised);
  finish.addColorStop(1, mixColors(c.raised, c.ink, 0.018) ?? c.raised);
  return finish;
}

export const card: ComponentDef = {
  type: "card",
  category: "layout",
  description: "A surface that groups related content, stacked vertically. Give it on= to make the whole card pressable.",
  props: {
    gap: gapProp(14),
    pad: padProp(22),
    variant: { type: "enum", values: CARD_VARIANTS, default: "raised", description: "raised (default), hero (an accent wash for the one card that leads the screen; a clear gradient in a bold look), tinted (a quiet accent fill for a side group), outline (a border only) or glass (frosted: what's behind shows through, blurred, as in a dock over a picture)." },
    on: onProp("when the card is pressed"),
    tone: { type: "enum", values: PILL_TONES, description: "Color role of a left edge stripe." },
    fill: { type: "enum", values: FILLS, description: "A gradient from the theme that sets a mood, by name, never a color: card fill=sky for today's weather. Words inside switch to colors that read on it." },
  },
  children: "any",
  example: `card variant=hero
  text "Order summary" style=title
  text "2 items" tone=muted
card on=emit:open_order
  text "Trail runner socks" weight=semibold
  text "Arrives Thursday" tone=muted`,
  check(props) {
    if (!isFillName(props.fill) || props.variant === undefined || props.variant === "raised") return [];
    return props.variant === "glass"
      ? ["fill= and variant=glass don't mix; the fill was used. Keep one of them"]
      : [`fill= takes the place of variant=${props.variant}; the fill was used. Keep one of them`];
  },
  theme(theme, node) {
    // A fill: the words inside take colors that read on its gradient (the theme's own, unchanged in a forced-colors mode).
    if (isFillName(node.props.fill)) return onFillTheme(theme, node.props.fill);
    // Glass: the quieter text colors lift toward ink until they read through the tint over any backdrop.
    if (node.props.variant === "glass") return glassTheme(theme);
    // A bold hero's stronger wash: muted and toned words inside lift toward ink until they hold AA on it.
    return node.props.variant === "hero" && isBold(theme) ? boldHeroTheme(theme) : theme;
  },
  semantics(box, ctx) {
    // A pressable card is a button named by everything in it; otherwise it's only a surface.
    return box.node.props.on ? { role: "button", name: ctx.textWithin(box) } : null;
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    // The host already frames the view (bareRootCard): the one top-level card adds no padding.
    // A fill or glass is the card's own content (its words take colors for it), so it keeps its surface even then.
    const own = isFillName(box.node.props.fill) || box.node.props.variant === "glass";
    const bare = !own && (ctx.bare?.(box.node) ?? false);
    stack(box, ctx, bare ? 0 : p.num("pad", ctx.theme.space.lg), p.num("gap", ctx.theme.space.md));
    if (bare) box.data = { ...box.data, bare: true };
    markTablesInsideCard(box);
  },
  surface(box, ctx) {
    // A bold hero's own wash is drawn in the host's colors, not the lifted ones its words use.
    const c = (heroBase.get(ctx.theme) ?? ctx.theme).colors;
    // A bare card has no fill: what's in it sits on the page.
    if (box.data?.bare) return c.surface;
    // A fill's theme already has the gradient's middle as raised.
    if (cardFill(box, ctx.theme)) return undefined;
    const variant = ctx.props(box.node).oneOf("variant", CARD_VARIANTS, "raised");
    // An outline card has no fill: what's in it sits on the page.
    if (variant === "outline") return c.surface;
    const tint = cardTint(variant, isDarkTheme(ctx.theme), isBold(ctx.theme));
    if (!tint) return undefined;
    // Children sit on the middle of the wash.
    return mixColors(c.raised, mixColors(c.accent, c.accent2, 0.5) ?? c.accent, tint.wash) ?? undefined;
  },
  paint(box, ctx) {
    // No border, shadow or fill: the chat app around the view is the frame.
    if (box.data?.bare) {
      if (ctx.props(box.node).has("on")) ctx.addHit(box);
      return;
    }
    const { g } = ctx;
    const theme = heroBase.get(ctx.theme) ?? ctx.theme;
    const c = theme.colors;
    const p = ctx.props(box.node);
    const fill = cardFill(box, theme);
    // A fill paints as a raised card with the gradient in place of its finish, and no accent wash.
    const chosen = fill ? "raised" : p.oneOf("variant", CARD_VARIANTS, "raised");
    // In a forced-colors mode glass is a plain card in the person's colors.
    const variant = chosen === "glass" && isForcedColors(theme) ? "raised" : chosen;
    const pressable = p.has("on");
    // Hairline (theme.surfaces lines: chats and host pages): a plain card is a 1px line, with no fill, shadow or highlight.
    const hairline = variant === "raised" && !fill && theme.surfaces === "lines";
    // Glass before anything else: the card's own hover tween below asks for frames, which would keep its backdrop from being reused.
    if (variant === "glass") paintGlass(box, ctx);
    const hovered = pressable && ctx.isHovered(box.node);
    const lift = ctx.tween(box.node, "card:hover", hovered ? 1 : 0, MOTION.hover);
    const press = ctx.tween(box.node, "card:press", pressable && ctx.isPressed(box.node) ? 1 : 0, MOTION.press);
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
    const tint = fill ? null : cardTint(variant, isDarkTheme(theme), isBold(theme));
    if (hairline) {
      // Nothing under the line: the card's inside is the page (raised is the surface color here).
    } else if (variant === "raised" || variant === "hero") {
      // A close, crisp shadow and a faint wide one: the card sits just above the page. Both stay
      // inside the screen's 20px padding. A pressable card lifts a little more under the pointer.
      g.save();
      g.fillStyle = (fill && fillGradient(g, fill.base, fill.name, box)) || raisedFinish(g, box, theme);
      g.shadowColor = c.shadow;
      g.shadowBlur = 10 + 8 * lift - 3 * press;
      g.shadowOffsetY = 2 + 2 * lift - press;
      g.fill();
      g.shadowBlur = 1;
      g.shadowOffsetY = 1;
      g.fill();
      g.restore();
    } else if (variant === "tinted") {
      g.fillStyle = c.raised;
      g.fill();
    }
    if (tint) {
      // The wash runs corner to corner, from the accent toward accent2 (flat when they're the same).
      g.save();
      const wash = g.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      wash.addColorStop(0, c.accent);
      wash.addColorStop(1, c.accent2);
      g.fillStyle = wash;
      g.globalAlpha *= tint.wash;
      g.fill();
      g.restore();
    }
    if (tint && tint.glow > 0) {
      // A soft light from the top corner, the way a lit panel reads.
      g.save();
      const r = Math.max(box.w, box.h) * 0.9;
      const glow = g.createRadialGradient(box.x, box.y, 0, box.x, box.y, r);
      glow.addColorStop(0, c.accent);
      glow.addColorStop(1, clearOf(c.accent));
      g.fillStyle = glow;
      g.globalAlpha *= tint.glow;
      g.fill();
      g.restore();
    }
    if (press > 0) fillTint(g, c.ink, 0.035 * press);
    // A fine upper highlight adds depth without a second container or extra layout.
    if (!hairline && (variant === "raised" || variant === "hero" || variant === "glass") && box.w > 36 && box.h > 10) {
      g.save();
      g.beginPath();
      g.moveTo(box.x + 16, box.y + 1.5);
      g.lineTo(box.x + box.w - 16, box.y + 1.5);
      g.strokeStyle = variant === "hero" ? c.accent : c.ink;
      g.globalAlpha *= (variant === "hero" ? 0.22 : variant === "glass" ? 0.1 : 0.055) + 0.045 * lift;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      // The highlight replaced the path: the border goes round the card again, not along the
      // highlight (which drew a short dark line across the top, with gaps at the corners).
      ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
    }
    if (variant !== "tinted") {
      g.strokeStyle = variant === "hero" ? c.accent : c.line;
      g.lineWidth = 1;
      // Softer perimeter; elevation and spacing separate cards from the canvas.
      g.save();
      g.globalAlpha *= variant === "hero" ? 0.28 : hairline || variant === "outline" || variant === "glass" ? 1 : 0.72;
      g.stroke();
      g.restore();
    }
    if (lift > 0) {
      // Emphasize elevation and contrast, not content movement.
      g.save();
      g.globalAlpha *= 0.18 * lift;
      g.strokeStyle = c.ink;
      g.stroke();
      g.restore();
    }
    if (p.has("tone")) {
      // A stripe down the left edge, cut to the card's rounded corners.
      g.save();
      ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
      g.clip();
      g.fillStyle = toneColor(theme, p.oneOf("tone", PILL_TONES, "accent"));
      g.fillRect(box.x, box.y, theme.space.xs, box.h);
      g.restore();
    }
    if (pressable) ctx.addHit(box);
  },
};

export const divider: ComponentDef = {
  type: "divider",
  category: "layout",
  description: "A thin horizontal line separating sections.",
  text: { description: "A label centred on the line." },
  props: {},
  example: "divider",
  semantics(box, ctx) {
    const label = ctx.props(box.node).text();
    return label ? { role: "separator", name: label } : false;
  },
  layout(box, ctx) {
    box.h = ctx.props(box.node).text() ? DIVIDER_LABEL_H : 1;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const label = ctx.props(box.node).text();
    g.fillStyle = theme.colors.line;
    if (!label) { g.fillRect(box.x, box.y, box.w, 1); return; }
    // The line runs either side of the label, with a gap round it.
    g.font = ctx.font(400, theme.text.caption);
    const gap = theme.space.sm;
    const shown = ellipsize(label, Math.max(0, box.w - gap * 2 - 40), g.font, { width: (t) => g.measureText(t).width });
    const w = g.measureText(shown).width;
    const mid = box.y + box.h / 2, left = box.x + (box.w - w) / 2;
    g.fillRect(box.x, Math.round(mid), Math.max(0, left - gap - box.x), 1);
    g.fillRect(left + w + gap, Math.round(mid), Math.max(0, box.x + box.w - (left + w + gap)), 1);
    g.fillStyle = theme.colors.muted;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(shown, left, mid + 1);
  },
};

/** A divider with a label is as tall as a line of caption text. */
const DIVIDER_LABEL_H = 18;

export const spacer: ComponentDef = {
  type: "spacer",
  category: "layout",
  description: "Empty vertical space.",
  props: { size: { type: "number", default: 8, description: "Height in pixels (default 8)." } },
  example: "spacer size=16",
  semantics: () => false,
  layout(box, ctx) {
    box.h = Math.max(0, ctx.props(box.node).num("size", 8));
  },
};

/** A grid column's narrowest width unless min= says otherwise: two stats side by side on a phone. */
export const GRID_MIN = 150;

export const grid: ComponentDef = {
  type: "grid",
  category: "layout",
  description: "Places children in responsive equal columns. Cards keep their own height, top-aligned.",
  props: {
    min: { type: "number", default: GRID_MIN, description: `Narrowest a column may be, in pixels (default ${GRID_MIN}).` },
    cols: { type: "number", description: "Most columns; fewer when min doesn't fit." },
    gap: gapProp(14),
    stretch: STRETCH,
  },
  children: "any",
  example: `grid min=140 gap=10
  stat label="Orders" value=12
  stat label="Returns" value=1
  stat label="Rating" value=4.8`,
  semantics: () => null,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const gap = Math.max(0, p.num("gap", ctx.theme.gaps?.grid ?? 14));
    const stretch = p.bool("stretch", ctx.theme.stretchCards ?? false);
    const kids = ctx.visibleChildren(box.node);
    // A column is never narrower than its widest child needs, whatever min= says.
    const min = Math.max(1, p.num("min", GRID_MIN), ...kids.map((k) => Math.min(box.w, ctx.minWidth(k))));
    const wanted = Math.floor(p.num("cols", 0));
    const fits = Math.max(1, Math.min(kids.length || 1, Math.floor((box.w + gap) / (min + gap))));
    const most = wanted >= 1 ? Math.min(wanted, fits) : fits;
    // Balance the rows: as many as the columns need, filled so they differ by at most one.
    const rows = Math.max(1, Math.ceil(kids.length / most));
    const cols = Math.max(1, Math.ceil(kids.length / rows));
    const cw = Math.max(0, (box.w - gap * (cols - 1)) / cols);
    const sizes = Array.from({ length: rows }, (_, r) => Math.floor(kids.length / rows) + (r < kids.length % rows ? 1 : 0));
    let y = box.y;
    for (let r = 0, start = 0; r < rows; start += sizes[r]!, r++) {
      if (r) y += gap;
      let tallest = 0;
      const placed: Box[] = [];
      kids.slice(start, start + sizes[r]!).forEach((k, i) => {
        const kb = ctx.layout(k, box.x + i * (cw + gap), y, cw);
        box.children.push(kb);
        placed.push(kb);
        tallest = Math.max(tallest, kb.h);
      });
      // stretch=true: a sparkline or donut legend in one card leaves no ragged bottoms on its
      // neighbouring panels. Children stay top-aligned within each card. Off by default, since a
      // short card stretched beside a tall one is mostly empty space.
      if (stretch && placed.length > 1 && placed.every((k) => k.node.type === "card")) {
        for (const k of placed) k.h = tallest;
      }
      y += tallest;
    }
    box.h = y - box.y;
  },
};

export const list: ComponentDef = {
  type: "list",
  category: "layout",
  description: "A bordered list of rows, separated by lines; inside a card, only the lines. Use list-item children; any other element (a row, a check) becomes a row of its own.",
  props: {},
  children: "any",
  example: `list
  list-item "Trail runner socks" detail="Merino blend" trailing="$24"
  list-item "Rain shell" detail="Packs into its pocket" trailing="$129" on=emit:open_shell`,
  semantics(box) {
    // A list of list-items; anything else in it reads as it is.
    return box.children.length && box.children.every((c) => c.node.type === "list-item") ? { role: "list" } : null;
  },
  layout(box, ctx) {
    // A list-item brings its own padding; anything else gets the same, so every row lines up.
    const { listPadX: padX, listPadY: padY } = sizesOf(ctx.theme);
    const place = () => {
      const rows: ListRow[] = [];
      box.children.length = 0;
      let y = box.y;
      for (const k of ctx.visibleChildren(box.node)) {
        const own = k.type === "list-item";
        const kb = own ? ctx.layout(k, box.x, y, box.w) : ctx.layout(k, box.x + padX, y + padY, box.w - padX * 2);
        box.children.push(kb);
        rows.push({ y, inset: padX + (own ? ((kb.data as { iconW?: number } | undefined)?.iconW ?? 0) : 0) });
        y += own ? kb.h : kb.h + padY * 2;
      }
      box.data = { rows };
      box.h = y - box.y;
    };
    place();
    // One row too narrow for its buttons beside its title: lay them all out with the buttons under, so they line up.
    const some = box.children.some((c) => (c.data as { actionsUnder?: boolean } | undefined)?.actionsUnder);
    const others = box.children.some((c) => ((c.data as { actionsW?: number } | undefined)?.actionsW ?? 0) > 0);
    if (some && others && !actionsUnder) {
      actionsUnder = true;
      try { place(); } finally { actionsUnder = false; }
    }
  },
  paint(box, ctx) {
    // Inside a card the card is the frame: no second panel in it, only the row lines.
    if (box.data?.embeddedInCard) return;
    const { g, theme } = ctx;
    // Hairline: no panel, only the frame drawn over the rows.
    if (theme.surfaces === "lines") return;
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    g.fillStyle = theme.colors.raised;
    g.fill();
  },
  paintOver(box, ctx) {
    const { g, theme } = ctx;
    // Separators are lighter than the frame, so rows read as one group.
    g.save();
    g.globalAlpha *= 0.7;
    g.fillStyle = theme.colors.line;
    const rows = (box.data as { rows?: ListRow[] } | undefined)?.rows ?? [];
    rows.slice(1).forEach((r) => g.fillRect(box.x + r.inset, r.y, box.w - r.inset, 1));
    g.restore();
    if (box.data?.embeddedInCard) return;
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    g.strokeStyle = theme.colors.line;
    g.lineWidth = 1;
    g.stroke();
  },
};

/** Between the title and the detail when they share a line (theme.listInline). */
const ITEM_INLINE_GAP = 10;
/** On a phone, a pressable row is at least this tall (a comfortable tap), with its text in the middle. */
const ITEM_TAP = 44;
/** Icon-only buttons at a row's right end: at most this many, this far apart and from the value before them. */
const ITEM_ACTIONS = 2, ITEM_ACTION_GAP = 8;

/**
 * Set while a list lays its rows out again because one row had to put its actions under its title:
 * then every row does, so the buttons line up down the list. Layout runs synchronously, so a list
 * sets it around its second pass and clears it in finally.
 */
let actionsUnder = false;

/** An icon-only button (icon=, label=, no text): inside a list-item it sits at the row's right end. */
function isRowAction(node: SayShapeNode, ctx: { props(n: SayShapeNode): { text(): string; str(k: string): string } }): boolean {
  if (node.type !== "button") return false;
  const p = ctx.props(node);
  return !p.text() && isIconName(p.str("icon"));
}
/** Where a list's row starts, and how far in its separator begins. */
interface ListRow { y: number; inset: number }

export const listItem: ComponentDef = {
  type: "list-item",
  category: "layout",
  description: "One row of a list: a title, an optional detail line and value on the right, and anything inside it (a badge, a check, a row) under the title, except an icon-only button (icon= and label=), which sits at the right end. Give it on= to make it pressable.",
  text: { description: "The row's title.", required: true },
  props: {
    detail: { type: "string", description: "A second, quieter line under the title." },
    trailing: { type: "string", description: "A short value on the right, like a price or a count." },
    tone: { type: "enum", values: PILL_TONES, description: "Draws trailing as a badge in this color role." },
    icon: iconProp,
    on: onProp("when the row is pressed"),
  },
  parents: ["list"],
  children: "any",
  example: `list-item "Rain shell" detail="Packs into its pocket" trailing="$129" icon=package on=emit:open_shell
list-item "Groceries" detail="Food" trailing="$142"
  button icon=trash label="Remove Groceries" variant=secondary size=sm on=emit:remove`,
  check: (props) => iconProblems(props.icon, "icon"),
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const name = [p.text(), p.str("detail"), p.str("trailing")].filter(Boolean).join(", ");
    if (!box.node.props.on) return { role: "listitem", name };
    // A pressable row is a button inside its list item, so the list still reads as a list.
    return { role: "listitem", detail: "row", parts: [{ detail: undefined, role: "button", name }] };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const { listPadX: padX, listPadY: padY, listIcon, listIconGap } = sizesOf(t);
    const titleFont = themeFont(t, 600, t.text.body), detailFont = themeFont(t, 400, 13);
    const trailing = p.str("trailing");
    const pillW = p.has("tone") && trailing ? pillWidth(ctx, trailing, null) : 0;
    const trailingW = trailing ? (pillW || ctx.measure.width(trailing, titleFont)) + 12 : 0;
    const chevronW = p.has("on") ? 20 : 0;
    const iconW = isIconName(p.str("icon")) ? listIcon + listIconGap : 0;
    // Icon-only buttons (a remove, an edit) go at the right end, before any chevron; everything else goes under the title.
    const kids = ctx.visibleChildren(box.node);
    let actions = kids.filter((k) => isRowAction(k, ctx)).slice(0, ITEM_ACTIONS);
    let actionWidths = actions.map((a) => ctx.minWidth(a));
    let actionsW = actions.length ? actionWidths.reduce((a, b) => a + b, 0) + ITEM_ACTION_GAP * actions.length : 0;
    let textW = Math.max(40, box.w - padX * 2 - trailingW - chevronW - iconW - actionsW);
    // In a narrow row the title comes first: if a word of it wouldn't fit beside the actions (it
    // would break mid-word), they go under the title instead, as any other child does.
    const under = actions.length > 0 && (actionsUnder || Math.max(...p.text().split(/\s+/).map((w) => ctx.measure.width(w, titleFont))) > textW);
    if (under) {
      textW += actionsW;
      actions = []; actionWidths = []; actionsW = 0;
    }
    const titleLH = Math.round(t.text.body * 1.35), detailLH = 18;
    // The chat density: title, detail and trailing value on one line when they fit, else as below.
    const titleW = t.listInline && p.has("detail") ? ctx.measure.width(p.text(), titleFont) : 0;
    const inline = titleW > 0 && titleW + ITEM_INLINE_GAP + ctx.measure.width(p.str("detail"), detailFont) <= textW;
    const title = inline ? [p.text()] : wrapText(p.text(), textW, titleFont, ctx.measure);
    const detail = inline ? [p.str("detail")] : p.has("detail") ? wrapText(p.str("detail"), textW, detailFont, ctx.measure) : [];
    const data = { title, detail, titleFont, detailFont, titleLH, detailLH, trailing, iconW, pillW, actionsW, padX, top: padY, icon: listIcon, ...(under ? { actionsUnder: true } : {}), ...(inline ? { detailX: titleW + ITEM_INLINE_GAP } : {}) };
    box.data = data;
    let y = box.y + padY + title.length * titleLH + (detail.length && !inline ? 2 + detail.length * detailLH : 0);
    // Elements inside go under the text, lined up with it.
    const left = padX + iconW;
    let below = 0;
    for (const k of kids) {
      if (actions.includes(k)) continue;
      y += 8;
      const kb = ctx.layout(k, box.x + left, y, Math.max(40, box.w - left - padX - chevronW - actionsW));
      box.children.push(kb);
      y += kb.h;
      below++;
    }
    box.h = y - box.y + padY;
    // On a phone a pressable row is a comfortable tap: it grows to ITEM_TAP, its text in the middle
    // (a row with elements under its title is taller than that already, so it only grows at the bottom).
    if (p.has("on") && ctx.screenWidth() < PHONE_WIDTH && box.h < ITEM_TAP) {
      if (!below) data.top = padY + (ITEM_TAP - box.h) / 2;
      box.h = ITEM_TAP;
    }
    // The row grows to hold its tallest action with a little room, and each sits in its middle, right to left.
    let right = box.x + box.w - padX - chevronW;
    const placed: Box[] = [];
    actions.forEach((a, i) => {
      const w = actionWidths[i]!;
      const kb = ctx.layout(a, right - w, box.y, w);
      placed.push(kb);
      right -= w + ITEM_ACTION_GAP;
    });
    if (placed.length) {
      box.h = Math.max(box.h, ...placed.map((kb) => kb.h + 8));
      for (const kb of placed) kb.y = box.y + (box.h - kb.h) / 2;
      // Read after the title and anything under it, in the order they sit, left to right.
      box.children.push(...placed.reverse());
    }
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as { title: string[]; detail: string[]; titleFont: string; detailFont: string; titleLH: number; detailLH: number; trailing: string; iconW: number; pillW: number; actionsW?: number; detailX?: number; padX: number; top: number; icon: number };
    const p = ctx.props(box.node);
    const pressable = p.has("on");
    if (pressable) {
      const hovered = ctx.isHovered(box.node);
      const highlight = ctx.tween(box.node, "list:hover", hovered ? 1 : 0, MOTION.hover);
      const pressed = ctx.tween(box.node, "list:press", ctx.isPressed(box.node) ? 1 : 0, MOTION.press);
      if (highlight || pressed) {
        ctx.roundRect(box.x + 2, box.y + 1, box.w - 4, box.h - 2, theme.radius.sm);
        fillTint(g, c.ink, 0.03 * highlight + 0.045 * pressed);
      }
    }
    // A leading icon in the accent, level with the title's first line.
    const name = p.str("icon");
    if (d.iconW && isIconName(name)) drawIcon(g, name, box.x + d.padX, box.y + d.top + (d.titleLH - d.icon) / 2, d.icon, c.accent);
    const tx = box.x + d.padX + d.iconW;
    g.textAlign = "left";
    g.textBaseline = "middle";
    let y = box.y + d.top;
    g.font = d.titleFont;
    g.fillStyle = c.ink;
    for (const l of d.title) { g.fillText(l, tx, y + d.titleLH / 2); y += d.titleLH; }
    if (d.detailX !== undefined) {
      // On the title's line, after it.
      g.font = d.detailFont;
      g.fillStyle = c.muted;
      g.fillText(d.detail[0] ?? "", tx + d.detailX, box.y + d.top + d.titleLH / 2);
    } else if (d.detail.length) {
      y += 2;
      g.font = d.detailFont;
      g.fillStyle = c.muted;
      for (const l of d.detail) { g.fillText(l, tx, y + d.detailLH / 2); y += d.detailLH; }
    }
    const right = box.x + box.w - d.padX - (pressable ? 20 : 0) - (d.actionsW ?? 0);
    if (d.trailing && d.pillW) {
      // A tagged value is a badge, level with the title's first line.
      const w = d.pillW, h = sizesOf(theme).badge;
      paintPill(ctx, { x: right - w, y: box.y + d.top + (d.titleLH - h) / 2, w, h }, d.trailing, toneColor(theme, p.oneOf("tone", PILL_TONES, "accent")), "soft", null);
    } else if (d.trailing) {
      g.font = d.titleFont;
      g.textAlign = "right";
      g.fillStyle = c.ink;
      g.fillText(d.trailing, right, box.y + d.top + d.titleLH / 2);
    }
    if (pressable) {
      chevron(g, box.x + box.w - d.padX - 4, box.y + box.h / 2, 10, "right", c.muted);
      ctx.addHit(box);
    }
  },
};

const ACCORDION_DETAIL_LH = 18;

export const accordion: ComponentDef = {
  type: "accordion",
  category: "layout",
  description: "A heading that shows or hides the content under it when pressed. Stack several for an FAQ.",
  text: { description: "The heading.", required: true },
  props: {
    bind: { type: "state", required: true, description: "A true/false state name: true while open." },
    gap: gapProp(10),
    on: onProp("after it opens or closes"),
    detail: detailProp("title"),
  },
  children: "any",
  example: `state returns=true
accordion "Returns" bind=returns
  text "Free returns within 30 days, unworn."
accordion "Shipping" bind=shipping
  text "Ships in two business days."`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    return { role: "group", parts: [{ detail: "header", role: "button", name: [p.text(), p.str("detail")].filter(Boolean).join(", "), expanded: !!p.bound() }] };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const open = !!p.bound();
    const t = ctx.theme;
    const font = themeFont(t, 600, t.text.body);
    const lines = wrapText(p.text(), Math.max(40, box.w - 32), font, ctx.measure);
    const lh = Math.round(t.text.body * 1.35);
    const detail = p.has("detail") ? fitLines(p.str("detail"), Math.max(40, box.w - 32), themeFont(t, 400, 13), ctx.measure, 2) : [];
    // The room around the title shrinks with a shorter header (24 at the default 48, 12 at 36), so the size holds for one line.
    const least = sizesOf(t).accordionHeader;
    const headerH = Math.max(least, lines.length * lh + detail.length * ACCORDION_DETAIL_LH + Math.max(8, Math.min(24, least - 24)));
    box.data = { lines, font, lh, headerH, open, detail };
    if (!open) { box.h = headerH; return; }
    const gap = Math.max(0, p.num("gap", 10));
    let y = box.y + headerH;
    ctx.visibleChildren(box.node).forEach((k, i) => {
      if (i) y += gap;
      const kb = ctx.layout(k, box.x, y, box.w);
      box.children.push(kb);
      y += kb.h;
    });
    box.h = y - box.y + (box.children.length ? 14 : 0);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const d = box.data as { lines: string[]; font: string; lh: number; headerH: number; open: boolean; detail: string[] };
    const header = partBox(box, box.x, box.y, box.w, d.headerH);
    if (ctx.isHovered(box.node, "header")) {
      ctx.roundRect(header.x - 6, header.y + 2, header.w + 12, header.h - 4, theme.radius.sm);
      fillTint(g, c.ink, 0.035);
    }
    g.font = d.font;
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    // The title and its detail line are centred in the header together.
    const textH = d.lines.length * d.lh + d.detail.length * ACCORDION_DETAIL_LH;
    const top = box.y + (d.headerH - textH) / 2;
    d.lines.forEach((l, i) => g.fillText(l, box.x, top + d.lh * i + d.lh / 2));
    if (d.detail.length) {
      g.font = ctx.font(400, 13);
      g.fillStyle = c.muted;
      d.detail.forEach((l, i) => g.fillText(l, box.x, top + d.lines.length * d.lh + ACCORDION_DETAIL_LH * i + ACCORDION_DETAIL_LH / 2));
    }
    chevron(g, box.x + box.w - 10, box.y + d.headerH / 2, 10, d.open ? "up" : "down", c.muted);
    g.fillStyle = c.line;
    g.fillRect(box.x, box.y + box.h - 1, box.w, 1);
    ctx.addHit(header, { detail: "header" });
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key) return;
    ctx.set(key, !ctx.props(ctx.target.node).bound());
    runOn(ctx);
  },
};
