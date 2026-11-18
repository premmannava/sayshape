/**
 * A host's own design tokens: the few colors, the corner radius and the font
 * of the page SayShape sits in, so an embedded interface looks like part of
 * it (a portal, a chat) rather than a separate app.
 *
 *   <say-shape [theme]="{ background: '#f7f8fa', text: '#1c2430', accent: '#0b5cad',
 *                         radius: 6, fontFamily: 'Inter, sans-serif', fontSize: 14 }">
 *
 * Tokens come from the host app, never from a spec, and become an ordinary
 * Theme (SayShape's own token names), so every element follows them. Values
 * that aren't plain colors, lengths or font stacks are ignored, and text
 * colors that wouldn't read on the background (WCAG AA) are corrected. With
 * no chart palette, the series colors are worked out from the accent, spaced
 * apart in hue so neighbors stay distinct, and kept at 3:1 against the
 * background.
 */
import { darkTheme, extendTheme, isDark, lightTheme, parseColor, type DeepPartial, type Theme } from "./theme";
import { contrastRatio } from "./scrim";

export interface HostTokens {
  /** The page behind the interface. */
  background?: string;
  /** Cards and other surfaces on it. */
  surface?: string;
  /** Primary text. */
  text?: string;
  /** Secondary text: labels, details. */
  textSecondary?: string;
  /** Muted text, used when there's no secondary color. */
  textMuted?: string;
  border?: string;
  accent?: string;
  /** Text on the accent. Worked out when left out. */
  onAccent?: string;
  /** Corner radius in px, for medium elements; small and large scale from it. */
  radius?: number;
  fontFamily?: string;
  /** Body text size in px; every text size scales from it. */
  fontSize?: number;
  /** Chart colors, first to last. Worked out from the accent when left out. */
  series?: readonly string[];
  /** Light or dark; read from the background when left out. */
  dark?: boolean;
}

/** Whether a theme input is host tokens rather than a whole Theme. */
export function isHostTokens(v: unknown): v is HostTokens {
  return !!v && typeof v === "object" && !("colors" in (v as object)) && !("name" in (v as object));
}

const AA = 4.5;
const GRAPHIC = 3;

/** A plain color (#rgb, #rrggbb, rgb()) that's opaque, or undefined. */
function color(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const c = parseColor(v);
  return c && c[3] === 1 ? v.trim() : undefined;
}

/** A font stack that can't break out of the canvas font string. */
function fontStack(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 200 || /[;{}()\\<>]|url/i.test(s)) return undefined;
  return s;
}

function px(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");

function toHsl(c: string): [number, number, number] | null {
  const p = parseColor(c);
  if (!p) return null;
  const [r, g, b] = [p[0] / 255, p[1] / 255, p[2] / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** c moved lighter or darker (away from the background) until it reaches `ratio` against bg. */
function reaching(c: string, bg: string, ratio: number): string {
  if ((contrastRatio(c, bg) ?? 0) >= ratio) return c;
  const hsl = toHsl(c);
  if (!hsl) return c;
  const darker = !isDark(bg);
  for (let i = 1; i <= 20; i++) {
    const l = darker ? hsl[2] * (1 - i / 20) : hsl[2] + (1 - hsl[2]) * (i / 20);
    const next = fromHsl(hsl[0], hsl[1], l);
    if ((contrastRatio(next, bg) ?? 0) >= ratio) return next;
  }
  return darker ? "#000000" : "#ffffff";
}

/** Hue steps from the accent: each neighbor far from the one before it. */
const HUE_STEPS = [0, 180, 60, 240, 120, 300];

/** Six chart colors from an accent, distinct in hue and at 3:1 against the background. */
export function seriesFromAccent(accent: string, background: string): string[] {
  const hsl = toHsl(accent);
  if (!hsl) return [];
  const s = Math.max(0.45, hsl[1]);
  const l = Math.min(0.6, Math.max(0.35, hsl[2]));
  return HUE_STEPS.map((step, i) => reaching(i === 0 ? accent : fromHsl((hsl[0] + step) % 360, s, l), background, GRAPHIC));
}

/** A Theme from a host's tokens, on SayShape's light or dark theme (or `base`). */
export function themeFromTokens(tokens: HostTokens, base?: Theme): Theme {
  const background = color(tokens.background);
  const dark = typeof tokens.dark === "boolean" ? tokens.dark : background ? isDark(background) : false;
  const from = base ?? (dark ? darkTheme : lightTheme);
  const colors: Partial<Theme["colors"]> = {};
  const surface = background ?? from.colors.surface;
  if (background) colors.surface = background;
  const raised = color(tokens.surface);
  if (raised) colors.raised = raised;
  // Text sits on the page and on cards, so it has to read on both (the page's, then the card's).
  const card = raised ?? (background ? undefined : from.colors.raised);
  const readable = (c: string, ratio: number) => {
    const onPage = reaching(c, surface, ratio);
    return card ? reaching(onPage, card, ratio) : onPage;
  };
  // Given or not: a theme's own text may not read on a host's background (dark: true on a light page).
  colors.ink = readable(color(tokens.text) ?? from.colors.ink, AA);
  colors.muted = readable(color(tokens.textSecondary) ?? color(tokens.textMuted) ?? from.colors.muted, AA);
  const line = color(tokens.border);
  if (line) colors.line = line;
  const accent = color(tokens.accent);
  if (accent) {
    colors.accent = readable(accent, GRAPHIC);
    colors.focus = colors.accent;
    const on = color(tokens.onAccent);
    const white = contrastRatio("#ffffff", colors.accent) ?? 0, black = contrastRatio("#000000", colors.accent) ?? 0;
    colors.onAccent = on && (contrastRatio(on, colors.accent) ?? 0) >= AA ? on : white >= black ? "#ffffff" : "#000000";
  }
  const given = (tokens.series ?? []).map(color).filter((c): c is string => !!c);
  const series = (given.length ? given : accent ? seriesFromAccent(colors.accent!, surface) : []).map((c) => readable(c, GRAPHIC));
  series.slice(0, 6).forEach((c, i) => { (colors as Record<string, string>)[`series${i + 1}`] = c; });

  const patch: DeepPartial<Theme> = { colors };
  const r = px(tokens.radius, 0, 24);
  if (r !== undefined) patch.radius = { sm: Math.round(r * 0.75), md: Math.round(r), lg: Math.round(r * 1.5) };
  const family = fontStack(tokens.fontFamily);
  if (family) patch.font = { ...from.font, family };
  const size = px(tokens.fontSize, 11, 20);
  if (size !== undefined) {
    const k = size / from.text.body;
    patch.text = Object.fromEntries(Object.entries(from.text).map(([key, v]) => [key, Math.round(v * k)])) as Theme["text"];
  }
  return { ...extendTheme(from, patch), name: `${from.name} (host tokens)` };
}
