/**
 * The live smoke test for adaptive guides (scripts/adaptive-smoke.ts): two
 * requests in plain words, each answered by a real model through Claude
 * Code's headless mode with the MCP server, once as it is and once with
 * --adaptive-guides. Pure parts only here, so tests can check them without a
 * model: the requests, reading Claude Code's stream-json output, and checking
 * that what was shown works.
 *
 * The prompts never name a route, a capability or a SayShape element: which
 * docs the model asks for, and how many calls it makes, is what's measured.
 */
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { sceneComponents } from "../../src/components/scene";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";

export interface SmokeRequest {
  id: "report" | "scene";
  /** What the person types. */
  prompt: string;
  /** Server flags both paths share (the scene needs scenes and behavior on, on both). */
  flags: string[];
}

export const SMOKE_REQUESTS: SmokeRequest[] = [
  {
    id: "report",
    prompt:
      "Here are our sales: Jan West 1200, Jan East 800, Feb West 1500, Feb East 600, Mar West 900, Mar East 1100. " +
      "Show me revenue by month as a chart, the total, and let me filter by region.",
    flags: [],
  },
  {
    id: "scene",
    prompt: "Show a ball rolling across the screen by itself. I want to be able to drag it somewhere else, and pause it with a button.",
    flags: ["--scene", "--behavior"],
  },
];

export interface ToolCall { name: string; input: Record<string, unknown> }

export interface RunRecord {
  /** Model calls: distinct assistant messages (Claude Code sends one per API call, possibly in several pieces). */
  modelCalls: number;
  toolCalls: ToolCall[];
  usage: { input: number; cacheCreation: number; cacheRead: number; output: number };
  /** Claude Code's own figures from its result line. */
  durationMs?: number;
  numTurns?: number;
  costUsd?: number;
  /** Models Claude Code reports using, with their token counts (a subagent would show here as another model). */
  modelUsage?: Record<string, unknown>;
  /** The last spec sent to show_interface. */
  spec?: string;
  error?: string;
}

/** mcp__sayshape__show_interface → show_interface. */
const short = (name: string) => name.split("__").pop() ?? name;

/** Reads Claude Code's `--output-format stream-json --verbose` lines. Lines that aren't JSON are skipped. */
export function readStream(text: string): RunRecord {
  const ids = new Map<string, { input: number; cacheCreation: number; cacheRead: number; output: number }>();
  const toolCalls: ToolCall[] = [];
  const out: RunRecord = { modelCalls: 0, toolCalls, usage: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 } };
  let anon = 0;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (ev.type === "assistant") {
      const msg = (ev.message ?? {}) as { id?: string; content?: Array<Record<string, unknown>>; usage?: Record<string, number> };
      const id = msg.id ?? `anon-${anon++}`;
      const u = msg.usage ?? {};
      ids.set(id, { input: u.input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 });
      for (const block of msg.content ?? []) {
        if (block.type === "tool_use") toolCalls.push({ name: short(String(block.name)), input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    if (ev.type === "result") {
      const u = (ev.usage ?? {}) as Record<string, number>;
      out.usage = { input: u.input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
      if (typeof ev.duration_ms === "number") out.durationMs = ev.duration_ms;
      if (typeof ev.num_turns === "number") out.numTurns = ev.num_turns;
      if (typeof ev.total_cost_usd === "number") out.costUsd = ev.total_cost_usd;
      if (ev.modelUsage && typeof ev.modelUsage === "object") out.modelUsage = ev.modelUsage as Record<string, unknown>;
      if (ev.is_error === true) out.error = String(ev.result ?? ev.subtype ?? "error");
    }
  }
  out.modelCalls = ids.size;
  // No result line (the run was cut off): add up what the messages said.
  if (!text.includes('"type":"result"')) {
    for (const u of ids.values()) {
      out.usage.input += u.input; out.usage.cacheCreation += u.cacheCreation; out.usage.cacheRead += u.cacheRead; out.usage.output += u.output;
    }
  }
  const shows = toolCalls.filter((c) => c.name === "show_interface");
  const last = shows[shows.length - 1];
  if (last && typeof last.input.spec === "string") out.spec = last.input.spec;
  return out;
}

export interface Outcome { ok: boolean; notes: string[] }

const ALL = new Registry([...coreComponents, ...mapComponents, ...sceneComponents]);

/** Whether what was shown does what the person asked, used as they would. */
export function checkOutcome(id: SmokeRequest["id"], spec: string | undefined): Outcome {
  const notes: string[] = [];
  if (!spec) return { ok: false, notes: ["nothing was shown"] };
  const behavior = id === "scene";
  const parsed = parse(spec.endsWith("\n") ? spec : spec + "\n", ALL, { presets: true, ...(behavior ? { behavior } : {}) });
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) notes.push(`errors: ${errors.map((e) => `line ${e.line}: ${e.message}`).join("; ")}`);
  const ui = render(spec.endsWith("\n") ? spec : spec + "\n", { components: [...coreComponents, ...mapComponents, ...sceneComponents], presets: true, ...(behavior ? { behavior: true } : {}) });
  if (id === "report") {
    const charts = ui.findAll("chart").filter((f) => f.box);
    const filters = ui.findAll({}).filter((f) => f.box && ["select", "segmented", "radio", "tabs"].includes(f.node.type));
    if (!charts.length) notes.push("no chart is drawn");
    if (!filters.length) notes.push("no filter control is drawn");
    const totals = ui.text().filter((t) => /6[,.]?1|\$6/.test(t));
    if (!totals.length) notes.push("the total (6,100) isn't shown");
    return { ok: !errors.length && charts.length > 0 && filters.length > 0 && totals.length > 0, notes };
  }
  // A scene that moves by itself, can be dragged and paused.
  const before = JSON.stringify(ui.state);
  ui.clock.advance(1500);
  const moving = JSON.stringify(ui.state) !== before;
  if (!moving) notes.push("nothing changes by itself");
  const draggable = /\bdrag=true\b/.test(spec);
  if (!draggable) notes.push("no shape has drag=true");
  let paused = false;
  for (const b of ui.findAll("button").filter((f) => f.box)) {
    try { ui.press({ id: b.node.id }); } catch { continue; }
    const at = JSON.stringify(ui.state);
    ui.clock.advance(1500);
    if (JSON.stringify(ui.state) === at) { paused = true; break; }
  }
  if (!paused) notes.push("no button stops it");
  return { ok: !errors.length && moving && draggable && paused, notes };
}
