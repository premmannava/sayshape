// Builds the engine as classic scripts for a plain <script src> (part of `npm run build`,
// after the ES modules, which empty dist/ first):
//
//   dist/sayshape.global.js       the global `sayshape`: SayShape, coreComponents,
//                                 sceneComponents, the themes, parse and Registry
//   dist/sayshape-map.global.js   the global `sayshapeMap`: mapComponents (the world's
//                                 outlines make it as big as the engine, so it's apart)
//
// One file each, no modules and no chunks, so a page can load them from a CDN:
// https://cdn.jsdelivr.net/npm/sayshape@<version>/dist/sayshape.global.js
// The MCP server's page for text-only chat apps does (mcp/src/fallback.ts).
import { build } from "vite";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

for (const [entry, name, file] of [
  ["src/browser.ts", "sayshape", "sayshape.global.js"],
  ["src/components/map/browser.ts", "sayshapeMap", "sayshape-map.global.js"],
]) {
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      outDir: at("dist"),
      emptyOutDir: false,
      // Recent browsers, the same ones the ES modules need.
      target: "es2020",
      sourcemap: false,
      lib: { entry: at(entry), name, formats: ["iife"], fileName: () => file },
    },
  });
}
