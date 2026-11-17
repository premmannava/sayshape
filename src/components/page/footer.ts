/**
 * footer: the bottom of a page. A name and a line about it, columns of links,
 * and the small print. The columns sit side by side and stack on a phone.
 */
import type { ComponentDef } from "../../component";
import { alignProp, dataOf, grown, headSpec, layoutBlock, leadProp, makeRun, paintRuns, runParts } from "./shared";

export const footer: ComponentDef = {
  type: "footer",
  category: "layout",
  description: "The bottom of a page: the name of the site or company, a line about it, columns of links and the small print. Use it once, last.",
  text: { description: "The site or company name.", required: false },
  props: {
    lead: leadProp,
    note: { type: "string", description: 'The small print, like "© 2026 Northwind".' },
    align: alignProp,
  },
  children: "any",
  picks: [{ for: "the bottom of a landing page with links", write: 'footer "Northwind" note="© 2026 Northwind"' }],
  example: `footer "Northwind" lead="Trips that plan themselves." note="© 2026 Northwind"
  column
    text "Product" weight=semibold
    link "Pricing" on=emit:pricing
    link "Examples" on=emit:examples
  column
    text "Company" weight=semibold
    link "About" on=emit:about
    link "Contact" on=emit:contact`,
  semantics(box) {
    const head = dataOf(box).head;
    return { role: "region", name: head.runs.find((r) => r.key === "title")?.text || "Footer", parts: runParts(box, head.runs, 2) };
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const padY = grown(t.space.xl, box.w, 1, 1.3);
    const spec = headSpec(ctx, box, t.text.lead, t.text.body);
    const b = layoutBlock(box, ctx, { padX: t.space.lg, padY, gap: t.space.lg, headGap: t.space.lg, columns: true, head: spec });
    const note = ctx.props(box.node).str("note");
    if (note) {
      const r = makeRun(ctx, "note", note, t.text.caption, 400, t.font.family, "muted", b.left, b.width, b.contentBottom + t.space.lg, spec.align, 1.4);
      b.head.runs.push(r);
      box.h = r.dy + r.lines.length * r.lh + padY;
    }
  },
  paint(box, ctx) {
    // A hairline marks where the page ends.
    ctx.g.fillStyle = ctx.theme.colors.line;
    ctx.g.fillRect(box.x, box.y, box.w, 1);
    paintRuns(ctx, box, dataOf(box).head.runs);
  },
};
