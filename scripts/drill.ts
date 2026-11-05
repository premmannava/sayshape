/**
 * Drill-down demo: a person picks something in a SayShape interface, the
 * model gets the emit: event (worded exactly as the MCP view words it) and
 * writes the next interface. Four levels: regions → customers → orders → one
 * order. Then the same drill-down asked for as one spec with every level in
 * it, pressed through without the model.
 *
 *   npx vite-node scripts/drill.ts -- --model anthropic/claude-sonnet-5.5
 *
 * Settings come from .env.local (SAYSHAPE_MODEL_URL, SAYSHAPE_API_KEY).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { generateSpec, type GenerateResult } from "../src/model/generate";
import type { ChatMessage } from "../src/model/stream";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import { languageGuide } from "../src/prompt";
import { eventMessage } from "../mcp/src/ui/messages";
import { readModelEnv } from "./model-env";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const model = arg("model") ?? "anthropic/claude-sonnet-5.5";
const only = arg("only"); // "steps" or "one"

// --- The data: 4 regions, 3 customers each, 3 orders each -----------------
const CUSTOMERS: Record<string, string[]> = {
  NA: ["Acme", "Stark", "Initech"], EU: ["Globex", "Vandelay", "Nordwind"],
  APAC: ["Tyrell", "Soylent", "Kaito"], LATAM: ["Umbrella", "Sol y Mar", "Andes Co"],
};
const PRODUCTS: Array<[string, number]> = [["Desk", 420], ["Chair", 180], ["Lamp", 45], ["Monitor", 310], ["Shelf", 95], ["Rug", 140], ["Sofa", 890]];
interface Order { id: string; region: string; customer: string; date: string; status: string; items: Array<{ product: string; qty: number; price: number }>; total: number }
const orders: Order[] = [];
let seed = 7;
const rnd = (n: number) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
let num = 1001;
for (const [region, names] of Object.entries(CUSTOMERS)) for (const customer of names) for (let k = 0; k < 3; k++) {
  const items = Array.from({ length: 2 + rnd(2) }, () => { const [product, price] = PRODUCTS[rnd(PRODUCTS.length)]!; return { product, qty: 1 + rnd(4), price }; });
  const uniq = items.filter((it, i) => items.findIndex((o) => o.product === it.product) === i);
  orders.push({ id: `O-${num++}`, region, customer, date: `2026-10-${String(1 + rnd(28)).padStart(2, "0")}`, status: ["Shipped", "Pending", "Delivered"][rnd(3)]!,
    items: uniq, total: uniq.reduce((s, it) => s + it.qty * it.price, 0) });
}
const DATA = orders.map((o) => `${o.id} | ${o.region} | ${o.customer} | ${o.date} | ${o.status} | ${o.items.map((i) => `${i.qty}× ${i.product} @ $${i.price}`).join(", ")} | total $${o.total}`).join("\n");

const sum = (os: Order[]) => os.reduce((s, o) => s + o.total, 0);
const REGION = "EU";
const euCustomers = CUSTOMERS[REGION]!;
const CUSTOMER = [...euCustomers].sort((a, b) => sum(orders.filter((o) => o.customer === b)) - sum(orders.filter((o) => o.customer === a)))[0]!;
const custOrders = orders.filter((o) => o.customer === CUSTOMER);
const ORDER = [...custOrders].sort((a, b) => b.total - a.total)[0]!;
const others = Object.values(CUSTOMERS).flat().filter((c) => !euCustomers.includes(c));

// --- Checks: what each level must show -------------------------------------
interface Level { pick?: string; shows: string[]; hides?: string[] }
const LEVELS: Level[] = [
  { pick: REGION, shows: Object.keys(CUSTOMERS) },
  { pick: CUSTOMER, shows: euCustomers, hides: others.slice(0, 4) },
  { pick: ORDER.id, shows: custOrders.map((o) => o.id) },
  { shows: ORDER.items.map((i) => i.product) },
];

const registry = new Registry(coreComponents);
// The MCP server's chat notes (mcp/src/server.ts), copied so this runs without the MCP package.
const CHAT_NOTES = `You are writing an interface that appears inside a chat conversation, in a narrow column about 600 pixels wide.
Keep it to one focused screen: a card or column with a title, then the content. Prefer row and grid for side-by-side numbers; avoid more than three columns.
Put the data you know straight into state (lists of records for tables, charts and each). Never claim data is live: if numbers come from your own knowledge, say so in a caption.
When the person should be able to send something back to you (a choice, a form, an approval), give it a button with on=emit:name, for example on=emit:submit_order. The chat shows a short line like "Submit order", and you also receive the exact action name, its value and every state value; reply to it, or call show_interface again with an updated spec.
Output only the spec in show_interface's spec argument, with no Markdown fences.`;
const guideText = () => languageGuide(registry, { mode: "full", imageHosts: [], notes: CHAT_NOTES });
const env = readModelEnv("development", resolve(__dirname, ".."));
const config = { url: env.url, apiKey: env.apiKey || undefined, model, streamUsage: true, maxTokens: 8000, cache: true as const };
const guide = guideText() + "\n\nReply with only the spec, as if it were show_interface's spec argument.";

async function prices(): Promise<{ in: number; out: number; read: number; write: number } | null> {
  const res = await fetch(`${env.url}/models`).catch(() => null);
  const json = res?.ok ? ((await res.json()) as { data: Array<{ id: string; pricing: Record<string, string> }> }) : null;
  const p = json?.data.find((m) => m.id === model)?.pricing;
  return p ? { in: +p.prompt!, out: +p.completion!, read: +(p.input_cache_read ?? p.prompt!), write: +(p.input_cache_write ?? p.prompt!) } : null;
}
let P: Awaited<ReturnType<typeof prices>> = null;
function cost(r: GenerateResult): number | undefined {
  const u = r.usage; if (!P || u.promptTokens === undefined || u.completionTokens === undefined) return undefined;
  const read = u.cachedTokens ?? 0, write = u.cacheWriteTokens ?? 0;
  return (u.promptTokens - read - write) * P.in + read * P.read + write * P.write + u.completionTokens * P.out;
}

type Click = readonly [number, number];
const snap = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
function replay(spec: string, clicks: readonly Click[]): Rendered { const ui = render(spec); for (const c of clicks) ui.click(c[0], c[1]); return ui; }

/**
 * After replaying earlier clicks, tries every pressable region (buttons, table
 * rows, list items, tabs) in turn and returns the first whose press sets a
 * value to `target` or sends it with an emit:, as a person picking it would.
 */
function clickFor(spec: string, done: readonly Click[], target: string): { click: Click; ui: Rendered; emit?: { name: string; value: unknown } } | null {
  const n = replay(spec, done).hits.length;
  const is = (v: unknown) => v === target || (JSON.stringify(v) ?? "").includes(`"${target}"`);
  for (let i = 0; i < n; i++) {
    const ui = replay(spec, done);
    const h = ui.hits[i]; if (!h) continue;
    const before = snap(ui.state), emits = ui.emitted.length;
    const click: Click = [h.box.x + h.box.w / 2, h.box.y + h.box.h / 2];
    ui.click(click[0], click[1]);
    const changed = Object.keys(ui.state).filter((k) => JSON.stringify(ui.state[k]) !== JSON.stringify(before[k])).map((k) => ui.state[k]);
    const sent = ui.emitted.slice(emits);
    if ([...changed, ...sent.map((e) => e.value)].some(is)) return { click, ui, ...(sent.length ? { emit: sent.at(-1)! } : {}) };
  }
  return null;
}

function check(spec: string, level: Level): string[] {
  const ui = render(spec);
  const text = ui.text().join("\n");
  const missing = level.shows.filter((s) => !text.includes(s)).map((s) => `doesn't show ${s}`);
  const extra = (level.hides ?? []).filter((s) => text.includes(s)).map((s) => `still shows ${s}`);
  const errors = ui.diagnostics.filter((d) => d.severity === "error").map((d) => `line ${d.line}: ${d.message.slice(0, 80)}`);
  return [...errors, ...missing, ...extra];
}

const out = resolve(__dirname, "..", "eval", "drill", model.replace(/[^\w.-]+/g, "_"));
mkdirSync(out, { recursive: true });
const fmt = (r: GenerateResult) => `${(r.timings.totalMs / 1000).toFixed(1)} s total, first line at ${((r.timings.firstLineMs ?? 0) / 1000).toFixed(1)} s, ${r.usage.promptTokens} in (${r.usage.cachedTokens ?? 0} cached) / ${r.usage.completionTokens} out, $${cost(r)?.toFixed(4) ?? "?"}`;

async function steps(): Promise<void> {
  const request = `Sales explorer for October. Start with revenue by region; let me pick a region to see its customers, then a customer to see their orders, then an order to see its items. Each time I pick something, show the next level as a new interface. Orders (id | region | customer | date | status | items | total):\n${DATA}`;
  let history: ChatMessage[] | undefined;
  let msg = request;
  const rows: string[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i]!;
    const r = await generateSpec({ config, registry, guide, request: msg, history });
    writeFileSync(resolve(out, `step${i + 1}.sayshape`), r.spec);
    const problems = check(r.spec, level);
    rows.push(`Level ${i + 1}: ${problems.length ? "PROBLEMS " + problems.join("; ") : "ok"}${r.repair ? " (repaired)" : ""} — ${fmt(r)}, ${r.spec.length} chars`);
    console.log(rows.at(-1));
    history = r.messages.slice(1); // generateSpec adds the guide itself
    if (!level.pick) break;
    const hit = clickFor(r.spec, [], level.pick);
    if (!hit?.emit) { rows.push(`Level ${i + 1}: nothing to press that sends ${level.pick}`); console.log(rows.at(-1)); break; }
    msg = eventMessage(hit.emit.name, hit.emit.value as never, hit.ui.state as never);
    console.log(`  pressed → ${msg.split("\n")[0]}`);
  }
  writeFileSync(resolve(out, "steps.txt"), rows.join("\n") + "\n");
}

async function one(): Promise<void> {
  const request = `Sales explorer for October, all in one interface. Start with revenue by region; picking a region shows its customers, picking a customer shows their orders, picking an order shows its items, with a way back at each level. Orders (id | region | customer | date | status | items | total):\n${DATA}`;
  const r = await generateSpec({ config, registry, guide: guideText() + "\n\nReply with only the spec.", request });
  writeFileSync(resolve(out, "one.sayshape"), r.spec);
  console.log(`One spec: ${fmt(r)}, ${r.spec.length} chars${r.repair ? " (repaired)" : ""}`);
  // Press through without the model: each pick must show the next level.
  const t0 = performance.now();
  const results: string[] = [];
  const firstProblems = check(r.spec, LEVELS[0]!);
  results.push(`level 1 ${firstProblems.length ? firstProblems.join("; ") : "ok"}`);
  const clicks: Click[] = [];
  for (let i = 0; i < LEVELS.length - 1; i++) {
    const pick = LEVELS[i]!.pick!;
    const hit = clickFor(r.spec, clicks, pick);
    if (!hit) { results.push(`level ${i + 2} couldn't pick ${pick}`); break; }
    clicks.push(hit.click);
    const text = hit.ui.text().join("\n");
    const lv = LEVELS[i + 1]!;
    const missing = lv.shows.filter((s) => !text.includes(s));
    const extra = (lv.hides ?? []).filter((s) => text.includes(s));
    results.push(`level ${i + 2} ${missing.length ? `doesn't show ${missing.join(", ")}` : extra.length ? `still shows ${extra.join(", ")}` : "ok"}`);
  }
  void t0;
  const t1 = performance.now();
  replay(r.spec, clicks); // what the person's clicks cost on their screen, without the search above
  const ms = performance.now() - t1;
  const line = `One spec, ${clicks.length} picks replayed without the model in ${ms.toFixed(0)} ms (render included): ${results.join(" | ")}`;
  console.log(line);
  writeFileSync(resolve(out, "one.txt"), `One spec: ${fmt(r)}, ${r.spec.length} chars\n${line}\n`);
}

async function main(): Promise<void> {
  P = await prices();
  console.log(`${model}: drill ${REGION} → ${CUSTOMER} → ${ORDER.id} (${ORDER.items.map((i) => i.product).join(", ")})`);
  if (only !== "one") await steps();
  if (only !== "steps") await one();
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
