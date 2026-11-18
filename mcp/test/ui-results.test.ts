/**
 * Clients that announce MCP Apps get exactly the results they got before the
 * text-only fallback existed, plus the colors argument and its note.
 *
 * test/fixtures/ui-results.json and ui-tools.json are what they get now;
 * record them again only for a change meant to reach MCP Apps clients:
 *
 *   SAYSHAPE_RECORD=1 npx vitest run test/ui-results.test.ts
 *
 * test/fixtures/main/ holds the same two files as they were recorded from
 * main before the colors argument existed. They're never recorded again: a
 * server started with --no-model-colors must still give exactly them.
 * (One exception, on purpose: the two tools files changed when slide decks
 * stopped being behind a flag, which adds deck to the quick start and the docs.
 * Another, on purpose: button's new icon=, size= and fit= props changed the docs
 * shown in repair results, so main/ui-results.json has those three lines added.
 * And another: the look, motion and pictures topics joined sayshape_docs, which adds
 * their names to the topic list in both tools files. And another: the quick start gained one line
 * saying what those topics are for, so models ask for motion too. And another: extend and rank
 * joined the expression functions, which adds their names to the list in the quick start, and so
 * did range and map, and has, is, contains, starts and ends. And another: button's validate= and
 * label= props, its optional text and its icon-only example changed the button docs shown in
 * repair results, so main/ui-results.json has those lines too.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, setAdaptiveGuides } from "../src/server";

afterEach(() => setAdaptiveGuides(true));
import { McpResultStore } from "../src/mcp-results";
import { parseViewArgs, type ViewOptions } from "../src/ui/view-options";
import { UI_CLIENT } from "./clients";

const RESULTS = new URL("./fixtures/ui-results.json", import.meta.url);
const TOOLS = new URL("./fixtures/ui-tools.json", import.meta.url);
const MAIN_RESULTS = new URL("./fixtures/main/ui-results.json", import.meta.url);
const MAIN_TOOLS = new URL("./fixtures/main/ui-tools.json", import.meta.url);
const record = !!process.env.SAYSHAPE_RECORD;
const LOCKED = parseViewArgs(["--no-model-colors"]);

const GOOD = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n';
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["good", { spec: GOOD, title: "Hike" }],
  ["repeat", { spec: GOOD, title: "Hike" }],
  ["to fix", { spec: 'card\n  txet "Typo"\n  button "Go" on=nope:x\n' }],
  ["ignored prop", { spec: 'card\n  text "Hi" colour=red\n' }],
  ["dataset", { spec: 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n', data: { sales: "m1" } }],
  ["script in a string", { spec: 'card\n  text "</script><script>alert(1)</script><!--"\n' }],
];
/** The same spec as "good", in colors: new, then the same again (a repeat), then sloppy, then a problem to fix. */
const COLOR_CALLS: Array<[string, Record<string, unknown>]> = [
  ["colors", { colors: ["#e4572e", "#2e86ab"], spec: GOOD, title: "Hike" }],
  ["colors repeat", { colors: ["#E4572E", "2e86ab"], spec: GOOD, title: "Hike" }],
  ["colors sloppy", { colors: ["teal", "", "#e45", "#2e86ab", "#1", "#222", "#333", "#444", "#555", "#666"], spec: GOOD, title: "Hike" }],
  ["colors none usable", { colors: ["red", "rgb(0,0,0)"], spec: 'card\n  text "Plain" style=title\n' }],
  ["colors to fix", { colors: ["#e4572e"], spec: 'card\n  txet "Typo"\n' }],
];

async function connect(view?: ViewOptions, store?: McpResultStore) {
  const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store, now: () => 1_000, ...(view ? { view } : {}) });
  const client = new Client({ name: "test", version: "1.0.0" }, UI_CLIENT);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function results(calls: Array<[string, Record<string, unknown>]>, view?: ViewOptions) {
  const store = new McpResultStore();
  store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12000 }, { team: "East", revenue: 9000 }] } }, { label: "sales" });
  const client = await connect(view, store);
  const out: Record<string, unknown> = {};
  for (const [name, args] of calls) out[name] = await client.callTool({ name: "show_interface", arguments: args });
  await client.close();
  return out;
}

const EMIT_SPEC = 'state n=1\ncard\n  text "Pick one" style=title\n  button "Plan this trip" on=set:n:2;emit:plan_trip:{n}\n  text "Read [the guide](https://example.com/guide)" rich=true\n';

async function tools(view?: ViewOptions, emitArgs: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [name, store] of [["plain", undefined], ["datasets", new McpResultStore()]] as const) {
    const client = await connect(view, store);
    out[name] = { tools: (await client.listTools()).tools, docs: await client.callTool({ name: "sayshape_docs", arguments: {} }), emit: await client.callTool({ name: "show_interface", arguments: { ...emitArgs, spec: EMIT_SPEC } }) };
    await client.close();
  }
  return out;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

describe("MCP Apps clients", () => {
  it("get the results recorded in test/fixtures/ui-results.json, colors included", async () => {
    const now = json(await results([...CALLS, ...COLOR_CALLS]));
    if (record) { writeFileSync(RESULTS, now); return; }
    expect(now).toBe(readFileSync(RESULTS, "utf8"));
  });

  it("see the tools, the docs and emit: as recorded in test/fixtures/ui-tools.json", async () => {
    const now = json(await tools());
    if (record) { writeFileSync(TOOLS, now); return; }
    expect(now).toBe(readFileSync(TOOLS, "utf8"));
  });

  it("get byte-for-byte main's results without the colors calls: no note when no colors are sent", async () => {
    expect(json(await results(CALLS))).toBe(readFileSync(MAIN_RESULTS, "utf8"));
  });
});

describe("--no-model-colors", () => {
  it("gives byte-for-byte main's results, even for calls that send colors anyway", async () => {
    expect(json(await results(CALLS, LOCKED))).toBe(readFileSync(MAIN_RESULTS, "utf8"));
    const withColors = CALLS.map(([name, args]) => [name, { colors: ["#e4572e", "#2e86ab"], ...args }] as [string, Record<string, unknown>]);
    expect(json(await results(withColors, LOCKED))).toBe(readFileSync(MAIN_RESULTS, "utf8"));
  });

  it("gives byte-for-byte main's tools, docs and emit: result", async () => {
    // main's tools are the quick start's, which the server still gives with adaptive guides off.
    setAdaptiveGuides(false);
    const recorded = readFileSync(MAIN_TOOLS, "utf8");
    expect(json(await tools(LOCKED))).toBe(recorded);
    expect(json(await tools(LOCKED, { colors: ["#e4572e"] }))).toBe(recorded);
  });
});
