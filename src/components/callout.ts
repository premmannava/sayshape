/**
 * callout: the one thing to notice in an answer, on a softly tinted panel with
 * a hairline border in its tone's color and an optional icon.
 *
 *   callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true
 */
import type { ComponentDef, LayoutContext, PaintContext } from "../component";
import { easeOut, paintGhost } from "../ghost";
import { wrapText } from "../text";
import { sizesOf, type Theme } from "../theme";
import type { Box } from "../types";
import { fitText } from "./input";
import { fillTint, onProp, partBox, themeFont } from "./util";

/** info is the accent; accent is accepted as another name for it. */
const CALLOUT_TONES = ["info", "accent", "good", "warn", "bad"] as const;
type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Room before the content where a left bar used to be (none: the border carries the tone). */
const BAR = 0;
/** The icon's diameter and the action button's height: the theme's calloutIcon and calloutAction sizes. */
const iconOf = (t: Theme): number => sizesOf(t).calloutIcon;
const actionOf = (t: Theme): number => sizesOf(t).calloutAction;
/** The diameter the icon's symbols are drawn for; a smaller icon scales them down. */
const ICON_DRAWN = 18;

function calloutColor(theme: Theme, tone: CalloutTone): string {
  const c = theme.colors;
  return { info: c.accent, accent: c.accent, good: c.good, warn: c.warn, bad: c.bad }[tone];
}

interface CalloutLayout {
  lines: string[];
  detail: string[];
  font: string;
  detailFont: string;
  lh: number;
  detailLH: number;
  padX: number;
  padY: number;
  textX: number;
  icon: boolean;
  action: string;
  /** Where the action button starts under the text, relative to the panel's top. */
  actionTop: number;
}

function measure(box: Box, ctx: LayoutContext): CalloutLayout & { height: number } {
  const p = ctx.props(box.node);
  const t = ctx.theme;
  const padX = t.space.md, padY = t.space.sm + 2;
  const icon = p.bool("icon", false);
  const ICON = iconOf(t);
  const textX = BAR + padX + (icon ? ICON + t.space.sm : 0);
  const width = Math.max(20, box.w - textX - padX);
  const font = themeFont(t, 600, t.text.body);
  const detailFont = themeFont(t, 400, t.text.caption);
  const lh = Math.round(t.text.body * 1.35);
  const detailLH = Math.round(t.text.caption * 1.4);
  const loading = ctx.isLoading?.(box.node) ?? false;
  // While its data loads, keep a line for each part so little moves when it arrives.
  const text = p.text();
  const lines = text ? wrapText(text, width, font, ctx.measure) : [""];
  const detailText = p.str("detail");
  const detail = detailText ? wrapText(detailText, width, detailFont, ctx.measure) : loading && p.has("detail") ? [""] : [];
  const body = lines.length * lh + (detail.length ? t.space.xs + detail.length * detailLH : 0);
  const action = p.str("action");
  const above = padY + Math.max(body, icon ? ICON : 0);
  return {
    lines, detail, font, detailFont, lh, detailLH, padX, padY, textX, icon, action,
    actionTop: above + t.space.sm,
    height: above + (action ? t.space.sm + actionOf(t) : 0) + padY,
  };
}

/** The panel: a faint tint of the tone, outlined by a hairline of the same tone. */
function paintPanel(box: Box, ctx: PaintContext, color: string): void {
  const { g, theme } = ctx;
  ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
  fillTint(g, color, 0.052);
  g.save();
  g.globalAlpha *= 0.17;
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

/** A small symbol in a circle: i for info, a tick for good, ! for warn, × for bad. */
function paintIcon(ctx: PaintContext, tone: CalloutTone, cx: number, cy: number, color: string): void {
  const { g, theme } = ctx;
  const r = iconOf(theme) / 2;
  const k = (r * 2) / ICON_DRAWN;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.save();
  g.strokeStyle = theme.colors.onAccent;
  g.fillStyle = theme.colors.onAccent;
  g.lineWidth = 1.8;
  g.lineCap = "round";
  // The symbols are drawn for ICON_DRAWN; about the middle, so a smaller icon keeps them centred.
  g.translate(cx, cy);
  g.scale(k, k);
  g.translate(-cx, -cy);
  g.lineJoin = "round";
  g.beginPath();
  if (tone === "good") {
    g.moveTo(cx - 4.5, cy + 0.5);
    g.lineTo(cx - 1.5, cy + 3.5);
    g.lineTo(cx + 4.5, cy - 3.5);
    g.stroke();
  } else if (tone === "bad") {
    g.moveTo(cx - 3.5, cy - 3.5);
    g.lineTo(cx + 3.5, cy + 3.5);
    g.moveTo(cx + 3.5, cy - 3.5);
    g.lineTo(cx - 3.5, cy + 3.5);
    g.stroke();
  } else {
    // i is a dot over a stem; ! is a stem over a dot.
    const info = tone !== "warn";
    g.moveTo(cx, info ? cy - 1 : cy - 5);
    g.lineTo(cx, info ? cy + 5 : cy + 1);
    g.stroke();
    g.beginPath();
    g.arc(cx, info ? cy - 4.5 : cy + 4.5, 1.3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** The button under the text: drawn like a secondary button, so it's clearly pressable without competing with the takeaway. */
function paintAction(box: Box, ctx: PaintContext, d: CalloutLayout, pressable: boolean): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  g.font = ctx.font(600, theme.text.caption + 1);
  const room = Math.max(0, box.x + box.w - d.padX - (box.x + d.textX));
  const w = Math.min(room, g.measureText(d.action).width + theme.space.md * 2);
  const ACTION_H = actionOf(theme);
  const btn = partBox(box, box.x + d.textX, box.y + d.actionTop, w, ACTION_H);
  ctx.roundRect(btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1, theme.radius.md);
  g.save();
  g.shadowColor = c.shadow;
  g.shadowBlur = 2;
  g.shadowOffsetY = 1;
  g.fillStyle = c.raised;
  g.fill();
  g.restore();
  const hot = pressable && ctx.isHovered(box.node, "action");
  if (hot) fillTint(g, c.ink, 0.04);
  g.strokeStyle = ctx.isFocused(box.node, "action") ? c.focus : c.line;
  g.lineWidth = ctx.isFocused(box.node, "action") ? 2 : 1;
  g.stroke();
  g.fillStyle = c.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(fitText(g, d.action, w - theme.space.md), btn.x + w / 2, btn.y + ACTION_H / 2 + 1);
  if (pressable) ctx.addHit(btn, { detail: "action" });
}

export const callout: ComponentDef = {
  type: "callout",
  category: "content",
  description: "The one thing to notice in an answer: a key finding, a warning or a next step.",
  text: { description: "The takeaway, in one short sentence. May include {expressions}. Long text wraps.", required: true },
  props: {
    detail: { type: "string", description: "An optional second line in muted text, e.g. what the finding is based on." },
    tone: {
      type: "enum", values: CALLOUT_TONES, default: "info",
      description: "info (default, the accent color) for a finding, good for good news, warn for something to watch, bad for a problem. accent is the same as info.",
    },
    icon: { type: "boolean", default: false, description: "Show a small icon matching the tone: i, a tick, ! or ×." },
    action: { type: "string", description: "Label of a button inside it." },
    on: onProp("when the button is pressed"),
  },
  picks: [
    { for: "the one takeaway or warning to notice first", write: "callout tone=warn" },
  ],
  example: `callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true action="See breakdown" on=emit:open_breakdown`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const action = p.str("action");
    return {
      role: "note",
      name: p.text(),
      description: p.str("detail") || undefined,
      parts: action && p.has("on") ? [{ detail: "action", role: "button", name: action }] : undefined,
    };
  },
  layout(box, ctx) {
    const d = measure(box, ctx);
    box.data = { ...d };
    box.h = d.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const d = box.data as unknown as CalloutLayout;
    const tone = p.oneOf("tone", CALLOUT_TONES, "info");
    const color = calloutColor(theme, tone);
    paintPanel(box, ctx, color);
    // Just after its data arrived, the words fade in on the panel.
    const base = g.globalAlpha;
    g.globalAlpha = base * easeOut(ctx.reveal(box.node) * 2);
    const top = box.y + d.padY;
    const ICON = iconOf(theme);
    if (d.icon) paintIcon(ctx, tone, box.x + BAR + d.padX + ICON / 2, top + Math.max(d.lh, ICON) / 2, color);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.font = d.font;
    g.fillStyle = theme.colors.ink;
    const x = box.x + d.textX;
    d.lines.forEach((l, i) => g.fillText(l, x, top + d.lh * i + d.lh / 2 + 1));
    if (d.detail.length) {
      const dy = top + d.lines.length * d.lh + theme.space.xs;
      g.font = d.detailFont;
      g.fillStyle = theme.colors.muted;
      d.detail.forEach((l, i) => g.fillText(l, x, dy + d.detailLH * i + d.detailLH / 2 + 1));
    }
    if (d.action) paintAction(box, ctx, d, p.has("on"));
    g.globalAlpha = base;
  },
  paintLoading(box, ctx) {
    const p = ctx.props(box.node);
    const d = box.data as unknown as CalloutLayout;
    const tone = p.oneOf("tone", CALLOUT_TONES, "info");
    const color = calloutColor(ctx.theme, tone);
    // The panel is real (its tone doesn't depend on the data); the words are on their way.
    paintPanel(box, ctx, color);
    const top = box.y + d.padY, x = box.x + d.textX;
    const room = Math.max(0, box.x + box.w - d.padX - x);
    const pillH = 10;
    const ICON = iconOf(ctx.theme);
    paintGhost(ctx, { x, y: top, w: room, h: box.h - d.padY * 2 }, (s) => {
      if (d.icon) s.circle(box.x + BAR + d.padX + ICON / 2, top + Math.max(d.lh, ICON) / 2, ICON / 2);
      d.lines.forEach((_l, i) => {
        const last = i === d.lines.length - 1;
        s.pill(x, top + d.lh * i + (d.lh - pillH) / 2, last ? Math.min(room, Math.max(48, room * 0.7)) : room, pillH);
      });
      if (d.detail.length) {
        const dy = top + d.lines.length * d.lh + ctx.theme.space.xs;
        s.pill(x, dy + (d.detailLH - 8) / 2, Math.min(room, Math.max(40, room * 0.45)), 8);
      }
    });
  },
};
