/**
 * Before/after render check for the repo's existing scene examples: every
 * playground scene sample, the scenes in README.md, docs/engine.md and
 * docs/language.md, test/scene.test.ts's inline scenes and each scene
 * element's example, drawn at rest and at a few moments, light and dark, with
 * behavior on, as hashes of the recording canvas's draw calls.
 *
 *   npm run scene:regression            compare with scripts/scene-regression-baseline.json
 *   npm run scene:regression -- --update  write the baseline (after a change that's meant to look different)
 *
 * The baseline was taken on main before the scene upgrades (91ae615). Only
 * names in the baseline are compared, so new examples don't fail it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const imp = (p: string) => import(resolve(root, p));

async function main() {
  const { coreComponents } = await imp("src/components/index.ts");
  const scene = await imp("src/components/scene/index.ts");
  const { render } = await imp("src/testing/index.ts");
  const { darkTheme, lightTheme } = await imp("src/theme.ts");
  const ss = await imp("playground/scene-samples.ts");
  const bs = await imp("playground/behavior-samples.ts");
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(ss.sceneSamples as Record<string, { spec: string }>)) specs["sample:" + k] = v.spec;
  for (const [k, v] of Object.entries(bs.behaviorSceneSamples as Record<string, { spec: string }>)) specs["behavior:" + k] = v.spec;
  for (const file of ["README.md", "docs/engine.md", "docs/language.md", "test/scene.test.ts"]) {
    let text = "";
    try { text = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
    const blocks = file.endsWith(".ts") ? [...text.matchAll(/`(scene "[\s\S]*?)`/g)].map((m) => m[1]!) : [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
    blocks.filter((b) => /^\s*scene "/m.test(b)).forEach((b, i) => { specs[`${file}#${i}`] = b; });
  }
  for (const c of scene.sceneComponents as Array<{ type: string; example?: string }>) {
    if (c.type === "scene" && c.example) specs["example:scene"] = c.example;
    else if (c.example) specs["example:" + c.type] = `scene "x" w=600 h=340 duration=3\n` + c.example.split("\n").map((l) => "  " + l).join("\n");
  }
  const components = [...coreComponents, ...scene.sceneComponents];
  const out: Record<string, string> = {};
  const behavior = true;
  for (const [name, spec] of Object.entries(specs)) {
    for (const [tn, theme] of [["light", lightTheme], ["dark", darkTheme]] as const) {
      const still = render(spec, { components, theme, behavior, width: 600 });
      out[`${name}|${tn}|rest`] = hash(still.drawOps);
      still.destroy();
      const moving = render(spec, { components, theme, behavior, width: 600, animate: true, clock: true });
      const frames: unknown[] = [moving.drawOps];
      for (const ms of [700, 1200, 2600]) { moving.clock.advance(ms); frames.push(moving.drawOps); }
      out[`${name}|${tn}|frames`] = hash(frames);
      moving.destroy();
    }
  }
  const file = resolve(root, "scripts/scene-regression-baseline.json");
  if (process.argv.includes("--update")) {
    writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
    console.log(`Wrote ${Object.keys(out).length} renders to ${file}`);
    return;
  }
  const base = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const changed = Object.keys(base).filter((k) => base[k] !== out[k]);
  console.log(`${Object.keys(base).length - changed.length} of ${Object.keys(base).length} renders unchanged.`);
  if (changed.length) {
    console.log(`Changed:\n${changed.map((k) => `  ${k}`).join("\n")}`);
    process.exit(1);
  }
}
const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 12);
main().catch((e) => { console.error(e); process.exit(1); });
