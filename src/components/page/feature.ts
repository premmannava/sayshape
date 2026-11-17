/**
 * feature and quote: the small pieces a page's sections hold.
 *
 * - feature: an icon, a short title and a sentence, with no frame, for a grid
 *   of what a product does.
 * - quote: what a customer said, large, with who said it under it.
 */
import type { ComponentDef } from "../../component";
import { drawIcon, isIconName, type IconName } from "../../icons";
import { displayFamily } from "../../look";
import { fillTint, iconProblems, iconProp } from "../util";
import { ALIGNS, alignProp, grown, makeRun, paintRuns, runParts, type Align, type Run } from "./shared";

/** A feature's icon sits on a tile this many times the body text's size. */
const TILE = 3;

interface FeatureData { [key: string]: unknown; runs: Run[]; icon: IconName | null; tile: number; tileX: number }

export const feature: ComponentDef = {
  type: "feature",
  category: "content",
  description: "One thing a product does: an icon, a short title and a sentence under it. Put several in a grid or a row; they sit side by side and stack on a phone.",
  text: { description: "The feature's title, a few words.", required: true },
  props: {
    icon: iconProp,
    body: { type: "string", description: "One or two sentences that say what it means for the person." },
    align: alignProp,
  },
  picks: [{ for: "what a product does, three to six short points", write: 'feature "Title" icon=bolt body="One sentence."' }],
  example: `grid min=200
  feature "Real itineraries" icon=map body="Every stop is timed and checked."
  feature "No surprises" icon=shield body="Costs are shown before you book."
  feature "Works offline" icon=download body="Take the plan with you."`,
  check: (props) => iconProblems(props.icon, "icon"),
  minWidth: (_node, ctx) => ctx.theme.text.body * 12,
  semantics(box) {
    const d = box.data as FeatureData;
    return { role: "group", name: d.runs.find((r) => r.key === "title")?.text ?? "", parts: runParts(box, d.runs, 3) };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const p = ctx.props(box.node);
    const align = p.oneOf("align", ALIGNS, "left");
    const name = p.str("icon");
    const icon = name && isIconName(name) ? name : null;
    const tile = icon ? Math.round(t.text.body * TILE) : 0;
    const runs: Run[] = [];
    let y = tile ? tile + t.space.md : 0;
    const title = makeRun(ctx, "title", p.text(), t.text.lead, 600, displayFamily(t), "ink", 0, box.w, y, align, 1.3);
    runs.push(title);
    y += title.lines.length * title.lh;
    const body = p.str("body");
    if (body) {
      const r = makeRun(ctx, "lead", body, t.text.body, 400, t.font.family, "muted", 0, box.w, y + t.space.xs, align, 1.5);
      runs.push(r);
      y = r.dy + r.lines.length * r.lh;
    }
    box.h = Math.max(y, tile);
    box.data = { runs, icon, tile, tileX: align === "center" ? (box.w - tile) / 2 : 0 } satisfies FeatureData;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const d = box.data as FeatureData;
    if (d.icon) {
      // The icon on a tile of the accent's wash, in the accent.
      ctx.roundRect(box.x + d.tileX, box.y, d.tile, d.tile, theme.radius.md);
      fillTint(g, theme.colors.accent, 0.13);
      const size = Math.round(d.tile * 0.5);
      drawIcon(g, d.icon, box.x + d.tileX + (d.tile - size) / 2, box.y + (d.tile - size) / 2, size, theme.colors.accent);
    }
    paintRuns(ctx, box, d.runs);
  },
};

interface QuoteData { [key: string]: unknown; runs: Run[]; rule: number; by: Run | null }

export const quote: ComponentDef = {
  type: "quote",
  category: "content",
  description: "What a customer or expert said, in large type, with their name and role under it. For one or two strong lines of social proof.",
  text: { description: "What they said, without the quotation marks.", required: true },
  props: {
    by: { type: "string", description: "Who said it: a name." },
    role: { type: "string", description: "Their role or company, shown muted after the name." },
    align: alignProp,
  },
  picks: [{ for: "a customer quote or testimonial", write: 'quote "What they said." by="Name" role="Company"' }],
  example: `quote "We stopped writing itineraries by hand the week we found it." by="Maya Ortiz" role="Head of travel, Northwind"`,
  semantics(box) {
    const d = box.data as QuoteData;
    const said = d.runs[0]?.text ?? "";
    const who = [d.by?.text].filter(Boolean).join(", ");
    return { role: "figure", name: said, description: who || undefined };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const p = ctx.props(box.node);
    const align: Align = p.oneOf("align", ALIGNS, "left");
    // A left-aligned quote has a rule down its side, as wide as the theme's smallest space.
    const rule = align === "left" ? t.space.xs : 0;
    const left = rule ? rule + t.space.md : 0;
    const width = Math.max(1, box.w - left);
    const size = grown(t.text.title, box.w, 0.95, 1.35);
    const said = makeRun(ctx, "title", `“${p.text()}”`, size, 400, displayFamily(t), "ink", left, width, 0, align, 1.35);
    const runs: Run[] = [said];
    let y = said.lines.length * said.lh;
    let by: Run | null = null;
    const who = p.str("by");
    const role = p.str("role");
    if (who || role) {
      by = makeRun(ctx, "lead", [who, role].filter(Boolean).join(", "), t.text.body, 600, t.font.family, "muted", left, width, y + t.space.md, align, 1.4);
      runs.push(by);
      y = by.dy + by.lines.length * by.lh;
    }
    box.h = y;
    box.data = { runs, rule, by } satisfies QuoteData;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const d = box.data as QuoteData;
    if (d.rule) {
      ctx.roundRect(box.x, box.y, d.rule, box.h, d.rule / 2);
      g.fillStyle = theme.colors.accent;
      g.fill();
    }
    paintRuns(ctx, box, d.runs);
  },
};
