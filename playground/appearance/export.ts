/**
 * "Copy theme code": TypeScript that sets up the theme the playground is
 * showing, with sayshape's public API only (extendTheme, the base themes such
 * as lightTheme or studioLightTheme, SayShape#setTheme). It writes the effective colors, after any
 * contrast adjustment, not the ones asked for.
 */
import type { Theme } from "../../src/theme";
import { baseThemeName, presetById, resolveTheme, type Scheme } from "./presets";
import type { AppearancePrefs } from "./prefs";

type Colors = Partial<Theme["colors"]>;

/** What the code sets up: one theme, or a light and a dark one that follow the system. */
export type ExportPlan =
  | { mode: "light" | "dark"; changes: Colors }
  | { mode: "system"; light: Colors; dark: Colors };

export function exportPlan(p: AppearancePrefs): ExportPlan {
  const changes = (s: Scheme) => resolveTheme(p.preset, s, p.accent).changes;
  return p.mode === "system" ? { mode: "system", light: changes("light"), dark: changes("dark") } : { mode: p.mode, changes: changes(p.mode) };
}

/** A theme expression: SayShape's base theme as is, or extendTheme with the changed colors. */
function themeExpr(base: string, colors: Colors, indent = ""): string {
  const keys = Object.keys(colors) as Array<keyof Theme["colors"]>;
  if (!keys.length) return base;
  const lines = keys.map((k) => `${indent}    ${k}: "${colors[k]}",`).join("\n");
  return `extendTheme(${base}, {\n${indent}  colors: {\n${lines}\n${indent}  },\n${indent}})`;
}

export function themeCode(p: AppearancePrefs): string {
  const plan = exportPlan(p);
  const found = presetById(p.preset);
  const preset = found?.label ?? p.preset;
  const lightBase = baseThemeName("light", found), darkBase = baseThemeName("dark", found);
  const about = `// SayShape theme: ${preset}${p.accent ? `, accent ${p.accent}` : ""}, ${plan.mode === "system" ? "following the system's light or dark mode" : `${plan.mode} mode`}.\n` +
    `// Assumes \`sayshape\` is your SayShape instance: const sayshape = new SayShape(canvas, { components: coreComponents }).`;
  if (plan.mode !== "system") {
    const base = plan.mode === "dark" ? darkBase : lightBase;
    const needsExtend = Object.keys(plan.changes).length > 0;
    return [
      `import { ${needsExtend ? "extendTheme, " : ""}${base}, type SayShape } from "sayshape";`,
      "",
      about,
      `export const theme = ${themeExpr(base, plan.changes)};`,
      "",
      `export function applyTheme(sayshape: SayShape): void {`,
      `  sayshape.setTheme(theme);`,
      `}`,
      "",
    ].join("\n");
  }
  const needsExtend = Object.keys(plan.light).length + Object.keys(plan.dark).length > 0;
  return [
    `import { ${needsExtend ? "extendTheme, " : ""}${[darkBase, lightBase].sort().join(", ")}, type SayShape } from "sayshape";`,
    "",
    about,
    `export const light = ${themeExpr(lightBase, plan.light)};`,
    `export const dark = ${themeExpr(darkBase, plan.dark)};`,
    "",
    `/** Use the light or dark theme to match the system, now and when it changes. Returns a function that stops following it. */`,
    `export function followSystemAppearance(sayshape: SayShape): () => void {`,
    `  const query = window.matchMedia("(prefers-color-scheme: dark)");`,
    `  const apply = () => sayshape.setTheme(query.matches ? dark : light);`,
    `  apply();`,
    `  query.addEventListener("change", apply);`,
    `  return () => query.removeEventListener("change", apply);`,
    `}`,
    "",
  ].join("\n");
}
