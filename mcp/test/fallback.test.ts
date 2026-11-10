import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cannotDrawViews, createServer, REPEAT_TEXT } from "../src/server";
import { McpResultStore } from "../src/mcp-results";
import { engineScriptUrl, fallbackPage, fenced, PAGE_DATASETS_TEXT, PAGE_ENGINE_VERSION, PAGE_REPEAT_TEXT, PAGE_TEXT, scriptJson, usesMap } from "../src/fallback";
import { lightTheme, darkTheme } from "../../src/theme";
import { UI_CLIENT } from "./clients";

const GOOD = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n';
/** Model-written text that would end the script and inject markup if it went in as it is. */
const HOSTILE = 'card\n  text "</script><script>alert(1)</script><!-- <SCRIPT>" style=title\n  text "\u2028line\u2029separators </ScRiPt >"\n';

async function connect(options?: typeof UI_CLIENT, now = () => 1_000) {
  const store = new McpResultStore();
  store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12 }] } }, { label: "sales" });
  const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store, now });
  const client = new Client({ name: "text-only", version: "1.0.0" }, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

type Result = { content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
const show = async (client: Client, args: Record<string, unknown>) => (await client.callTool({ name: "show_interface", arguments: args })) as unknown as Result;
const pageIn = (r: Result) => /(`{3,})html\n([\s\S]*?)\1/.exec(r.content[0]!.text)?.[2];

/**
 * Runs the page's inline script against a stand-in engine and returns what it
 * was asked to draw: proves the script is valid JavaScript and the spec
 * arrives exactly as written.
 */
function runPage(html: string, root: { theme?: string; dark?: boolean } = {}) {
  const scripts = [...html.matchAll(/<script(?: src="([^"]*)")?>([\s\S]*?)<\/script>/g)];
  const inline = scripts.filter((m) => !m[1]).map((m) => m[2]!);
  const drawn: { spec?: string; themes: string[]; components?: unknown[] } = { themes: [] };
  class SayShape {
    constructor(_canvas: unknown, opts: { components: unknown[]; theme: { name: string } }) {
      drawn.components = opts.components;
      drawn.themes.push(opts.theme.name);
    }
    setTheme(t: { name: string }) { drawn.themes.push(t.name); }
    setSpec(spec: string) { drawn.spec = spec; }
  }
  const style = new Map<string, string>();
  const element = { textContent: "", hidden: true };
  const window = {
    sayshape: { SayShape, coreComponents: ["core"], sceneComponents: ["scene"], lightTheme, darkTheme },
    sayshapeMap: { mapComponents: ["map"] },
    matchMedia: () => ({ matches: !!root.dark, addEventListener() {} }),
  };
  const document = {
    documentElement: { getAttribute: () => root.theme ?? null, style: { setProperty: (k: string, v: string) => style.set(k, v) } },
    getElementById: () => element,
  };
  for (const code of inline) runInNewContext(code, { window, document });
  return { inline, external: scripts.filter((m) => m[1]).map((m) => m[1]!), drawn, style };
}

describe("the page for chat apps that can't draw views", () => {
  it("goes in the text result when the client announced no MCP Apps support and the spec has nothing to fix", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: GOOD, title: "Hike" });
    const text = r.content[0]!.text;
    expect(text.startsWith(PAGE_TEXT)).toBe(true);
    expect(text).not.toMatch(/showing in the conversation/);
    // Host-neutral: no product or tool is named.
    expect(PAGE_TEXT).not.toMatch(/claude|codex|antigravity|chatgpt|artifact|vs code/i);
    const page = pageIn(r)!;
    expect(page).toBe(fallbackPage({ spec: GOOD, title: "Hike" }));
    expect(r.structuredContent).toMatchObject({ errors: 0, toFix: 0, repeat: false, page: true });
    // Small enough for a model to read before it publishes: a couple of kilobytes besides the spec.
    expect(page.length - GOOD.length).toBeLessThan(3_000);
  });

  it("loads the engine from jsDelivr at one exact version, and the map's script only for a map", () => {
    expect(PAGE_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const plain = runPage(fallbackPage({ spec: GOOD }));
    expect(plain.external).toEqual([`https://cdn.jsdelivr.net/npm/sayshape@${PAGE_ENGINE_VERSION}/dist/sayshape.global.js`]);
    expect(plain.drawn.components).toEqual(["core"]);
    const mapSpec = 'card\n  map fit=pins\n    pin "Tokyo" lat=35.7 lon=139.7\n';
    expect(usesMap(mapSpec)).toBe(true);
    expect(usesMap('card\n  text "map of the office"\n')).toBe(false);
    const withMap = runPage(fallbackPage({ spec: mapSpec, scenes: true }));
    expect(withMap.external).toEqual([engineScriptUrl("sayshape.global.js"), engineScriptUrl("sayshape-map.global.js")]);
    expect(withMap.drawn.components).toEqual(["core", "scene", "map"]);
  });

  it("parses, and hands the engine the spec exactly as written", () => {
    for (const spec of [GOOD, HOSTILE, 'text "Quotes \\" and \\\\ backslashes, émoji 🎉 and ${template}"']) {
      const { drawn, inline } = runPage(fallbackPage({ spec }));
      expect(inline).toHaveLength(1);
      expect(drawn.spec).toBe(spec);
    }
  });

  it("keeps a spec containing </script> or <!-- inert: it can't end the script or add markup", () => {
    const page = fallbackPage({ spec: HOSTILE, title: '</title><script>alert("t")</script>' });
    // The only script tags are the page's own two, and nothing opens a comment.
    expect(page.match(/<\/script/gi)).toHaveLength(2);
    expect(page.match(/<script/gi)).toHaveLength(2);
    expect(page).not.toContain("<!--");
    expect(page).toContain("&#60;/title&#62;&#60;script&#62;");
    expect(scriptJson("</script>")).toBe('"\\u003c/script>"');
    expect(runPage(page).drawn.spec).toBe(HOSTILE);
  });

  it("follows light and dark, data-theme first, with the engine theme's background", () => {
    const page = fallbackPage({ spec: GOOD });
    expect(page).toContain(`--bg: ${lightTheme.colors.surface}`);
    expect(page).toContain(`:root[data-theme="dark"] { color-scheme: dark; --bg: ${darkTheme.colors.surface}`);
    expect(page).toMatch(/@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\)/);
    expect(runPage(page).drawn.themes[0]).toBe("light");
    expect(runPage(page, { dark: true }).drawn.themes[0]).toBe("dark");
    expect(runPage(page, { dark: true, theme: "light" }).drawn.themes[0]).toBe("light");
    const dark = runPage(page, { theme: "dark" });
    expect(dark.drawn.themes[0]).toBe("dark");
    expect(dark.style.get("--bg")).toBe(darkTheme.colors.surface);
    // Phones: the canvas never gets wider than the page.
    expect(page).toMatch(/name="viewport" content="width=device-width/);
    expect(page).toMatch(/body \{ overflow-x: hidden;/);
  });

  it("puts the page in a fence a spec can't close", () => {
    const page = fallbackPage({ spec: 'text "```` four backticks"' });
    const block = fenced(page);
    expect(block.startsWith("`````html\n")).toBe(true);
    expect(pageIn({ content: [{ text: block }], structuredContent: {} })).toBe(page);
  });

  it("has no page when there are problems to fix, and says nothing is showing yet", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: 'card\n  txet "Typo"\n' });
    expect(pageIn(r)).toBeUndefined();
    expect(r.content[0]!.text).toMatch(/^1 problem leaves part of this interface wrong or missing, and this chat app can't draw interfaces, so nothing is showing yet/);
    expect(r.content[0]!.text).toMatch(/line 2/);
    expect(r.structuredContent).toMatchObject({ toFix: 1, page: false });
  });

  it("gives the page with ignored props, and lists them", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: 'card\n  text "Hi" colour=red\n' });
    expect(pageIn(r)).toBeDefined();
    expect(r.content[0]!.text).toMatch(/ignored these small things[\s\S]*colour/);
  });

  it("has no second page for a repeat, and points back at the first", async () => {
    const { client } = await connect();
    await show(client, { spec: GOOD });
    const r = await show(client, { spec: GOOD });
    expect(r.content[0]!.text).toBe(PAGE_REPEAT_TEXT);
    expect(r.content[0]!.text).not.toBe(REPEAT_TEXT);
    expect(r.structuredContent).toMatchObject({ repeat: true, page: false });
  });

  it("has no page, and no rows, for an interface that loads a dataset", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n', data: { sales: "m1" } });
    expect(r.content).toEqual([{ type: "text", text: PAGE_DATASETS_TEXT }]);
    expect(JSON.stringify(r)).not.toMatch(/West|12\b/);
    expect(r.structuredContent).toMatchObject({ page: false, datasets: { sales: { id: "m1", rows: 1 } } });
  });

  it("isn't given to clients that draw views, or whose capabilities the server never saw", async () => {
    const { client, server } = await connect(UI_CLIENT);
    expect(cannotDrawViews(server)).toBe(false);
    const r = await show(client, { spec: GOOD });
    expect(pageIn(r)).toBeUndefined();
    expect(r.structuredContent).not.toHaveProperty("page");
    // The stateless HTTP mode makes a server per request, which never sees initialize.
    expect(cannotDrawViews(createServer({ uiHtml: () => "" }))).toBe(false);
  });
});
