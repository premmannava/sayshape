/**
 * How well a model does with SayShape through this MCP server, the way a chat
 * app like MCPJam or Claude runs it. Every request in eval/cases.ts goes to the
 * model with the server's instructions and tools; the model calls them until
 * it answers in text. The report says how often it was right the first time
 * and which mistakes made it retry.
 *
 *   npm run eval                               GPT-4.1 on OpenAI, every request
 *   npm run eval -- --model gpt-4.1-mini       another model
 *   npm run eval -- --only dash,shop-cart      only some categories or request ids
 *   npm run eval -- --concurrency 2            fewer requests at once (rate limits)
 *
 * The key: OPENAI_API_KEY, or LOOM_API_KEY in the environment or ../.env.local.
 * Any OpenAI-compatible server works: LOOM_MODEL_URL (default
 * https://api.openai.com/v1) and LOOM_MODEL (default gpt-4.1).
 * Results go to ../eval/results/mcp-<date>-<model>/: report.md and results.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { report, runCase, summarize, type CaseResult, type ChatFn } from "../src/eval";
import { cases } from "../../eval/cases";

const root = resolve(__dirname, "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** LOOM_ settings and OPENAI_API_KEY from the environment, then ../.env.local. */
function settings(): { url: string; model: string; key: string } {
  const file: Record<string, string> = {};
  const path = resolve(root, ".env.local");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) file[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  const get = (k: string) => process.env[k] || file[k] || "";
  return {
    url: (get("LOOM_MODEL_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: arg("model") || get("LOOM_MODEL") || "gpt-4.1",
    key: get("OPENAI_API_KEY") || get("LOOM_API_KEY"),
  };
}

function openAiChat(url: string, model: string, key: string): ChatFn {
  return async (messages, tools) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, messages, tools, temperature: 0 }),
      });
      // Rate limits and busy servers: wait and try again, a few times.
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as {
        choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = body.choices[0]!.message;
      return {
        text: msg.content,
        toolCalls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
        promptTokens: body.usage?.prompt_tokens,
        completionTokens: body.usage?.completion_tokens,
      };
    }
  };
}

async function main(): Promise<void> {
  const { url, model, key } = settings();
  if (!key && url.includes("openai.com")) {
    console.error("No API key. Set OPENAI_API_KEY, or LOOM_API_KEY in .env.local at the repository root.");
    process.exit(1);
  }
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const chosen = only ? cases.filter((c) => only.some((o) => c.id === o || c.category === o || c.id.startsWith(o + "-"))) : cases;
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 4));
  const chat = openAiChat(url, model, key);
  console.log(`${chosen.length} requests to ${model} at ${url}, ${concurrency} at a time`);

  const results: CaseResult[] = new Array(chosen.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < chosen.length) {
      const i = next++;
      const c = chosen[i]!;
      // A fresh server per request, as each conversation gets its own.
      const server = createServer({ uiHtml: () => "<!doctype html><title>view</title>" });
      const client = new Client({ name: "sayshape-eval", version: "0.1.0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      const r = await runCase({ client, chat, id: c.id, request: c.request });
      await client.close();
      results[i] = r;
      const first = r.shows[0];
      console.log(`${r.error ? "!" : first?.toFix === 0 ? "✓" : r.shows.length ? "↻" : "–"} ${c.id}: ${r.shows.length} show, ${r.docsCalls} docs, ${r.turns} turns${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
    }
  }));

  const s = summarize(results);
  const dir = resolve(root, "eval/results", `mcp-${new Date().toISOString().slice(0, 10)}-${model.replace(/[^\w.-]+/g, "_")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "report.md"), report(model, results));
  writeFileSync(resolve(dir, "results.json"), JSON.stringify({ model, url, summary: s, results }, null, 2));
  console.log(`\nRight the first time: ${s.firstTry} of ${s.showed}. Extra show_interface calls: ${s.extraShows}.`);
  console.log(`Top mistakes:\n${s.mistakes.slice(0, 5).map((m) => `  ${m.count}× ${m.mistake}`).join("\n") || "  none"}`);
  console.log(`\nReport: ${resolve(dir, "report.md")}`);
}

void main();
