/**
 * hero, section and band: the headed blocks a page is made of. Each draws its
 * own eyebrow, headline and lead line (shared.ts) and lays what is indented
 * under it below them.
 *
 * - hero: the top of the page. A big headline and, with src=, a photo behind
 *   it: the very image element's painting (media.ts), on its scrim, so the
 *   words always read.
 * - section: a titled part of the page with room around it.
 * - band: a full-width strip with a background of its own, for a call to
 *   action, a row of figures or a quote.
 */
import { PICTURE_PROPS, type ComponentDef } from "../../component";
import type { ElementSemantics } from "../../a11y/semantics";
import { isForcedColors, overImageTheme } from "../../scrim";
import type { Theme } from "../../theme";
import type { Box, SayShapeNode } from "../../types";
import { image } from "../media";
import { card } from "../layout";
import { alignProp, centerContent, dataOf, eyebrowProp, grown, headSpec, layoutBlock, leadProp, paintRuns, runParts } from "./shared";

/** A hero with a photo is at least this tall, as a share of its width, and at most MAX_HERO. */
const HERO_RATIO = 0.45;
const MAX_HERO = 640;

/** The element as another (a card's look is the band's and the plan's): same id and scope, other props. */
export function asCard(box: Box, variant: "raised" | "hero" | "tinted" | "outline"): Box {
  const node: SayShapeNode = { ...box.node, type: "card", props: { variant } };
  return { ...box, node, data: undefined };
}

export const hero: ComponentDef = {
  type: "hero",
  category: "layout",
  description: "The top of a landing page: a big headline with a line under it, buttons below, and optionally a photo behind it all. Use it once, first.",
  text: { description: "The headline.", required: true },
  props: {
    eyebrow: eyebrowProp,
    lead: leadProp,
    src: { type: "string", description: "A photo behind the words. The engine darkens it just enough to read them. Only hosts the app allows will load." },
    zoom: PICTURE_PROPS.zoom!,
    align: alignProp,
  },
  children: "any",
  picks: [{ for: "the top of a landing page or website", write: 'hero "Headline" lead="One sentence."' }],
  example: `hero "Trips that plan themselves" eyebrow="New" lead="Tell us where and when. We write the whole itinerary." src="/images/ridge.jpg" zoom=slow
  button "Plan a trip" on=emit:start
  button "See an example" variant=secondary on=emit:example`,
  // Over a photo its words are light on dark, the same as an image with elements laid over it.
  theme: (theme, node) => (node.props.src ? overImageTheme(theme) : theme),
  semantics(box) {
    const head = dataOf(box).head;
    return { role: "group", name: head.runs.find((r) => r.key === "title")?.text || "Introduction", parts: runParts(box, head.runs, 1) } satisfies ElementSemantics;
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const padY = grown(t.space.xl, box.w, 1.4, 2.4);
    const { head } = layoutBlock(box, ctx, {
      padX: t.space.lg, padY, gap: t.space.lg, headGap: t.space.lg, columns: false,
      head: headSpec(ctx, box, grown(t.text.display, box.w, 1.15, 1.75), grown(t.text.lead, box.w, 1, 1.3)),
    });
    // A photo needs room to be seen: the words sit in the middle of a box at least this tall.
    if (ctx.props(box.node).has("src")) {
      const want = Math.min(MAX_HERO, Math.round(box.w * HERO_RATIO));
      if (box.h < want) { centerContent(box, ctx, head, Math.floor((want - box.h) / 2)); box.h = want; }
    }
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    if (p.has("src")) {
      // The photo and its scrim are the image element's own painting, with this element standing in for what is laid over it.
      const photo: SayShapeNode = {
        id: `${box.node.id}~photo`, type: "image", text: p.text(), line: box.node.line, indent: box.node.indent,
        props: { src: p.str("src"), fit: "cover", shape: "rounded", zoom: p.str("zoom", "none") },
        children: [box.node],
      };
      image.paint!({ ...box, node: photo, data: { pictureH: box.h, caption: [], lh: 0 } }, ctx);
    }
    paintRuns(ctx, box, dataOf(box).head.runs);
  },
};

export const section: ComponentDef = {
  type: "section",
  category: "layout",
  description: "A titled part of a page, with room above and below: a heading, a line under it, then whatever is indented under it (a grid of features, a plan list, a quote).",
  text: { description: "The section's heading.", required: false },
  props: { eyebrow: eyebrowProp, lead: leadProp, align: alignProp },
  children: "any",
  picks: [{ for: "a part of a landing page with its own heading", write: 'section "Heading" lead="One sentence."' }],
  example: `section "Why people use it" lead="Three things we never skip."
  grid min=200
    feature "Real itineraries" icon=map body="Every stop is timed and checked."
    feature "No surprises" icon=shield body="Costs are shown before you book."`,
  semantics(box) {
    const head = dataOf(box).head;
    const title = head.runs.find((r) => r.key === "title")?.text;
    const name = title || head.runs[0]?.text;
    if (!name) return null;
    return { role: title ? "region" : "group", name, parts: runParts(box, head.runs, 2) };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    layoutBlock(box, ctx, {
      padX: t.space.lg, padY: grown(t.space.xl, box.w, 1, 1.6), gap: t.space.lg, headGap: t.space.xl, columns: false,
      head: headSpec(ctx, box, grown(t.text.title, box.w, 1.1, 1.6), grown(t.text.lead, box.w, 1, 1.2)),
    });
  },
  paint(box, ctx) {
    paintRuns(ctx, box, dataOf(box).head.runs);
  },
};

const BAND_TONES = ["soft", "plain", "accent"] as const;
type BandTone = (typeof BAND_TONES)[number];

/** A band's accent theme: the accent is the ground, so the words are onAccent and a solid button turns light. Per theme, made once. */
const onAccent = new WeakMap<Theme, Theme>();
function accentGround(theme: Theme): Theme {
  if (isForcedColors(theme)) return theme;
  let t = onAccent.get(theme);
  if (!t) {
    const c = theme.colors;
    // surface and raised keep the gradient's two ends for the band's own paint; the words and controls take onAccent.
    t = {
      ...theme,
      name: `${theme.name}-on-accent`,
      colors: { ...c, surface: c.accent, raised: c.accent2, ink: c.onAccent, muted: c.onAccent, line: c.onAccent, control: c.onAccent, focus: c.onAccent, good: c.onAccent, warn: c.onAccent, bad: c.onAccent, accent: c.onAccent, accent2: c.onAccent, onAccent: c.accent },
    };
    onAccent.set(theme, t);
  }
  return t;
}

export const band: ComponentDef = {
  type: "band",
  category: "layout",
  description: "A full-width strip with its own background that sets a part of the page apart: a call to action, a row of figures, a quote.",
  text: { description: "A heading for the strip.", required: false },
  props: {
    eyebrow: eyebrowProp,
    lead: leadProp,
    tone: { type: "enum", values: BAND_TONES, default: "soft", description: "soft (default, a quiet accent wash), plain (an outline only) or accent (the accent color, for the one strip that asks for the action)." },
    align: alignProp,
  },
  children: "any",
  picks: [{ for: "a full-width call to action or highlighted strip", write: 'band "Ready?" tone=accent align=center' }],
  example: `band "Ready when you are" lead="Free for your first three trips." tone=accent align=center
  button "Start planning" on=emit:start`,
  theme: (theme, node) => (node.props.tone === "accent" ? accentGround(theme) : theme),
  semantics(box) {
    const head = dataOf(box).head;
    const title = head.runs.find((r) => r.key === "title")?.text;
    const name = title || head.runs[0]?.text;
    return name ? { role: "group", name, parts: runParts(box, head.runs, 2) } : null;
  },
  surface(box, ctx) {
    const tone = ctx.props(box.node).oneOf("tone", BAND_TONES, "soft");
    return tone === "soft" ? card.surface!(asCard(box, "tinted"), ctx) : tone === "plain" ? ctx.theme.colors.surface : undefined;
  },
  layout(box, ctx) {
    const t = ctx.theme;
    layoutBlock(box, ctx, {
      padX: t.space.lg, padY: grown(t.space.xl, box.w, 0.9, 1.4), gap: t.space.md, headGap: t.space.lg, columns: false,
      head: headSpec(ctx, box, grown(t.text.title, box.w, 1.05, 1.4), t.text.lead),
    });
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const tone = ctx.props(box.node).oneOf("tone", BAND_TONES, "soft") as BandTone;
    if (tone === "accent" && !isForcedColors(theme)) {
      // The accent ground: surface and raised are the accent's two ends (see accentGround).
      ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.lg);
      const fill = g.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
      fill.addColorStop(0, theme.colors.surface);
      fill.addColorStop(1, theme.colors.raised);
      g.fillStyle = fill;
      g.fill();
    } else {
      card.paint!(asCard(box, tone === "plain" || tone === "accent" ? "outline" : "tinted"), ctx);
    }
    paintRuns(ctx, box, dataOf(box).head.runs);
  },
};
