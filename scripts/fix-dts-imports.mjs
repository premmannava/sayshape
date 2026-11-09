// Adds file extensions to the relative imports in dist/types, after tsc.
//
// The source imports "./engine" (moduleResolution: Bundler), and tsc copies
// that into the declarations. Bundler-style consumers (Vite, esbuild, webpack)
// resolve it, but a TypeScript project using moduleResolution node16 or
// nodenext can't: in an ES module package, a relative import needs its file
// extension. Rewriting "./engine" to "./engine.js" (or "./a11y" to
// "./a11y/index.js") works for both, and leaves the source as it is.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), process.argv[2] ?? "dist/types");

function* declarations(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* declarations(path);
    else if (name.endsWith(".d.ts")) yield path;
  }
}

// from "./x", import("./x"), import "./x" (and the same with single quotes).
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*)\2/g;

let files = 0;
let rewritten = 0;
const unresolved = [];
for (const file of declarations(root)) {
  const text = readFileSync(file, "utf8");
  const out = text.replace(SPECIFIER, (match, lead, quote, spec) => {
    if (/\.(m?js|json)$/.test(spec)) return match;
    const base = resolve(dirname(file), spec);
    let fixed;
    if (existsSync(`${base}.d.ts`)) fixed = `${spec}.js`;
    else if (existsSync(join(base, "index.d.ts"))) fixed = `${spec.replace(/\/$/, "")}/index.js`;
    else {
      unresolved.push(`${file}: ${spec}`);
      return match;
    }
    rewritten++;
    return `${lead}${quote}${fixed}${quote}`;
  });
  if (out !== text) {
    writeFileSync(file, out);
    files++;
  }
}

if (unresolved.length) {
  console.error(`fix-dts-imports: ${unresolved.length} relative import(s) point at no declaration file:\n  ${unresolved.join("\n  ")}`);
  process.exit(1);
}
console.log(`fix-dts-imports: ${rewritten} import(s) in ${files} file(s)`);
