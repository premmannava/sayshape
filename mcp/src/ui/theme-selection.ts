import { PRESETS, resolveTheme, type PresetId, type Scheme } from "../../../playground/appearance/presets";
import type { Theme } from "../../../src/theme";
import { hostTheme, type ReadVar } from "./host-theme";

export const DEFAULT_PRESET: PresetId = "teal";

/** The action the toolbar's download button sends to the view (never to the model). */
export const SAVE_ACTION = "save_image";

/** Which tools the toolbar shows: decided by the server's flags and what the chat app can do. */
export interface Tools {
  /** The theme selector (--theme-picker). */
  picker: boolean;
  /** The download button (on unless --no-save-image, and only where the chat app can download). */
  save: boolean;
  /** The theme the selector starts on. */
  theme: PresetId;
}

/** Padding around the toolbar, in pixels: it's a slim strip, not a card. */
export const TOOLBAR_PADDING = 4;
/** The download button's side (tool-button's toolSize of a 40px control). */
const TOOL = 30;

/**
 * The toolbar's width: just what its tools need, so it sits at the right
 * above the interface instead of taking a full row. The selector gets its
 * minimum (120) and the download button its square (30).
 */
export function toolbarWidth(t: Tools): number {
  const inner = t.picker && t.save ? 120 + 8 + TOOL : t.picker ? 140 : t.save ? TOOL : 0;
  return inner + 2 * TOOLBAR_PADDING;
}

/**
 * The view's own controls, drawn by SayShape too, with no label or heading:
 * the theme selector, then the download icon at the right end. Empty when
 * there's nothing to show, and then the view leaves the toolbar out.
 */
export function toolbarSpec(t: Tools): string {
  if (!t.picker && !t.save) return "";
  const select = `select items=presets value=id label=label bind=preset on="emit:theme:{preset}"`;
  const save = `tool-button "Save image" icon=download on=emit:${SAVE_ACTION}`;
  const state = `state preset="${t.theme}" presets=[${PRESETS.map(
    ({ id, label }) => `{id:${JSON.stringify(id)},label:${JSON.stringify(label)}}`,
  ).join(",")}]\n`;
  if (t.picker && t.save) return `${state}row gap=8 align=center wrap=false\n  ${select}\n  ${save}\n`;
  return t.picker ? `${state}${select}\n` : `${save}\n`;
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESETS.some((preset) => preset.id === value);
}

export function themeForPreset(preset: PresetId, scheme: Scheme, read?: ReadVar): Theme {
  const theme = resolveTheme(preset, scheme, null).theme;
  return read ? hostTheme(theme, read) : theme;
}
