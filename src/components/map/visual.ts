/**
 * Visual language for Canvas maps, derived exclusively from SayShape theme
 * tokens. No built-in "dark map" colors or extra syntax for AI models.
 *
 * The exact same visualization spec tracks the host's active light/dark
 * theme and any custom accent immediately on the next paint.
 */
import { isDarkTheme, type Theme } from "../../theme";
import { mixedColor } from "./analytics";

export interface MapVisual {
  dark: boolean;
  ocean: string;
  noData: string;
  outline: string;
  graticule: string;
  bubbleFill: string;
  bubbleOutline: string;
  label: string;
  labelHalo: string;
  tooltip: string;
  tooltipBorder: string;
  countryStrokeOpacity: number;
  stateStrokeOpacity: number;
  graticuleOpacity: number;
  bubbleOpacity: number;
}

export function mapVisual(theme: Theme): MapVisual {
  const c = theme.colors;
  const dark = isDarkTheme(theme);
  return {
    dark,
    ocean: c.surface,
    noData: mixedColor(c.land, c.raised, dark ? 0.24 : 0.38),
    outline: c.line,
    graticule: c.line,
    bubbleFill: c.accent,
    bubbleOutline: c.raised,
    label: c.ink,
    labelHalo: c.surface,
    tooltip: c.raised,
    tooltipBorder: c.line,
    countryStrokeOpacity: dark ? 0.57 : 0.72,
    stateStrokeOpacity: dark ? 0.34 : 0.42,
    graticuleOpacity: dark ? 0.5 : 0.68,
    bubbleOpacity: dark ? 0.83 : 0.76,
  };
}

/**
 * Three-step sequential scale: cool-slate -> intermediate accent -> full
 * accent. The same function paints countries and the legend's gradient.
 * All three stops are derived from the current theme's land, series2 and
 * accent tokens. It works with light, dark and host-customized palettes.
 */
export function choroplethStops(theme: Theme): readonly [string, string, string] {
  const c = theme.colors;
  const dark = isDarkTheme(theme);
  const low = mixedColor(c.land, c.series2, dark ? 0.53 : 0.57);
  const middle = mixedColor(c.land, c.accent, dark ? 0.7 : 0.74);
  return [low, middle, c.accent];
}

export function choroplethColor(theme: Theme, t: number): string {
  const [low, middle, high] = choroplethStops(theme);
  const v = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return v <= 0.5
    ? mixedColor(low, middle, 2 * v)
    : mixedColor(middle, high, 2 * (v - 0.5));
}
