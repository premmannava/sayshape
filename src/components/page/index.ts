/**
 * EXPERIMENTAL, opt-in: elements made for a landing page or a website, so a
 * model asked for one writes a designed page instead of an app screen:
 * hero, section, band, feature, quote, pricing (with its plan) and footer.
 *
 *   look mood=bold type=editorial
 *   hero "Trips that plan themselves" lead="Tell us where and when." src="/images/ridge.jpg" zoom=slow
 *     button "Plan a trip" on=emit:start
 *   section "Why people use it" stagger=true enter=rise
 *     grid min=200
 *       feature "Real itineraries" icon=map body="Every stop is timed."
 *
 * Like scene and map they are off unless a host registers pageComponents
 * (this separate entry point, `sayshape/page`): without it "hero" is an
 * unknown element and the language is exactly what it was. The `page`
 * profile (src/profiles.ts) tells a model about them and also explains the
 * look line, entrance motion and pictures.
 *
 * They draw nothing of their own: every color, font, size and space is the
 * theme's, a hero's photo is the image element's painting on its scrim
 * (media.ts), and their children are ordinary elements (buttons, text,
 * grids), so pressing, focus and screen readers work as everywhere else.
 */
import type { ComponentDef } from "../../component";
import { band, hero, section } from "./blocks";
import { feature, quote } from "./feature";
import { footer } from "./footer";
import { plan, pricing, MAX_FEATURES } from "./pricing";

export { hero, section, band, feature, quote, pricing, plan, footer, MAX_FEATURES };
export { MAX_CONTENT } from "./shared";

export const pageComponents: ComponentDef[] = [hero, section, band, feature, quote, pricing, plan, footer];
