/**
 * Design tokens. Components never use literal colors or sizes: they read
 * everything from the theme, which is what keeps model-generated screens
 * on-brand.
 */
export interface Theme {
  name: string;
  colors: {
    /** The base the interface sits on: the page, and inset fields such as inputs. */
    surface: string;
    /**
     * Lifted surfaces: cards, lists and popups. The same as surface in light
     * themes (cards are set apart by a border and a soft shadow); a step
     * lighter in dark ones, so elevation reads as layered charcoal.
     */
    raised: string;
    ink: string;
    muted: string;
    line: string;
    /**
     * The outline that shows where a control is: a field's border, an
     * unchecked box or radio, a switch that's off. At least 3:1 against
     * surface and raised (WCAG 1.4.11), where line is a quiet divider.
     */
    control: string;
    accent: string;
    /**
     * Where accent gradients end: the hero card's wash, a primary button, a
     * progress fill. The same as accent for a flat theme, which then paints
     * those in the accent alone.
     */
    accent2: string;
    onAccent: string;
    good: string;
    warn: string;
    bad: string;
    focus: string;
    land: string;
    landHighlight: string;
    landHover: string;
    debug: string;
    /** The soft shadow under cards and raised controls, so surfaces sit above the page instead of being outlined on it. */
    shadow: string;
    /**
     * Harmonized, low-saturation series for lines and bars. The first uses
     * the accent; steel, sage, stone, blue and moss follow. Keep strokes
     * visible against the chart surface, not pastel or rainbow-colored.
     * Pie and donut charts soften these same families for broader segments.
     */
    series1: string;
    series2: string;
    series3: string;
    series4: string;
    series5: string;
    series6: string;
  };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number };
  font: { family: string; mono: string };
  text: { caption: number; body: number; lead: number; title: number; display: number };
  control: { height: number };
}

const base = {
  space: { xs: 4, sm: 8, md: 14, lg: 22, xl: 32 },
  radius: { sm: 6, md: 8, lg: 12 },
  font: {
    family: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  },
  text: { caption: 12, body: 14, lead: 16, title: 20, display: 30 },
  control: { height: 40 },
};

export const lightTheme: Theme = {
  name: "light",
  ...base,
  colors: {
    surface: "#FFFFFF",
    raised: "#FFFFFF",
    ink: "#1B262A",
    muted: "#5C6B72",
    line: "#E1E7E8",
    control: "#86939A",
    accent: "#176F69",
    accent2: "#176F69",
    onAccent: "#FFFFFF",
    good: "#277253",
    warn: "#9A641D",
    bad: "#B14E50",
    focus: "#277E79",
    land: "#DEE5E3",
    landHighlight: "#B4D7D0",
    landHover: "#C2CECB",
    debug: "#A86C3A",
    shadow: "rgba(25, 43, 45, 0.065)",
    series1: "#176F69",
    series2: "#557887",
    series3: "#638777",
    series4: "#967D61",
    series5: "#5E798C",
    series6: "#767F71",
  },
};

export const darkTheme: Theme = {
  name: "dark",
  ...base,
  colors: {
    surface: "#12191C",
    raised: "#1D2629",
    ink: "#EDF2F1",
    muted: "#ACBABC",
    line: "#344348",
    control: "#677A80",
    accent: "#72C6BB",
    accent2: "#72C6BB",
    onAccent: "#112825",
    good: "#88CEAA",
    warn: "#E5B77A",
    bad: "#EB9393",
    focus: "#82C9C0",
    land: "#29373B",
    landHighlight: "#315F59",
    landHover: "#36494E",
    debug: "#DEA36C",
    shadow: "rgba(0, 0, 0, 0.38)",
    series1: "#72C6BB",
    series2: "#9DB8C4",
    series3: "#A6C4B1",
    series4: "#CDBC9F",
    series5: "#91B1C2",
    series6: "#ADB8A0",
  },
};

/**
 * Studio: a brighter, more contemporary look, offered alongside the default.
 * A cool near-white page with white cards on it, Inter, rounder corners,
 * an indigo-to-violet accent that runs as a gradient through hero cards,
 * primary buttons and progress fills, and clear, distinct chart colors.
 * The dark version is near-black with charcoal cards and lighter accents.
 */
const studioBase = {
  space: { xs: 4, sm: 8, md: 14, lg: 24, xl: 32 },
  radius: { sm: 8, md: 10, lg: 16 },
  font: {
    family: '"Inter", "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  },
  text: { caption: 12, body: 14, lead: 16, title: 20, display: 32 },
  control: { height: 40 },
};

export const studioLightTheme: Theme = {
  name: "studio-light",
  ...studioBase,
  colors: {
    surface: "#F5F6FA",
    raised: "#FFFFFF",
    ink: "#0F1222",
    muted: "#565E76",
    line: "#E3E6EE",
    control: "#7F879C",
    accent: "#4F46E5",
    accent2: "#7C3AED",
    onAccent: "#FFFFFF",
    good: "#15803D",
    warn: "#B45309",
    bad: "#D42020",
    focus: "#5B54E8",
    land: "#E4E7F0",
    landHighlight: "#C8C6F7",
    landHover: "#D2D6E2",
    debug: "#B45309",
    shadow: "rgba(22, 27, 61, 0.075)",
    series1: "#4F46E5",
    series2: "#0E87A8",
    series3: "#D63A7A",
    series4: "#C2690A",
    series5: "#0F8C63",
    series6: "#8B5CF6",
  },
};

export const studioDarkTheme: Theme = {
  name: "studio-dark",
  ...studioBase,
  colors: {
    surface: "#0B0D14",
    raised: "#161925",
    ink: "#F1F3F9",
    muted: "#A2A8BC",
    line: "#2A2F40",
    control: "#737A93",
    accent: "#8F8CFF",
    accent2: "#C38BFF",
    onAccent: "#0B0D14",
    good: "#5ED394",
    warn: "#F5BE4F",
    bad: "#FB8282",
    focus: "#A5A3FF",
    land: "#1D2131",
    landHighlight: "#3B3A80",
    landHover: "#282D40",
    debug: "#F5BE4F",
    shadow: "rgba(0, 0, 0, 0.5)",
    series1: "#8F8CFF",
    series2: "#3CC8E6",
    series3: "#F27AB4",
    series4: "#F5BE4F",
    series5: "#4FD1A0",
    series6: "#C38BFF",
  },
};

/** The chart series colors, in order. */
export function seriesColors(theme: Theme): string[] {
  const c = theme.colors;
  return [c.series1, c.series2, c.series3, c.series4, c.series5, c.series6];
}

/** How many series colors a theme has: the most series one chart draws. */
export const SERIES_COUNT = 6;

/**
 * A little color, not a rainbow: one deep teal and supporting steel, sage,
 * warm stone, dusty blue and moss. The same six configurable series tokens
 * feed every chart; broad pie slices are softer than thin line-chart strokes.
 * Hover still uses the unmuted accent, and custom host series colors follow.
 */
export function sliceColors(theme: Theme): string[] {
  const [accent, steel, sage, stone, blue, moss] = seriesColors(theme);
  const { raised, ink } = theme.colors;
  // A theme with an accent gradient (Studio) is a vivid one: its slices are its series colors.
  if (theme.colors.accent2 !== theme.colors.accent) return seriesColors(theme);
  if (isDarkTheme(theme)) {
    return [
      mixColors(raised, accent!, 0.77) ?? accent!,
      steel!, sage!, stone!, blue!, moss!,
    ];
  }
  const deep = mixColors(accent!, steel!, 0.6) ?? accent!;
  return [
    mixColors(deep, ink, 0.25) ?? deep,
    mixColors(steel!, raised, 0.18) ?? steel!,
    mixColors(sage!, raised, 0.32) ?? sage!,
    mixColors(stone!, raised, 0.40) ?? stone!,
    mixColors(blue!, raised, 0.25) ?? blue!,
    mixColors(moss!, raised, 0.24) ?? moss!,
  ];
}

/**
 * Series 1 is the accent: when an override changes the accent but says
 * nothing about series1, series1 follows it, so a rebranded theme's charts
 * still open in its own color.
 */
function followAccent(from: Theme["colors"], to: Theme["colors"], patch: Partial<Theme["colors"]>): void {
  if (patch.accent !== undefined && patch.series1 === undefined && from.series1 === from.accent) to.series1 = to.accent;
  // A rebrand that names only the accent gets a flat accent, not half of the old gradient.
  if (patch.accent !== undefined && patch.accent2 === undefined) to.accent2 = to.accent;
}

/**
 * A color as red, green, blue and alpha, from #rgb, #rrggbb, #rrggbbaa or
 * rgb()/rgba() (what browsers give back for a resolved CSS color), or null.
 */
export function parseColor(v: string): [number, number, number, number] | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  const out: [number, number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3]), a];
  return out.every((x) => Number.isFinite(x)) ? out : null;
}

/** a mixed toward b by t (0 = a, 1 = b), as #rrggbb; null if either isn't an opaque color. */
export function mixColors(a: string, b: string, t: number): string | null {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y || x[3] < 1 || y[3] < 1) return null;
  const c = (i: number) => Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}

/** Whether a color is dark (low luminance), for choosing how surfaces layer. */
export function isDark(color: string): boolean {
  const c = parseColor(color);
  if (!c) return false;
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128;
}

/**
 * When an override changes the surface but says nothing about raised, raised
 * follows it: equal on a light surface, a step toward the ink on a dark one.
 * So a host's or a brand's background keeps SayShape's layering.
 */
export function followSurface(to: Theme["colors"], patch: Partial<Theme["colors"]>): void {
  if (patch.surface === undefined || patch.raised !== undefined) return;
  if (!isDark(to.surface)) { to.raised = to.surface; return; }
  to.raised = mixColors(to.surface, to.ink, 0.045) ?? to.surface;
}

/** Build a theme by overriding parts of another. */
export function extendTheme(from: Theme, patch: DeepPartial<Theme>): Theme {
  const out = structuredClone(from) as Theme;
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof Theme;
    if (v && typeof v === "object") Object.assign(out[key] as object, v);
    else (out as unknown as Record<string, unknown>)[key] = v;
  }
  if (patch.colors) {
    followAccent(from.colors, out.colors, patch.colors);
    followSurface(out.colors, patch.colors);
  }
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** The CSS custom property for a color token: accent → --sayshape-accent, landHover → --sayshape-land-hover, series2 → --sayshape-series-2. */
export function cssVarOf(key: keyof Theme["colors"]): string {
  return "--sayshape-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/(\d+)$/, "-$1");
}

/** Color tokens can be supplied from CSS as `--sayshape-<token>` (e.g. --sayshape-accent, --sayshape-series-2). */
export function themeFromCSS(el: Element, from: Theme): Theme {
  const cs = getComputedStyle(el);
  const colors = { ...from.colors };
  const patch: Partial<Theme["colors"]> = {};
  for (const key of Object.keys(colors) as Array<keyof Theme["colors"]>) {
    const v = cs.getPropertyValue(cssVarOf(key)).trim();
    if (v) colors[key] = patch[key] = v;
  }
  followAccent(from.colors, colors, patch);
  followSurface(colors, patch);
  return { ...from, colors };
}

/** Whether a theme is dark: its surface is. Hosts can supply any surface, so this is read from the color, not the name. */
export function isDarkTheme(theme: Theme): boolean {
  return isDark(theme.colors.surface);
}

/**
 * The colors to draw with in a forced-colors mode (Windows Contrast Themes),
 * where the person has chosen a few system colors for everything. A canvas
 * isn't recolored by the browser, so SayShape draws with those colors
 * itself: the background in Canvas, text and lines in CanvasText, what's
 * chosen or focused in Highlight. resolve turns a CSS system color name
 * into the color it stands for now (the engine asks the browser).
 */
export function forcedColorsTheme(base: Theme, resolve: (systemColor: string) => string): Theme {
  const canvas = resolve("Canvas"), text = resolve("CanvasText"), highlight = resolve("Highlight");
  return {
    ...base,
    name: `${base.name}-forced-colors`,
    colors: {
      ...base.colors,
      surface: canvas, raised: canvas,
      ink: text, muted: text, line: text, control: text,
      accent: highlight, accent2: highlight, onAccent: resolve("HighlightText"), focus: highlight,
      good: text, warn: text, bad: text,
      land: canvas, landHighlight: highlight, landHover: resolve("GrayText"),
      debug: text, shadow: "transparent",
      // Series are told apart by their legend and labels here, not by color.
      series1: highlight, series2: text, series3: text, series4: text, series5: text, series6: text,
    },
  };
}
