/**
 * slide: one 16:9 slide in a deck. Its quoted text is its title, which it
 * draws itself; any elements go under it.
 *
 * A slide is the first element whose height doesn't come from what's in it:
 * it's always 16:9 and as wide as its space. Its title and children are laid
 * out at a fixed design size (DESIGN_W by DESIGN_H, with the theme's slide
 * tokens), then the whole slide is drawn scaled to the real width
 * (ComponentDef.childTransform), so it looks the same at every size. Short
 * content is centred under the title; tall content is scaled down to fit, to
 * MIN_FIT at the least, and past that clipped, with a warning to split it.
 */
import type { ChildTransform, ComponentDef, LayoutContext } from "../../component";
import { ellipsize, fitLines } from "../../text";
import type { Box, SayShapeNode } from "../../types";
import { statHint } from "../content";
import { slideTheme, slideTokens } from "./theme";

/** The size a slide is laid out at before it's scaled to its space. */
export const DESIGN_W = 960;
export const DESIGN_H = 540;
/** The smallest tall content is scaled to before it's cut off. */
export const MIN_FIT = 0.6;
/** The sizes tried, largest first, for content too tall at full size. */
const FITS = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, MIN_FIT];

const LAYOUTS = ["title", "content", "agenda"] as const;
/** The most titles an agenda slide lists; the rest are counted in a last line. */
export const MAX_AGENDA = 6;
type SlideLayout = (typeof LAYOUTS)[number];

/** Where a slide sits in its deck, set by the deck before it lays the slide out. */
export interface SlidePlace {
  index: number;
  count: number;
  numbers: boolean;
  /** What the corner says, e.g. "2 / 5" or "Appendix 1 / 2" (appendix slides aren't counted with the rest). */
  label?: string;
  /** The deck's footer=, drawn small in the bottom left of every slide. */
  footer?: string;
  /** How far through the deck this slide is (0..1), when the deck has progress=true. */
  progress?: number;
  /** The deck's main slides' titles, for a slide with layout=agenda. */
  agenda?: string[];
}
export const placeOf = new WeakMap<SayShapeNode, SlidePlace>();
/** How much of a slide is still covered while it fades in (0..1), set by its deck each frame. */
export const fadeOf = new WeakMap<SayShapeNode, number>();

export interface SlideData {
  [key: string]: unknown;
  layout: SlideLayout;
  /** Screen pixels per design pixel. */
  scale: number;
  /** How much the children are shrunk to fit (1 when they fit). */
  fit: number;
  /** The title as drawn, in design pixels from the slide's top left. */
  title: { lines: string[]; font: string; size: number; lineHeight: number; top: number };
  /** Where the eyebrow, title and subtitle start together, and the lines above and below the title. */
  headTop: number;
  eyebrow: { text: string; font: string; height: number };
  subtitle: { lines: string[]; font: string; lineHeight: number; top: number };
  /** An agenda's rows as drawn, under the title, and how tall each is. */
  agenda: { rows: string[]; font: string; rowHeight: number; top: number };
  /** The bottom line as drawn: the slide's number, and the deck's footer cut to the room beside it. */
  foot: { label: string; footer: string };
  /** Where what's on the slide stops being drawn, from the slide's top: above the bottom line, so nothing runs over the footer. */
  clipBottom: number;
  /** The children's transform from where they were laid out to the screen. */
  transform: ChildTransform;
  /** The children's height as laid out, and the room they had under the title, in design pixels. */
  content: number;
  room: number;
  clipped: boolean;
  place: SlidePlace | undefined;
}

export const dataOf = (b: Box): SlideData | undefined => b.data as SlideData | undefined;

/** The stats a slide gave hints to at its last layout, to take them back before the next. */
const hinted = new WeakMap<SayShapeNode, SayShapeNode[]>();

/**
 * Stats side by side read as one row of figures: the same size, on the same
 * line. Each stat sizes itself to its own value and label, so a long value or
 * a two-line label leaves it out of step. This finds the stats in each row or
 * grid and tells them all to use the smallest figure size and the tallest
 * label among them (statHint). True when a hint changed, so the slide lays
 * out again.
 */
function alignStats(slide: Box): boolean {
  let changed = false;
  const mine = hinted.get(slide.node) ?? [];
  const gather = (b: Box, into: Box[], depth: number) => {
    for (const c of b.children) {
      if (c.node.type === "stat") into.push(c);
      // Through a card or column around a stat, not into another row's stats.
      else if (depth < 2 && c.node.type !== "grid" && c.node.type !== "row") gather(c, into, depth + 1);
    }
  };
  const visit = (b: Box) => {
    if (b.node.type === "grid" || b.node.type === "row") {
      const stats: Box[] = [];
      gather(b, stats, 0);
      const sized = stats.map((s) => s.data as { size?: number; label?: string[] } | undefined).filter((d) => typeof d?.size === "number");
      if (stats.length > 1 && sized.length === stats.length) {
        const size = Math.min(...sized.map((d) => d!.size!));
        const labelLines = Math.max(...sized.map((d) => d!.label?.length ?? 0));
        if (sized.some((d) => d!.size !== size || (d!.label?.length ?? 0) !== labelLines)) {
          for (const s of stats) {
            const had = statHint.get(s.node);
            if (had?.size !== size || had?.labelLines !== labelLines) changed = true;
            statHint.set(s.node, { size, labelLines });
            if (!mine.includes(s.node)) mine.push(s.node);
          }
        }
      }
    }
    b.children.forEach(visit);
  };
  slide.children.forEach(visit);
  hinted.set(slide.node, mine);
  return changed;
}

function layoutChildren(box: Box, ctx: LayoutContext, x: number, y: number, w: number, gap: number): number {
  let at = y;
  const kids = ctx.visibleChildren(box.node);
  kids.forEach((k, i) => {
    const kb = ctx.layout(k, x, at, w);
    box.children.push(kb);
    at += kb.h + (i < kids.length - 1 ? gap : 0);
  });
  return kids.length ? at - y : 0;
}

export const slide: ComponentDef = {
  type: "slide",
  category: "layout",
  description: "One 16:9 slide in a deck, with its title drawn large at the top and the slide's content under it: keep each to one idea, and write the title as the point it makes, not a label. What doesn't fit is shrunk, then cut off, and a table or list shows about five rows, so show the top few with take() and sort(), a total or a chart in place of every row; write money one way through the deck, and a stat's change= as a short signed figure such as change=\"+1.4 h\", with good=down where lower is better (costs, reply time).",
  text: { description: "The slide's title, e.g. Three numbers that sum up the quarter." },
  props: {
    layout: { type: "enum", values: LAYOUTS, default: "content", description: "title for the opening slide (a large title with its children under it, centred on the slide), content for the rest (title at the top, children below), agenda for a slide that lists the other slides' titles by itself." },
    eyebrow: { type: "string", description: "A few words above the title, in the accent color, e.g. eyebrow=\"Q3 2026\" or the section's name." },
    subtitle: { type: "string", description: "A quieter line under the title, e.g. subtitle=\"Prepared for the board\"." },
    appendix: { type: "boolean", default: false, description: "true for a backup slide after the main ones: it's left out of the slide count and the agenda, and numbered as Appendix." },
  },
  children: "any",
  parents: ["deck"],
  example: `slide "What we do next"
  list
    list-item "Hire two in support"
    list-item "Open the Denver office"`,
  theme: slideTheme,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const k = slideTokens(t);
    const layout = p.oneOf("layout", LAYOUTS, "content");
    const scale = box.w / DESIGN_W;
    box.h = box.w * (DESIGN_H / DESIGN_W);
    const pad = t.space.xl;
    const width = DESIGN_W - pad * 2;
    const cover = layout === "title";
    const size = cover ? k.heading.cover : k.heading.slide;
    const font = `${cover ? 700 : 600} ${size}px ${t.font.family}`;
    const lineHeight = Math.round(size * 1.15);
    const text = p.text().trim();
    const lines = text ? fitLines(text, width, font, ctx.measure, cover ? 3 : 2) : [];
    const titleOnlyH = lines.length * lineHeight;
    const gap = t.space.lg;
    const eyebrowText = p.has("eyebrow") ? ellipsize(p.str("eyebrow").trim(), width, `600 ${t.text.caption}px ${t.font.family}`, ctx.measure) : "";
    const eyebrow = { text: eyebrowText, font: `600 ${t.text.caption}px ${t.font.family}`, height: eyebrowText ? Math.round(t.text.caption * 1.4) + t.space.xs : 0 };
    const subFont = `400 ${t.text.lead}px ${t.font.family}`;
    const subLines = p.has("subtitle") && p.str("subtitle").trim() ? fitLines(p.str("subtitle").trim(), width, subFont, ctx.measure, 2) : [];
    const subLH = Math.round(t.text.lead * 1.35);
    const subH = subLines.length ? t.space.sm + subLines.length * subLH : 0;
    // The eyebrow, title and subtitle together: everything below treats them as the title.
    const titleH = eyebrow.height + titleOnlyH + subH;
    const afterTitle = titleH ? (cover ? t.space.md : gap) : 0;
    // An agenda's rows are drawn by the slide under its title, and anything written under it comes after them.
    const place = placeOf.get(box.node);
    const agendaFont = `500 ${t.text.lead}px ${t.font.family}`;
    const rowHeight = Math.round(t.text.lead * 1.75);
    const titles = layout === "agenda" ? place?.agenda ?? [] : [];
    const listed = titles.length > MAX_AGENDA ? titles.slice(0, MAX_AGENDA - 1) : titles;
    const rows = listed.map((s, i) => ellipsize(`${i + 1}   ${s}`, width, agendaFont, ctx.measure));
    if (titles.length > listed.length) rows.push(`and ${titles.length - listed.length} more`);
    const agendaH = rows.length * rowHeight;
    // The bottom line: the footer gets what the number, and a host's logo, leave it.
    const footFont = `500 ${t.text.caption}px ${t.font.family}`;
    const label = place?.numbers ? place.label ?? `${place.index + 1} / ${place.count}` : "";
    const beside = (label ? ctx.measure.width(label, footFont) + t.space.md : 0) + (t.deck?.logo ? DESIGN_W / 5 + t.space.sm : 0);
    const foot = { label, footer: place?.footer ? ellipsize(place.footer, Math.max(0, width - beside), footFont, ctx.measure) : "" };

    // Laid out at design size where the content starts under the title. Centring and
    // shrinking to fit go in the transform, never by moving boxes: elements keep
    // positions of their own in box.data (a list's dividers), which moving wouldn't update.
    const x0 = box.x + pad;
    const agendaTop = pad + titleH + afterTitle;
    const top = agendaTop + (agendaH ? agendaH + gap : 0);
    // Last time's hints go first: the values may have changed since.
    for (const n of hinted.get(box.node) ?? []) statHint.delete(n);
    hinted.delete(box.node);
    // At a smaller size the content is laid out that much wider, so it still fills the slide
    // across: a grid gets another column, where shrinking alone would leave empty margins.
    const lay = (f: number): number => {
      const once = () => { box.children.length = 0; return layoutChildren(box, ctx, x0, box.y + top, width / f, gap); };
      const h = once();
      return alignStats(box) ? once() : h;
    };
    let content = lay(1);
    const usable = DESIGN_H - pad * 2;
    const room = Math.max(0, DESIGN_H - pad - top);
    let titleTop = pad, shiftY = 0, fit = 1;
    const offX = 0;
    if (!(cover && titleH + afterTitle + content <= usable) && content > room) {
      fit = MIN_FIT;
      let found = false;
      for (const f of FITS) {
        const h = lay(f);
        if (h * f <= room + 0.5) { fit = f; content = h; found = true; break; }
      }
      if (!found) content = lay(MIN_FIT);
    }
    if (cover && titleH + afterTitle + content <= usable) {
      // The opening slide: title and what's under it together, in the middle.
      titleTop = pad + (usable - titleH - afterTitle - content) / 2;
      shiftY = titleTop - pad;
    } else if (content <= room) shiftY = cover || agendaH ? 0 : (room - content) / 2;
    const clipped = content * fit > room + 0.5;
    if (clipped) {
      const name = text ? `"${text}"` : "without a title";
      ctx.warn?.(`slide ${name} on line ${box.node.line} has too much on it to fit, even at ${Math.round(MIN_FIT * 100)}% size, so its bottom is cut off. Split it into two slides`);
    }
    // Design point (as laid out) to screen: shrink to fit about the content's top left
    // (centred across), move down to centre it, then scale the slide about its top left.
    const cy0 = box.y + top;
    const transform: ChildTransform = {
      scale: scale * fit,
      dx: box.x + scale * (x0 + offX - fit * x0 - box.x),
      dy: box.y + scale * (cy0 + shiftY - fit * cy0 - box.y),
    };
    const data: SlideData = {
      layout, scale, fit, transform, content, room, clipped, place,
      title: { lines, font, size, lineHeight, top: titleTop + eyebrow.height },
      headTop: titleTop,
      eyebrow,
      subtitle: { lines: subLines, font: subFont, lineHeight: subLH, top: titleTop + eyebrow.height + titleOnlyH + t.space.sm },
      agenda: { rows, font: agendaFont, rowHeight, top: agendaTop },
      foot,
      clipBottom: (DESIGN_H - pad) * scale,
    };
    box.data = data;
  },
  childTransform: (box) => dataOf(box)?.transform ?? null,
  clipChildren: (box) => ({ x: box.x, y: box.y, w: box.w, h: dataOf(box)?.clipBottom ?? box.h }),
  semantics(box, ctx) {
    const d = dataOf(box);
    const name = ctx.text(box.node) || undefined;
    const p = ctx.props(box.node);
    // The lines the slide draws itself are read with it: they have no element of their own.
    const said = [
      d?.place ? `Slide ${d.place.label ? d.place.label.replace(" / ", " of ") : `${d.place.index + 1} of ${d.place.count}`}` : "",
      p.has("eyebrow") ? p.str("eyebrow").trim() : "",
      p.has("subtitle") ? p.str("subtitle").trim() : "",
      ...(d?.agenda.rows ?? []),
    ].filter(Boolean).join(". ");
    return { role: "group", roleDescription: "slide", ...(name ? { name } : {}), ...(said ? { description: said } : {}) };
  },
  paint(box, ctx) {
    const d = dataOf(box);
    if (!d) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    const pad = theme.space.xl;
    const s = d.scale;
    g.save();
    // Drawn at design size, scaled about the slide's top left like its children.
    g.transform(s, 0, 0, s, box.x * (1 - s), box.y * (1 - s));
    // A host saving slides as pages (theme.deck.square) gets them without the rounded frame.
    const square = theme.deck?.square === true;
    if (square) { g.beginPath(); g.rect(box.x, box.y, DESIGN_W, DESIGN_H); }
    else ctx.roundRect(box.x, box.y, DESIGN_W, DESIGN_H, theme.radius.lg);
    g.fillStyle = c.raised;
    g.fill();
    if (!square) {
      g.lineWidth = 1 / s;
      g.strokeStyle = c.line;
      g.stroke();
    }
    const t = d.title;
    const place = d.place;
    if (place?.progress !== undefined) {
      // How far through the deck, along the bottom edge, inside the frame's corners.
      g.save();
      if (square) { g.beginPath(); g.rect(box.x, box.y, DESIGN_W, DESIGN_H); }
      else ctx.roundRect(box.x, box.y, DESIGN_W, DESIGN_H, theme.radius.lg);
      g.clip();
      g.fillStyle = c.accent;
      g.fillRect(box.x, box.y + DESIGN_H - theme.space.xs, DESIGN_W * Math.min(1, Math.max(0, place.progress)), theme.space.xs);
      g.restore();
    }
    if (d.layout === "title" && t.lines.length) {
      // The opening slide's accent rule, above its title.
      ctx.roundRect(box.x + pad, box.y + d.headTop - theme.space.lg, theme.space.xl * 1.5, theme.space.xs, theme.space.xs / 2);
      g.fillStyle = c.accent;
      g.fill();
    }
    g.textAlign = "left";
    g.textBaseline = "middle";
    if (d.eyebrow.text) {
      g.fillStyle = c.accent;
      g.font = d.eyebrow.font;
      g.fillText(d.eyebrow.text, box.x + pad, box.y + d.headTop + (d.eyebrow.height - theme.space.xs) / 2);
    }
    g.fillStyle = c.ink;
    g.font = t.font;
    t.lines.forEach((line, i) => g.fillText(line, box.x + pad, box.y + t.top + t.lineHeight * (i + 0.5)));
    g.fillStyle = c.muted;
    g.font = d.subtitle.font;
    d.subtitle.lines.forEach((line, i) => g.fillText(line, box.x + pad, box.y + d.subtitle.top + d.subtitle.lineHeight * (i + 0.5)));
    if (d.agenda.rows.length) {
      g.font = d.agenda.font;
      d.agenda.rows.forEach((row, i) => {
        const y = box.y + d.agenda.top + d.agenda.rowHeight * (i + 0.5);
        g.fillStyle = c.ink;
        g.fillText(row, box.x + pad, y);
        if (i < d.agenda.rows.length - 1) {
          g.fillStyle = c.line;
          g.fillRect(box.x + pad, box.y + d.agenda.top + d.agenda.rowHeight * (i + 1) - 0.5, DESIGN_W - pad * 2, 1);
        }
      });
    }
    // The bottom line: the host's logo and the deck's footer on the left, the slide's number on the right.
    const baseY = box.y + DESIGN_H - pad / 2;
    let leftX = box.x + pad;
    const logo = theme.deck?.logo ? ctx.image(theme.deck.logo) : null;
    if (logo?.status === "ready" && logo.image) {
      const h = Math.round(pad * 0.5);
      const w = Math.min(DESIGN_W / 5, (h * logo.image.width) / Math.max(1, logo.image.height));
      g.drawImage(logo.image.source, leftX, baseY - h / 2, w, h);
      leftX += w + theme.space.sm;
    }
    g.fillStyle = c.muted;
    g.font = ctx.font(500, theme.text.caption);
    if (d.foot.footer) g.fillText(d.foot.footer, leftX, baseY);
    if (d.foot.label) {
      g.textAlign = "right";
      g.fillText(d.foot.label, box.x + DESIGN_W - pad, baseY);
    }
    g.restore();
  },
  // A slide that has just been moved to fades in: its own surface over it, clearing (the deck's transition=fade).
  paintOver(box, ctx) {
    const d = dataOf(box);
    const cover = fadeOf.get(box.node) ?? 0;
    if (!d || cover <= 0) return;
    const { g, theme } = ctx;
    const s = d.scale;
    g.save();
    g.transform(s, 0, 0, s, box.x * (1 - s), box.y * (1 - s));
    g.globalAlpha *= Math.min(1, cover);
    if (theme.deck?.square) { g.beginPath(); g.rect(box.x, box.y, DESIGN_W, DESIGN_H); }
    else ctx.roundRect(box.x, box.y, DESIGN_W, DESIGN_H, theme.radius.lg);
    g.fillStyle = theme.colors.raised;
    g.fill();
    g.restore();
  },
};
