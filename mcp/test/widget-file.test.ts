import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createContext, runInContext } from "node:vm";
import { gunzipSync, gzipSync } from "node:zlib";
import { resolveObjectURL } from "node:buffer";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, setBehavior, setScenes } from "../src/server";
import { NOTHING_SENT, PAGE_DATASETS_TEXT, PAGE_TEXT } from "../src/fallback";
import { McpResultStore } from "../src/mcp-results";
import { NO_START, NO_UNPACK, pruneWidgets, WIDGET_FILE, WIDGET_KEEP, WIDGET_MAX_BYTES, widgetFileName, widgetFragment, writeWidget, type WidgetOptions } from "../src/widget-file";
import type { PackedEngine, PackedScript } from "../src/widget-engine";
import { resolveTheme } from "../../playground/appearance/presets";
import { UI_CLIENT } from "./clients";

const SPEC = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n';
const MAP = 'card\n  map fit=pins\n    pin "London" lat=51.5 lon=-0.12\n';
/** Model-written text that would end the script, open a comment or hide a template string if it went in as it is. */
const HOSTILE = 'card\n  text "</script><script>window.injected = 1</script><!-- <SCRIPT> `${1+1}` \\u2028\u2028 </ScRiPt >" style=title\n  text "localStorage and sessionStorage and indexedDB"\n';

const pack = (code: string): PackedScript => {
  const gz = gzipSync(code);
  return { base64: gz.toString("base64"), bytes: code.length, gzipBytes: gz.length, digest: String(code.length) + code.slice(0, 8) };
};

/**
 * A stand-in for the engine, so the loader can be run in Node without a canvas: it records what it was asked
 * to do on window, and keeps its instance as window.__ui.
 */
const STAND_IN: PackedEngine = {
  engine: pack(`(function () {
  var w = window;
  w.__themes = []; w.__notes = []; w.__order = [];
  function SayShape(canvas, opts) { w.__opts = opts; w.__ui = this; this.handlers = {}; w.__order.push("new"); }
  SayShape.prototype.on = function (ev, fn) { this.handlers[ev] = fn; };
  SayShape.prototype.setTheme = function (t) { w.__themes.push(t); };
  SayShape.prototype.setSpec = function (s) { w.__spec = s; w.__order.push("setSpec"); };
  SayShape.prototype.notify = function (t) { w.__notes.push(t); };
  w.sayshape = { SayShape: SayShape, coreComponents: ["core"], sceneComponents: ["scene"] };
})();`),
  map: pack('window.sayshapeMap = { mapComponents: ["map"] };'),
};

const base = (extra: Partial<WidgetOptions> = {}): WidgetOptions => ({ spec: SPEC, engine: STAND_IN, ...extra });

interface Fake {
  [k: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Runs the fragment's scripts in a context with a minimal document, as a browser would, and waits for the loader to finish. */
async function run(html: string, opts: { dark?: boolean; theme?: string | null; unpack?: boolean } = {}) {
  const els = new Map<string, Fake>();
  const el = (id: string): Fake => {
    let e = els.get(id);
    if (!e) els.set(id, (e = { id, style: {}, hidden: id.endsWith("-note"), textContent: "", children: [], appendChild(c: Fake) { onAppend(c); } }));
    return e;
  };
  const opened: unknown[][] = [];
  const failures: string[] = [];
  const onAppend = (c: Fake) => {
    // A blob: script: read its text and run it, then say it loaded.
    const blob = resolveObjectURL(c.src);
    if (!blob) { c.onerror?.(); return; }
    void blob.text().then((code) => {
      try { runInContext(code, ctx); } catch (e) { failures.push(String(e)); c.onerror?.(); return; }
      c.onload?.();
    });
  };
  const document = {
    getElementById: el,
    createElement: () => ({}),
    documentElement: { getAttribute: () => opts.theme ?? null, style: {} },
  };
  const g: Fake = {
    document, atob, Blob, Response, URL, console,
    ...(opts.unpack === false ? {} : { DecompressionStream }),
    matchMedia: () => ({ matches: !!opts.dark, addEventListener() {} }),
    open: (...a: unknown[]) => { opened.push(a); return null; },
  };
  const ctx = createContext(g);
  g.window = ctx;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  for (const code of scripts) {
    try { runInContext(code, ctx); } catch (e) { failures.push(String(e)); }
  }
  for (let i = 0; i < 200 && !(g.__spec !== undefined || els.get(`${html.match(/id="(sw-[0-9a-f]+)"/)![1]}-note`)?.hidden === false); i++) await new Promise((r) => setTimeout(r, 5));
  const id = html.match(/id="(sw-[0-9a-f]+)"/)![1]!;
  return { g, els, el, id, opened, failures, note: el(`${id}-note`), canvas: el(`${id}-view`), box: el(id), ui: g.__ui as Fake | undefined };
}

describe("the widget fragment", () => {
  it("is one wrapping div: no document, no external address, no storage names, no loose elements", () => {
    const html = widgetFragment(base());
    expect(html).not.toMatch(/<!doctype|<html|<head|<body|<meta|<title/i);
    expect(html.startsWith("<div ")).toBe(true);
    expect(html.trimEnd().endsWith("</div>")).toBe(true);
    // The only wrapper is the one div; the rest is a canvas, a note and scripts.
    expect([...html.matchAll(/<(\w+)/g)].map((m) => m[1])).toEqual(["div", "canvas", "p", "script"]);
    expect(html).toMatch(/box-sizing:border-box;width:100%;max-width:\d+px/);
    expect(html).not.toMatch(/https?:\/\/|\/\/cdn|<script src|<link|<img|<iframe|<style/i);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|import\(|WebSocket|sendBeacon/);
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|openDatabase|document\.cookie/i);
    // Text in it has a font of its own: the frame's default is Times.
    expect(html).toMatch(/font:15px\/1\.5 system-ui/);
  });

  it("keeps ids unique within a file and between files", () => {
    const html = widgetFragment(base());
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    const other = [...widgetFragment(base({ spec: SPEC + "  text \"more\"\n" })).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
    expect(other.some((id) => ids.includes(id))).toBe(false);
    // Built twice from the same inputs, it's the same file.
    expect(widgetFragment(base())).toBe(html);
  });

  it("carries a spec with </script>, comments, backticks and line separators inertly, and shows storage names without writing them", async () => {
    const html = widgetFragment(base({ spec: HOSTILE }));
    // One script, ending where the loader ends: nothing in the spec closed it or opened another.
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html).not.toMatch(/<!--/);
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(html).not.toMatch(/[\u2028\u2029]/);
    const r = await run(html);
    expect(r.g.__spec).toBe(HOSTILE);
    expect("injected" in r.g).toBe(false);
  });

  it("is under 1 MB with the real engine, with and without the map", () => {
    const sizes = { plain: Buffer.byteLength(widgetFragment({ spec: SPEC, engine: real })), map: Buffer.byteLength(widgetFragment({ spec: MAP, engine: real })) };
    console.log(`widget file sizes: plain ${sizes.plain} bytes, with the map ${sizes.map} bytes`);
    expect(sizes.plain).toBeLessThan(WIDGET_MAX_BYTES);
    expect(sizes.map).toBeLessThan(WIDGET_MAX_BYTES);
    expect(sizes.map).toBeGreaterThan(sizes.plain);
  });

  it("includes the map's script only when the spec has a map", async () => {
    const plain = widgetFragment(base());
    const withMap = widgetFragment(base({ spec: MAP }));
    expect(withMap.length - plain.length).toBeGreaterThan(STAND_IN.map.base64.length - 200);
    expect(plain).not.toContain(STAND_IN.map.base64);
    expect(withMap).toContain(STAND_IN.map.base64);
    expect((await run(withMap)).g.__opts.components).toEqual(["core", "map"]);
    expect((await run(plain)).g.__opts.components).toEqual(["core"]);
  });

  it("starts the engine from a blob: script with the spec, in the order the page does", async () => {
    const r = await run(widgetFragment(base()));
    expect(r.failures).toEqual([]);
    expect(r.g.__spec).toBe(SPEC);
    expect(r.g.__order).toEqual(["new", "setSpec"]);
    expect(r.note.hidden).toBe(true);
    expect(r.g.__opts.imageHosts).toEqual([]);
    expect("behavior" in r.g.__opts).toBe(false);
  });

  it("carries the server's settings: theme, accent, image hosts, scenes and behavior", async () => {
    const html = widgetFragment(base({ theme: "purple", colors: ["#e4572e"], imageHosts: ["cdn.example.com", "*.img.example.com"], scenes: true, behavior: true, logo: "https://cdn.example.com/logo.png" }));
    const r = await run(html);
    expect(r.g.__opts.components).toEqual(["core", "scene"]);
    expect(r.g.__opts.behavior).toBe(true);
    expect(r.g.__opts.imageHosts).toEqual(["cdn.example.com", "*.img.example.com"]);
    const light = resolveTheme("purple", "light", ["#e4572e"]).theme;
    const dark = resolveTheme("purple", "dark", ["#e4572e"]).theme;
    expect(r.g.__opts.theme.colors.accent).toBe(light.colors.accent);
    expect(r.g.__opts.theme.deck.logo).toBe("https://cdn.example.com/logo.png");
    // The dark one differs from the light one, as its own resolution.
    const darkRun = await run(html, { dark: true });
    expect(darkRun.g.__opts.theme.colors.accent).toBe(dark.colors.accent);
    expect(darkRun.g.__opts.theme.colors.accent).not.toBe(light.colors.accent);
    // Scenes and behavior are off unless asked for; slides are in the core list.
    expect((await run(widgetFragment(base()))).g.__opts.components).toEqual(["core"]);
  });

  it("carries a list of colors: the accent and all six series, in light and dark", async () => {
    const colors = ["#e4572e", "#2e86ab", "#f2c14e"];
    const html = widgetFragment(base({ colors }));
    for (const dark of [false, true]) {
      const run1 = await run(html, { dark });
      const want = resolveTheme("teal", dark ? "dark" : "light", colors).theme.colors;
      const got = run1.g.__opts.theme.colors;
      for (const k of ["accent", "series1", "series2", "series3", "series4", "series5", "series6"] as const) expect(got[k], `${dark ? "dark" : "light"} ${k}`).toBe(want[k]);
    }
  });

  it("follows the system's light or dark, and data-theme on the root over it, and changes to either", async () => {
    const surface = (dark: boolean) => resolveTheme("teal", dark ? "dark" : "light", null).theme.colors.surface;
    expect((await run(widgetFragment(base()))).g.__opts.theme.colors.surface).toBe(surface(false));
    const dark = await run(widgetFragment(base()), { dark: true });
    expect(dark.g.__opts.theme.colors.surface).toBe(surface(true));
    expect(dark.box.style.background).toBe(surface(true));
    expect((await run(widgetFragment(base()), { dark: true, theme: "light" })).g.__opts.theme.colors.surface).toBe(surface(false));
    expect((await run(widgetFragment(base()), { theme: "dark" })).g.__opts.theme.colors.surface).toBe(surface(true));
  });

  it("opens a pressed link in a new tab (https only) and says there's no chat to send other actions to", async () => {
    const r = await run(widgetFragment(base()));
    r.ui!.handlers.action({ name: "link", value: "https://example.com/notes" });
    r.ui!.handlers.action({ name: "link", value: "javascript:alert(1)" });
    r.ui!.handlers.action({ name: "link", value: "http://example.com" });
    expect(r.opened).toEqual([["https://example.com/notes", "_blank", "noopener,noreferrer"]]);
    r.ui!.handlers.action({ name: "submit", value: 1 });
    expect(r.g.__notes).toEqual([NOTHING_SENT]);
  });

  it("puts a short plain note in place of the canvas when it can't unpack, or the engine doesn't run", async () => {
    const r = await run(widgetFragment(base()), { unpack: false });
    expect(r.note.hidden).toBe(false);
    expect(r.note.textContent).toBe(NO_UNPACK);
    expect(r.canvas.style.display).toBe("none");
    // A pack that isn't gzip at all.
    const bad = await run(widgetFragment(base({ engine: { ...STAND_IN, engine: { ...STAND_IN.engine, base64: Buffer.from("not gzip").toString("base64") } } })));
    expect(bad.note.hidden).toBe(false);
    expect(bad.note.textContent).toBe(NO_START);
    expect(bad.canvas.style.display).toBe("none");
    // An engine that runs but defines nothing.
    const empty = await run(widgetFragment(base({ engine: { ...STAND_IN, engine: pack("var nothing = 1;") } })));
    expect(empty.note.textContent).toBe(NO_START);
  });
});

describe("the host hook", () => {
  const HOST = `function (ui, S, root) {
    window.__hostArgs = [typeof ui.on, typeof S.SayShape, root.id, window.__spec];
    window.__emitted = [];
    return { emit: function (a) { window.__emitted.push(a); } };
  }`;

  it("is called once, after the first setSpec, with the instance, the engine's global and the wrapping div", async () => {
    const html = widgetFragment(base({ host: HOST }));
    const r = await run(html);
    expect(r.g.__hostArgs).toEqual(["function", "function", r.id, SPEC]);
    expect(r.g.__order).toEqual(["new", "setSpec"]);
    expect(html.match(/<script/g)).toHaveLength(2);
  });

  it("gets every action except a link through emit(action), and a link still opens", async () => {
    const r = await run(widgetFragment(base({ host: HOST })));
    r.ui!.handlers.action({ name: "submit_order", value: 3 });
    r.ui!.handlers.action({ name: "link", value: "https://example.com/x" });
    expect(r.g.__emitted).toEqual([{ name: "submit_order", value: 3 }]);
    expect(r.opened).toHaveLength(1);
    expect(r.g.__notes).toEqual([]);
  });

  it("may return nothing, or something with no emit: other actions get the usual notice", async () => {
    for (const returned of ["", "return {};", "return 5;"]) {
      const r = await run(widgetFragment(base({ host: `function (ui) { ${returned} }` })));
      r.ui!.handlers.action({ name: "x" });
      expect(r.g.__notes).toEqual([NOTHING_SENT]);
    }
  });

  it("never stops the interface drawing when it throws, or doesn't even parse, or its emit throws", async () => {
    const throwing = await run(widgetFragment(base({ host: "function () { throw new Error('boom'); }" })));
    expect(throwing.g.__spec).toBe(SPEC);
    expect(throwing.note.hidden).toBe(true);
    throwing.ui!.handlers.action({ name: "x" });
    expect(throwing.g.__notes).toEqual([NOTHING_SENT]);

    const broken = await run(widgetFragment(base({ host: "function (ui, S {" })));
    expect(broken.g.__spec).toBe(SPEC);
    expect(broken.note.hidden).toBe(true);
    broken.ui!.handlers.action({ name: "x" });
    expect(broken.g.__notes).toEqual([NOTHING_SENT]);

    const emitThrows = await run(widgetFragment(base({ host: "function () { return { emit: function () { throw new Error('no'); } }; }" })));
    emitThrows.ui!.handlers.action({ name: "x" });
    expect(emitThrows.g.__notes).toEqual([NOTHING_SENT]);
  });

  it("keeps a host's own </script> and <!-- from ending the script", async () => {
    const html = widgetFragment(base({ host: "function () { window.__s = '</script><!--'; }" }));
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html.match(/<\/script/g)).toHaveLength(2);
    expect((await run(html)).g.__s).toBe("</script><!--");
  });

  it("changes the file: the same spec with another host is another file", () => {
    expect(widgetFileName(base({ host: HOST }))).not.toBe(widgetFileName(base()));
  });
});

describe("the files", () => {
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sayshape-widgets-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  afterEach(async () => { for (const f of await readdir(dir)) await rm(join(dir, f), { recursive: true, force: true }); });

  it("name one interface one file, from the spec and every setting that changes it", () => {
    const name = widgetFileName(base());
    expect(name).toMatch(WIDGET_FILE);
    expect(widgetFileName(base())).toBe(name);
    // Blank-line noise isn't ignored here (the file would differ), but any real difference is a new name.
    const names = new Set([
      name,
      widgetFileName(base({ spec: SPEC + "\n  text \"x\"" })),
      widgetFileName(base({ theme: "blue" })),
      widgetFileName(base({ colors: ["#e4572e"] })),
      widgetFileName(base({ imageHosts: ["cdn.example.com"] })),
      widgetFileName(base({ scenes: true })),
      widgetFileName(base({ behavior: true })),
      widgetFileName(base({ engine: { ...STAND_IN, engine: pack("window.sayshape = {};") } })),
    ]);
    expect(names.size).toBe(8);
  });

  it("write the fragment, once: the same interface reuses its file", async () => {
    const first = await writeWidget(dir, base());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(isAbsolute(first.path)).toBe(true);
    expect(await readFile(first.path, "utf8")).toBe(widgetFragment(base()));
    const second = await writeWidget(dir, base());
    expect(second.ok && second.path === first.path && second.reused).toBe(true);
    expect(await readdir(dir)).toEqual([first.path.split("/").pop()]);
  });

  it("make the folder if it isn't there", async () => {
    const nested = join(dir, "a", "b");
    const r = await writeWidget(nested, base());
    expect(r.ok && existsSync(r.path)).toBe(true);
  });

  it("keep the newest 50 and delete older ones, touching only the server's own names", async () => {
    const mine: string[] = [];
    for (let i = 0; i < 55; i++) {
      const name = `sayshape-${i.toString(16).padStart(16, "0")}.html`;
      mine.push(name);
      await writeFile(join(dir, name), "old");
      // File 0 is the oldest.
      const at = new Date(Date.now() - (60 - i) * 60_000);
      await utimes(join(dir, name), at, at);
    }
    const others = ["notes.txt", "sayshape-xyz.html", "sayshape-0000000000000001.html.bak", "Sayshape-00000000000000aa.html", "sayshape-000000000000000g.html", "deck.html"];
    for (const f of others) { await writeFile(join(dir, f), "mine"); await utimes(join(dir, f), new Date(2000, 0, 1), new Date(2000, 0, 1)); }
    await mkdir(join(dir, "sayshape-00000000000000ff.html"));
    const r = await writeWidget(dir, base());
    expect(r.ok).toBe(true);
    const left = await readdir(dir);
    const ours = left.filter((f) => WIDGET_FILE.test(f) && !f.endsWith("ff.html"));
    expect(ours).toHaveLength(WIDGET_KEEP);
    // The new one and the 49 newest old ones stay; the 6 oldest go.
    expect(ours).toContain(r.ok ? r.path.split("/").pop() : "");
    for (const gone of mine.slice(0, 6)) expect(left).not.toContain(gone);
    for (const kept of mine.slice(6)) expect(left).toContain(kept);
    for (const f of others) expect(left).toContain(f);
    expect(left).toContain("sayshape-00000000000000ff.html");
  });

  it("can prune on their own, never removing the current file", async () => {
    for (let i = 0; i < 5; i++) await writeFile(join(dir, `sayshape-${"0".repeat(15)}${i}.html`), "x");
    const removed = await pruneWidgets(dir, 2, `sayshape-${"0".repeat(15)}0.html`);
    expect(removed).toHaveLength(3);
    expect(await readdir(dir)).toContain(`sayshape-${"0".repeat(15)}0.html`);
    expect(await readdir(dir)).toHaveLength(2);
  });

  it("write nothing, and say why, when the file would pass 1 MB", async () => {
    const big: PackedEngine = { ...STAND_IN, map: { ...STAND_IN.map, base64: "A".repeat(WIDGET_MAX_BYTES) } };
    const r = await writeWidget(dir, { spec: MAP, engine: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/1 MB.*map/);
    expect(await readdir(dir)).toEqual([]);
    // The same engine without a map in the spec is fine.
    expect((await writeWidget(dir, { spec: SPEC, engine: big })).ok).toBe(true);
  });

  it("say why when the folder can't be written", async () => {
    const file = join(dir, "a-file");
    await writeFile(file, "x");
    const r = await writeWidget(join(file, "inside"), base());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/couldn't be written/);
  });
});

// The server: a client that announced no MCP Apps, with --widget-dir.
describe("show_interface with --widget-dir", () => {
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sayshape-widgets-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  afterEach(() => { setScenes(false); setBehavior(false); });

  type Result = { content: Array<{ text: string }>; structuredContent?: unknown };
  async function connect(client: ConstructorParameters<typeof Client>[1], withDir = true, extra: Record<string, unknown> = {}) {
    const store = new McpResultStore();
    store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12 }] } }, { label: "sales" });
    const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store, widgetEngine: async () => STAND_IN, ...(withDir ? { widgetDir: dir } : {}), ...extra });
    const c = new Client({ name: "text-only", version: "1.0.0" }, client);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), c.connect(b)]);
    return c;
  }
  const show = async (c: Client, args: Record<string, unknown>) => (await c.callTool({ name: "show_interface", arguments: args })) as unknown as Result;

  it("writes one file and returns its path with the instruction, and no HTML", async () => {
    const c = await connect(undefined);
    const r = await show(c, { spec: SPEC, title: "Hike" });
    const text = r.content[0]!.text;
    const path = /^(\/\S+\.html)$/m.exec(text)?.[1];
    expect(path).toBeTruthy();
    expect(isAbsolute(path!)).toBe(true);
    expect(await readFile(path!, "utf8")).toBe(widgetFragment({ spec: SPEC, engine: STAND_IN }));
    expect(text).toMatch(/Create the widget from that file exactly as it is/);
    expect(text).toMatch(/Don't read it and don't edit it/);
    expect(text).not.toMatch(/<\w|```|PAGE|jsdelivr/i);
    expect(text).not.toContain(PAGE_TEXT);
    expect(text.length).toBeLessThan(800);
    expect(r).not.toHaveProperty("structuredContent");
    expect(text).not.toContain(STAND_IN.engine.base64);
  });

  it("reports problems to fix as today, with no file", async () => {
    const dirBefore = (await readdir(dir)).length;
    const c = await connect(undefined);
    const r = await show(c, { spec: 'card\n  text "x" colour=red\n  chart kind=bar\n  badge "ok"\n  bogus "x"\n' });
    expect(r.content[0]!.text).toMatch(/problems? leaves? part of this interface wrong or missing[\s\S]*file to make a widget from/);
    expect(r.content[0]!.text).not.toMatch(/\.html/);
    expect((await readdir(dir)).length).toBe(dirBefore);
  });

  it("refuses datasets with today's message, and emit: as today", async () => {
    const c = await connect(undefined);
    expect((await show(c, { spec: "table items=sales\n  table-column field=team", data: { sales: "m1" } })).content[0]!.text).toBe(PAGE_DATASETS_TEXT);
    const emit = await show(c, { spec: 'card\n  button "Send" on=emit:sent' });
    expect(emit.content[0]!.text).toMatch(/line 2 \(error\): emit: can't reach you/);
    expect(emit.content[0]!.text).not.toMatch(/\.html/);
    const tools = (await c.listTools()).tools;
    expect(tools.find((t) => t.name === "show_interface")!.description).toMatch(/emit: can't reach you: don't use it/);
  });

  it("answers the same interface sent again without a second file", async () => {
    const c = await connect(undefined, true, { now: () => 5 });
    const spec = SPEC + "  text \"twice\"\n";
    const first = await show(c, { spec });
    const again = await show(c, { spec });
    expect(first.content[0]!.text).toMatch(/\.html/);
    expect(again.content[0]!.text).toMatch(/already named the file/);
    expect(again.content[0]!.text).not.toMatch(/\.html/);
  });

  it("says why when no file could be made, and a second call isn't a repeat", async () => {
    const huge: PackedEngine = { ...STAND_IN, engine: { ...STAND_IN.engine, base64: "A".repeat(WIDGET_MAX_BYTES) } };
    const c = await connect(undefined, true, { widgetEngine: async () => huge, now: () => 7 });
    const spec = SPEC + "  text \"huge\"\n";
    const first = await show(c, { spec });
    expect(first.content[0]!.text).toMatch(/no file could be made[\s\S]*under 1 MB/);
    expect((await show(c, { spec })).content[0]!.text).toMatch(/no file could be made/);
  });

  it("describes the file, not a page, in a text-only client's tool description", async () => {
    const c = await connect(undefined);
    const description = (await c.listTools()).tools.find((t) => t.name === "show_interface")!.description!;
    expect(description).toMatch(/path of a file that draws it/);
    expect(description).not.toMatch(/small web page/);
  });

  it("changes nothing for clients that draw views, and nothing without the flag", async () => {
    const withDir = await show(await connect(UI_CLIENT), { spec: SPEC });
    const without = await show(await connect(UI_CLIENT, false), { spec: SPEC });
    expect(withDir).toEqual(without);
    expect(withDir.structuredContent).toBeTruthy();
    const page = await show(await connect(undefined, false), { spec: SPEC + "  text \"cdn\"\n" });
    expect(page.content[0]!.text.startsWith(PAGE_TEXT)).toBe(true);
    expect(page.content[0]!.text).toMatch(/cdn\.jsdelivr\.net/);
  });

  it("gives these clients behavior and decks, which the CDN page can't draw, and passes the settings through", async () => {
    setBehavior(true);
    setScenes(true);
    const rule = 'state n=0 running=true\ncard\n  every 1s if={running} do=inc:n\n  stat label="n" value={n}\n  button "Pause" on=toggle:running\n';
    const deck = 'state page=0\ndeck bind=page\n  slide "One" layout=title\n    text "Hello"\n';
    const c = await connect(undefined, true, { view: { themePicker: false, theme: "blue", colors: ["#e4572e"], saveImage: true, copyText: true, logo: "https://cdn.example.com/l.png", imageHosts: ["cdn.example.com"] } });
    const ruled = await show(c, { spec: rule });
    const file = async (r: Result) => readFile(/^(\/\S+\.html)$/m.exec(r.content[0]!.text)![1]!, "utf8");
    expect(ruled.content[0]!.text).toMatch(/Create the widget from that file/);
    const html = await file(ruled);
    expect(html).toContain("behavior: true");
    expect(html).toContain("S.sceneComponents");
    expect(html).toContain("cdn.example.com");
    // A deck is fine here: the file carries this server's own engine, which has the slide elements.
    const deckFile = await file(await show(c, { spec: deck }));
    expect(deckFile).toContain("S.coreComponents");
    expect(deckFile).toContain("https://cdn.example.com/l.png");
    // The CDN page (no --widget-dir) still refuses both, as before.
    const cdn = await connect(undefined, false);
    expect((await show(cdn, { spec: rule })).content[0]!.text).toMatch(/Unknown element "every"/);
    expect((await show(cdn, { spec: deck })).content[0]!.text).toMatch(/can't show slide decks yet/);
    // The quick start and docs for these clients include behavior too.
    expect((await c.listTools()).tools.find((t) => t.name === "show_interface")!.description).toMatch(/every/);
    expect((await cdn.listTools()).tools.find((t) => t.name === "show_interface")!.description).not.toMatch(/\bevery 1s\b/);
  });
});

// The real engine, built the way `npm run build` builds it (scripts/pack-widget-engine.mjs).
let real: PackedEngine;
let built = "";
beforeAll(async () => {
  built = await mkdtemp(join(tmpdir(), "sayshape-engine-"));
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/pack-widget-engine.mjs", import.meta.url)), built], { stdio: "pipe" });
  real = JSON.parse(await readFile(join(built, "widget-engine.json"), "utf8")) as PackedEngine;
}, 180_000);
afterAll(async () => { if (built) await rm(built, { recursive: true, force: true }); });

describe("the real packed engine", () => {
  it("unpacks to the engine and the map, with no browser storage names and nothing that runs strings as code", () => {
    for (const script of [real.engine, real.map]) {
      const code = gunzipSync(Buffer.from(script.base64, "base64")).toString("utf8");
      expect(Buffer.byteLength(code)).toBe(script.bytes);
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|openDatabase|document\.cookie/);
      expect(code).not.toMatch(/\beval\(|new Function/);
    }
    const engine = gunzipSync(Buffer.from(real.engine.base64, "base64")).toString("utf8");
    expect(engine).toMatch(/sceneComponents/);
  });

  it("defines the globals the loader uses, when run as a plain script", () => {
    const ctx = createContext({});
    for (const script of [real.engine, real.map]) runInContext(gunzipSync(Buffer.from(script.base64, "base64")).toString("utf8"), ctx);
    const names = (expr: string) => runInContext(`${expr}.map(function (c) { return c.type; })`, ctx) as string[];
    expect(runInContext("typeof sayshape.SayShape", ctx)).toBe("function");
    expect(names("sayshape.sceneComponents")).toContain("scene");
    expect(names("sayshape.coreComponents")).toContain("card");
    // deck and slide come with the core list: no flag, no separate list.
    expect(names("sayshape.coreComponents")).toEqual(expect.arrayContaining(["deck", "slide"]));
    expect(names("sayshapeMap.mapComponents")).toContain("map");
    expect(runInContext("typeof sayshape.lightTheme.colors.surface", ctx)).toBe("string");
  });
});
