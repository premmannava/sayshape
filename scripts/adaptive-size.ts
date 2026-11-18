/**
 * How much a model reads with adaptive guides (src/capabilities.ts), against
 * the guides and tools it reads today. Everything is counted from the real
 * text: the assembled guides, and for the MCP server, everything tools/list
 * advertises (names, descriptions and input schemas) plus what sayshape_docs
 * returns.
 *
 *   npm run adaptive:size          (needs npm ci --prefix mcp)
 *
 * Tokens are counted with o200k_base (gpt-tokenizer), not Claude's tokenizer:
 * compare the ratios, not the absolute numbers. The routes below are chosen by
 * hand, one plausible docs call per request on each path. They measure the
 * size of a route, not whether a model would take it: only a live run says
 * that (scripts/adaptive-smoke.mjs).
 */
import { assembleGuide, languageMap } from "../src/capabilities";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";
import { tokens, TOKENIZER } from "../bench/tokens/measure";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load, packageFile } from "../eval/colors/connect";

// The server and the SDK load from mcp/ when this runs (npm ci --prefix mcp first), as eval/colors/connect.ts
// does, so the library typechecks without mcp/'s packages.
interface Client {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: unknown }> }>;
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<{ content?: unknown }>;
  connect(t: unknown): Promise<void>;
}
interface ServerModule {
  createServer(o: { uiHtml: () => string }): { connect(t: unknown): Promise<void> };
  setAdaptiveGuides(on: boolean): void;
  setScenes(on: boolean): void;
  setBehavior(on: boolean): void;
}
const { createServer, setAdaptiveGuides, setScenes, setBehavior } = await load<ServerModule>(pathToFileURL(fileURLToPath(new URL("../mcp/src/server.ts", import.meta.url))).href);
const { Client } = await load<{ Client: new (info: { name: string; version: string }, opts: unknown) => Client }>(packageFile("@modelcontextprotocol/sdk", "./client"));
const { InMemoryTransport } = await load<{ InMemoryTransport: { createLinkedPair(): [unknown, unknown] } }>(packageFile("@modelcontextprotocol/sdk", "./inMemory.js"));
const apps = await load<{ EXTENSION_ID: string; RESOURCE_MIME_TYPE: string }>(packageFile("@modelcontextprotocol/ext-apps", "./server"));
const UI_CLIENT = { capabilities: { extensions: { [apps.EXTENSION_ID]: { mimeTypes: [apps.RESOURCE_MIME_TYPE] } } } };

interface Route {
  name: string;
  /** Today: the elements (and topics) a model would ask sayshape_docs for. Undefined: no docs call. */
  current?: { elements?: string[]; topics?: string[] };
  /** With --adaptive-guides: the capabilities and elements. Undefined: none (a report is in the map). */
  adaptive?: { elements?: string[]; topics?: string[] };
  scenes?: boolean;
}

const ROUTES: Route[] = [
  { name: "Sales report (filter, chart, total)", current: { elements: ["chart", "stat", "select"] } },
  { name: "Sign-up form (validation, emit)", current: { elements: ["input", "button"] }, adaptive: { topics: ["forms"] } },
  { name: "Budget with filtered total (mixed)", current: { elements: ["select", "stepper", "stat"], topics: ["lists"] }, adaptive: { topics: ["lists", "calculations", "forms"] } },
  { name: "Draggable, pausable scene", current: { elements: ["scene", "circle", "button"], topics: ["behavior"] }, adaptive: { topics: ["scenes", "behavior"] }, scenes: true },
];

async function client(adaptive: boolean, scenes: boolean) {
  setAdaptiveGuides(adaptive);
  setScenes(scenes);
  setBehavior(scenes);
  const server = createServer({ uiHtml: () => "<!doctype html>" });
  const c = new Client({ name: "measure", version: "1.0.0" }, UI_CLIENT);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), c.connect(b)]);
  return c;
}
const surface = async (c: Client) => JSON.stringify((await c.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
const docs = async (c: Client, args?: { elements?: string[]; topics?: string[] }) =>
  args ? ((await c.callTool({ name: "sayshape_docs", arguments: args })).content as Array<{ text: string }>)[0]!.text : "";

const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
const ratio = (a: number, b: number) => (b ? `${(a / b).toFixed(1)}×` : "–");

async function mcp(): Promise<string[]> {
  const out = [
    "## MCP server (view client)",
    "",
    "Read before writing: the advertised tools plus the docs call's result, what the model holds when it writes the spec. Summed: the input of every call up to show_interface (the tools go with each call). Calls: model calls up to and including show_interface. Tool results after it, and the model's own words, are left out on both sides.",
    "",
    row(["Request", "Current: tools", "docs", "read before writing", "summed", "calls", "Adaptive: tools", "docs", "read before writing", "summed", "calls", "Summed, current ÷ adaptive"]),
    row(["---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:"]),
  ];
  for (const r of ROUTES) {
    const scenes = !!r.scenes;
    const now = await client(false, scenes);
    const sNow = tokens(await surface(now));
    const dNow = r.current ? tokens(await docs(now, r.current)) : 0;
    const next = await client(true, scenes);
    const sNext = tokens(await surface(next));
    const dNext = r.adaptive ? tokens(await docs(next, r.adaptive)) : 0;
    const sumNow = r.current ? sNow + (sNow + dNow) : sNow;
    const sumNext = r.adaptive ? sNext + (sNext + dNext) : sNext;
    out.push(row([r.name, sNow, dNow, sNow + dNow, sumNow, r.current ? 2 : 1, sNext, dNext, sNext + dNext, sumNext, r.adaptive ? 2 : 1, ratio(sumNow, sumNext)]));
  }
  setAdaptiveGuides(false); setScenes(false); setBehavior(false);
  return out;
}

function sdk(): string[] {
  const reg = new Registry([...coreComponents, ...mapComponents]);
  const withScenes = new Registry([...coreComponents, ...mapComponents, ...sceneComponents]);
  const full = tokens(languageGuide(reg));
  const map = tokens(languageMap(reg, { presets: true }));
  const out = [
    "## sayshape/model guides (system prompt of one call)",
    "",
    `Full guide (the default): ${full}. Compact: ${tokens(languageGuide(reg, { mode: "compact" }))}. Report guide: ${tokens(languageGuide(reg, { mode: "report" }))}. Map (open-ended first call, report syntax included): ${map}.`,
    "",
    row(["Request", "Capabilities (known to the app)", "Known: 1 call", "Open-ended: map + guide", "Full ÷ known"]),
    row(["---", "---", "---:", "---:", "---:"]),
  ];
  const cases: Array<[string, string[], Registry, { behavior?: boolean }]> = [
    ["Sales report", ["report"], reg, {}],
    ["Sign-up form", ["forms"], reg, {}],
    ["Budget with filtered total", ["lists", "calculations", "forms"], reg, {}],
    ["Draggable, pausable scene", ["scenes", "behavior"], withScenes, { behavior: true }],
  ];
  for (const [name, caps, r, o] of cases) {
    const known = tokens(assembleGuide(r, caps, { presets: true, ...o }).text);
    const fullHere = tokens(languageGuide(r, o));
    const open = caps[0] === "report" ? `${tokens(languageMap(r, { presets: true, ...o }))} (1 call)` : `${tokens(languageMap(r, { presets: true, ...o }))} + ${known}`;
    out.push(row([name, caps.join(", "), known, open, ratio(fullHere, known)]));
  }
  return out;
}

const lines = [`# Adaptive guides: sizes`, "", `Tokenizer: ${TOKENIZER}. Routes are chosen by hand: sizes, not model behavior.`, "", ...sdk(), "", ...(await mcp())];
console.log(lines.join("\n"));
