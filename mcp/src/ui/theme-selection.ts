import { PRESETS, resolveTheme, type PresetId, type Scheme } from "../../../playground/appearance/presets";
import type { Theme } from "../../../src/theme";
import { hostTheme, type ReadVar } from "./host-theme";

export const DEFAULT_PRESET: PresetId = "teal";

export const THEME_CONTROL_SPEC = `state preset="${DEFAULT_PRESET}" presets=[${PRESETS.map(
  ({ id, label }) => `{id:${JSON.stringify(id)},label:${JSON.stringify(label)}}`,
).join(",")}]
select "Theme" items=presets value=id label=label bind=preset on="emit:theme:{preset}"
`;

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESETS.some((preset) => preset.id === value);
}

export function themeForPreset(preset: PresetId, scheme: Scheme, read?: ReadVar): Theme {
  const theme = resolveTheme(preset, scheme, null).theme;
  return read ? hostTheme(theme, read) : theme;
}
