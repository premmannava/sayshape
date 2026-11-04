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
    accent: string;
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
     * Muted series colors for line and bar charts, in order. The first
     * series uses the brand accent, followed by slate, sage and stone tones.
     * Pie and donut charts use separate neutral shades generated from the
     * theme's own surfaces and ink, so they never become rainbow charts.
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
    accent: "#176F69",
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
    series2: "#536A79",
    series3: "#858D93",
    series4: "#788A7A",
    series5: "#A09688",
    series6: "#708496",
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
    accent: "#72C6BB",
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
    series2: "#A0B4C1",
    series3: "#C0C7CB",
    series4: "#96B09E",
    series5: "#C3B19B",
    series6: "#859CAF",
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
 * Pie and donut charts should be quiet when idle: six distinct tonal shades
 * from the surrounding raised surface toward its ink. This follows custom
 * host colors too, while active slices can use the theme accent on hover.
 * No fixed rainbow colors or new styling language are necessary.
 */
export function sliceColors(theme: Theme): string[] {
  const dark = isDarkTheme(theme);
  const weights = dark ? [0.77, 0.65, 0.54, 0.44, 0.35, 0.27] : [0.80, 0.67, 0.54, 0.43, 0.33, 0.24];
  const fallback = dark
    ? ["#C3CED0", "#A7B6BA", "#8B9EA3", "#71878D", "#586F75", "#445A60"]
    : ["#444F54", "#677479", "#89969A", "#ABB5B8", "#CAD1D3", "#E0E5E6"];
  return weights.map((weight, i) => mixColors(theme.colors.raised, theme.colors.ink, weight) ?? fallback[i]!);
}

/**
 * Series 1 is the accent: when an override changes the accent but says
 * nothing about series1, series1 follows it, so a rebranded theme's charts
 * still open in its own color.
 */
function followAccent(from: Theme["colors"], to: Theme["colors"], patch: Partial<Theme["colors"]>): void {
  if (patch.accent !== undefined && patch.series1 === undefined && from.series1 === from.accent) to.series1 = to.accent;
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

/** The CSS custom property for a color token: accent → --loom-accent, landHover → --loom-land-hover, series2 → --loom-series-2. */
export function cssVarOf(key: keyof Theme["colors"]): string {
  return "--loom-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/(\d+)$/, "-$1");
}

/** Color tokens can be supplied from CSS as `--loom-<token>` (e.g. --loom-accent, --loom-series-2). */
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
