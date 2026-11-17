/**
 * pricing and plan: a heading and the plans under it. Each plan is a card of
 * its own (the card element's painting, so the theme's look applies): name,
 * price, a list of what it includes and, laid under them, its buttons. The
 * plans sit side by side and stack on a phone, with the same height in a row
 * and their buttons at the bottom, so they line up.
 */
import type { ComponentDef } from "../../component";
import { drawIcon } from "../../icons";
import { displayFamily } from "../../look";
import { card } from "../layout";
import type { Box } from "../../types";
import { asCard } from "./blocks";
import { alignProp, dataOf, eyebrowProp, grown, headSpec, layoutHead, leadProp, makeRun, MAX_CONTENT, paintRuns, runParts, type Head, type Run } from "./shared";

/** The most features a plan lists; a longer list is cut, and the rest is the person's to read on the pricing page. */
export const MAX_FEATURES = 12;
/** The narrowest a plan is, as a multiple of the body text's size. */
const PLAN_MIN = 17;

interface PlanData { [key: string]: unknown; runs: Run[]; ticks: Array<{ dy: number; size: number }>; kidsFrom: number }

export const plan: ComponentDef = {
  type: "plan",
  category: "content",
  description: "One plan in a pricing list: its name, price and what it includes, with its button under it. Only inside pricing.",
  text: { description: "The plan's name, like Pro.", required: true },
  props: {
    price: { type: "string", required: true, description: 'The price, like "$12" or "Free".' },
    per: { type: "string", description: 'What the price is for, like "/ month".' },
    detail: { type: "string", description: "A muted line under the name: who the plan is for." },
    features: { type: "string", description: `What it includes, separated by semicolons: "Unlimited trips; Offline plans; Priority support". Up to ${MAX_FEATURES}.` },
    badge: { type: "string", description: 'A small label above the name, like "Most popular".' },
    highlight: { type: "boolean", default: false, description: "true for the one plan to lead people to: it gets an accent frame." },
  },
  children: "any",
  parents: ["pricing"],
  example: `plan "Pro" price="$12" per="/ month" features="Unlimited trips; Offline plans" highlight=true badge="Most popular"
  button "Start free trial" on=emit:trial`,
  minWidth: (_node, ctx) => Math.round(ctx.theme.text.body * PLAN_MIN),
  semantics(box) {
    const d = box.data as PlanData;
    const name = d.runs.find((r) => r.key === "title")?.text ?? "";
    const price = [d.runs.find((r) => r.key === "price")?.text, d.runs.find((r) => r.key === "per")?.text].filter(Boolean).join(" ");
    return { role: "group", name, description: price || undefined, parts: runParts(box, d.runs, 3) };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const p = ctx.props(box.node);
    const pad = t.space.lg;
    const iw = Math.max(1, box.w - pad * 2);
    const runs: Run[] = [];
    let y = pad;
    const push = (r: Run, gap: number) => { runs.push(r); y = r.dy + r.lines.length * r.lh + gap; };
    if (p.str("badge")) push(makeRun(ctx, "eyebrow", p.str("badge"), t.text.caption, 600, t.font.family, "accent", pad, iw, y, "left", 1.4), t.space.xs);
    push(makeRun(ctx, "title", p.text(), t.text.lead, 600, displayFamily(t), "ink", pad, iw, y, "left", 1.3), t.space.xs);
    if (p.str("detail")) push(makeRun(ctx, "lead", p.str("detail"), t.text.body, 400, t.font.family, "muted", pad, iw, y, "left", 1.45), t.space.xs);
    y += t.space.sm;
    // The price in display type, its unit beside it on the same line when it fits, else under it.
    const price = makeRun(ctx, "price", p.str("price"), t.text.display, 600, displayFamily(t), "ink", pad, iw, y, "left", 1.15);
    runs.push(price);
    const per = p.str("per");
    let priceBottom = price.dy + price.lines.length * price.lh;
    if (per) {
      const lastLine = price.lines[price.lines.length - 1] ?? "";
      const used = ctx.measure.width(lastLine, price.font) + t.space.sm;
      const unit = makeRun(ctx, "per", per, t.text.body, 400, t.font.family, "muted", pad, iw, 0, "left", 1.4);
      if (price.lines.length === 1 && used + ctx.measure.width(per, unit.font) <= iw) {
        unit.dx = pad + used;
        unit.w = iw - used;
        unit.dy = price.dy + price.lh - unit.lh - Math.round(price.lh * 0.12);
      } else {
        unit.dy = priceBottom;
        priceBottom += unit.lines.length * unit.lh;
      }
      runs.push(unit);
    }
    y = priceBottom + t.space.md;
    const ticks: PlanData["ticks"] = [];
    const items = p.str("features").split(";").map((s) => s.trim()).filter(Boolean).slice(0, MAX_FEATURES);
    const tick = Math.round(t.text.body * 1.15);
    items.forEach((text, i) => {
      if (i) y += t.space.sm;
      const r = makeRun(ctx, "feature", text, t.text.body, 400, t.font.family, "ink", pad + tick + t.space.sm, Math.max(1, iw - tick - t.space.sm), y, "left", 1.4);
      runs.push(r);
      ticks.push({ dy: r.dy + (r.lh - tick) / 2, size: tick });
      y = r.dy + r.lines.length * r.lh;
    });
    if (items.length) y += t.space.md;
    const kidsFrom = y;
    const kids = ctx.visibleChildren(box.node);
    kids.forEach((k, i) => {
      if (i) y += t.space.sm;
      const kb = ctx.layout(k, box.x + pad, box.y + y, iw);
      box.children.push(kb);
      y += kb.h;
    });
    box.h = y + pad;
    box.data = { runs, ticks, kidsFrom } satisfies PlanData;
  },
  surface: (box, ctx) => card.surface!(asCard(box, ctx.props(box.node).bool("highlight") ? "hero" : "raised"), ctx),
  paint(box, ctx) {
    const d = box.data as PlanData;
    card.paint!(asCard(box, ctx.props(box.node).bool("highlight") ? "hero" : "raised"), ctx);
    paintRuns(ctx, box, d.runs);
    for (const k of d.ticks) drawIcon(ctx.g, "check", box.x + ctx.theme.space.lg, box.y + k.dy, k.size, ctx.theme.colors.accent);
  },
};

export const pricing: ComponentDef = {
  type: "pricing",
  category: "layout",
  description: "A pricing section: a heading and the plans under it, side by side on a wide screen and stacked on a phone. Each plan is a plan element.",
  text: { description: "The section's heading, like Simple pricing.", required: false },
  props: { eyebrow: eyebrowProp, lead: leadProp, align: alignProp },
  children: ["plan"],
  picks: [{ for: "plans or prices to compare on a landing page", write: 'pricing "Plans" holding plan price="$12"' }],
  example: `pricing "Simple pricing" lead="Start free. Upgrade when you travel more."
  plan "Free" price="$0" features="Three trips; Shared itineraries"
    button "Start" variant=secondary on=emit:free
  plan "Pro" price="$12" per="/ month" features="Unlimited trips; Offline plans; Priority support" highlight=true badge="Most popular"
    button "Start free trial" on=emit:trial`,
  semantics(box) {
    const head = dataOf(box).head;
    return { role: "region", name: head.runs.find((r) => r.key === "title")?.text || "Pricing", parts: runParts(box, head.runs, 2) };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const padY = grown(t.space.xl, box.w, 1, 1.6);
    const contentW = Math.max(0, Math.min(box.w - t.space.lg * 2, MAX_CONTENT));
    const left = (box.w - contentW) / 2;
    const head: Head = layoutHead(ctx, left, contentW, padY, headSpec(ctx, box, grown(t.text.title, box.w, 1.1, 1.6), grown(t.text.lead, box.w, 1, 1.2)));
    const plans = ctx.visibleChildren(box.node);
    const gap = t.space.md;
    const min = Math.round(t.text.body * PLAN_MIN);
    const fits = Math.max(1, Math.min(plans.length || 1, Math.floor((contentW + gap) / (min + gap))));
    const rows = Math.max(1, Math.ceil(plans.length / fits));
    const cols = Math.max(1, Math.ceil(plans.length / rows));
    const cw = Math.max(0, (contentW - gap * (cols - 1)) / cols);
    let y = box.y + padY + head.h + (head.h ? t.space.xl : 0);
    for (let r = 0; r < rows; r++) {
      if (r) y += gap;
      const placed: Box[] = plans.slice(r * cols, (r + 1) * cols).map((k, i) => {
        const kb = ctx.layout(k, box.x + left + i * (cw + gap), y, cw);
        box.children.push(kb);
        return kb;
      });
      // Equal heights in a row, with each plan's buttons moved down to its bottom edge so they line up.
      const tallest = Math.max(0, ...placed.map((b) => b.h));
      for (const b of placed) {
        const more = tallest - b.h;
        if (more > 0) {
          const from = (b.data as PlanData | undefined)?.kidsFrom ?? 0;
          for (const kid of b.children) if (kid.y - b.y >= from - 0.5) ctx.shift(kid, 0, more);
          b.h = tallest;
        }
      }
      y += tallest;
    }
    box.h = y - box.y + padY;
    box.data = { head };
  },
  paint(box, ctx) {
    paintRuns(ctx, box, dataOf(box).head.runs);
  },
};
