/**
 * A small live comparison of the MCP server as it is and with --adaptive-guides,
 * with your own Claude Code login: each request in eval/adaptive/smoke.ts is
 * answered by `claude -p` (headless), whose only tools are this server's
 * show_interface and sayshape_docs. Same model, settings, data and server
 * flags within each pair; only --adaptive-guides differs.
 *
 *   npm ci && npm ci --prefix mcp && npm --prefix mcp run build
 *   npm run adaptive:smoke -- [--model haiku] [--runs 1] [--out <folder>] [--only report|scene]
 *
 * Records, per run: model calls, tool calls (and what sayshape_docs was asked
 * for), input, cache and output tokens and cost as Claude Code reports them,
 * wall-clock time, and whether what was shown works when used
 * (checkOutcome). Tokens include Claude Code's own system prompt, the same on
 * both paths, so compare the differences. No subagents are possible: the run
 * has no Task tool. Results go to <out>/results.json and a table on stdout;
 * nothing is written in the repository.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOutcome, readStream, SMOKE_REQUESTS, type Outcome, type RunRecord } from "../eval/adaptive/smoke";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1]! : fallback; };
const model = opt("--model", "haiku");
const runs = Number(opt("--runs", "1"));
const only = opt("--only", "");
const out = opt("--out", mkdtempSync(join(tmpdir(), "sayshape-smoke-")));
const server = fileURLToPath(new URL("../mcp/dist/server.js", import.meta.url));
if (!existsSync(server)) {
  console.error("Build the MCP server first: npm ci --prefix mcp && npm --prefix mcp run build");
  process.exit(1);
}

function run(prompt: string, flags: string[]): Promise<{ stdout: string; ms: number; code: number | null; stderr: string }> {
  const config = join(out, `mcp-${flags.join("_") || "default"}.json`);
  writeFileSync(config, JSON.stringify({ mcpServers: { sayshape: { command: process.execPath, args: [server, ...flags] } } }));
  const cli = [
    "-p", prompt,
    "--model", model,
    "--output-format", "stream-json", "--verbose",
    "--mcp-config", config, "--strict-mcp-config",
    // No built-in tools (so no Task: no subagents), only this server's two.
    "--tools", "",
    "--allowedTools", "mcp__sayshape__show_interface", "mcp__sayshape__sayshape_docs",
    "--no-session-persistence",
  ];
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", cli, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, ms: Date.now() - start, code, stderr }));
    child.on("error", (e) => resolve({ stdout, ms: Date.now() - start, code: -1, stderr: String(e) }));
  });
}

interface Row { request: string; path: "current" | "adaptive"; run: number; wallMs: number; record: RunRecord; outcome: Outcome }
const rows: Row[] = [];
for (const req of SMOKE_REQUESTS.filter((r) => !only || r.id === only)) {
  for (let i = 1; i <= runs; i++) {
    for (const path of ["current", "adaptive"] as const) {
      const flags = [...req.flags, ...(path === "adaptive" ? ["--adaptive-guides"] : [])];
      const r = await run(req.prompt, flags);
      const record = readStream(r.stdout);
      if (r.code !== 0 && !record.error) record.error = r.stderr.trim().split("\n").slice(-3).join(" ") || `exit ${r.code}`;
      const outcome = checkOutcome(req.id, record.spec);
      rows.push({ request: req.id, path, run: i, wallMs: r.ms, record, outcome });
      writeFileSync(join(out, `${req.id}-${path}-${i}.jsonl`), r.stdout);
      console.error(`${req.id} ${path} #${i}: ${record.modelCalls} calls, ${(r.ms / 1000).toFixed(1)} s, ${outcome.ok ? "works" : `fails (${outcome.notes.join("; ")})`}${record.error ? `, error: ${record.error}` : ""}`);
    }
  }
}
writeFileSync(join(out, "results.json"), JSON.stringify({ model, runs, rows }, null, 2));

const docsAsked = (r: RunRecord) => r.toolCalls.filter((c) => c.name === "sayshape_docs").map((c) => JSON.stringify(c.input)).join(" ") || "none";
const line = (c: Array<string | number>) => `| ${c.join(" | ")} |`;
console.log([
  `Model: ${model}. Claude Code headless (claude -p), MCP server ${server}. Tokens as Claude Code reports them, its own system prompt included on both paths.`,
  "",
  line(["Request", "Path", "Model calls", "Tool calls", "sayshape_docs asked for", "Input", "Cache write", "Cache read", "Output", "Wall s", "Works", "Notes"]),
  line(["---", "---", "---:", "---", "---", "---:", "---:", "---:", "---:", "---:", "---", "---"]),
  ...rows.map((r) => line([
    r.request, r.path, r.record.modelCalls, r.record.toolCalls.map((c) => c.name).join(", ") || "none", docsAsked(r.record),
    r.record.usage.input, r.record.usage.cacheCreation, r.record.usage.cacheRead, r.record.usage.output,
    (r.wallMs / 1000).toFixed(1), r.outcome.ok ? "yes" : "no", [...r.outcome.notes, ...(r.record.error ? [r.record.error] : [])].join("; ") || "",
  ])),
  "",
  `Raw streams and results.json: ${out}`,
].join("\n"));
