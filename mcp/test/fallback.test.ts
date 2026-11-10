import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cannotDrawViews, createServer, NO_EMIT, quickStart, REPEAT_TEXT } from "../src/server";
import { McpResultStore } from "../src/mcp-results";
import { engineScriptUrl, fallbackPage, fenced, NOTHING_SENT, PAGE_DATASETS_TEXT, PAGE_ENGINE_VERSION, PAGE_REPEAT_TEXT, PAGE_TEXT, scriptJson, usesMap } from "../src/fallback";
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

type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
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
  const drawn: { spec?: string; themes: string[]; components?: unknown[]; notes: string[]; opened: unknown[][]; act?: (a: { name: string; value?: unknown }) => void } = { themes: [], notes: [], opened: [] };
  class SayShape {
    on(event: string, fn: (a: { name: string; value?: unknown }) => void) { if (event === "action") drawn.act = fn; }
    notify(text: string) { drawn.notes.push(text); }
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
    open: (...args: unknown[]) => { drawn.opened.push(args); return null; },
  };
  const document = {
    documentElement: { getAttribute: () => root.theme ?? null, style: { setProperty: (k: string, v: string) => style.set(k, v) } },
    getElementById: () => element,
  };
  for (const code of inline) runInNewContext(code, { window, document, URL });
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
    // Text alone: a client that hands its model the structured part in place of the text would lose the page.
    expect(r).not.toHaveProperty("structuredContent");
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
    expect(pageIn({ content: [{ text: block }] })).toBe(page);
  });

  it("has no page when there are problems to fix, and says nothing is showing yet", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: 'card\n  txet "Typo"\n' });
    expect(pageIn(r)).toBeUndefined();
    expect(r.content[0]!.text).toMatch(/^1 problem leaves part of this interface wrong or missing, and this chat app can't draw interfaces, so nothing is showing yet/);
    expect(r.content[0]!.text).toMatch(/line 2/);
    expect(r).not.toHaveProperty("structuredContent");
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
    expect(r).not.toHaveProperty("structuredContent");
  });

  it("has no page, and no rows, for an interface that loads a dataset", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n', data: { sales: "m1" } });
    expect(r.content).toEqual([{ type: "text", text: PAGE_DATASETS_TEXT }]);
    expect(JSON.stringify(r)).not.toMatch(/West|12\b/);
    expect(r).not.toHaveProperty("structuredContent");
  });

  it("isn't given to clients that draw views, or whose capabilities the server never saw", async () => {
    const { client, server } = await connect(UI_CLIENT);
    expect(cannotDrawViews(server)).toBe(false);
    const r = await show(client, { spec: GOOD });
    expect(pageIn(r)).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ toFix: 0, repeat: false });
    expect(r.structuredContent).not.toHaveProperty("page");
    // The stateless HTTP mode makes a server per request, which never sees initialize.
    expect(cannotDrawViews(createServer({ uiHtml: () => "" }))).toBe(false);
  });

  it("opens a pressed https link in a new tab, ignores any other address, and says when an emit: can't be sent", () => {
    const { drawn } = runPage(fallbackPage({ spec: 'text "Read [the guide](https://example.com/guide)" rich=true' }));
    drawn.act!({ name: "link", value: "https://example.com/guide" });
    expect(drawn.opened).toEqual([["https://example.com/guide", "_blank", "noopener,noreferrer"]]);
    for (const value of ["javascript:alert(1)", "http://example.com", "data:text/html,hi", "not a url", 42]) drawn.act!({ name: "link", value });
    expect(drawn.opened).toHaveLength(1);
    expect(drawn.notes).toEqual([]);
    drawn.act!({ name: "plan_trip", value: 3 });
    expect(drawn.notes).toEqual([NOTHING_SENT]);
  });
});

describe("emit: in chat apps that can't draw views", () => {
  const EMIT = 'state n=1\ncard\n  text "Pick one" style=title\n  button "Plan this trip" on=set:n:2;emit:plan_trip:{n}\n  button "Done" on=emit:done\n  button "More" on=inc:n\n';

  it("isn't in the quick start they're given; ask the person to reply in the chat instead", async () => {
    const { client } = await connect();
    const show = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(show.description).toContain(NO_EMIT);
    expect(show.description).toContain(quickStart(false, true, true));
    expect(show.description).not.toMatch(/sends a choice to you|inside the conversation|making an artifact/);
    const docs = (await client.callTool({ name: "sayshape_docs", arguments: {} })) as unknown as Result;
    expect(docs.content[0]!.text).toBe(quickStart(false, true, true));
  });

  it("is a problem to fix, with no page, on each line that uses it, chained or not", async () => {
    const { client } = await connect();
    const r = await show(client, { spec: EMIT });
    const text = r.content[0]!.text;
    expect(pageIn(r)).toBeUndefined();
    expect(text).toMatch(/^2 problems leave part of this interface wrong or missing, and this chat app can't draw interfaces/);
    expect(text).toMatch(/line 4 \(error\): emit: can't reach you from this chat app[^\n]*keep any set:, go: or notify:/);
    expect(text).toMatch(/line 5 \(error\): emit: can't reach you/);
    expect(text).not.toMatch(/line 6/);
    // No element docs for it: the fix is in the action, not the element.
    expect(text).not.toMatch(/Docs for/);
    expect(r).not.toHaveProperty("structuredContent");
  });

  it("gives the page once it's gone, and a rich-text link isn't an emit: to remove", async () => {
    const { client } = await connect();
    const spec = 'state n=1\ncard\n  button "Plan this trip" on=set:n:2\n  text "Read [the guide](https://example.com/guide)" rich=true\n';
    const r = await show(client, { spec });
    expect(pageIn(r)).toBe(fallbackPage({ spec }));
  });

  it("changes nothing for clients that draw views", async () => {
    const { client } = await connect(UI_CLIENT);
    const r = await show(client, { spec: EMIT });
    expect(r.content[0]!.text).toMatch(/^The interface is showing in the conversation, with no problems/);
    const show2 = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(show2.description).not.toContain(NO_EMIT);
    expect(show2.description).toContain(quickStart(false, true));
  });
});
