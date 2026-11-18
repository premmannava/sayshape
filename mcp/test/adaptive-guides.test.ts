/**
 * Adaptive guides, on by default (--adaptive-guides is still accepted and does
 * nothing): show_interface's description carries the map of the language (with
 * the report syntax, where reports are drawn) in place of the quick start, and
 * sayshape_docs answers every capability and element asked for in one guide.
 * setAdaptiveGuides(false) still gives what the server said before.
 *
 * Sizes here are characters of what tools/list advertises (descriptions and
 * input schemas together); token counts come from `npm run adaptive:size` in
 * the repository root, which counts the same text with a tokenizer.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { adaptiveStart, checkSpec, createServer, docsText, NO_EMIT, quickStart, setAdaptiveGuides, setBehavior, setScenes } from "../src/server";
import { PRESSES_SAVED } from "../src/widget-file";
import { PAGE_ENGINE_VERSION } from "../src/fallback";
import { decodeViewOptions } from "../src/ui/view-options";
import type { PackedEngine } from "../src/widget-engine";

const REPORT = `report "Sales" data=sales filter=region
  sum amount
  bar month amount
state sales=[{month: "Jan", region: "West", amount: 1200}, {month: "Feb", region: "East", amount: 800}]
`;
const NONE = { base64: "", bytes: 0, gzipBytes: 0, digest: "x" };
const STAND_IN: PackedEngine = { engine: NONE, map: NONE };

type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
/** A client that announced no MCP Apps: it can't draw views, so it gets the CDN page (or a widget file with --widget-dir). */
const TEXT_ONLY = "text-only" as const;
async function connect(kind: typeof UI_CLIENT | typeof TEXT_ONLY = UI_CLIENT, extra: Record<string, unknown> = {}) {
  const client = kind === TEXT_ONLY ? undefined : kind;
  const server = createServer({ uiHtml: () => "<!doctype html><title>view</title>", ...extra });
  const c = new Client({ name: "test", version: "1.0.0" }, client);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), c.connect(b)]);
  return c;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as unknown as Result;
/** Everything tools/list advertises that a model reads: names, descriptions and input schemas. */
const surface = async (c: Client) => JSON.stringify((await c.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
const toolText = async (c: Client, name: string) => (await c.listTools()).tools.find((t) => t.name === name)!.description ?? "";

afterEach(() => { setAdaptiveGuides(true); setScenes(false); setBehavior(false); });

/** What sayshape_docs says it can be asked for, as tools/list advertises it. */
const docsTopics = async (c: Client) => JSON.stringify((await c.listTools()).tools.find((t) => t.name === "sayshape_docs")!.inputSchema);
const EMIT = `state email=""\nbutton "Send" on=emit:signup:{email}\n`;

describe("on by default", () => {
  it("gives the map with no flag, and false still restores the quick start and docs as they were", async () => {
    const d = await toolText(await connect(), "show_interface");
    expect(d).toContain("HOW SAYSHAPE FITS TOGETHER");
    expect(d).not.toContain("QUICK START");
    setAdaptiveGuides(false);
    expect(await toolText(await connect(), "show_interface")).toContain("QUICK START");
    expect(docsText([], [])).toBe(quickStart());
  });

  it("serves the view with reports on, with no flag", async () => {
    const html = ((await (await connect()).readResource({ uri: "ui://sayshape/interface.html" })).contents[0] as { text: string }).text;
    expect(decodeViewOptions(/<meta name="sayshape-view" content="([^"]*)">/.exec(html)?.[1]).presets).toBe(true);
  });
});

describe("each client is offered what it can draw and send back", () => {
  beforeEach(() => { setScenes(true); setBehavior(true); });
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sayshape-clients-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("a client that draws views: reports, behavior, and emit: that reaches the model", async () => {
    const c = await connect();
    const d = await toolText(c, "show_interface");
    expect(d).toContain("A REPORT, ready to write");
    expect(d).toMatch(/^- behavior:/m);
    expect(d).toContain("on=emit:pick:{x.name} sends a choice to you");
    expect(await docsTopics(c)).toMatch(/Capabilities: report, [^"]*scenes, behavior,/);
    expect((await call(c, "show_interface", { spec: EMIT })).structuredContent).toMatchObject({ errors: 0, toFix: 0 });
  });

  it("a text-only client on the CDN page: no reports or behavior anywhere, and told emit: can't reach the model", async () => {
    const c = await connect(TEXT_ONLY);
    const d = await toolText(c, "show_interface");
    expect(d).not.toContain("A REPORT");
    expect(d).not.toMatch(/^- (report|behavior):/m);
    expect(d).toContain(NO_EMIT);
    const topics = await docsTopics(c);
    expect(topics).toMatch(/Capabilities: lists, /);
    expect(topics).not.toMatch(/\breport\b|\bbehavior\b|\blook\b|\bmotion\b|\bpictures\b/);
    expect((await call(c, "show_interface", { spec: EMIT })).content[0]!.text).toMatch(/emit: can't reach you from this chat app/);
  });

  it("a widget-file client: reports and behavior (its own engine); emit: is refused unless a host adapter saves presses", async () => {
    const c = await connect(TEXT_ONLY, { widgetDir: dir, widgetEngine: async () => STAND_IN });
    const d = await toolText(c, "show_interface");
    expect(d).toContain("A REPORT, ready to write");
    expect(d).toMatch(/^- behavior:/m);
    expect(d).toContain(NO_EMIT);
    expect(await docsTopics(c)).toMatch(/Capabilities: report, [^"]*behavior,/);
    const saved = await connect(TEXT_ONLY, { widgetDir: dir, widgetEngine: async () => STAND_IN, widgetHost: { name: "muse" } });
    expect(await toolText(saved, "show_interface")).toContain(PRESSES_SAVED);
    expect((await call(saved, "show_interface", { spec: EMIT })).content[0]!.text).not.toMatch(/emit: can't reach you/);
  });
});

describe("the advertised tool surface", () => {
  it("is smaller in all, not just moved from one tool to another", async () => {
    setAdaptiveGuides(false);
    const old = await surface(await connect());
    setAdaptiveGuides(true);
    const now = await surface(await connect());
    expect(now.length).toBeLessThan(old.length);
  });

  it("puts the map and the report syntax in show_interface, where the view draws reports", async () => {
    const d = await toolText(await connect(), "show_interface");
    expect(d).toContain("HOW SAYSHAPE FITS TOGETHER");
    expect(d).toContain("A REPORT, ready to write");
    expect(d).toMatch(/call sayshape_docs once with every capability and element/);
    expect(d).not.toContain("QUICK START");
    const docs = (await connect().then((c) => c.listTools())).tools.find((t) => t.name === "sayshape_docs")!;
    expect(JSON.stringify(docs.inputSchema)).toMatch(/Capabilities: report, lists, calculations, forms, actions, layout, content, data, navigation, feedback, look, motion, pictures, full/);
  });

  it("never offers reports to a client on the CDN page, whose pinned engine can't draw them", async () => {
    expect(PAGE_ENGINE_VERSION).toBe("0.1.1");
    const d = await toolText(await connect(TEXT_ONLY), "show_interface");
    expect(d).toContain("HOW SAYSHAPE FITS TOGETHER");
    expect(d).not.toContain("A REPORT");
    expect(d).not.toMatch(/^- report:/m);
    expect(adaptiveStart(false, false, true, false)).not.toContain("report");
    // A widget file carries this server's own engine, so it is offered them.
    expect(adaptiveStart(false, false, true, true)).toContain("A REPORT, ready to write");
  });

  it("offers scenes and behavior only when they're on", () => {
    expect(adaptiveStart()).not.toMatch(/^- (scenes|behavior):/m);
    setScenes(true);
    setBehavior(true);
    expect(adaptiveStart()).toMatch(/^- scenes:/m);
    expect(adaptiveStart()).toMatch(/^- behavior:/m);
  });
});

describe("a report on the first turn", () => {
  it("is accepted with no docs call, on the view", async () => {
    const c = await connect();
    const r = await call(c, "show_interface", { spec: REPORT });
    expect(r.content[0]!.text).toMatch(/^The interface is showing in the conversation, with no problems/);
    expect(r.structuredContent).toMatchObject({ errors: 0, toFix: 0 });
  });

  it("is drawn by the view and by widget files: both engines get presets", async () => {
    const res = await (await connect()).readResource({ uri: "ui://sayshape/interface.html" });
    const html = (res.contents[0] as { text: string }).text;
    expect(decodeViewOptions(/<meta name="sayshape-view" content="([^"]*)">/.exec(html)?.[1]).presets).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), "sayshape-adaptive-"));
    try {
      const c = await connect(TEXT_ONLY, { widgetDir: dir, widgetEngine: async () => STAND_IN });
      const r = await call(c, "show_interface", { spec: REPORT });
      const path = /^(\/\S+\.html)$/m.exec(r.content[0]!.text)?.[1];
      expect(path, r.content[0]!.text).toBeTruthy();
      expect(await readFile(path!, "utf8")).toContain(", presets: true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is a problem to fix on the CDN page, not a page that can't draw it", async () => {
    const r = await call(await connect(TEXT_ONLY), "show_interface", { spec: REPORT });
    expect(r.content[0]!.text).toMatch(/Unknown element "report"/);
    expect(r.content[0]!.text).not.toContain("jsdelivr");
  });

  it("a chart line that can't be drawn is named, and the result is never a complete interface", async () => {
    const r = await call(await connect(), "show_interface", { spec: REPORT.replace("bar month amount", "bar month visitors") });
    const text = r.content[0]!.text;
    expect(text).toMatch(/^1 problem leaves part of this interface wrong or missing/);
    expect(text).toContain(`line 3 (error): This bar chart isn't shown: sales has no field "visitors". Its fields: month, region, amount`);
    expect(r.structuredContent).toMatchObject({ errors: 1, toFix: 1 });
    // The report's own list named first is its rows: the case that used to vanish now draws.
    expect(checkSpec(REPORT.replace("bar month amount", "line sales month amount")).errors).toEqual([]);
  });
});

describe("sayshape_docs: one call for a screen that needs several things", () => {
  it("returns one guide for every capability and element named", async () => {
    const r = await call(await connect(), "sayshape_docs", { topics: ["forms", "calculations"], elements: ["table"] });
    const text = r.content[0]!.text;
    for (const part of ["FORMAT", "EXPRESSIONS", "- input [\"text\"] bind=path!", "- stepper", "DETAILS\n  table", "EXAMPLE (calculator)", "EXAMPLE (signup)"]) expect(text).toContain(part);
    expect(text.split("\nRULES\n")).toHaveLength(2);
    expect(text).not.toContain("NOT INCLUDED");
  });

  it("says what isn't available or known, with what to ask for instead, without sending the whole guide", async () => {
    const c = await connect();
    const off = (await call(c, "sayshape_docs", { topics: ["scenes", "forms"] })).content[0]!.text;
    expect(off).toContain(`NOT INCLUDED\n- "scenes" isn't available here: this app doesn't draw scenes. Ask for data or content instead.`);
    expect(off).toContain("- input [\"text\"]");
    const unknown = (await call(c, "sayshape_docs", { topics: ["hologram"] })).content[0]!.text;
    expect(unknown).toMatch(/^NOT INCLUDED\n- There's no capability or element called "hologram"/);
    expect(unknown).toContain("HOW SAYSHAPE FITS TOGETHER");
    expect(unknown.length).toBeLessThan(8000);
  });

  it("still has the full guide when asked, and the other topics", async () => {
    const c = await connect();
    const full = (await call(c, "sayshape_docs", { topics: ["full"] })).content[0]!.text;
    expect(full).toContain("ELEMENTS AT A GLANCE");
    expect(full.length).toBeGreaterThan(50_000);
    const chat = (await call(c, "sayshape_docs", { topics: ["chat"] })).content[0]!.text;
    expect(chat).toContain("Keep it to one focused screen");
    expect((await call(c, "sayshape_docs", {})).content[0]!.text).toBe(adaptiveStart());
  });

  it("brings scenes, behavior and the button a Pause needs in one call when they're on", async () => {
    setScenes(true);
    setBehavior(true);
    const text = (await call(await connect(), "sayshape_docs", { topics: ["scenes", "behavior"] })).content[0]!.text;
    expect(text).toContain("People can drag it");
    expect(text).toContain("every 1s if={running && left > 0}");
    expect(text).toMatch(/^- button \["text"\] on=action/m);
    expect(text).toMatch(/^- circle .*drag=true\|false/m);
  });
});
