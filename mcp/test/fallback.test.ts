import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cannotDrawViews, colorsNote, createServer, NO_EMIT, quickStart, REPEAT_TEXT } from "../src/server";
import { McpResultStore } from "../src/mcp-results";
import { engineScriptUrl, fallbackPage, fenced, NOTHING_SENT, PAGE_COLOR_TOKENS, PAGE_DATASETS_TEXT, PAGE_ENGINE_VERSION, PAGE_REPEAT_TEXT, PAGE_TEXT, pageColors, scriptJson, usesMap } from "../src/fallback";
import { lightTheme, darkTheme, extendTheme, type Theme } from "../../src/theme";
import { resolveTheme } from "../../playground/appearance/presets";
import { parseViewArgs, type ViewOptions } from "../src/ui/view-options";
import { UI_CLIENT } from "./clients";

const GOOD = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n';
/** Model-written text that would end the script and inject markup if it went in as it is. */
const HOSTILE = 'card\n  text "</script><script>alert(1)</script><!-- <SCRIPT>" style=title\n  text "\u2028line\u2029separators </ScRiPt >"\n';

async function connect(options?: typeof UI_CLIENT, now = () => 1_000, view?: ViewOptions) {
  const store = new McpResultStore();
  store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12 }] } }, { label: "sales" });
  const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store, now, ...(view ? { view } : {}) });
  const client = new Client({ name: "text-only", version: "1.0.0" }, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
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
  const drawn: { spec?: string; themes: string[]; colors: Array<Theme["colors"]>; components?: unknown[]; notes: string[]; opened: unknown[][]; act?: (a: { name: string; value?: unknown }) => void } = { themes: [], colors: [], notes: [], opened: [] };
  class SayShape {
    on(event: string, fn: (a: { name: string; value?: unknown }) => void) { if (event === "action") drawn.act = fn; }
    notify(text: string) { drawn.notes.push(text); }
    constructor(_canvas: unknown, opts: { components: unknown[]; theme: Theme }) {
      drawn.components = opts.components;
      drawn.themes.push(opts.theme.name);
      drawn.colors.push(opts.theme.colors);
    }
    setTheme(t: Theme) { drawn.themes.push(t.name); drawn.colors.push(t.colors); }
    setSpec(spec: string) { drawn.spec = spec; }
  }
  const style = new Map<string, string>();
  const element = { textContent: "", hidden: true };
  const window = {
    sayshape: { SayShape, coreComponents: ["core"], sceneComponents: ["scene"], lightTheme, darkTheme, extendTheme },
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

describe("brand colors on the page", () => {
  const TWO = ["#1f3a93", "#f28c28"];
  const hex6 = /^#[0-9a-f]{6}$/i;
  /** The colors the page draws with in a mode (the first theme it hands the engine). */
  const drawnIn = (html: string, dark: boolean) => runPage(html, { dark }).drawn.colors[0]!;
  const want = (colors: string[], dark: boolean) => resolveTheme("teal", dark ? "dark" : "light", colors).theme.colors;

  it("is exactly the page without colors when there are none, or none usable", () => {
    const plain = readFileSync(new URL("./fixtures/main/fallback-page-plain.html", import.meta.url), "utf8");
    const spec = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n  map fit=pins\n    pin "Tokyo" lat=35.7 lon=139.7\n';
    // Recorded from main before colors existed: byte for byte.
    expect(fallbackPage({ spec, title: "Hike", scenes: true })).toBe(plain);
    for (const colors of [undefined, null, [], ["red", "", "#12", "rgb(1,2,3)"]]) expect(fallbackPage({ spec, title: "Hike", scenes: true, colors })).toBe(plain);
    expect(plain).not.toMatch(/extendTheme|brand/);
    expect(pageColors([])).toBeNull();
    expect(pageColors(["teal"])).toBeNull();
  });

  it("hands the engine the accent, the text on it, the map's highlight and six series, worked out for light and dark", () => {
    const colors = pageColors(TWO)!;
    expect(Object.keys(colors)).toEqual(["light", "dark"]);
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(colors[mode])).toEqual([...PAGE_COLOR_TOKENS]);
      for (const k of PAGE_COLOR_TOKENS) expect(colors[mode][k]).toMatch(hex6);
      const series = [1, 2, 3, 4, 5, 6].map((i) => colors[mode][`series${i}` as "series1"]);
      expect(new Set(series.map((c) => c.toLowerCase())).size).toBe(6);
      // The first color is the accent and the first series.
      expect(colors[mode].series1).toBe(colors[mode].accent);
    }
    // The two modes differ (each is made readable on its own surface).
    expect(colors.light.accent).not.toBe(colors.dark.accent);
    expect(colors.light.series2).not.toBe(colors.dark.series2);
    // The page says them in its script as JSON, once.
    const page = fallbackPage({ spec: GOOD, colors: TWO });
    expect(page).toContain(`var brand = ${scriptJson(colors)};`);
  });

  it("draws in them in light and dark, the same values resolveTheme gives, and nothing else changes", () => {
    const page = fallbackPage({ spec: GOOD, colors: TWO });
    for (const dark of [false, true]) {
      const got = drawnIn(page, dark);
      const expected = want(TWO, dark);
      for (const k of PAGE_COLOR_TOKENS) expect(got[k], `${dark ? "dark" : "light"} ${k}`).toBe(expected[k]);
      // accent2 follows the accent, as in the view; the rest are the engine's own.
      expect(got.accent2).toBe(got.accent);
      const base = (dark ? darkTheme : lightTheme).colors;
      for (const k of ["surface", "raised", "ink", "muted", "line", "good", "warn", "bad", "focus", "scrim"] as const) expect(got[k], k).toBe(base[k]);
      expect(got.accent).not.toBe(base.accent);
      expect(got.series2).not.toBe(base.series2);
    }
    // The theme's name and the page background are as before.
    const dark = runPage(page, { theme: "dark" });
    expect(dark.drawn.themes[0]).toBe("dark");
    expect(dark.style.get("--bg")).toBe(darkTheme.colors.surface);
  });

  it("follows light and dark after load, the way the page does without colors", () => {
    const page = fallbackPage({ spec: GOOD, colors: TWO });
    const light = runPage(page, { dark: false });
    const dark = runPage(page, { dark: true });
    // The theme it starts in and the one apply() sets are the same.
    expect(light.drawn.colors).toHaveLength(2);
    expect(light.drawn.colors[1]).toEqual(light.drawn.colors[0]);
    expect(dark.drawn.colors[1]).toEqual(dark.drawn.colors[0]);
    expect(dark.drawn.colors[0]!.accent).toBe(want(TWO, true).accent);
    // data-theme from the host page wins over the viewer's setting.
    expect(runPage(page, { dark: true, theme: "light" }).drawn.colors[0]!.accent).toBe(want(TWO, false).accent);
    expect(runPage(page, { dark: false, theme: "dark" }).drawn.colors[0]!.accent).toBe(want(TWO, true).accent);
  });

  it("keeps working with an engine that has no extendTheme: the default themes", () => {
    const html = fallbackPage({ spec: GOOD, colors: TWO });
    const scripts = [...html.matchAll(/<script(?: src="([^"]*)")?>([\s\S]*?)<\/script>/g)].filter((m) => !m[1]).map((m) => m[2]!);
    const drawn: Array<Theme["colors"]> = [];
    class SayShape {
      constructor(_c: unknown, o: { theme: Theme }) { drawn.push(o.theme.colors); }
      on() {}
      setTheme() {}
      setSpec() {}
    }
    const window = { sayshape: { SayShape, coreComponents: [], lightTheme, darkTheme }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
    const document = { documentElement: { getAttribute: () => null, style: { setProperty() {} } }, getElementById: () => ({ hidden: true, textContent: "" }) };
    for (const code of scripts) runInNewContext(code, { window, document, URL });
    expect(drawn[0]).toBe(lightTheme.colors);
  });

  it("relies on extendTheme following the accent, as the pinned release's does", () => {
    const patch = pageColors(TWO)!.light;
    const out = extendTheme(lightTheme, { colors: patch });
    expect(out.colors.accent2).toBe(patch.accent);
    expect(out.colors.series1).toBe(patch.series1);
  });

  it("puts any color through as hex digits only: a color can't give the page markup", () => {
    const page = fallbackPage({ spec: GOOD, colors: ['#e4572e"</script><script>alert(1)</script>', "#2e86ab", "javascript:alert(1)"] });
    expect(page.match(/<script/gi)).toHaveLength(2);
    expect(page).not.toMatch(/alert\(1\)/);
    expect(drawnIn(page, false).accent).toBe(want(["#2e86ab"], false).accent);
  });

  it("gives an accent and a label color for any brand color, in both modes", () => {
    for (const hex of ["#ffffff", "#000000", "#ffd400", "#0a1a3f", "#e4572e", "#808080"]) {
      for (const mode of ["light", "dark"] as const) {
        const c = pageColors([hex])![mode];
        expect(c.accent).toMatch(hex6);
        expect(c.onAccent).toMatch(hex6);
      }
    }
  });
});

describe("brand colors in the result for chat apps that can't draw views", () => {
  const SPEC = 'card\n  text "Miles" style=title\n  chart "Miles" kind=bar items={[{d: "Sat", m: 4}, {d: "Sun", m: 6}]} x=d y=m\n  button "Go" on=inc:n\n';
  const drawnAccent = (page: string, dark: boolean) => runPage(page, { dark }).drawn.colors[0]!.accent;
  const accentOf = (r: Result, dark: boolean) => drawnAccent(pageIn(r)!, dark);
  const accentFor = (colors: string[], dark: boolean) => resolveTheme("teal", dark ? "dark" : "light", colors).theme.colors.accent;
  const defaultAccent = (dark: boolean) => (dark ? darkTheme : lightTheme).colors.accent;
  const view = (args: string[]): ViewOptions => parseViewArgs(args);

  it("draws the page in the conversation's colors, in light and dark", async () => {
    const { client } = await connect();
    const r = await show(client, { colors: ["#1F3A93", "f28c28"], spec: SPEC });
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#1f3a93", "#f28c28"] }));
    for (const dark of [false, true]) expect(accentOf(r, dark)).toBe(accentFor(["#1f3a93", "#f28c28"], dark));
  });

  it("ends the result with the same note the view's results end with, after the page", async () => {
    const { client } = await connect();
    const r = await show(client, { colors: ["#1f3a93", "#f28c28"], spec: SPEC });
    const text = r.content[0]!.text;
    expect(text.endsWith(`\n${colorsNote(["#1f3a93", "#f28c28"])}`)).toBe(true);
    // The note is outside the fence: the page is still exactly the page.
    expect(text.split(colorsNote(["#1f3a93", "#f28c28"]))).toHaveLength(2);
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#1f3a93", "#f28c28"] }));
    expect(r).not.toHaveProperty("structuredContent");
  });

  it("uses the operator's colors when the conversation sent none, with no note", async () => {
    const { client } = await connect(undefined, () => 1_000, view(["--colors", "#2e86ab,#f2c14e"]));
    const r = await show(client, { spec: SPEC });
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#2e86ab", "#f2c14e"] }));
    for (const dark of [false, true]) expect(accentOf(r, dark)).toBe(accentFor(["#2e86ab", "#f2c14e"], dark));
    expect(r.content[0]!.text).not.toMatch(/Colors:/);
    // --accent is a list of one.
    const one = await connect(undefined, () => 1_000, view(["--accent", "#e4572e"]));
    expect(accentOf(await show(one.client, { spec: SPEC }), false)).toBe(accentFor(["#e4572e"], false));
  });

  it("puts the conversation's colors over the operator's, and the note names only the conversation's", async () => {
    const { client } = await connect(undefined, () => 1_000, view(["--colors", "#2e86ab,#f2c14e"]));
    const r = await show(client, { colors: ["#e4572e"], spec: SPEC });
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#e4572e"] }));
    for (const dark of [false, true]) expect(accentOf(r, dark)).toBe(accentFor(["#e4572e"], dark));
    expect(r.content[0]!.text.endsWith(`\n${colorsNote(["#e4572e"])}`)).toBe(true);
    expect(r.content[0]!.text).not.toMatch(/#2e86ab/);
    // The next call without colors goes back to the operator's.
    const next = await show(client, { spec: SPEC.replace("Miles", "Walks") });
    expect(accentOf(next, false)).toBe(accentFor(["#2e86ab", "#f2c14e"], false));
    expect(next.content[0]!.text).not.toMatch(/Colors:/);
  });

  it("has the page and result it always had when no colors were sent or usable, and no note", async () => {
    const { client } = await connect();
    const plain = await show(client, { spec: SPEC });
    expect(pageIn(plain)).toBe(fallbackPage({ spec: SPEC }));
    expect(pageIn(plain)).not.toMatch(/extendTheme/);
    expect(plain.content[0]!.text).not.toMatch(/Colors:/);
    for (const [i, colors] of [[], ["red", "", "#12", "rgb(1,2,3)"], 7, null, { a: "#e4572e" }, ""].entries()) {
      const spec = SPEC.replace("Miles", `Miles ${i}`);
      const r = await show(client, { colors, spec });
      expect(r.isError).toBeFalsy();
      expect(pageIn(r)).toBe(fallbackPage({ spec }));
      expect(r.content[0]!.text).not.toMatch(/Colors:/);
    }
    expect(drawnAccent(pageIn(plain)!, false)).toBe(defaultAccent(false));
  });

  it("ignores sloppy entries and keeps the good ones", async () => {
    const { client } = await connect();
    const r = await show(client, { colors: "  #E45 , teal, #zzzzzz, 2e86ab ", spec: SPEC });
    expect(r.isError).toBeFalsy();
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#ee4455", "#2e86ab"] }));
    expect(r.content[0]!.text.endsWith(`\n${colorsNote(["#ee4455", "#2e86ab"])}`)).toBe(true);
    const long = await show(client, { colors: Array.from({ length: 9 }, (_, i) => `#${i}${i}5599`), spec: SPEC.replace("Miles", "Lots") });
    expect(long.isError).toBeFalsy();
    expect(long.content[0]!.text).toMatch(/Colors: (#[0-9a-f]{6}(, )?){6}\. Pass/);
  });

  it("with --no-model-colors takes no argument, ignores one sent anyway, and draws in the operator's colors only", async () => {
    const { client } = await connect(undefined, () => 1_000, view(["--no-model-colors", "--colors", "#2e86ab"]));
    const tool = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("colors");
    const r = await show(client, { colors: ["#e4572e"], spec: SPEC });
    expect(pageIn(r)).toBe(fallbackPage({ spec: SPEC, colors: ["#2e86ab"] }));
    expect(r.content[0]!.text).not.toMatch(/Colors:|e4572e/);
    // With no operator colors either, the page is the plain one.
    const bare = await connect(undefined, () => 1_000, view(["--no-model-colors"]));
    expect(pageIn(await show(bare.client, { colors: ["#e4572e"], spec: SPEC }))).toBe(fallbackPage({ spec: SPEC }));
  });

  it("says so on a repeat in the same colors, and a new color is a new page", async () => {
    const { client } = await connect();
    await show(client, { colors: ["#e4572e"], spec: SPEC });
    const again = await show(client, { colors: ["#E4572E"], spec: SPEC });
    expect(again.content[0]!.text).toBe(`${PAGE_REPEAT_TEXT}\n${colorsNote(["#e4572e"])}`);
    expect(pageIn(again)).toBeUndefined();
    const other = await show(client, { colors: ["#2e86ab"], spec: SPEC });
    expect(pageIn(other)).toBe(fallbackPage({ spec: SPEC, colors: ["#2e86ab"] }));
    // No colors at all is another change, and a repeat of that has no note.
    await show(client, { spec: SPEC });
    expect((await show(client, { spec: SPEC })).content[0]!.text).toBe(PAGE_REPEAT_TEXT);
  });

  it("keeps the note on a result with problems to fix, with no page, so the retry keeps the colors", async () => {
    const { client } = await connect();
    const r = await show(client, { colors: ["#e4572e"], spec: 'card\n  txet "Typo"\n' });
    expect(pageIn(r)).toBeUndefined();
    expect(r.content[0]!.text).toMatch(/^1 problem leaves part/);
    expect(r.content[0]!.text.endsWith(`\n${colorsNote(["#e4572e"])}`)).toBe(true);
  });

  it("has no note where nothing is drawn: an interface that loads a dataset", async () => {
    const { client } = await connect();
    const data = await show(client, { colors: ["#e4572e"], spec: 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n', data: { sales: "m1" } });
    expect(data.content).toEqual([{ type: "text", text: PAGE_DATASETS_TEXT }]);
  });

  it("changes nothing for clients that draw views: no page, the same note", async () => {
    const { client } = await connect(UI_CLIENT);
    const r = await show(client, { colors: ["#e4572e"], spec: SPEC });
    expect(pageIn(r)).toBeUndefined();
    expect(r.content[0]!.text.endsWith(`\n${colorsNote(["#e4572e"])}`)).toBe(true);
  });
});
