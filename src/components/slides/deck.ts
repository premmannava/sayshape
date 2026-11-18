/**
 * deck: slides shown one at a time, with previous and next arrows and a dot
 * per slide in a bar under it. Which slide shows lives in state (bind=), the
 * way a carousel keeps its page; Left, Right, Home and End move between
 * slides while one of its controls has focus.
 *
 * Only the slide shown is laid out, so the others are neither drawn, pressed
 * nor read out.
 */
import type { ComponentDef, DragContext, PressContext } from "../../component";
import { toNumber } from "../../data";
import { drawIcon } from "../../icons";
import type { Box, SayShapeNode } from "../../types";
import { fillTint, onProp, partBox, runOn } from "../util";
import { fadeOf, placeOf } from "./slide";

interface DeckData {
  [key: string]: unknown;
  page: number;
  count: number;
  titles: string[];
  /** Where the bar under the slide starts, and how tall it is. */
  barY: number;
  barH: number;
}

/** Slides per deck, from its last layout, for the keys. */
const countOf = new WeakMap<SayShapeNode, number>();
/** Where a sideways swipe over a deck's slide started, while the finger or pointer is down. */
const swipeFrom = new WeakMap<SayShapeNode, number>();
/** How far sideways counts as a swipe to the next or previous slide, in pixels. */
export const SWIPE_DISTANCE = 48;
const TRANSITIONS = ["fade", "none"] as const;
/** How long a slide takes to fade in, in milliseconds. */
const FADE_MS = 260;

const dataOf = (b: Box): DeckData | undefined => b.data as DeckData | undefined;

function pageOf(raw: unknown, count: number): number {
  const n = Math.round(toNumber(raw as never));
  return Number.isFinite(n) ? Math.min(Math.max(0, n), Math.max(0, count - 1)) : 0;
}

function goTo(ctx: PressContext, page: number): void {
  const node = ctx.target.node;
  const p = ctx.props(node);
  const key = p.raw("bind");
  const count = countOf.get(node) ?? 1;
  const to = Math.min(Math.max(0, page), Math.max(0, count - 1));
  if (!key || to === pageOf(p.bound(), count)) return;
  ctx.set(key, to);
  runOn(ctx);
}

export const deck: ComponentDef = {
  type: "deck",
  category: "layout",
  description: "A slide deck: slides shown one at a time, with arrows and dots to move between them (and a sideways swipe on a touch screen), for presenting a story in a few steps, like a business review; put a slide per step inside it. State is shared by every slide, so one control, such as a segmented for the region, can change what all of them show, and a button with on=set:page:3 jumps to the fourth slide.",
  props: {
    bind: { type: "state", required: true, description: "The state name holding the slide shown, starting at 0." },
    numbers: { type: "boolean", default: true, description: "Show the slide's number, like 2 / 4, in its corner." },
    footer: { type: "string", description: "A short line in the bottom left of every slide, e.g. footer=\"Northwind · Confidential\"." },
    progress: { type: "boolean", default: false, description: "true draws a thin bar along the bottom of each slide showing how far through the deck it is." },
    transition: { type: "enum", values: TRANSITIONS, default: "fade", description: "fade (a slide fades in when moved to) or none." },
    on: onProp("after the slide changes"),
  },
  children: ["slide"],
  picks: [
    { for: "a presentation or slide deck, one idea per slide", write: "deck bind=page" },
  ],
  example: `state page=0
deck bind=page
  slide "Q3 business review" layout=title
    text "Revenue is up 18% on last year" style=lead tone=muted
  slide "Three numbers that sum up the quarter"
    grid min=220
      stat label="Revenue" value="$4.82M" change="+18%"
      stat label="New customers" value="312" change="+9%"`,
  minWidth: () => 240,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const slides = ctx.visibleChildren(box.node);
    const count = slides.length;
    const page = pageOf(p.bound(), count);
    countOf.set(box.node, count);
    const numbers = p.bool("numbers", true);
    const titles = slides.map((s) => ctx.props(s).text());
    const shown = slides[page];
    let h = 0;
    if (shown) {
      // Backup slides (appendix=true) are numbered apart, so "3 / 5" counts the slides people are taken through.
      const backup = slides.map((s) => ctx.props(s).bool("appendix", false));
      const mainCount = backup.filter((b) => !b).length, backupCount = count - mainCount;
      const before = backup.slice(0, page + 1).filter((b) => b === backup[page]).length;
      const label = backup[page] ? `Appendix ${before} / ${backupCount}` : `${before} / ${mainCount}`;
      // An agenda lists the slides people are taken through: not the opening slide, itself or the backup ones.
      const agenda = slides
        .filter((s, i) => !backup[i] && !["title", "agenda"].includes(ctx.props(s).str("layout")) && ctx.props(s).text().trim())
        .map((s) => ctx.props(s).text().trim());
      const footer = p.has("footer") ? p.str("footer").trim() : "";
      placeOf.set(shown, {
        index: page, count, numbers, label, agenda,
        ...(footer ? { footer } : {}),
        ...(p.bool("progress", false) && mainCount > 1 && !backup[page] ? { progress: before / mainCount } : {}),
      });
      const sb = ctx.layout(shown, box.x, box.y, box.w);
      box.children.push(sb);
      h = sb.h;
    }
    const barH = count > 1 ? t.control.height : 0;
    const barY = box.y + h + (barH ? t.space.sm : 0);
    const data: DeckData = { page, count, titles, barY, barH };
    box.data = data;
    box.h = barY - box.y + barH;
  },
  semantics(box) {
    const d = dataOf(box);
    if (!d || !d.count) return null;
    const title = d.titles[d.page] || `Slide ${d.page + 1}`;
    if (d.count <= 1) return { role: "region", roleDescription: "slide deck", name: title, description: `Slide 1 of 1` };
    return {
      role: "region",
      roleDescription: "slide deck",
      name: title,
      description: `Slide ${d.page + 1} of ${d.count}`,
      parts: [
        { detail: "prev", role: "button", name: "Previous slide", ...(d.page <= 0 ? { disabled: true } : {}) },
        ...d.titles.map((tt, i) => ({ detail: `slide:${i}`, role: "button" as const, name: `Slide ${i + 1}${tt ? `: ${tt}` : ""}`, ...(i === d.page ? { current: true } : {}) })),
        { detail: "next", role: "button", name: "Next slide", ...(d.page >= d.count - 1 ? { disabled: true } : {}) },
      ],
    };
  },
  paint(box, ctx) {
    const d = dataOf(box);
    if (!d) return;
    const shown = box.children[0];
    if (shown) {
      // The page as a number that takes a moment to arrive: while it's on its way, the new slide is still covered.
      const fade = ctx.props(box.node).oneOf("transition", TRANSITIONS, "fade") === "fade";
      const at = fade ? ctx.tween(box.node, "page", d.page, FADE_MS) : d.page;
      fadeOf.set(shown.node, Math.min(1, Math.abs(at - d.page)));
      // Under everything on the slide: a sideways swipe or drag over it moves between slides.
      if (d.count > 1) ctx.addHit(partBox(box, shown.x, shown.y, shown.w, shown.h), { detail: "swipe", focusable: false });
    }
    if (!d.barH) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    const size = d.barH, y = d.barY;
    const arrow = (x: number, dir: "left" | "right", enabled: boolean) => {
      const detail = dir === "left" ? "prev" : "next";
      g.beginPath();
      g.arc(x + size / 2, y + size / 2, size / 2 - 1, 0, Math.PI * 2);
      if (enabled && ctx.isHovered(box.node, detail)) fillTint(g, c.accent, 0.08);
      g.lineWidth = 1;
      // control, not line: the bar sits on the page, where line is too faint to see in light themes.
      g.strokeStyle = enabled ? c.control : c.line;
      g.stroke();
      const icon = size * 0.45;
      drawIcon(g, dir === "left" ? "arrow-left" : "arrow-right", x + (size - icon) / 2, y + (size - icon) / 2, icon, enabled ? c.ink : c.control);
      // Kept as a Tab stop at the ends too, so focus stays put; pressing it there does nothing.
      ctx.addHit(partBox(box, x, y, size, size), { detail, drags: false });
    };
    arrow(box.x, "left", d.page > 0);
    arrow(box.x + box.w - size, "right", d.page < d.count - 1);
    // A dot per slide in the middle, the current one longer and in the accent.
    const dot = theme.space.sm, gap = theme.space.sm;
    const wide = dot * 2;
    const total = (d.count - 1) * (dot + gap) + wide;
    const room = box.w - size * 2 - gap * 2;
    // Too many to fit between the arrows: the dots aren't drawn, the arrows and keys still work.
    if (total > room) return;
    let x = box.x + box.w / 2 - total / 2;
    for (let i = 0; i < d.count; i++) {
      const w = i === d.page ? wide : dot;
      const hovered = ctx.isHovered(box.node, `slide:${i}`);
      ctx.roundRect(x, y + size / 2 - dot / 2, w, dot, dot / 2);
      g.fillStyle = i === d.page ? c.accent : hovered ? c.muted : c.control;
      g.fill();
      ctx.addHit(partBox(box, x - gap / 2, y, w + gap, size), { detail: `slide:${i}`, drags: false });
      x += w + gap;
    }
  },
  press(ctx) {
    const d = ctx.target.detail;
    const node = ctx.target.node;
    const page = pageOf(ctx.props(node).bound(), countOf.get(node) ?? 1);
    if (d === "prev") goTo(ctx, page - 1);
    else if (d === "next") goTo(ctx, page + 1);
    else if (typeof d === "string" && d.startsWith("slide:")) goTo(ctx, Number(d.slice(6)));
  },
  // Only the slide's own area is dragged (the arrows and dots are pressed): a swipe far enough sideways moves a slide.
  drag(ctx: DragContext) {
    const node = ctx.target.node;
    if (ctx.phase === "start") { swipeFrom.set(node, ctx.x); return; }
    if (ctx.phase !== "end") return;
    const from = swipeFrom.get(node);
    swipeFrom.delete(node);
    if (from === undefined || ctx.cancelled) return;
    const moved = ctx.x - from;
    if (Math.abs(moved) < SWIPE_DISTANCE) return;
    const page = pageOf(ctx.props(node).bound(), countOf.get(node) ?? 1);
    goTo(ctx, moved < 0 ? page + 1 : page - 1);
  },
  key(ctx, k) {
    const node = ctx.target.node;
    const count = countOf.get(node) ?? 1;
    const page = pageOf(ctx.props(node).bound(), count);
    const to = k === "ArrowLeft" ? page - 1 : k === "ArrowRight" ? page + 1 : k === "Home" ? 0 : k === "End" ? count - 1 : null;
    if (to === null) return false;
    goTo(ctx, to);
    return true;
  },
};
