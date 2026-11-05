/**
 * Records answers for the website's live comparison (site/compare.md): the
 * same request sent to the same model three times at the same moment, asking
 * for SayShape, HTML and A2UI, with every piece of each answer saved alongside
 * the time it arrived. The page plays them back at that speed.
 *
 *   npx vite-node scripts/record.ts -- --model deepseek/deepseek-v4.1-flash --only k3,f2
 *
 * Answers are first tries, saved as they came: nothing is repaired or edited.
 * Settings come from .env.local like `npm run compare` (SAYSHAPE_MODEL_URL, SAYSHAPE_API_KEY).
 * Each recording goes to site/public/compare/<model>/<task>.json, and
 * site/public/compare/index.json lists them all.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { generateSpec } from "../src/model/generate";
import { streamChat, type ModelConfig } from "../src/model/stream";
import { Registry } from "../src/registry";
import { a2uiPrompt } from "../eval/compare/a2ui";
import { HTML_PROMPT } from "../eval/compare/run";
import { tasks } from "../eval/compare/tasks";
import { readModelEnv } from "./model-env";

/** The requests the page offers by default: one or two of each kind the benchmark has. */
const GALLERY = ["k3", "c5", "t2", "f1", "f2", "x1", "d4"];

/** A piece of an answer and when it arrived, in ms from the moment all three requests were sent. null text: start over (the model was thinking after all). */
export type Chunk = [number, string | null];

export interface FormatRecording {
  chunks: Chunk[];
  /** When the answer finished, in ms; absent when the request failed. */
  doneMs?: number;
  error?: string;
}

export interface Recording {
  id: string;
  request: string;
  model: string;
  recordedAt: string;
  formats: { sayshape: FormatRecording; html: FormatRecording; a2ui: FormatRecording };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function plain(config: ModelConfig, system: string, request: string, t0: number): Promise<FormatRecording> {
  const out: FormatRecording = { chunks: [] };
  try {
    for await (const part of streamChat(config, [{ role: "system", content: system }, { role: "user", content: request }])) {
      if (part.kind === "content" && part.text) out.chunks.push([Math.round(performance.now() - t0), part.text]);
    }
    out.doneMs = Math.round(performance.now() - t0);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

async function sayshape(config: ModelConfig, registry: Registry, request: string, t0: number): Promise<FormatRecording> {
  const out: FormatRecording = { chunks: [] };
  const at = () => Math.round(performance.now() - t0);
  try {
    // What the product shows: SayShape text as the stream filter passes it, first try only.
    await generateSpec({
      config, registry, request, guide: { imageHosts: [], mode: "full" }, repairOn: "never",
      onText: (text) => { if (text) out.chunks.push([at(), text]); },
      onReset: () => out.chunks.push([at(), null]),
    });
    out.doneMs = at();
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/**
 * The list the page reads, made from every recording on disk (not edited in
 * place), so recordings made in parallel all end up in it: by model, then in
 * gallery order.
 */
function writeIndex(dir: string): void {
  const index: Array<{ id: string; model: string; file: string; request: string }> = [];
  for (const sub of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const files = readdirSync(resolve(dir, sub)).filter((f) => f.endsWith(".json"));
    const rank = (f: string) => { const i = GALLERY.indexOf(f.replace(/\.json$/, "")); return i < 0 ? GALLERY.length : i; };
    for (const f of files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
      const r = JSON.parse(readFileSync(resolve(dir, sub, f), "utf8")) as Recording;
      index.push({ id: r.id, model: r.model, file: `${sub}/${f}`, request: r.request });
    }
  }
  writeFileSync(resolve(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

async function main(): Promise<void> {
  const env = readModelEnv("development", resolve(__dirname, ".."));
  const model = arg("model") ?? env.model;
  if (!model) throw new Error("No model: pass --model, or set SAYSHAPE_MODEL in .env.local.");
  const ids = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? GALLERY;
  const chosen = ids.map((id) => tasks.find((t) => t.id === id) ?? (() => { throw new Error(`No task "${id}"`); })());
  const config: ModelConfig = { url: env.url, apiKey: env.apiKey || undefined, model, streamUsage: true, maxTokens: 16000 };
  const registry = new Registry(coreComponents);
  const a2ui = a2uiPrompt();
  const slug = model.replace(/[^\w.-]+/g, "_");
  const dir = resolve(__dirname, "..", "site", "public", "compare");
  mkdirSync(resolve(dir, slug), { recursive: true });

  for (const task of chosen) {
    const t0 = performance.now();
    // All three leave at the same moment, so the page can play them side by side.
    const [s, h, a] = await Promise.all([sayshape(config, registry, task.request, t0), plain(config, HTML_PROMPT, task.request, t0), plain(config, a2ui, task.request, t0)]);
    const rec: Recording = { id: task.id, request: task.request, model, recordedAt: new Date().toISOString(), formats: { sayshape: s, html: h, a2ui: a } };
    writeFileSync(resolve(dir, slug, `${task.id}.json`), JSON.stringify(rec));
    const sec = (f: FormatRecording) => (f.error ? `failed (${f.error.slice(0, 60)})` : `${((f.doneMs ?? 0) / 1000).toFixed(1)} s`);
    console.log(`${task.id}: SayShape ${sec(s)}, HTML ${sec(h)}, A2UI ${sec(a)}`);
  }

  writeIndex(dir);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
