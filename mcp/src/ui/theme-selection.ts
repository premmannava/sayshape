import { PRESETS, resolveTheme, type PresetId, type Scheme } from "../../../playground/appearance/presets";
import { extendTheme, type Theme } from "../../../src/theme";
import { hostTheme, type ReadVar } from "./host-theme";

export const DEFAULT_PRESET: PresetId = "teal";

/** The action the toolbar's download button sends to the view (never to the model). */
export const SAVE_ACTION = "save_image";
/** The action the toolbar's copy button sends to the view (never to the model). */
export const COPY_ACTION = "copy_text";
/** The action the toolbar's Pause/Resume button sends to the view (behavior on; never to the model). */
export const MOTION_ACTION = "pause_motion";

/** Which tools the toolbar shows: decided by the server's flags and what the chat app can do. */
export interface Tools {
  /** The theme selector (--theme-picker). */
  picker: boolean;
  /** The download button (on unless --no-save-image, and only where the chat app can download). */
  save: boolean;
  /** The copy button (on unless --no-copy-text). */
  copy: boolean;
  /** The theme the selector starts on. */
  theme: PresetId;
  /**
   * Pause and Resume for rules (--behavior). Shown only while the interface
   * has rules (toolbar state rules > 0): WCAG 2.2.2, whatever the spec says.
   */
  motion?: boolean;
}

/** Padding around the toolbar, in pixels: it's a slim strip, not a card. */
export const TOOLBAR_PADDING = 4;
/** An icon button's side (tool-button's toolSize of a 40px control). */
const TOOL = 30;
/** Space between the toolbar's controls. */
const GAP = 8;

/**
 * The toolbar's width: just what its tools need, so it sits at the right
 * above the interface instead of taking a full row. The selector gets its
 * minimum (120, or 140 on its own) and each icon button its square (30).
 */
export function toolbarWidth(t: Tools): number {
  const icons = (t.copy ? 1 : 0) + (t.save ? 1 : 0) + (t.motion ? 1 : 0);
  const widths = [...(t.picker ? [icons ? 120 : 140] : []), ...Array<number>(icons).fill(TOOL)];
  const inner = widths.length ? widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1) : 0;
  return inner + 2 * TOOLBAR_PADDING;
}

/**
 * The view's own controls, drawn by SayShape too, with no label or heading:
 * the theme selector, then the copy and download icons at the right end.
 * Empty when there's nothing to show, and then the view leaves the toolbar out.
 */
export function toolbarSpec(t: Tools): string {
  const items: string[] = [];
  // No visible label; a theme is always chosen, so the placeholder is never
  // shown, but it names the selector for screen readers.
  if (t.picker) items.push(`select items=presets value=id label=label bind=preset placeholder="Theme" on="emit:theme:{preset}"`);
  if (t.motion) items.push(`tool-button "{paused ? 'Resume motion' : 'Pause motion'}" icon={paused ? 'play' : 'pause'} if={rules > 0} on=emit:${MOTION_ACTION}`);
  if (t.copy) items.push(`tool-button "Copy text" icon=copy on=emit:${COPY_ACTION}`);
  if (t.save) items.push(`tool-button "Save image" icon=download on=emit:${SAVE_ACTION}`);
  if (!items.length) return "";
  const motion = t.motion ? " rules=0 paused=false" : "";
  const state = t.picker
    ? `state preset="${t.theme}" presets=[${PRESETS.map(({ id, label }) => `{id:${JSON.stringify(id)},label:${JSON.stringify(label)}}`).join(",")}]${motion}\n`
    : motion ? `state${motion}\n` : "";
  if (items.length === 1) return `${state}${items[0]}\n`;
  return `${state}row gap=${GAP} align=center wrap=false\n${items.map((i) => `  ${i}\n`).join("")}`;
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESETS.some((preset) => preset.id === value);
}

/**
 * A preset in the host's mode, with the server's --accent if it has one (made
 * readable on this scheme's surface; the first chart series follows it), then
 * the host's shared colors, fonts and radii. Hosts never send an accent.
 */
export function themeForPreset(preset: PresetId, scheme: Scheme, read?: ReadVar, accent?: string): Theme {
  const theme = resolveTheme(preset, scheme, accent ?? null).theme;
  return read ? hostTheme(theme, read) : theme;
}

/**
 * Tighter tokens for the interface inside a chat app, which already frames it
 * and gives it little room: a smaller display size, less large spacing and
 * shorter controls. The toolbar keeps the preset's own sizes.
 */
export const CHAT_TOKENS = { text: { display: 24 }, space: { lg: 16 }, control: { height: 32 } } as const;

/** The theme the view draws the interface with: the resolved preset with CHAT_TOKENS over it. */
export function interfaceTheme(theme: Theme): Theme {
  return extendTheme(theme, CHAT_TOKENS);
}
