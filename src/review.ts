/**
 * The layout check: design rules a spec can break while still parsing
 * cleanly. Like the scene check (src/components/scene/review.ts), these are
 * warnings for the model to tidy, not errors: the interface still shows.
 * Headless: it reads the parsed tree only.
 *
 * - a card inside another card (the guide's rule: cards group related
 *   content and never nest; a column or a divider separates parts inside one).
 *   No card variant is meant as an inner panel: an outline or tinted card is
 *   still a framed surface, so a frame inside a frame either way.
 */
import type { Diagnostic, SayShapeNode } from "./types";

/** The most layout problems reported for one spec. */
export const MAX_LAYOUT_PROBLEMS = 5;

/** Elements that float over the screen instead of sitting in their parent: a card in one isn't inside the card around it. */
const FLOATING = new Set(["dialog"]);

export const NESTED_CARD = "card inside a card; use a column or divider instead (cards never nest)";

/** Layout problems in a parsed spec, in line order. */
export function reviewLayout(root: SayShapeNode): Diagnostic[] {
  const out: Diagnostic[] = [];
  const walk = (node: SayShapeNode, inCard: boolean) => {
    for (const child of node.children) {
      if (out.length >= MAX_LAYOUT_PROBLEMS) return;
      const floating = FLOATING.has(child.type);
      const card = child.type === "card";
      if (card && inCard && !floating) out.push({ line: child.line, severity: "warning", message: NESTED_CARD });
      walk(child, floating ? card : inCard || card);
    }
  };
  walk(root, false);
  return out;
}
