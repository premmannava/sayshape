import { PRESETS, resolveTheme, type PresetId, type Scheme } from "../../../playground/appearance/presets";
import type { Theme } from "../../../src/theme";
import { hostTheme, type ReadVar } from "./host-theme";

export const DEFAULT_PRESET: PresetId = "teal";

/** The action the control strip's "Save image" button sends to the view (never to the model). */
export const SAVE_ACTION = "save_image";

/**
 * The view's own controls, above the model's interface and drawn by SayShape
 * too: the theme picker, and "Save image" once the view knows the chat app can
 * download files (the view sets canSave from the host's capabilities).
 */
export const THEME_CONTROL_SPEC = `state preset="${DEFAULT_PRESET}" presets=[${PRESETS.map(
  ({ id, label }) => `{id:${JSON.stringify(id)},label:${JSON.stringify(label)}}`,
).join(",")}] canSave=false
row align=bottom
  select "Theme" items=presets value=id label=label bind=preset on="emit:theme:{preset}"
  button "Save image" variant=secondary on=emit:${SAVE_ACTION} if=canSave
`;

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESETS.some((preset) => preset.id === value);
}

export function themeForPreset(preset: PresetId, scheme: Scheme, read?: ReadVar): Theme {
  const theme = resolveTheme(preset, scheme, null).theme;
  return read ? hostTheme(theme, read) : theme;
}
