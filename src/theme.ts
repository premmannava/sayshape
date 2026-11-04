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
     * Categorical colors for chart series and pie slices, used in this order.
     * series1 is the accent. The first four stay apart under common color
     * blindness (protanopia, deuteranopia), checked with every pair against each other.
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
    ink: "#14171C",
    muted: "#5E6573",
    line: "#E1E4E9",
    accent: "#0F766E",
    onAccent: "#FFFFFF",
    good: "#15803D",
    warn: "#B45309",
    bad: "#D32F2F",
    focus: "#2563EB",
    land: "#DCE0E6",
    landHighlight: "#A6D6D1",
    landHover: "#BCC3CD",
    debug: "#C2410C",
    shadow: "rgba(15, 20, 30, 0.06)",
    series1: "#0F766E",
    series2: "#A2461A",
    series3: "#64399D",
    series4: "#AD8B1C",
    series5: "#C74C8E",
    series6: "#2F8EFC",
  },
};

export const darkTheme: Theme = {
  name: "dark",
  ...base,
  colors: {
    surface: "#111316",
    raised: "#191B1F",
    ink: "#ECEDEF",
    muted: "#9BA1AB",
    line: "#2C2F35",
    accent: "#2EC4B6",
    onAccent: "#04211E",
    good: "#5CC98A",
    warn: "#EDB04D",
    bad: "#F2777E",
    focus: "#7AA7FF",
    land: "#2A2E35",
    landHighlight: "#1D5753",
    landHover: "#3A3F48",
    debug: "#FB923C",
    shadow: "rgba(0, 0, 0, 0.45)",
    series1: "#2EC4B6",
    series2: "#B74C05",
    series3: "#7C61A8",
    series4: "#B08E26",
    series5: "#DD569F",
    series6: "#2F8EFC",
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
