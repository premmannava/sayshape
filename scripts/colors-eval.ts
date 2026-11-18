/**
 * Do models keep the colors a person named? Multi-turn conversations with a real model that has the MCP
 * server's real tools (show_interface with its colors argument, sayshape_docs), scored on the colors argument
 * of every show_interface call (eval/colors/):
 *
 *   A  the person names colors once, asks for three more interfaces without mentioning them, then asks to go
 *      back to normal and for one more: are the colors sent again, unchanged, and dropped when asked?
 *   B  the person never mentions colors: does the model invent any?
 *
 *   npm run colors-eval -- --models anthropic/claude-sonnet-5.5,openai/gpt-6.1-sol
 *   npm run colors-eval -- --models <id> --runs 5            each conversation five times per model
 *   npm run colors-eval -- --models <id> --sets coffee,purple  some prompt sets (coffee, navy-coral, purple, ocean)
 *   npm run colors-eval -- --models <id> --only A            one kind of conversation (A or B)
 *   npm run colors-eval -- --dry-run                         the plan and a cost estimate, no model called
 *   npm run colors-eval -- --stub mixed                      a scripted model in place of a real one (keeper,
 *                                                            forgetter, inventor, plain, mixed): no key, no cost
 *
 * Trying other wording (the server's own text is never changed; the script swaps it in what the model sees):
 *
 *   --note-variant explicit|short|reason      the "Colors: …" line that ends a result
 *   --description-variant lasting             the colors argument's description
 *   --note-text "Keep sending colors={colors}."   any note ({colors} becomes the list)
 *   --description-text "…"                    any description
 *
 * Settings come from .env.local like the other evals: SAYSHAPE_MODEL_URL (required here, so a real run never
 * quietly goes to a local server), SAYSHAPE_API_KEY, SAYSHAPE_PROMPT_CACHE. One endpoint serves every model in
 * --models; a model on another endpoint takes --endpoint <model>=<url> and --key-env <model>=<VARIABLE> (the
 * name of an environment variable that holds its key, so the key is never on the command line). Other flags:
 * --concurrency 2, --temperature, --reply-tokens 8000, --max-requests 40, --max-tokens 400000,
 * --max-turn-requests 6, --cache 1h|5m|off, --out <dir>.
 *
 * Needs the MCP server's packages: npm install --prefix mcp. Results go to eval/results/colors-<date>/:
 * report.md, results.json, tools.json (the tools as the model saw them) and every conversation in full under
 * transcripts/ (git-ignored; no key is ever written).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { openAiChat, type ChatFn } from "../eval/colors/chat";
import { connectView } from "../eval/colors/connect";
import { PROMPT_SETS, conversationA, conversationB, type Conversation } from "../eval/colors/prompts";
import { rate, report } from "../eval/colors/report";
import { DEFAULT_LIMITS, runEval, tallyOf, withVariant, type Backend, type ConversationResult } from "../eval/colors/run";
import { startStub, STUB_BEHAVIORS, type StubBehavior } from "../eval/colors/stub";
import { DESCRIPTION_VARIANTS, NOTE_VARIANTS, variantList, type TextVariant } from "../eval/colors/variants";
import { pricesFor } from "../eval/compare/prices";
import { costOf } from "../eval/compare/run";
import { parseCache, readModelEnv } from "./model-env";

const root = resolve(__dirname, "..");

/** The value of --name, or undefined. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** Every value of a repeated --name. */
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] !== undefined ? [process.argv[i + 1]!] : []));
}
const list = (name: string) => arg(name)?.split(",").map((s) => s.trim()).filter(Boolean);
const flag = (name: string) => process.argv.includes(`--${name}`);
function count(name: string, fallback: number, min = 1): number {
  const v = arg(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} takes a whole number of ${min} or more, not "${v}"`);
  return n;
}
/** --endpoint a/b=https://… into { "a/b": "https://…" }: split at the first = after the model name. */
function pairs(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of args(name)) {
    const i = v.indexOf("=");
    if (i <= 0 || i === v.length - 1) throw new Error(`--${name} takes <model>=<value>, not "${v}"`);
    out[v.slice(0, i)] = v.slice(i + 1);
  }
  return out;
}

function pickVariant(kind: string, given: string | undefined, table: Record<string, string | undefined>): string | undefined {
  if (given === undefined) return undefined;
  if (!(given in table)) throw new Error(`--${kind}-variant takes ${variantList(table)}, not "${given}"`);
  return table[given];
}

/** Whether SAYSHAPE_MODEL_URL was set on purpose (readModelEnv falls back to a local server, which a real run must not do quietly). */
function urlWasSet(): boolean {
  return !!(process.env.SAYSHAPE_MODEL_URL || loadEnv("development", root, "SAYSHAPE_").SAYSHAPE_MODEL_URL);
}

const sanitize = (s: string) => s.replace(/[^\w.-]+/g, "_");
const pct = (n: number) => `${Math.round(n)}`;

/** What a full run costs, from the tools' size and a typical conversation, before any model is called. */
function estimate(backend: Backend, conversations: Conversation[], models: number, runs: number): string[] {
  const system = backend.instructions.length + 60;
  const fixed = Math.round((JSON.stringify(backend.tools).length + system) / 4);
  const perMessage = 2.5; // requests the model makes to answer one message: docs, show, last words
  const grow = 900; // tokens one exchange adds to the history: the message, the spec it wrote, the result
  let requests = 0, input = 0, output = 0;
  for (const c of conversations) {
    const k = c.turns.length;
    requests += k * perMessage;
    for (let j = 0; j < k; j++) input += perMessage * (fixed + j * grow + grow / 2);
    output += k * perMessage * 350;
  }
  const times = models * runs;
  return [
    `Tools and instructions the model gets on every request: about ${fixed.toLocaleString("en-US")} tokens.`,
    `One run of every conversation, per model: about ${pct(requests)} requests, ${Math.round(input / 1000).toLocaleString("en-US")}k input tokens, ${Math.round(output / 1000).toLocaleString("en-US")}k output tokens.`,
    `All ${models} model${models === 1 ? "" : "s"} × ${runs} run${runs === 1 ? "" : "s"}: about ${pct(requests * times)} requests, ${Math.round((input * times) / 1000).toLocaleString("en-US")}k input tokens, ${Math.round((output * times) / 1000).toLocaleString("en-US")}k output tokens.`,
    "These are estimates; thinking models write more, and prompt caching makes the fixed part much cheaper.",
  ];
}

async function main(): Promise<void> {
  const env = readModelEnv("development", root);
  const stubName = arg("stub");
  if (stubName !== undefined && !STUB_BEHAVIORS.includes(stubName as StubBehavior)) throw new Error(`--stub takes ${STUB_BEHAVIORS.join(", ")}, not "${stubName}"`);
  const dry = flag("dry-run");

  const models = stubName !== undefined ? [`stub-${stubName}`] : list("models") ?? (env.model ? [env.model] : []);
  if (!models.length && !dry) throw new Error("No model: pass --models a,b,c, or set SAYSHAPE_MODEL in .env.local.");
  const endpoints = pairs("endpoint");
  const keyEnvs = pairs("key-env");
  for (const m of [...Object.keys(endpoints), ...Object.keys(keyEnvs)]) if (!models.includes(m)) throw new Error(`--endpoint and --key-env name models from --models; "${m}" isn't one.`);
  const needsDefault = models.some((m) => !endpoints[m]);
  if (stubName === undefined && !dry && needsDefault && !urlWasSet()) {
    throw new Error("No model URL: set SAYSHAPE_MODEL_URL in .env.local (for OpenRouter, https://openrouter.ai/api/v1) or in the environment, or give each model an --endpoint.");
  }

  const wanted = list("sets") ?? PROMPT_SETS.map((s) => s.id);
  for (const id of wanted) if (!PROMPT_SETS.some((s) => s.id === id)) throw new Error(`--sets takes ${PROMPT_SETS.map((s) => s.id).join(", ")}, not "${id}"`);
  const sets = PROMPT_SETS.filter((s) => wanted.includes(s.id));
  const only = arg("only")?.toUpperCase();
  if (only !== undefined && only !== "A" && only !== "B") throw new Error(`--only takes A or B, not "${arg("only")}"`);
  const conversations: Conversation[] = sets.flatMap((s) => [...(only !== "B" ? [conversationA(s)] : []), ...(only !== "A" ? [conversationB(s)] : [])]);
  const runs = count("runs", 3);

  const variant: TextVariant = {};
  const descriptionText = arg("description-text") ?? pickVariant("description", arg("description-variant"), DESCRIPTION_VARIANTS);
  const noteTemplate = arg("note-text") ?? pickVariant("note", arg("note-variant"), NOTE_VARIANTS);
  if (descriptionText !== undefined) variant.description = descriptionText;
  if (noteTemplate !== undefined) variant.note = noteTemplate;
  const descriptionLabel = arg("description-text") !== undefined ? "custom" : arg("description-variant") ?? "real";
  const noteLabel = arg("note-text") !== undefined ? "custom" : arg("note-variant") ?? "real";

  const cacheArg = arg("cache");
  const cache = cacheArg === undefined ? env.cache : cacheArg === "off" ? undefined : parseCache(cacheArg);
  if (cacheArg !== undefined && cacheArg !== "off" && !cache) throw new Error(`--cache takes 1h, 5m or off, not "${cacheArg}"`);
  const limits = {
    maxRequests: count("max-requests", DEFAULT_LIMITS.maxRequests),
    maxTokens: count("max-tokens", DEFAULT_LIMITS.maxTokens),
    maxTurnRequests: count("max-turn-requests", DEFAULT_LIMITS.maxTurnRequests),
  };
  const replyTokens = count("reply-tokens", 8000);
  const temperature = arg("temperature") === undefined ? undefined : Number(arg("temperature"));
  if (temperature !== undefined && !Number.isFinite(temperature)) throw new Error(`--temperature takes a number, not "${arg("temperature")}"`);
  const concurrency = count("concurrency", 2);

  // Connecting once up front checks that the server's packages are installed before anything is spent.
  const probe = await connectView();
  const tools = withVariant(probe, variant).tools;
  const plan = estimate(probe, conversations, models.length || 1, runs);
  await probe.close();
  console.log(`Colors check: ${sets.length} prompt set${sets.length === 1 ? "" : "s"} (${sets.map((s) => s.id).join(", ")}), ${conversations.length} conversations × ${models.length || "?"} model${models.length === 1 ? "" : "s"} × ${runs} run${runs === 1 ? "" : "s"}`);
  console.log(`Tool text: colors description ${descriptionLabel}, result note ${noteLabel}.`);
  for (const line of plan) console.log(`  ${line}`);
  if (dry) return;
  console.log("");

  const stub = stubName !== undefined ? await startStub(stubName as StubBehavior) : undefined;
  try {
    const url = stub?.url ?? env.url;
    const prices = stub ? {} : await pricesFor(env.url, models.filter((m) => !endpoints[m]));
    const keyFor = (m: string): string | undefined => {
      const name = keyEnvs[m];
      if (name === undefined) return env.apiKey || undefined;
      const key = process.env[name];
      if (!key) throw new Error(`--key-env ${m}=${name}: ${name} is not set in the environment.`);
      return key;
    };
    // A model's endpoint and key are checked before the first request, so a typo stops the run at once.
    const chats = new Map<string, ChatFn>(models.map((m) => [m, openAiChat({ url: endpoints[m] ?? url, model: m, apiKey: keyFor(m), maxTokens: replyTokens, temperature, cache })]));
    if (!stub && env.url.includes("openrouter.ai") && !env.apiKey && models.some((m) => !endpoints[m] && !keyEnvs[m])) {
      throw new Error("SAYSHAPE_API_KEY is empty, and OpenRouter needs one: set it in .env.local or in the environment.");
    }

    const seenOk = new Set<string>();
    const results = await runEval({
      models, conversations, runs, concurrency, limits, variant,
      chatFor: (m) => chats.get(m)!,
      connect: connectView,
      onResult: (r, done, total) => {
        const t = tallyOf([r]);
        const what = r.kind === "A" ? `later calls unchanged ${rate(t.laterSame, t.laterCalls)}, reset honored ${rate(t.resetNone, t.resetCalls)}` : `invented ${rate(t.plainInvented, t.plainCalls)}`;
        console.log(`${String(done).padStart(4)}/${total}  ${r.model.slice(0, 30).padEnd(30)} ${r.id.padEnd(14)} run ${r.run}  ${r.stopped ? `stopped: ${r.stopped.slice(0, 70)}` : what}  (${r.requests} requests, ${(r.ms / 1000).toFixed(1)} s)`);
        if (r.requests > 0) seenOk.add(r.model);
        else if (!seenOk.has(r.model)) {
          console.error(`\nThe first conversation for ${r.model} got no answer, so the server is probably unreachable, the key is wrong or the model name is wrong. Stopping.`);
          process.exit(1);
        }
      },
    });

    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const dir = arg("out") ? resolve(arg("out")!) : resolve(root, "eval", "results", `colors-${stamp}`);
    mkdirSync(resolve(dir, "transcripts"), { recursive: true });
    const md = report(results, {
      date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
      url: stub ? `scripted stub (${stubName})` : env.url,
      runs, sets: sets.map((s) => s.id), descriptionVariant: descriptionLabel, noteVariant: noteLabel, cache,
      cost: (m, u) => (prices[m] ? costOf(u, prices[m]) : undefined),
    });
    writeFileSync(resolve(dir, "report.md"), md);
    writeFileSync(resolve(dir, "tools.json"), JSON.stringify(tools, null, 2));
    const slim = (r: ConversationResult) => ({ ...r, messages: undefined });
    writeFileSync(resolve(dir, "results.json"), JSON.stringify({ url: stub ? null : env.url, models, runs, sets: sets.map((s) => s.id), descriptionVariant: descriptionLabel, noteVariant: noteLabel, limits, cache: cache ?? null, prices, results: results.map(slim) }, null, 2));
    for (const r of results) {
      const sub = resolve(dir, "transcripts", sanitize(r.model));
      mkdirSync(sub, { recursive: true });
      writeFileSync(resolve(sub, `${sanitize(r.id)}.run${r.run}.json`), JSON.stringify(r, null, 2));
    }
    console.log("\n" + md);
    console.log(`Full results and transcripts: ${dir}`);
  } finally {
    await stub?.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
