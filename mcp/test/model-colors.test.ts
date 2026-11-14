/**
 * show_interface's colors argument: a model sends it when the person, or its
 * instructions, named colors. The server checks it loosely and reminds the
 * model to keep sending it; the view draws in it above every other source of
 * colors. --no-model-colors takes it away (byte-for-byte: test/ui-results.test.ts).
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { COLORS_DESCRIPTION, colorsNote, createServer, interfaceKey, quickStart, REPEAT_TEXT } from "../src/server";
import { chosenColors, colorsArrival, sameColors, toolColors } from "../src/ui/host-brand";
import { decodeViewOptions, encodeViewOptions, parseViewArgs, type ViewOptions } from "../src/ui/view-options";
import { themeForPreset } from "../src/ui/theme-selection";
import { resolveTheme } from "../../playground/appearance/presets";

const GOOD = 'card\n  text "Weekend hike" style=title\n  chart "Miles" kind=bar items={[{d: "Sat", m: 4}, {d: "Sun", m: 6}]} x=d y=m\n';

async function connect(view?: ViewOptions, ui = true) {
  const server = createServer({ uiHtml: () => "<!doctype html>", ...(view ? { view } : {}) });
  const client = new Client({ name: "test", version: "1.0.0" }, ui ? UI_CLIENT : undefined);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: Record<string, unknown>) => ((r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "");
const show = (client: Client, args: Record<string, unknown>) => client.callTool({ name: "show_interface", arguments: args });

describe("the colors argument", () => {
  it("is declared before spec, optional, with one sentence that says when to send it", async () => {
    const tool = (await (await connect()).listTools()).tools.find((t) => t.name === "show_interface")!;
    const props = tool.inputSchema.properties as Record<string, { type?: string; description?: string; items?: { type?: string } }>;
    expect(Object.keys(props)).toEqual(["colors", "spec", "title"]);
    expect(tool.inputSchema.required).toEqual(["spec"]);
    expect(props.colors).toMatchObject({ type: "array", items: { type: "string" }, description: COLORS_DESCRIPTION });
    // Strings with no pattern: a sloppy entry is ignored by the server, never refused by the schema.
    expect(JSON.stringify(props.colors)).not.toMatch(/pattern/);
    // One sentence: its only full stop is the last character.
    expect(COLORS_DESCRIPTION.match(/[.!?](\s|$)/g) ?? []).toHaveLength(1);
    expect(COLORS_DESCRIPTION.endsWith(".")).toBe(true);
    expect(COLORS_DESCRIPTION).toMatch(/only when the person, or the instructions you were given, named colors/);
    // The quick start (in the description) and sayshape_docs don't mention it.
    expect(tool.description).toContain(quickStart());
    expect(tool.description).not.toMatch(/colors argument|"colors"/);
  });

  it("ends the result with a note naming the colors, as the view uses them", async () => {
    const r = await show(await connect(), { colors: ["#E4572E", "2e86ab"], spec: GOOD });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe(`The interface is showing in the conversation, with no problems. Don't call show_interface again unless the person asks for a change.\n${colorsNote(["#e4572e", "#2e86ab"])}`);
    expect(colorsNote(["#e4572e", "#2e86ab"])).toBe("Colors: #e4572e, #2e86ab. Pass the same colors on every later show_interface call in this conversation, unless the person asks to change them.");
  });

  it("has no note when no colors were sent, or none were usable", async () => {
    const client = await connect();
    for (const [i, colors] of [undefined, [], ["red", "", "#12", "rgb(1,2,3)"]].entries()) {
      const r = await show(client, { ...(colors ? { colors } : {}), spec: GOOD.replace("hike", `hike ${i}`) });
      expect(r.isError).toBeFalsy();
      expect(text(r)).not.toMatch(/Colors:/);
      expect(r.structuredContent).toMatchObject({ errors: 0, warnings: 0, toFix: 0, diagnostics: [] });
    }
  });

  it("ignores sloppy entries and extras past six without a problem to fix", async () => {
    const colors = ["  #E45 ", "teal", "#zzzzzz", "", "#2e86ab", "f2c14e", "#111", "#222222", "#333", "#444444", "#555555"];
    const r = await show(await connect(), { colors, spec: GOOD });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ errors: 0, warnings: 0, toFix: 0, repeat: false, diagnostics: [] });
    expect(text(r)).toMatch(/Colors: #ee4455, #2e86ab, #f2c14e, #111111, #222222, #333333\. Pass/);
  });

  it.each<[string, unknown, string | null]>([
    ["a string", "#e4572e", "#e4572e"],
    ["a comma-separated string with spaces", " #E4572E ,  2e86ab,teal, ", "#e4572e, #2e86ab"],
    ["a list with things that aren't strings", [4, "#e4572e", null, { c: "#fff" }, ["#000"], "#2e86ab", true], "#e4572e, #2e86ab"],
    ["a number", 0xe4572e, null],
    ["an object", { primary: "#e4572e" }, null],
    ["null", null, null],
    ["a boolean", true, null],
    ["an empty string", "", null],
  ])("takes %s without an error or a problem to fix", async (_, colors, named) => {
    const r = await show(await connect(), { colors, spec: GOOD });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ errors: 0, warnings: 0, toFix: 0, repeat: false, diagnostics: [] });
    if (named) expect(text(r)).toMatch(new RegExp(`\\nColors: ${named}\\. Pass the same colors`));
    else expect(text(r)).not.toMatch(/Colors:/);
  });

  it("keeps the note on a result with problems to fix, so the retry keeps the colors", async () => {
    const r = await show(await connect(), { colors: ["#e4572e"], spec: 'card\n  txet "Typo"\n' });
    expect(r.structuredContent).toMatchObject({ toFix: 1 });
    expect(text(r)).toMatch(/Fix it[\s\S]*\nColors: #e4572e\. Pass the same colors/);
  });

  it("counts the same spec in new colors as a new interface, and in the same colors as a repeat", async () => {
    const client = await connect();
    expect((await show(client, { spec: GOOD })).structuredContent).toMatchObject({ repeat: false });
    expect((await show(client, { colors: ["#e4572e"], spec: GOOD })).structuredContent).toMatchObject({ repeat: false });
    const again = await show(client, { colors: ["#E4572E", "nope"], spec: GOOD });
    expect(again.structuredContent).toMatchObject({ repeat: true });
    expect(text(again)).toBe(`${REPEAT_TEXT}\n${colorsNote(["#e4572e"])}`);
    expect((await show(client, { colors: ["#2e86ab"], spec: GOOD })).structuredContent).toMatchObject({ repeat: false });
    // Colors with nothing usable are no colors: the same as the plain spec before them.
    expect((await show(client, { spec: GOOD })).structuredContent).toMatchObject({ repeat: false });
    expect((await show(client, { colors: ["blue"], spec: GOOD })).structuredContent).toMatchObject({ repeat: true });
  });

  it("is part of interfaceKey, which without colors is what it always was", () => {
    expect(interfaceKey("a\n", {})).toBe("a\n--\n");
    expect(interfaceKey("a\n", {}, [])).toBe(interfaceKey("a\n", {}));
    expect(interfaceKey("a\n", {}, ["#e4572e"])).not.toBe(interfaceKey("a\n", {}));
    expect(interfaceKey("a\n", {}, ["#e4572e"])).not.toBe(interfaceKey("a\n", {}, ["#2e86ab"]));
    expect(interfaceKey("a\n", {}, ["#e4572e", "#2e86ab"])).not.toBe(interfaceKey("a\n", {}, ["#2e86ab", "#e4572e"]));
  });

  it("is offered to text-only clients, which get no note: their page doesn't draw in it yet", async () => {
    const client = await connect(undefined, false);
    const tool = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["colors", "spec", "title"]);
    const r = await show(client, { colors: ["#e4572e"], spec: GOOD });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/```html/);
    expect(text(r)).not.toMatch(/Colors:|e4572e/);
  });
});

describe("--no-model-colors", () => {
  const locked = parseViewArgs(["--no-model-colors"]);

  it("is read from the command line and reaches the view in its meta tag", () => {
    expect(locked.modelColors).toBe(false);
    expect(parseViewArgs([]).modelColors).toBeUndefined();
    expect(encodeViewOptions(locked)).toBe("picker=0&theme=teal&save=1&copy=1&model=0");
    expect(decodeViewOptions(encodeViewOptions(locked)).modelColors).toBe(false);
    // Without the flag the tag is what it was.
    expect(encodeViewOptions(parseViewArgs([]))).toBe("picker=0&theme=teal&save=1&copy=1");
    expect(decodeViewOptions("picker=0&theme=teal&save=1&copy=1").modelColors).toBeUndefined();
  });

  it("takes the argument away, and colors sent anyway change nothing", async () => {
    const client = await connect(locked);
    const tool = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(["spec", "title"]);
    const plain = await show(client, { spec: GOOD });
    // Not a new interface either: the colors aren't part of it.
    expect((await show(client, { colors: ["#2e86ab"], spec: GOOD })).structuredContent).toMatchObject({ repeat: true });
    const colored = await show(client, { colors: ["#e4572e"], spec: GOOD.replace("hike", "trip") });
    expect(colored.isError).toBeFalsy();
    expect(text(colored)).toBe(text(plain));
    // Any shape at all is dropped without an error.
    for (const [i, stray] of ["#e4572e", 7, null, { a: 1 }, [1, "#fff"]].entries()) {
      const r = await show(client, { colors: stray, spec: GOOD.replace("hike", `walk ${i}`) });
      expect(r.isError).toBeFalsy();
      expect(text(r)).toBe(text(plain));
    }
  });
});

describe("the view's colors", () => {
  it("reads the argument as the server does, and ignores it with --no-model-colors", () => {
    expect(toolColors({ colors: ["#E45", "teal", 4, null, "#2e86ab"], spec: "card\n" }, true)).toEqual(["#ee4455", "#2e86ab"]);
    expect(toolColors({ colors: ["#e4572e"] }, false)).toBeUndefined();
    expect(toolColors({ spec: "card\n" }, true)).toBeUndefined();
    // The same shapes the server takes: a string is comma-separated colors; anything else that isn't a list is none.
    expect(toolColors({ colors: "#e4572e" }, true)).toEqual(["#e4572e"]);
    expect(toolColors({ colors: " #E4572E ,  2e86ab,teal, " }, true)).toEqual(["#e4572e", "#2e86ab"]);
    for (const colors of [0xe4572e, { primary: "#e4572e" }, null, true, ""]) expect(toolColors({ colors }, true)).toBeUndefined();
    expect(toolColors({ colors: "#e4572e" }, false)).toBeUndefined();
    expect(toolColors({ colors: ["red", ""] }, true)).toBeUndefined();
    expect(toolColors(undefined, true)).toBeUndefined();
    expect(toolColors({ colors: Array.from({ length: 9 }, () => "#e4572e") }, true)).toHaveLength(6);
  });

  it("takes from partial arguments only the colors that can't still change", () => {
    // "#e45" might be the start of "#e4572e": not yet.
    expect(toolColors({ colors: ["#e45"] }, true, true)).toBeUndefined();
    expect(toolColors({ colors: ["#e4572e", "#2e8"] }, true, true)).toEqual(["#e4572e"]);
    expect(toolColors({ colors: ["#e4572e", "#2e86ab"] }, true, true)).toEqual(["#e4572e", "#2e86ab"]);
    expect(toolColors({ colors: ["#e4572e", "#2e86ab"], spec: "card\n" }, true, true)).toEqual(["#e4572e", "#2e86ab"]);
    // The complete arguments take a short color as it is.
    expect(toolColors({ colors: ["#e45"] }, true)).toEqual(["#ee4455"]);
    expect(toolColors({ colors: ["#e4572e"] }, false, true)).toBeUndefined();
    // A string streaming in: entries before the last comma, and the last only once it has six digits.
    expect(toolColors({ colors: "#e45" }, true, true)).toBeUndefined();
    expect(toolColors({ colors: "#e4572e, #2e" }, true, true)).toEqual(["#e4572e"]);
    expect(toolColors({ colors: "#e4572e, #2e86ab" }, true, true)).toEqual(["#e4572e", "#2e86ab"]);
    expect(toolColors({ colors: "#e4572e, " }, true, true)).toEqual(["#e4572e"]);
    expect(toolColors({ colors: [4, "#e4572e", null] }, true, true)).toEqual(["#e4572e"]);
  });

  it("puts the conversation's colors over the operator's, a picked preset and the chat app's brand", () => {
    const conversation = ["#2e86ab", "#f2c14e"];
    expect(chosenColors({ conversationColors: conversation, operatorColors: ["#e4572e"], picked: true, startupPreset: "teal", brand: "#D97757" })).toEqual(conversation);
    expect(chosenColors({ conversationColors: conversation, picked: true, startupPreset: "purple" })).toEqual(conversation);
    expect(chosenColors({ conversationColors: conversation, picked: false, startupPreset: "teal", brand: "#D97757" })).toEqual(conversation);
    // A call without them (a new view) falls back as before.
    expect(chosenColors({ operatorColors: ["#e4572e"], picked: false, startupPreset: "teal", brand: "#D97757" })).toEqual(["#e4572e"]);
    expect(chosenColors({ conversationColors: [], operatorColors: ["#e4572e"], picked: false, startupPreset: "teal" })).toEqual(["#e4572e"]);
    expect(chosenColors({ picked: false, startupPreset: "teal", brand: "#D97757" })).toEqual(["#D97757"]);
    expect(chosenColors({ picked: true, startupPreset: "teal", brand: "#D97757" })).toBeUndefined();
  });

  it("draws the accent and series from them in light and dark, a picked preset keeping its style", () => {
    for (const scheme of ["light", "dark"] as const) {
      const colors = chosenColors({ conversationColors: ["#2e86ab", "#f2c14e"], operatorColors: ["#e4572e"], picked: true, startupPreset: "teal" });
      const theme = themeForPreset("studio", scheme, undefined, colors);
      const expected = resolveTheme("studio", scheme, ["#2e86ab", "#f2c14e"]).theme;
      expect(theme.colors.accent).toBe(expected.colors.accent);
      expect(theme.colors.series1).toBe(expected.colors.series1);
      expect(theme.colors.series2).toBe(expected.colors.series2);
      expect(theme.font).toEqual(themeForPreset("studio", scheme).font);
    }
  });

  it("compares lists, and logs when they arrive", () => {
    expect(sameColors(undefined, [])).toBe(true);
    expect(sameColors(["#e4572e"], ["#e4572e"])).toBe(true);
    expect(sameColors(["#e4572e"], undefined)).toBe(false);
    expect(colorsArrival(["#e4572e", "#2e86ab"], "")).toBe("SayShape view: colors #e4572e, #2e86ab arrived before the spec's first line");
    expect(colorsArrival(["#e4572e"], "card\n  text \"Hi\"\n")).toBe("SayShape view: colors #e4572e arrived after 2 lines of the spec");
  });
});
