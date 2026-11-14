// Builds the engine for the widget file (mcp/src/widget-file.ts) and gzips it.
//
//   node scripts/pack-widget-engine.mjs [outDir]      writes <outDir>/widget-engine.json (default: ../dist)
//
// Two classic scripts, built from this repository's src/ (the same entries as the repository's
// scripts/build-browser.mjs, with the slide elements added to the first): the engine, and the
// map's outlines. Each is gzipped with Node's zlib and stored as base64, ready to go into a
// fragment as it is; the fragment's loader unpacks it with DecompressionStream. The JSON also
// carries a digest of each, so a file made by an older build is never mistaken for a new one.
//
// Part of `npm run build`. The tests and the browser check run it into a temporary folder.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, constants } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = process.argv[2] ?? here("../dist");

async function script(entry, name) {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    build: {
      write: false,
      target: "es2020",
      sourcemap: false,
      lib: { entry: here(entry), name, formats: ["iife"], fileName: () => `${name}.js` },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  const chunk = outputs.find((o) => o.type === "chunk");
  if (outputs.length !== 1 || !chunk) throw new Error(`pack-widget-engine: ${entry} didn't build into one script`);
  return Buffer.from(chunk.code, "utf8");
}

const pack = (code) => {
  const gz = gzipSync(code, { level: constants.Z_BEST_COMPRESSION });
  return { base64: gz.toString("base64"), bytes: code.length, gzipBytes: gz.length, digest: createHash("sha256").update(code).digest("hex").slice(0, 16) };
};

const engine = pack(await script("../src/widget-engine-entry.ts", "sayshape"));
const map = pack(await script("../../src/components/map/browser.ts", "sayshapeMap"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "widget-engine.json"), JSON.stringify({ engine, map }));
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`widget-engine.json: engine ${kb(engine.bytes)} -> ${kb(engine.gzipBytes)} gzipped, map ${kb(map.bytes)} -> ${kb(map.gzipBytes)} gzipped`);
