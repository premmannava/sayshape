/**
 * The packed engine the widget file carries: dist/widget-engine.json, written
 * by scripts/pack-widget-engine.mjs as part of `npm run build` and shipped in
 * this package, so it is always the engine this server's parser came from.
 * Read once, only when a widget is first asked for.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** One script, gzipped then base64: what goes into a fragment as it is. */
export interface PackedScript {
  base64: string;
  /** Before gzip. */
  bytes: number;
  gzipBytes: number;
  /** A short hash of the script itself, so a file made by an older build gets another name. */
  digest: string;
}

export interface PackedEngine {
  /** The engine, with the slide elements: the global `sayshape`. */
  engine: PackedScript;
  /** The map's outlines: the global `sayshapeMap`. */
  map: PackedScript;
}

const isScript = (v: unknown): v is PackedScript => {
  const s = v as Partial<PackedScript> | null;
  return !!s && typeof s.base64 === "string" && typeof s.digest === "string" && typeof s.bytes === "number" && typeof s.gzipBytes === "number";
};

/** Where the file sits: next to dist/server.js, or in ../dist when this runs from source (the tests). */
const LOCATIONS = [new URL("./widget-engine.json", import.meta.url), new URL("../dist/widget-engine.json", import.meta.url)];

let cache: Promise<PackedEngine> | null = null;

/** The packed engine. Throws, in plain words, if this build has none. */
export function loadPackedEngine(): Promise<PackedEngine> {
  return (cache ??= (async () => {
    for (const url of LOCATIONS) {
      let raw: string;
      try {
        raw = await readFile(fileURLToPath(url), "utf8");
      } catch {
        continue;
      }
      const parsed = JSON.parse(raw) as Partial<PackedEngine>;
      if (isScript(parsed.engine) && isScript(parsed.map)) return { engine: parsed.engine, map: parsed.map };
      throw new Error("widget-engine.json isn't what this version of sayshape-mcp writes: run `npm run build` again.");
    }
    throw new Error("widget-engine.json is missing, so --widget-dir has no engine to put in its files: run `npm run build` in the sayshape-mcp package.");
  })().catch((e) => {
    cache = null;
    throw e;
  }));
}
