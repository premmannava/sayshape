/**
 * The theme inside a slide: the theme's slide tokens (larger type, spacing,
 * corners and controls, since a slide is laid out 960 px wide and then
 * scaled), or, for a theme without them, its own tokens scaled up.
 */
import type { Theme } from "../../theme";

type SlideTokens = NonNullable<Theme["slide"]>;

/** How much larger than the screen's tokens a theme without slide tokens draws inside a slide. */
const FALLBACK_SCALE = 1.6;

const up = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * FALLBACK_SCALE)])) as T;

/** A theme's slide tokens, or its own scaled up. */
export function slideTokens(t: Theme): SlideTokens {
  return t.slide ?? {
    space: up(t.space),
    radius: up(t.radius),
    text: up(t.text),
    control: up(t.control),
    heading: { cover: Math.round(t.text.display * FALLBACK_SCALE * 1.25), slide: Math.round(t.text.display * FALLBACK_SCALE * 0.85) },
  };
}

const made = new WeakMap<Theme, Theme>();

/** The theme a slide and everything on it is laid out and painted with. The same object for the same theme, so layout can reuse its context. */
export function slideTheme(t: Theme): Theme {
  let s = made.get(t);
  if (!s) {
    const k = slideTokens(t);
    s = { ...t, space: k.space, radius: k.radius, text: k.text, control: k.control };
    made.set(t, s);
    // A slide inside a slide keeps the same sizes.
    made.set(s, s);
  }
  return s;
}
