/**
 * npm run colors-eval, without a model: the scoring, the wording variants, the conversation loop against a
 * scripted model and a stand-in for the server's tools, the report, and the chat client against a local
 * stub of an OpenAI-compatible server. The real server's tools and results are checked in
 * mcp/test/colors-eval.test.ts, where the MCP packages are installed.
 */
import { describe, expect, it } from "vitest";
import { ChatError, openAiChat, usageOf, type ChatFn, type Message } from "../eval/colors/chat";
import { PROMPT_SETS, conversationA, conversationB } from "../eval/colors/prompts";
import { rate, report } from "../eval/colors/report";
import { jobsFor, runConversation, runEval, tallyOf, withVariant, type Backend, type ConversationResult } from "../eval/colors/run";
import { addToTally, compareColors, emptyTally, normalizeColors, readColors, scoreCall } from "../eval/colors/score";
import { startStub, stubMessage, stubReply, type StubBehavior } from "../eval/colors/stub";
import { colorsInNote, DESCRIPTION_VARIANTS, noteText, NOTE_VARIANTS } from "../eval/colors/variants";

const REAL_NOTE = (c: string[]) => `Colors: ${c.join(", ")}. Pass the same colors on every later show_interface call in this conversation, unless the person asks to change them.`;
const DESC = 'Brand colors as hex, most important first, such as ["#e4572e", "#2e86ab"]: send them only when the person, or the instructions you were given, named colors to use.';

/** Stands in for the server's tools: the same shape of schema and the same note, none of its checks. */
function fakeBackend(): Backend & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    tools: [
      { name: "sayshape_docs", description: "Docs.", inputSchema: { type: "object", properties: { elements: { type: "array", items: { type: "string" } } } } },
      { name: "show_interface", description: "Shows.", inputSchema: { type: "object", properties: { colors: { type: "array", items: { type: "string" }, description: DESC }, spec: { type: "string" } }, required: ["spec"] } },
    ],
    instructions: "Use show_interface.",
    async call(name, args) {
      calls.push({ name, args });
      if (name === "sayshape_docs") return "chart: props…";
      const colors = readColors(args.colors).colors;
      return `The interface is showing correctly.${colors.length ? `\n${REAL_NOTE(colors)}` : ""}`;
    },
    close: async () => {},
  };
}

const scripted = (behavior: StubBehavior): ChatFn => async (messages) => ({ message: stubMessage(behavior, messages), usage: {}, ms: 0 });
const [COFFEE, NAVY, PURPLE, OCEAN] = PROMPT_SETS;

describe("reading the colors argument", () => {
  it("reads it the way the server does", () => {
    expect(readColors(["#E4572E", "2e86ab", "#abc"])).toEqual({ sent: true, colors: ["#e4572e", "#2e86ab", "#aabbcc"] });
    expect(readColors("#e4572e, #2e86ab")).toEqual({ sent: true, colors: ["#e4572e", "#2e86ab"] });
    expect(readColors(["teal", "rgb(0,0,0)"])).toEqual({ sent: true, colors: [] });
    expect(readColors([1, null, "#fff"])).toEqual({ sent: true, colors: ["#ffffff"] });
    expect(readColors(undefined)).toEqual({ sent: false, colors: [] });
    expect(readColors([])).toEqual({ sent: false, colors: [] });
    expect(readColors(["", "  "])).toEqual({ sent: false, colors: [] });
    expect(readColors({ a: 1 })).toEqual({ sent: false, colors: [] });
    expect(readColors(7)).toEqual({ sent: false, colors: [] });
  });

  it("keeps at most six, like the server", () => {
    expect(readColors(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"]).colors).toHaveLength(6);
  });

  it("normalizes case, the hash and short forms", () => {
    expect(normalizeColors(["0B6E4F", "#F4B942", "fa0"])).toEqual(["#0b6e4f", "#f4b942", "#ffaa00"]);
  });
});

describe("comparing with the colors the person named", () => {
  const named = ["#0b6e4f", "#f4b942"];
  const m = (raw: unknown) => compareColors(readColors(raw), named);
  it("tells the same list from each kind of change", () => {
    expect(m(["#0B6E4F", "f4b942"])).toBe("same");
    expect(m(["#f4b942", "#0b6e4f"])).toBe("reordered");
    expect(m(["#0b6e4f"])).toBe("subset");
    expect(m(["#0b6e4f", "#f4b942", "#123456"])).toBe("superset");
    expect(m(["#0b6e4f", "#123456"])).toBe("different");
    expect(m(["#123456"])).toBe("different");
    expect(m(["green"])).toBe("different");
    expect(m(undefined)).toBe("none");
  });
});

describe("scoring a call by phase", () => {
  const named = ["#0b6e4f", "#f4b942"];
  it("wants the named colors, unchanged, when asked and later", () => {
    expect(scoreCall(0, "ask", ["#0b6e4f", "#f4b942"], named).ok).toBe(true);
    expect(scoreCall(1, "later", ["#0B6E4F", "#F4B942"], named)).toMatchObject({ ok: true, match: "same" });
    expect(scoreCall(1, "later", ["#f4b942", "#0b6e4f"], named)).toMatchObject({ ok: false, match: "reordered" });
    expect(scoreCall(1, "later", undefined, named)).toMatchObject({ ok: false, match: "none" });
  });
  it("wants none after a reset and in a conversation that never asked", () => {
    expect(scoreCall(4, "reset", undefined, named)).toMatchObject({ ok: true, match: "none", wanted: [] });
    expect(scoreCall(4, "reset", named, named)).toMatchObject({ ok: false, match: "different" });
    expect(scoreCall(0, "plain", [], [])).toMatchObject({ ok: true });
    expect(scoreCall(0, "plain", ["#ff0000"], [])).toMatchObject({ ok: false });
    // Colors the server would ignore are still colors nobody asked for.
    expect(scoreCall(0, "plain", ["red"], [])).toMatchObject({ ok: false, sent: { sent: true, colors: [] } });
  });
});

describe("tallies", () => {
  it("counts each phase on its own", () => {
    const t = emptyTally();
    const named = ["#0b6e4f"];
    addToTally(t, {
      kind: "A", stopped: false,
      calls: [
        scoreCall(0, "ask", named, named),
        scoreCall(1, "later", named, named),
        scoreCall(2, "later", undefined, named),
        scoreCall(3, "later", ["#123456"], named),
        scoreCall(4, "reset", undefined, named),
      ],
      turns: [
        { turn: 0, phase: "ask", calls: 1, noInterface: false },
        { turn: 1, phase: "later", calls: 1, noInterface: false },
        { turn: 2, phase: "later", calls: 1, noInterface: false },
        { turn: 3, phase: "later", calls: 1, noInterface: false },
        { turn: 4, phase: "later", calls: 0, noInterface: true },
      ],
    });
    addToTally(t, { kind: "B", stopped: true, calls: [scoreCall(0, "plain", ["#fff"], []), scoreCall(1, "plain", undefined, [])], turns: [] });
    expect(t).toMatchObject({
      conversationsA: 1, conversationsB: 1, stopped: 1,
      askCalls: 1, askSame: 1,
      laterCalls: 3, laterSent: 2, laterSame: 1, laterDropped: 1, laterChanged: 1,
      resetCalls: 1, resetNone: 1,
      plainCalls: 2, plainInvented: 1,
    });
    expect(t.laterKinds.different).toBe(1);
    expect(t.noInterface.later).toBe(1);
  });

  it("writes a rate with its counts", () => {
    expect(rate(33, 36)).toBe("92% (33/36)");
    expect(rate(0, 0)).toBe("–");
  });
});

describe("prompt sets", () => {
  const colorWords = /\b(colou?rs?|palette|brand|accent|purple|navy|coral|sand|teal)\b/i;
  it("name the colors once and give them as hex", () => {
    for (const s of PROMPT_SETS) {
      expect(s.colors.length).toBeGreaterThan(0);
      expect(normalizeColors(s.colors)).toHaveLength(s.colors.length);
      for (const c of s.colors) expect(s.ask.toLowerCase()).toContain(c.replace(/^#/, "").toLowerCase());
    }
  });
  it("say nothing about colors in the later messages or in conversation B", () => {
    for (const s of PROMPT_SETS) {
      for (const t of [...s.later, ...s.plain]) {
        expect(t, `${s.id}: ${t}`).not.toMatch(colorWords);
        expect(t).not.toMatch(/#?\b[0-9a-f]{6}\b/i);
      }
    }
  });
  it("ask to go back to normal at the end of A, and for an interface", () => {
    for (const s of PROMPT_SETS) {
      const a = conversationA(s);
      expect(a.turns.map((t) => t.phase)).toEqual(["ask", "later", "later", "later", "reset"]);
      expect(a.turns[4]!.text).toMatch(/normal|default|standard|back to how/i);
      expect(conversationB(s).turns.map((t) => t.phase)).toEqual(["plain", "plain", "plain", "plain"]);
    }
  });
  it("differ from each other", () => {
    expect(new Set(PROMPT_SETS.map((s) => s.id)).size).toBe(PROMPT_SETS.length);
    expect(new Set(PROMPT_SETS.map((s) => s.colors.length)).size).toBeGreaterThan(1);
  });
});

describe("wording variants", () => {
  const colorsOf = (b: Backend) => (b.tools.find((t) => t.name === "show_interface")!.inputSchema as { properties: { colors: { description: string } } }).properties.colors.description;

  it("leave the server's text alone by default", async () => {
    const real = fakeBackend();
    const same = withVariant(real, {});
    expect(same).toBe(real);
    expect(colorsOf(same)).toBe(DESC);
    expect(await same.call("show_interface", { spec: "card", colors: ["#aabbcc"] })).toContain(REAL_NOTE(["#aabbcc"]));
  });

  it("swap the description without touching the original", () => {
    const real = fakeBackend();
    const v = withVariant(real, { description: DESCRIPTION_VARIANTS.lasting });
    expect(colorsOf(v)).toBe(DESCRIPTION_VARIANTS.lasting);
    expect(colorsOf(real)).toBe(DESC);
    expect(v.tools.find((t) => t.name === "sayshape_docs")).toBe(real.tools.find((t) => t.name === "sayshape_docs"));
  });

  it("swap the note, with the colors the server named, and nothing else in the result", async () => {
    const v = withVariant(fakeBackend(), { note: NOTE_VARIANTS.short });
    const text = await v.call("show_interface", { spec: "card", colors: ["#AABBCC", "123456"] });
    expect(text).toBe('The interface is showing correctly.\nKeep sending colors=["#aabbcc","#123456"] on show_interface until the person says otherwise.');
    // No colors, no note, and so nothing to swap.
    expect(await v.call("show_interface", { spec: "card" })).toBe("The interface is showing correctly.");
    expect(await v.call("sayshape_docs", {})).toBe("chart: props…");
  });

  it("read the colors out of the real note", () => {
    expect(colorsInNote(REAL_NOTE(["#aabbcc", "#123456"]))).toEqual(["#aabbcc", "#123456"]);
    expect(colorsInNote("nothing")).toEqual([]);
    expect(noteText("Use {colors}.", ["#aabbcc"])).toBe('Use ["#aabbcc"].');
  });

  it("don't invent a colors argument on a server that has none", () => {
    const locked = fakeBackend();
    (locked.tools[1]!.inputSchema as { properties: Record<string, unknown> }).properties = { spec: { type: "string" } };
    const v = withVariant(locked, { description: "x" });
    expect((v.tools[1]!.inputSchema as { properties: Record<string, unknown> }).properties).toEqual({ spec: { type: "string" } });
  });
});

describe("a conversation against a scripted model", () => {
  const run = (kind: "A" | "B", behavior: StubBehavior, backend = fakeBackend(), extra: Partial<Parameters<typeof runConversation>[1]> = {}) =>
    runConversation(kind === "A" ? conversationA(COFFEE!) : conversationB(COFFEE!), { model: "m", run: 1, chat: scripted(behavior), backend, ...extra });

  it("scores a model that keeps the colors", async () => {
    const backend = fakeBackend();
    const r = await run("A", "keeper", backend);
    expect(r.stopped).toBeUndefined();
    expect(r.calls.map((c) => [c.phase, c.match, c.ok])).toEqual([["ask", "same", true], ["later", "same", true], ["later", "same", true], ["later", "same", true], ["reset", "none", true]]);
    expect(tallyOf([r])).toMatchObject({ laterCalls: 3, laterSame: 3, resetNone: 1 });
    // Every tool call went to the backend, docs lookups included, and its result is in the transcript.
    expect(backend.calls.filter((c) => c.name === "sayshape_docs").length).toBeGreaterThan(0);
    expect(r.messages.filter((m) => m.role === "tool")).toHaveLength(backend.calls.length);
    expect(r.calls[1]!.result).toContain(REAL_NOTE(["#0b6e4f", "#f4b942"]));
    expect(r.requests).toBe(r.messages.filter((m) => m.role === "assistant").length);
  });

  it("scores a model that forgets them", async () => {
    const r = await run("A", "forgetter");
    expect(tallyOf([r])).toMatchObject({ askSame: 1, laterCalls: 3, laterSent: 0, laterDropped: 3, resetNone: 1 });
  });

  it("scores a model that changes them, and one that drops one", async () => {
    const t = tallyOf([await run("A", "mixed")]);
    expect(t).toMatchObject({ laterCalls: 3, laterSame: 1, laterChanged: 1, laterDropped: 1 });
    expect(t.laterKinds.reordered).toBe(1);
  });

  it("scores a model that keeps colors after being told to go back to normal", async () => {
    const r = await run("A", "inventor");
    expect(tallyOf([r])).toMatchObject({ resetCalls: 1, resetNone: 0, laterChanged: 3 });
  });

  it("scores invented colors in a conversation that never asked", async () => {
    expect(tallyOf([await run("B", "inventor")])).toMatchObject({ plainCalls: 4, plainInvented: 4 });
    expect(tallyOf([await run("B", "plain")])).toMatchObject({ plainCalls: 4, plainInvented: 0 });
  });

  it("stops at a cap and says why, keeping what it has", async () => {
    const r = await run("A", "keeper", fakeBackend(), { limits: { maxRequests: 3 } });
    expect(r.stopped).toMatch(/3 model requests/);
    expect(r.requests).toBe(3);
    const t = tallyOf([r]);
    expect(t.stopped).toBe(1);
    expect(t.laterCalls).toBe(0);
  });

  it("stops at the token cap, estimating when the server reports none", async () => {
    const r = await run("A", "keeper", fakeBackend(), { limits: { maxTokens: 1 } });
    expect(r.stopped).toMatch(/tokens/);
    expect(r.estimated).toBe(true);
  });

  it("stops a message that keeps calling tools", async () => {
    const loop: ChatFn = async (messages) => ({ message: { role: "assistant", content: null, tool_calls: [{ id: `c${messages.length}`, type: "function", function: { name: "sayshape_docs", arguments: "{}" } }] }, usage: { promptTokens: 10, completionTokens: 5 }, ms: 0 });
    const r = await runConversation(conversationB(COFFEE!), { model: "m", run: 1, chat: loop, backend: fakeBackend(), limits: { maxTurnRequests: 2 } });
    expect(r.stopped).toMatch(/2 model requests for one message/);
    expect(r.requests).toBe(2);
    expect(r.estimated).toBe(false);
    expect(r.turns).toEqual([]);
  });

  it("records a model that answers in words and shows nothing", async () => {
    const talker: ChatFn = async () => ({ message: { role: "assistant", content: "Sure!" }, usage: {}, ms: 0 });
    const t = tallyOf([await runConversation(conversationA(COFFEE!), { model: "m", run: 1, chat: talker, backend: fakeBackend() })]);
    expect(t.noInterface.later).toBe(3);
    expect(t.laterCalls).toBe(0);
  });

  it("does not score a call whose arguments are not JSON", async () => {
    let n = 0;
    const bad: ChatFn = async (messages) => {
      if (messages[messages.length - 1]!.role === "tool") return { message: { role: "assistant", content: "ok" }, usage: {}, ms: 0 };
      return { message: { role: "assistant", content: null, tool_calls: [{ id: `c${n++}`, type: "function", function: { name: "show_interface", arguments: "{not json" } }] }, usage: {}, ms: 0 };
    };
    const r = await runConversation(conversationB(COFFEE!), { model: "m", run: 1, chat: bad, backend: fakeBackend() });
    expect(r.malformed).toBe(4);
    expect(r.calls).toHaveLength(0);
    expect(r.messages.find((m) => m.role === "tool")).toMatchObject({ content: expect.stringContaining("not a JSON object") });
  });

  it("reports a model server that fails and keeps what came before", async () => {
    let n = 0;
    const flaky: ChatFn = async (messages) => {
      if (++n > 3) throw new ChatError("The model server reported an error (HTTP 401): bad key", 401);
      return scripted("keeper")(messages, []);
    };
    const r = await runConversation(conversationA(COFFEE!), { model: "m", run: 1, chat: flaky, backend: fakeBackend() });
    expect(r.stopped).toBe("The model server reported an error (HTTP 401): bad key");
    expect(r.calls.length).toBeGreaterThan(0);
  });

  it("sends the model the server's instructions and tools, with the colors text in a variant's words", async () => {
    const seen: Array<{ system: string; tools: string }> = [];
    const spy: ChatFn = async (messages, tools) => {
      seen.push({ system: messages[0]!.content as string, tools: JSON.stringify(tools) });
      return { message: { role: "assistant", content: "ok" }, usage: {}, ms: 0 };
    };
    const backend = withVariant(fakeBackend(), { description: "Send these on every call." });
    await runConversation(conversationB(COFFEE!), { model: "m", run: 1, chat: spy, backend });
    expect(seen[0]!.system).toContain("Use show_interface.");
    expect(seen[0]!.tools).toContain("Send these on every call.");
    expect(seen[0]!.tools).not.toContain(DESC);
  });
});

describe("the whole run", () => {
  it("runs every conversation for every model and keeps them apart", async () => {
    const conversations = [conversationA(COFFEE!), conversationB(COFFEE!), conversationA(PURPLE!)];
    const opts = { models: ["keeps", "forgets"], conversations, runs: 2 };
    expect(jobsFor(opts)).toHaveLength(12);
    const seen: number[] = [];
    const results = await runEval({
      ...opts,
      concurrency: 3,
      chatFor: (m) => scripted(m === "keeps" ? "keeper" : "forgetter"),
      connect: async () => fakeBackend(),
      onResult: (_r, done) => seen.push(done),
    });
    expect(results).toHaveLength(12);
    expect(results.every(Boolean)).toBe(true);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(tallyOf(results.filter((r) => r.model === "keeps" && r.kind === "A"))).toMatchObject({ conversationsA: 4, laterCalls: 12, laterSame: 12 });
    expect(tallyOf(results.filter((r) => r.model === "forgets" && r.kind === "A"))).toMatchObject({ laterCalls: 12, laterDropped: 12 });
  });

  it("closes every backend it opened, also when a conversation fails", async () => {
    let open = 0;
    const connect = async () => { open++; const b = fakeBackend(); return { ...b, close: async () => { open--; } }; };
    await runEval({ models: ["m"], conversations: [conversationB(COFFEE!)], runs: 2, chatFor: () => async () => { throw new ChatError("down"); }, connect });
    expect(open).toBe(0);
  });

  it("puts the numbers in the report", async () => {
    const results = await runEval({
      models: ["keeps", "mixes"], conversations: [conversationA(NAVY!), conversationB(NAVY!), conversationA(OCEAN!), conversationB(OCEAN!)], runs: 1,
      chatFor: (m) => scripted(m === "keeps" ? "keeper" : "mixed"),
      connect: async () => fakeBackend(),
    });
    const md = report(results, { date: "2026-01-01 00:00 UTC", url: "stub", runs: 1, sets: ["navy-coral", "ocean"], descriptionVariant: "real", noteVariant: "short" });
    expect(md).toContain("| keeps | 2 | 100% (2/2) | 6 | 100% (6/6) | 100% (6/6) | 0% (0/6) | 0% (0/6) | 100% (2/2) | 0 of 10 |");
    expect(md).toMatch(/\| mixes \| 2 \| 100% \(2\/2\) \| 6 \| 67% \(4\/6\) \| 33% \(2\/6\) \| 33% \(2\/6\) \| 33% \(2\/6\) \| 100% \(2\/2\) \|/);
    expect(md).toContain("result note \"short\" variant");
    expect(md).toContain("colors description as the server writes it");
    expect(md).toContain("| keeps | 2 | 8 | 0% (0/8) | 0 of 8 |");
    expect(md).toContain("| mixes | 2 | 8 | 0% (0/8) | 0 of 8 |");
  });

  it("lists conversations that ended early", async () => {
    const results = await runEval({ models: ["m"], conversations: [conversationA(COFFEE!)], runs: 1, limits: { maxRequests: 2 }, chatFor: () => scripted("keeper"), connect: async () => fakeBackend() });
    const md = report(results, { date: "d", url: "u", runs: 1, sets: ["coffee"], descriptionVariant: "real", noteVariant: "real" });
    expect(md).toContain("Conversations that ended before their last message");
    expect(md).toContain("m, A:coffee, run 1: 2 model requests in one conversation");
  });

  it("adds up cost when prices are known", () => {
    const r = { model: "m", kind: "A", usage: { promptTokens: 1000, completionTokens: 500 }, estimated: false, requests: 1, calls: [], turns: [] } as unknown as ConversationResult;
    const md = report([r, r], { date: "d", url: "u", runs: 1, sets: [], descriptionVariant: "real", noteVariant: "real", cost: (_m, u) => (u.promptTokens! * 2 + u.completionTokens! * 4) / 1e6 });
    expect(md).toMatch(/\| m \| 2 \| 2 \| 2,000 \| \? \| 1,000 \| \$0\.0080 \| 0 \|/);
  });
});

describe("the chat client", () => {
  const ok = (message: unknown, usage?: unknown) => new Response(JSON.stringify({ choices: [{ message }], usage }), { status: 200 });

  it("sends the tools, the system message marked for caching and the key, and reads the tool calls and usage", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const chat = openAiChat({
      url: "https://example.test/v1/", model: "vendor/model", apiKey: "sk-secret", cache: true,
      fetch: async (url, init) => { seen.push({ url: String(url), init: init! }); return ok({ role: "assistant", content: null, reasoning_details: [{ x: 1 }], tool_calls: [{ id: "c1", type: "function", function: { name: "show_interface", arguments: "{}" } }] }, { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 } }); },
    });
    const tools = [{ type: "function" as const, function: { name: "show_interface", description: "d", parameters: { type: "object" } } }];
    const reply = await chat([{ role: "system", content: "sys" }, { role: "user", content: "hi" }], tools);
    const body = JSON.parse(seen[0]!.init.body as string) as { model: string; tools: unknown[]; messages: Array<{ role: string; content: unknown }>; max_tokens: number };
    expect(seen[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect(body.model).toBe("vendor/model");
    expect(body.tools).toEqual(tools);
    expect(body.max_tokens).toBe(8000);
    expect(body.messages[0]!.content).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(reply.message.tool_calls![0]!.function.name).toBe("show_interface");
    // What the server sent beyond the standard fields goes back with the next request.
    expect(reply.message.reasoning_details).toEqual([{ x: 1 }]);
    expect(reply.usage).toEqual({ promptTokens: 100, completionTokens: 20, cachedTokens: 80, cacheWriteTokens: 5 });
  });

  it("leaves usage unknown when the server sends none", () => {
    expect(usageOf(undefined)).toEqual({});
    expect(usageOf({ completion_tokens: 3 })).toEqual({ completionTokens: 3 });
  });

  it("tries again after a 429 or a 5xx, then gives up", async () => {
    let n = 0;
    const chat = openAiChat({ url: "u", model: "m", retryDelays: [0, 0], fetch: async () => (++n < 3 ? new Response("{}", { status: n === 1 ? 429 : 503 }) : ok({ role: "assistant", content: "hi" })) });
    expect((await chat([], [])).message.content).toBe("hi");
    expect(n).toBe(3);
    n = 0;
    const down = openAiChat({ url: "u", model: "m", retryDelays: [0], fetch: async () => { n++; return new Response("{}", { status: 500 }); } });
    await expect(down([], [])).rejects.toThrow(/HTTP 500/);
    expect(n).toBe(2);
  });

  it("does not retry a refusal, and never puts the key in the error", async () => {
    let n = 0;
    const chat = openAiChat({ url: "u", model: "m", apiKey: "sk-secret", retryDelays: [0, 0], fetch: async () => { n++; return new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }); } });
    const error = await chat([], []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect((error as ChatError).message).toBe("The model server reported an error (HTTP 401): Invalid API key");
    expect((error as ChatError).message).not.toContain("sk-secret");
    expect(n).toBe(1);
  });

  it("says when the server cannot be reached", async () => {
    const chat = openAiChat({ url: "http://nowhere.test/v1", model: "m", retryDelays: [], fetch: async () => { throw new Error("connect ECONNREFUSED"); } });
    await expect(chat([], [])).rejects.toThrow("The model server could not be reached at http://nowhere.test/v1: connect ECONNREFUSED");
  });
});

describe("the scripted model over HTTP", () => {
  it("answers the chat client with tool calls, then words, and a whole conversation runs through it", async () => {
    const stub = await startStub("keeper");
    try {
      // Short retry delays: the real 2 s and 6 s would turn one dropped connection into a timeout instead of an answer.
      const chat = openAiChat({ url: stub.url, model: "stub", retryDelays: [20, 20] });
      const first = await chat([{ role: "user", content: "Make a funnel. Use #0b6e4f." }], []);
      expect(first.message.tool_calls![0]!.function.name).toBe("sayshape_docs");
      expect(first.usage.promptTokens).toBeGreaterThan(0);
      const r = await runConversation(conversationA(NAVY!), { model: "stub", run: 1, chat, backend: fakeBackend() });
      expect(tallyOf([r])).toMatchObject({ askSame: 1, laterSame: 3, resetNone: 1 });
      expect(r.estimated).toBe(false);
      await expect(chat([], [])).resolves.toBeDefined();
    } finally {
      await stub.close();
    }
  });

  it("builds replies for each behavior", () => {
    const messages: Message[] = [{ role: "user", content: "Show a table. Use #0b6e4f and #f4b942." }];
    for (const b of ["keeper", "forgetter", "inventor", "plain", "mixed"] as const) {
      const reply = stubReply(b, { messages }) as { choices: Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }> };
      const args = JSON.parse(reply.choices[0]!.message.tool_calls[0]!.function.arguments) as { colors?: string[] };
      expect(args.colors !== undefined).toBe(b !== "plain");
    }
  });
});
