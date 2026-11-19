/**
 * The look line: one line near the top of a spec that chooses how the whole
 * interface looks, `look mood=bold type=editorial shape=soft density=airy`.
 *
 * Every prop takes a few named options, never a value: the engine turns the
 * choice into theme tokens laid over the host's own theme (extendTheme), so a
 * spec still never holds a color, a font or a size. Colors keep coming only
 * from the host (its theme, brand colors); mood only changes how the theme's
 * own accent and shadow are used. Type pairings are fixed font stacks of
 * faces the host may already have loaded, each ending in a system face, so
 * nothing a spec says makes the engine fetch a font. Sizes are scaled from
 * the host's own, so a compact host (a chat app) stays compact.
 *
 * Inside slides, density, shape and type sizes don't apply (a slide has a
 * fixed design size); mood and type's faces do.
 */
import { extendTheme, isDark, mixColors, parseColor, type DeepPartial, type Theme, type ThemeSizes } from "./theme";

/** The options each look prop takes, with what each does: the guide and the docs read these. */
export const LOOK_OPTIONS = {
  mood: {
    quiet: "a flat accent and no shadows: calm, editorial, printed",
    bold: "the accent as a gradient (primary buttons, accent progress bars, a strong wash on hero cards) and deeper shadows: confident, promotional",
  },
  type: {
    editorial: "serif headings over the app's own text, a little larger: magazines, stories, portfolios",
    classic: "serif headings and text: letters, menus, long reading",
    technical: "monospaced headings: developer tools, data, specs",
    system: "the device's own interface font for everything: native-looking apps, widgets, phone screens",
  },
  shape: {
    sharp: "nearly square corners: precise, formal",
    soft: "rounder corners: friendly",
    round: "very round corners: playful, consumer apps",
  },
  density: {
    compact: "tighter spacing and shorter controls: tools, tables, admin",
    airy: "more space and taller controls: landing pages, reading, calm forms",
  },
} as const;

/** What each look prop is about, for the guide and diagnostics. */
export const LOOK_PROP_DESCRIPTIONS: Record<LookProp, string> = {
  mood: "how strongly the app's accent color is used",
  type: "the pairing of typefaces",
  shape: "how round corners are",
  density: "how much room things get",
};

export type LookProp = keyof typeof LOOK_OPTIONS;
export type LookOption<P extends LookProp> = keyof (typeof LOOK_OPTIONS)[P] & string;
/** The choices a look line made; a prop left out (or written as default) keeps the host's. */
export type Look = { [P in LookProp]?: LookOption<P> };

export const LOOK_PROPS = Object.keys(LOOK_OPTIONS) as LookProp[];
/** Accepted for every prop: the host theme's own, the same as leaving the prop out. */
export const LOOK_DEFAULT = "default";

/** The options a prop takes, default first. */
export function lookOptions(prop: LookProp): string[] {
  return [LOOK_DEFAULT, ...Object.keys(LOOK_OPTIONS[prop])];
}

/**
 * The font stacks type= chooses from: faces a host may already have loaded,
 * then faces most systems have, then the generic family. Reviewed here and
 * never taken from a spec.
 */
export const LOOK_FONTS = {
  serifDisplay: '"Fraunces", "Playfair Display", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  serifText: '"Source Serif 4", "Source Serif Pro", Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif',
  /** The platform's UI face: San Francisco on Apple devices, Segoe UI on Windows, Roboto on Android. Always installed, so never fetched. */
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
} as const;

const SPACE_SCALE = { compact: 0.75, airy: 1.35 } as const;
const CONTROL_SCALE = { compact: 0.9, airy: 1.1 } as const;
/** The shortest a compact control gets: still well over WCAG 2.5.8's 24 px target. */
const MIN_CONTROL = 28;
const RADIUS_SCALE = { sharp: 0.33, soft: 1.5, round: 2.25 } as const;
/** editorial: headings a step larger, to carry the serif. */
const EDITORIAL_TEXT = { display: 1.2, title: 1.1 } as const;
/** How far bold's gradient end moves from the accent. */
const BOLD_MIX = 0.3;
const BOLD_SHADOW = 1.8;
const MAX_SHADOW_ALPHA = 0.6;

/**
 * A look as the engine applies it: a spec's choices, over what the host and
 * the screen bring. Never written in a spec: the engine sets these.
 * density "chat": the compact scale (SayShapeOptions.context "chat", where
 * the spec chose no density). surface "lines": Hairline surfaces (chats).
 * screen "phone": a canvas narrower than PHONE_WIDTH, so the theme's phone
 * sizes apply.
 */
export type AppliedLook = Omit<Look, "density"> & {
  density?: LookOption<"density"> | typeof CHAT_DENSITY;
  surface?: "lines";
  screen?: "phone";
};
/** The compact scale, as the density a chat gets by default. */
export const CHAT_DENSITY = "chat";

/**
 * The compact scale, as shares of the host's own tokens (SayShape's light
 * and dark themes: lead 16, title 20, display 30, a 40 px control, spacing
 * 4/8/14/22/32 and a 12 px large corner), so a host's own font size still
 * scales it. With those it gives lead 15, title 18 (17 on a phone), display
 * 24 (22), 32 px controls (34) with 23 px small ones (24), spacing
 * 4/6/10/12/18 and a 10 px large corner. Body and caption text keep the
 * host's sizes, for reading.
 */
const COMPACT = {
  text: { lead: 15 / 16, title: 18 / 20, display: 24 / 30 },
  phoneText: { title: 17 / 20, display: 22 / 30 },
  control: 32 / 40,
  phoneControl: 34 / 40,
  /** A small button's height, as a share of a compact control's. */
  small: 0.72,
  space: { xs: 1, sm: 6 / 8, md: 10 / 14, lg: 12 / 22, xl: 18 / 32 },
  radiusLg: 10 / 12,
} as const;

/** The compact scale's sizes of parts (ThemeSizes in src/theme.ts), on a desktop. */
const COMPACT_SIZES: ThemeSizes = {
  listPadX: 12,
  listPadY: 8,
  listIcon: 18,
  listIconGap: 10,
  accordionHeader: 36,
  statLabel: 12,
  pill: 18,
  badge: 20,
  label: 13,
  labelGap: 4,
  fieldPadX: 10,
  fieldText: 14,
  segmented: 32,
  segmentedPadX: 12,
  calloutAction: 28,
  calloutIcon: 16,
  emptyIcon: 32,
  emptyButton: 32,
  emptyPad: 12,
  plotMin: 144,
};

/**
 * What differs on a phone: taller headers and controls for fingers, 16 px
 * field text (under 16, iOS zooms the page when the native input opens) and
 * a shorter shortest plot.
 */
const COMPACT_PHONE_SIZES: Partial<ThemeSizes> = {
  accordionHeader: 44,
  fieldText: 16,
  segmented: 34,
  emptyButton: 34,
  plotMin: 120,
};

/** The gaps between children of column, row and grid in the compact scale. */
const COMPACT_GAPS = { column: 6, row: 8, grid: 8 } as const;

const controlAt = (t: Theme, k: number) => Math.max(MIN_CONTROL, Math.round(t.control.height * k));

/**
 * The compact scale's tokens over a theme: the sizes above, list rows on one
 * line where they fit (listInline), tighter gaps, and a phone group for
 * canvases narrower than PHONE_WIDTH. A theme it already made (scale
 * "compact", such as a host-token theme shown in a chat) isn't shrunk again.
 */
export function compactPatch(t: Theme): DeepPartial<Theme> {
  if (t.scale === "compact") return { listInline: true, gaps: { ...COMPACT_GAPS } };
  const height = controlAt(t, COMPACT.control), phoneHeight = controlAt(t, COMPACT.phoneControl);
  const text = (k: Partial<Record<keyof Theme["text"], number>>) =>
    Object.fromEntries(Object.entries(k).map(([n, v]) => [n, Math.round(t.text[n as keyof Theme["text"]] * v)])) as Partial<Theme["text"]>;
  return {
    text: text(COMPACT.text),
    control: { height, small: Math.round(height * COMPACT.small) },
    space: Object.fromEntries(Object.entries(t.space).map(([n, v]) => [n, Math.max(2, Math.round(v * COMPACT.space[n as keyof Theme["space"]]))])) as Theme["space"],
    radius: { lg: Math.max(Math.min(t.radius.lg, 1), Math.round(t.radius.lg * COMPACT.radiusLg)) },
    listInline: true,
    gaps: { ...COMPACT_GAPS },
    sizes: { ...COMPACT_SIZES },
    phone: {
      text: text(COMPACT.phoneText),
      control: { height: phoneHeight, small: Math.round(phoneHeight * COMPACT.small) },
      sizes: { ...COMPACT_SIZES, ...COMPACT_PHONE_SIZES },
    },
    scale: "compact",
    // A slide keeps its design size: its own tokens, or the host's scaled as before.
    slide: t.slide ?? slideFallback(t),
  };
}

/**
 * Hairline surfaces: cards, lists and tables draw no fill or shadow, only a
 * 1px line, and take the page's color (raised becomes surface), so they sit
 * on the host's page as part of it. Popups and dialogs keep their shadow and
 * line border.
 */
export function linesPatch(t: Theme): DeepPartial<Theme> {
  return { surfaces: "lines", colors: { raised: t.colors.surface } };
}

/** A look as a short key, for telling whether it changed ("" for none). */
export function lookKey(look: AppliedLook | null | undefined): string {
  if (!look) return "";
  const keys = [...LOOK_PROPS, "surface", "screen"] as const;
  return keys.filter((p) => look[p]).map((p) => `${p}=${look[p]}`).join(" ");
}

/** The theme each looked theme was made from, so applying a look again starts from the host's, never compounds. */
const baseOf = new WeakMap<Theme, Theme>();
const made = new WeakMap<Theme, Map<string, Theme>>();

/**
 * The host's theme with a look laid over it. No choices: the very same theme.
 * A theme this made is traced back to the host's first, so passing it back in
 * (setTheme(sayshape.theme)) gives the same result, not a doubled one.
 */
export function applyLook(theme: Theme, look: AppliedLook | null | undefined): Theme {
  const base = baseOf.get(theme) ?? theme;
  // A phone screen changes only a theme that has phone sizes (its own, or the compact scale's).
  if (look?.screen && !base.phone && look.density !== CHAT_DENSITY) {
    const { screen: _screen, ...rest } = look;
    look = rest;
  }
  const key = lookKey(look);
  if (!key || !look) return base;
  let byKey = made.get(base);
  if (!byKey) made.set(base, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) {
    out = extendTheme(base, lookPatch(base, look));
    if (look.screen === "phone" && out.phone) out = extendTheme(out, out.phone);
    baseOf.set(out, base);
    byKey.set(key, out);
  }
  return out;
}

const scale = <T extends Record<string, number>>(o: T, k: number, min = 0): T =>
  Object.fromEntries(Object.entries(o).map(([n, v]) => [n, Math.max(min, Math.round(v * k))])) as T;

function lookPatch(t: Theme, look: AppliedLook): DeepPartial<Theme> {
  const patch: DeepPartial<Theme> = look.density === CHAT_DENSITY ? compactPatch(t) : {};
  if (look.density && look.density !== CHAT_DENSITY) {
    patch.space = scale(t.space, SPACE_SCALE[look.density], 2);
    patch.control = { height: Math.max(MIN_CONTROL, Math.round(t.control.height * CONTROL_SCALE[look.density])) };
  }
  // A rounded corner stays at least 1 px, so elements that inset a radius by 1 never get a negative one.
  if (look.shape) patch.radius = Object.fromEntries(Object.entries(t.radius).map(([n, v]) => [n, Math.max(Math.min(v, 1), Math.round(v * RADIUS_SCALE[look.shape!]))])) as Theme["radius"];
  if (look.type === "editorial") {
    patch.font = { display: LOOK_FONTS.serifDisplay };
    patch.text = { ...patch.text, display: Math.round((patch.text?.display ?? t.text.display) * EDITORIAL_TEXT.display), title: Math.round((patch.text?.title ?? t.text.title) * EDITORIAL_TEXT.title) };
    // The phone's heading sizes replace these on a phone: they carry the serif too.
    const phone = (patch.phone ?? t.phone) as Theme["phone"];
    const pt = phone?.text;
    if (phone && pt) {
      const up = (v: number | undefined, k: number) => (v === undefined ? undefined : Math.round(v * k));
      const text: Partial<Theme["text"]> = { ...pt };
      const display = up(pt.display, EDITORIAL_TEXT.display), title = up(pt.title, EDITORIAL_TEXT.title);
      if (display !== undefined) text.display = display;
      if (title !== undefined) text.title = title;
      patch.phone = { ...phone, text };
    }
  } else if (look.type === "classic") {
    patch.font = { family: LOOK_FONTS.serifText, display: LOOK_FONTS.serifText };
  } else if (look.type === "system") {
    patch.font = { family: LOOK_FONTS.system, display: LOOK_FONTS.system };
  } else if (look.type === "technical") {
    // The host's own monospaced stack, so it's a face the host already uses.
    patch.font = { display: t.font.mono };
  }
  const colors = moodColors(t, look.mood);
  if (colors) patch.colors = colors;
  if (colors && look.mood) patch.mood = look.mood;
  if (look.surface === "lines") {
    const lines = linesPatch(t);
    patch.surfaces = lines.surfaces;
    patch.colors = { ...patch.colors, ...lines.colors };
  }
  // A slide keeps its design size whatever the look: its own tokens, or the host's scaled as before.
  if (patch.space || patch.radius || patch.text || patch.control) patch.slide = t.slide ?? slideFallback(t);
  return patch;
}

/** The slide tokens a theme without its own gets (src/components/slides/theme.ts), worked out from the host's sizes, before the look. */
function slideFallback(t: Theme): NonNullable<Theme["slide"]> {
  const up = <T extends Record<string, number>>(o: T) => scale(o, 1.6);
  return { space: up(t.space), radius: up(t.radius), text: up(t.text), control: up(t.control), heading: { cover: Math.round(t.text.display * 1.6 * 1.25), slide: Math.round(t.text.display * 1.6 * 0.85) } };
}

/**
 * How mood uses the theme's own colors. quiet: the accent alone, flat, and no
 * shadow. bold: a gradient from the accent toward whichever of the theme's
 * ink or surface sets text on the accent further apart (so it reads at least
 * as well as on the accent itself), unless the theme already has one, and a
 * deeper shadow. A forced-colors theme is left alone: the person's colors win.
 */
function moodColors(t: Theme, mood: Look["mood"]): Partial<Theme["colors"]> | null {
  if (!mood || t.name.endsWith("-forced-colors")) return null;
  const c = t.colors;
  if (mood === "quiet") return { accent2: c.accent, shadow: "transparent" };
  const out: Partial<Theme["colors"]> = {};
  if (c.accent2 === c.accent) {
    // Text on the accent is dark: go lighter. Light: go darker.
    const [darker, lighter] = isDark(c.ink) ? [c.ink, c.surface] : [c.surface, c.ink];
    const end = mixColors(c.accent, isDark(c.onAccent) ? lighter : darker, BOLD_MIX);
    if (end) out.accent2 = end;
  }
  const s = parseColor(c.shadow);
  if (s && s[3] > 0) out.shadow = `rgba(${s[0]}, ${s[1]}, ${s[2]}, ${Math.min(MAX_SHADOW_ALPHA, Math.round(s[3] * BOLD_SHADOW * 1000) / 1000)})`;
  return out;
}

/** The face headings are drawn in: the theme's display face, or its text face. */
export function displayFamily(theme: Theme): string {
  return theme.font.display ?? theme.font.family;
}

/** What the guide says about the look line (GuideOptions.look), built from LOOK_OPTIONS. */
export function lookGuide(mode: "full" | "compact"): string {
  const example = "look mood=bold type=editorial shape=soft density=airy";
  if (mode === "compact") {
    return `LOOK (optional): ${example} as the very first line, unindented, once; leave a prop out for the app's own. Never colors, fonts or sizes.
${LOOK_PROPS.map((p) => `- ${p}=${Object.keys(LOOK_OPTIONS[p]).join("|")}`).join("\n")}`;
  }
  const lines = LOOK_PROPS.map((p) => {
    const opts = Object.entries(LOOK_OPTIONS[p]).map(([o, d]) => `${o} (${d})`).join(", ");
    return `- ${p}, ${LOOK_PROP_DESCRIPTIONS[p]}: ${opts}`;
  });
  return `LOOK (optional)
- One line chooses how the whole interface looks: ${example}
- Write it as the very first line, unindented, once, so the screen draws in its look from the start. Leave out a prop, or the whole line, to keep the app's own look.
${lines.join("\n")}
- Choose what suits the request, so different answers look different. It never sets colors, fonts or sizes: those stay the app's.`;
}
