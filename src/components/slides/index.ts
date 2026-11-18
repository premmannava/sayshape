/**
 * Slides: `deck` and `slide`, for writing a slide deck. Both are in
 * coreComponents like any other element; slideComponents (this entry point,
 * `sayshape/slides`) lists the same two for hosts that import them on their own.
 *
 *   state page=0
 *   deck bind=page
 *     slide "Q3 business review" layout=title
 *       text "Revenue is up 18% on last year" style=lead tone=muted
 *     slide "What we do next"
 *       timeline
 *         step "Hire two in support" time="Nov" status=current
 *
 * Everything they need is in this folder, plus two optional engine hooks
 * (ComponentDef.childTransform and ComponentDef.theme) and the theme's
 * optional slide tokens, which do nothing outside a slide.
 */
import type { ComponentDef } from "../../component";
import { deck } from "./deck";
import { slide } from "./slide";

export { deck, slide };
export { DESIGN_W, DESIGN_H, MIN_FIT } from "./slide";
export { slideTheme, slideTokens } from "./theme";

export const slideComponents: ComponentDef[] = [deck, slide];
