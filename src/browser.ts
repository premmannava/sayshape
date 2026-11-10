/**
 * The engine as one classic script for a plain <script src>, built by
 * scripts/build-browser.mjs into dist/sayshape.global.js. It defines the
 * global `sayshape`:
 *
 *   <canvas></canvas>
 *   <script src="https://cdn.jsdelivr.net/npm/sayshape@<version>/dist/sayshape.global.js"></script>
 *   <script>
 *     const { SayShape, coreComponents } = sayshape;
 *     new SayShape(document.querySelector("canvas"), { components: coreComponents }).setSpec('text "Hi"');
 *   </script>
 *
 * Scenes are included but stay off unless a page adds sceneComponents. The map
 * carries the world's outlines, so it's a second script,
 * dist/sayshape-map.global.js, which defines `sayshapeMap.mapComponents`.
 *
 * Bundlers should import "sayshape" instead: these files carry the whole engine.
 */
export { SayShape } from "./engine";
export { coreComponents } from "./components";
export { sceneComponents } from "./components/scene";
export { lightTheme, darkTheme, studioLightTheme, studioDarkTheme, extendTheme, type Theme } from "./theme";
export { parse } from "./parser";
export { Registry } from "./registry";
