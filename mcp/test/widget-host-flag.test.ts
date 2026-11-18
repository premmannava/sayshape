import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, NO_EMIT } from "../src/server";
import { PRESSES_SAVED, PRESSES_SAVED_RESULT } from "../src/widget-file";
import { WIDGET_HOST_NAMES, widgetHostRefusal } from "../src/widget-hosts";
import type { PackedEngine, PackedScript } from "../src/widget-engine";
import { UI_CLIENT } from "./clients";

// --widget-host: an adapter in the widget file, and emit: allowed because presses are saved for the next turn.

const pack = (code: string): PackedScript => {
  const gz = gzipSync(code);
  return { base64: gz.toString("base64"), bytes: code.length, gzipBytes: gz.length, digest: String(code.length) };
};
const ENGINE: PackedEngine = { engine: pack("window.sayshape = {};"), map: pack("window.sayshapeMap = {};") };

const PLAIN = 'state days=2\ncard\n  text "Hike" style=title\n  button "Add day" on=inc:days\n';
const EMITS = 'card\n  text "Pick" style=title\n  button "Order" on=emit:submit_order\n  button "Both" on=set:sel:1;emit:pick:1\n';

describe("--widget-host validation", () => {
  it("accepts a listed host with --widget-dir", () => {
    expect(WIDGET_HOST_NAMES).toContain("muse");
    expect(widgetHostRefusal("muse", true)).toBeNull();
  });

  it("refuses an unknown host and lists the valid ones", () => {
    const message = widgetHostRefusal("slack", true)!;
    expect(message).toMatch(/doesn't know "slack"/);
    for (const name of WIDGET_HOST_NAMES) expect(message).toContain(name);
    expect(widgetHostRefusal("toString", true)).toMatch(/doesn't know "toString"/);
  });

  it("refuses a missing name, and a host without --widget-dir", () => {
    expect(widgetHostRefusal(undefined, true)).toMatch(/needs the name of a chat app.*muse/);
    expect(widgetHostRefusal("--theme", true)).toMatch(/needs the name of a chat app/);
    expect(widgetHostRefusal("muse", false)).toMatch(/only applies with --widget-dir/);
  });
});

describe("show_interface with --widget-host", () => {
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sayshape-host-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  type Result = { content: Array<{ text: string }>; structuredContent?: unknown };
  async function connect(client: ConstructorParameters<typeof Client>[1], extra: Record<string, unknown> = {}) {
    const server = createServer({ uiHtml: () => "<!doctype html>", widgetEngine: async () => ENGINE, ...extra });
    const c = new Client({ name: "text-only", version: "1.0.0" }, client);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), c.connect(b)]);
    return c;
  }
  const show = async (c: Client, spec: string) => (await c.callTool({ name: "show_interface", arguments: { spec } })) as unknown as Result;
  const description = async (c: Client) => (await c.listTools()).tools.find((t) => t.name === "show_interface")!.description!;
  const pathIn = (r: Result) => /^(\/\S+\.html)$/m.exec(r.content[0]!.text)?.[1];

  it("gives a spec that uses emit: a file with the adapter in it, and says presses are saved", async () => {
    const c = await connect(undefined, { widgetDir: dir, widgetHost: { name: "muse" } });
    const r = await show(c, EMITS);
    const path = pathIn(r);
    expect(path).toBeTruthy();
    const text = r.content[0]!.text;
    expect(text).toContain(PRESSES_SAVED_RESULT);
    expect(text).not.toMatch(/emit: can't reach you/);
    const file = await readFile(path!, "utf8");
    expect(file).toContain("sayshapeHost");
    expect(file).toContain("hatchWidget");
    expect(file).toContain('"ignoreAppColors":false');
    expect(file).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
  });

  it("leaves the extra sentence out when the spec has no emit:", async () => {
    const c = await connect(undefined, { widgetDir: dir, widgetHost: { name: "muse" } });
    const r = await show(c, PLAIN);
    expect(pathIn(r)).toBeTruthy();
    expect(r.content[0]!.text).not.toContain(PRESSES_SAVED_RESULT);
  });

  it("tells the quick start, the tool description and the docs that presses are saved, not that emit: is off", async () => {
    const c = await connect(undefined, { widgetDir: dir, widgetHost: { name: "muse" } });
    const d = await description(c);
    expect(d).toContain(PRESSES_SAVED);
    expect(d).not.toContain(NO_EMIT);
    const docs = (await c.callTool({ name: "sayshape_docs", arguments: {} })) as unknown as Result;
    expect(docs.content[0]!.text).toContain(PRESSES_SAVED);
    expect(PRESSES_SAVED).toMatch(/next message, read the widget's state/);
  });

  it("bakes in whether --theme or --accent was given", async () => {
    const c = await connect(undefined, { widgetDir: dir, widgetHost: { name: "muse", ignoreAppColors: true } });
    const path = pathIn(await show(c, EMITS + '  text "own colors"\n'));
    expect(await readFile(path!, "utf8")).toContain('"ignoreAppColors":true');
  });

  it("still refuses datasets, and still fixes other problems first", async () => {
    const c = await connect(undefined, { widgetDir: dir, widgetHost: { name: "muse" } });
    const r = await show(c, 'card\n  chart kind=bar\n  button "Order" on=emit:x\n');
    expect(r.content[0]!.text).toMatch(/problem/);
    expect(r.content[0]!.text).not.toMatch(/emit: can't reach you/);
    expect(pathIn(r)).toBeUndefined();
  });

  it("without the flag, emit: is handled as before", async () => {
    const c = await connect(undefined, { widgetDir: dir });
    const r = await show(c, EMITS);
    expect(r.content[0]!.text).toMatch(/line 3 \(error\): emit: can't reach you/);
    expect(r.content[0]!.text).toMatch(/line 4 \(error\): emit: can't reach you/);
    expect(pathIn(r)).toBeUndefined();
    const d = await description(c);
    expect(d).toContain(NO_EMIT);
    expect(d).not.toContain(PRESSES_SAVED);
    const plain = await show(c, PLAIN);
    expect(pathIn(plain)).toBeTruthy();
    expect(await readFile(pathIn(plain)!, "utf8")).not.toContain("sayshapeHost");
  });

  it("does nothing without --widget-dir (the page for text-only clients is unchanged)", async () => {
    const c = await connect(undefined, { widgetHost: { name: "muse" } });
    const r = await show(c, EMITS);
    expect(r.content[0]!.text).toMatch(/emit: can't reach you/);
    expect(await description(c)).toContain(NO_EMIT);
  });

  it("changes nothing for clients that draw views", async () => {
    const withHost = await connect(UI_CLIENT, { widgetDir: dir, widgetHost: { name: "muse" } });
    const without = await connect(UI_CLIENT, { widgetDir: dir });
    expect(await show(withHost, EMITS)).toEqual(await show(without, EMITS));
    expect(await description(withHost)).toBe(await description(without));
    expect(await description(withHost)).not.toContain(PRESSES_SAVED);
  });
});
