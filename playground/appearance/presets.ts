/**
 * The playground's style presets and how a preset, a mode and an optional
 * custom accent become a SayShape Theme. Themes are built with SayShape's own
 * extendTheme from a base pair (SayShape's light and dark themes, or Studio's),
 * changing color tokens only.
 */
import { darkTheme, extendTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../../src/theme";
import { contrast, effectiveAccent, mix, over, TEXT_CONTRAST, UI_CONTRAST } from "./color";

export type PresetId = "teal" | "purple" | "blue" | "neutral" | "studio";
export type Mode = "light" | "dark" | "system";
export type Scheme = "light" | "dark";
type Colors = Partial<Theme["colors"]>;

export interface Preset {
  id: PresetId;
  label: string;
  /**
   * The themes it starts from: SayShape's own (lightTheme and darkTheme) unless it says otherwise.
   * Studio has its own font, corners and colors, so it starts from studioLightTheme and studioDarkTheme.
   */
  base?: "studio";
  /** Changes to the base's light and dark colors. Teal changes nothing: it is SayShape's default. */
  light: Colors;
  dark: Colors;
}

export const PRESETS: readonly Preset[] = [
  { id: "teal", label: "Teal", light: {}, dark: {} },
  {
    id: "purple",
    label: "Purple",
    light: { accent: "#6d28d9", onAccent: "#ffffff", landHighlight: "#d9ccf5" },
    dark: { accent: "#b69cf7", onAccent: "#0b0f14", landHighlight: "#3f3466" },
  },
  {
    id: "blue",
    label: "Blue",
    light: { accent: "#1d4ed8", onAccent: "#ffffff", landHighlight: "#c7d6f7", focus: "#7c3aed" },
    dark: { accent: "#7aaefc", onAccent: "#0b0f14", landHighlight: "#24406b", focus: "#c4a7ff" },
  },
  {
    // Greys, with controls drawn firmly: stronger lines (3:1 on the surface) and a near-ink accent.
    id: "neutral",
    label: "Neutral",
    light: { accent: "#374151", onAccent: "#ffffff", line: "#8c95a3", landHighlight: "#c3c8d0", land: "#dde1e6" },
    dark: { accent: "#d1d5db", onAccent: "#0b0f14", line: "#6b7585", landHighlight: "#4a5361", land: "#2c3443" },
  },
  // Inter, rounder corners and an indigo-to-violet accent, as its own pair of themes.
  { id: "studio", label: "Studio", base: "studio", light: {}, dark: {} },
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** The light or dark theme a preset changes: SayShape's own, or Studio's for Studio. */
export const baseTheme = (scheme: Scheme, preset?: Preset): Theme =>
  preset?.base === "studio" ? (scheme === "dark" ? studioDarkTheme : studioLightTheme) : scheme === "dark" ? darkTheme : lightTheme;

/** The name sayshape exports a preset's base theme under, for code that sets it up. */
export const baseThemeName = (scheme: Scheme, preset?: Preset): string =>
  preset?.base === "studio" ? (scheme === "dark" ? "studioDarkTheme" : "studioLightTheme") : scheme === "dark" ? "darkTheme" : "lightTheme";

export interface Resolved {
  theme: Theme;
  /** Only the color tokens that differ from SayShape's base theme for this scheme. */
  changes: Colors;
  /** The accent asked for, and whether it had to be adjusted to be readable in this scheme. */
  requestedAccent: string | null;
  accentAdjusted: boolean;
}

/**
 * The theme for a preset in a scheme, with a custom accent if one was asked
 * for. The requested accent is resolved separately in each scheme, so the
 * same request can stay as is in one and be adjusted in the other.
 */
export function resolveTheme(presetId: PresetId, scheme: Scheme, accent: string | null): Resolved {
  const preset = presetById(presetId) ?? PRESETS[0]!;
  const base = baseTheme(scheme, preset);
  const changes: Colors = { ...preset[scheme] };
  let accentAdjusted = false;
  if (accent) {
    const e = effectiveAccent(accent, base.colors.surface);
    accentAdjusted = e.adjusted;
    changes.accent = e.accent;
    changes.onAccent = e.onAccent;
    // The map's highlighted country follows the accent, softened toward the surface.
    changes.landHighlight = mix(e.accent, base.colors.surface, scheme === "dark" ? 0.6 : 0.65);
  }
  // Keep only real differences, so the default exports as nothing to change.
  for (const k of Object.keys(changes) as Array<keyof Theme["colors"]>) {
    if (changes[k]?.toLowerCase() === base.colors[k].toLowerCase()) delete changes[k];
  }
  return { theme: extendTheme(base, { colors: changes }), changes, requestedAccent: accent, accentAdjusted };
}

export interface ContrastCheck {
  name: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/**
 * The color pairs SayShape actually draws, with the contrast each needs: text
 * on the surface, a filled button's label, accent text and strokes, focus
 * rings, the selected-row and highlight tints SayShape paints (accent at 12 to
 * 16% over the surface) with text on them, and status colors used as text.
 */
export function auditTheme(theme: Theme): ContrastCheck[] {
  const c = theme.colors;
  const tint = over(c.accent, 0.16, c.surface);
  const checks: Array<[string, string, string, number]> = [
    ["Text on the surface", c.ink, c.surface, TEXT_CONTRAST],
    ["Muted text on the surface", c.muted, c.surface, TEXT_CONTRAST],
    ["Accent text and strokes on the surface", c.accent, c.surface, TEXT_CONTRAST],
    ["Button label on the accent", c.onAccent, c.accent, TEXT_CONTRAST],
    ["Focus ring on the surface", c.focus, c.surface, UI_CONTRAST],
    ["Text on a selected row or highlight", c.ink, tint, TEXT_CONTRAST],
    ["Accent text on a highlight", c.accent, tint, UI_CONTRAST],
    ["Success text", c.good, c.surface, TEXT_CONTRAST],
    ["Warning text", c.warn, c.surface, TEXT_CONTRAST],
    ["Error text", c.bad, c.surface, TEXT_CONTRAST],
  ];
  return checks.map(([name, a, b, min]) => {
    const ratio = contrast(a, b);
    return { name, ratio, min, pass: ratio >= min - 1e-9 };
  });
}

/** Field and divider lines against the surface: 3:1 makes control boundaries clear. */
export const lineContrast = (theme: Theme) => contrast(theme.colors.line, theme.colors.surface);

/**
 * Canvas text doesn't make the browser load a web font, so a theme with another face (Studio's
 * Inter) draws in a fallback until something asks for it. Ask for its weights, then call
 * redraw: a no-op once they're loaded, and quick when they already are.
 */
export function loadThemeFonts(theme: Theme, redraw: () => void): void {
  if (typeof document === "undefined" || !document.fonts) return;
  const family = theme.font.family.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
  if (!family) return;
  const faces = [400, 600, 700].map((w) => `${w} 15px "${family}"`);
  if (faces.every((f) => document.fonts.check(f))) return;
  Promise.all(faces.map((f) => document.fonts.load(f))).then(redraw, () => undefined);
}
