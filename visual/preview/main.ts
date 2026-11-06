/** Design preview (not a test): ?spec=d1&theme=studio-dark&width=760 renders a benchmark answer or a showcase. */
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { SayShape } from "../../src/engine";
import { coreComponents } from "../../src/components";
import { darkTheme, lightTheme, studioDarkTheme, studioLightTheme } from "../../src/theme";
import { reference } from "../../eval/compare/reference";
import { showcase } from "./showcase";

declare global { interface Window { __ready?: boolean; __error?: string } }

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const themes = { light: lightTheme, dark: darkTheme, "studio-light": studioLightTheme, "studio-dark": studioDarkTheme };
  const theme = themes[(q.get("theme") ?? "light") as keyof typeof themes];
  const name = q.get("spec") ?? "d1";
  const spec = showcase[name] ?? reference[name]?.sayshape;
  if (!spec) throw new Error(`no spec ${name}`);
  document.body.style.background = theme.colors.surface;
  const fam = theme.font.family.split(",")[0]!;
  await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(`${w} 16px ${fam}`)));
  const ui = new SayShape(document.getElementById("canvas") as HTMLCanvasElement, { components: coreComponents, theme, width: Number(q.get("width") ?? 760), animate: false, today: () => "2026-10-21" });
  ui.setSpec(spec);
  ui.renderNow();
  window.__ready = true;
}
main().catch((e: unknown) => { window.__error = String(e); });
