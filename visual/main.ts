/**
 * Renders one visual case, chosen by the URL:
 *
 *   /visual/index.html?case=sample-hike&theme=dark&width=375
 *
 * The page sets window.__sayShapeReady once fonts are loaded and the frame is
 * painted, so screenshots never catch a half-rendered canvas.
 */
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import { SayShape } from "../src/engine";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";
import { darkTheme, lightTheme, studioDarkTheme, studioLightTheme } from "../src/theme";
import { sceneSamples } from "../playground/scene-samples";
import { fixtureImageLoader } from "./fixture-image";
import { cases } from "./cases";

declare global {
  interface Window { __sayShapeReady?: boolean; __sayShapeError?: string; __sayshape?: SayShape }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const name = params.get("case") ?? "";
  const width = Number(params.get("width") ?? 375);
  // Scene interaction tests (scene.spec.ts): ?scene=<sample> turns scenes on and shows that playground sample.
  const scene = params.get("scene");
  const visual = scene ? sceneSamples[scene] : cases.find((c) => c.name === name);
  if (!visual) throw new Error(`No visual case named "${scene ?? name}"`);

  const themes = { light: lightTheme, dark: darkTheme, "studio-light": studioLightTheme, "studio-dark": studioDarkTheme };
  const theme = themes[(params.get("theme") ?? "light") as keyof typeof themes] ?? lightTheme;
  // The root has no surface of its own, so the page shows through: use the theme's.
  document.body.style.background = theme.colors.surface;
  // Canvas text doesn't trigger web font loading, so load every weight first.
  await Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 16px "Instrument Sans"`)));

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const sayshape = new SayShape(canvas, {
    components: [...coreComponents, ...mapComponents, ...(scene ? sceneComponents : [])],
    theme,
    width,
    // Screenshots need stills; ?motion=1 animates (and still follows prefers-reduced-motion).
    ...(params.get("motion") === "1" ? {} : { animate: false }),
    // The samples' real photo host, so their images are drawn by the fixture
    // instead of downloaded; other hosts stay blocked, as in the playground.
    imageHosts: ["images.unsplash.com"],
    loadImage: fixtureImageLoader,
    // A fixed today, so calendars look the same whenever the screenshots are taken.
    today: () => "2026-10-21",
  });
  // Interaction tests (typing.spec.ts) drive the engine directly.
  window.__sayshape = sayshape;
  sayshape.setSpec(visual.spec);
  sayshape.renderNow();
  await sayshape.imagesLoaded();
  window.__sayShapeReady = true;
}

main().catch((e: unknown) => {
  window.__sayShapeError = e instanceof Error ? e.message : String(e);
});
