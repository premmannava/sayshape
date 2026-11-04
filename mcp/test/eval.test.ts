import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { chatTools, mistakeOf, report, runCase, summarize, type ChatFn, type ChatReply } from "../src/eval";

async function connect() {
  const server = createServer({ uiHtml: () => "<!doctype html><title>view</title>" });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

/** A pretend model that plays back its turns, and records what it was sent. */
function scripted(turns: ChatReply[]): ChatFn & { seen: unknown[][] } {
  let i = 0;
  const fn = (async (messages: Parameters<ChatFn>[0]) => {
    fn.seen.push(structuredClone(messages));
    return turns[i++] ?? { text: "Done.", toolCalls: [] };
  }) as unknown as ChatFn & { seen: unknown[][] };
  fn.seen = [];
  return fn;
}

const call = (name: string, args: unknown, id = name): ChatReply => ({
  text: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }], promptTokens: 100, completionTokens: 20,
});
const GOOD = `card\n  text "Sales" style=title\n  stat label="Revenue" value="$1,200"\n`;
const BROKEN = `card\n  sparkle "nope"\n  text "Sales"\n`;

describe("the MCP evaluation", () => {
  it("offers the model the server's tools, not the view-only ones", async () => {
    const names = (await chatTools(await connect())).map((t) => t.function.name).sort();
    expect(names).toEqual(["sayshape_docs", "show_interface"]);
  });

  it("runs a request until the model answers in text, with the server's instructions", async () => {
    const chat = scripted([call("sayshape_docs", { elements: ["stat"] }), call("show_interface", { spec: GOOD }), { text: "Here it is.", toolCalls: [] }]);
    const r = await runCase({ client: await connect(), chat, id: "dash", request: "A sales dashboard" });
    expect(r).toMatchObject({ docsCalls: 1, turns: 3, finalText: "Here it is.", promptTokens: 200, completionTokens: 40 });
    expect(r.shows).toEqual([{ toFix: 0, repeat: false, problems: [], refused: false }]);
    const first = chat.seen[0] as Array<{ role: string; content: string }>;
    expect(first[0]!.role).toBe("system");
    expect(first[0]!.content).toMatch(/show_interface/);
    expect(first[1]).toEqual({ role: "user", content: "A sales dashboard" });
    // The model reads the tool's result before its next turn.
    const last = chat.seen[2] as Array<{ role: string; content: string }>;
    expect(last.at(-1)!.role).toBe("tool");
    expect(last.at(-1)!.content).toMatch(/no problems/);
  });

  it("records a retry, its problems, and a repeat", async () => {
    const chat = scripted([call("show_interface", { spec: BROKEN }, "a"), call("show_interface", { spec: GOOD }, "b"), call("show_interface", { spec: GOOD }, "c")]);
    const r = await runCase({ client: await connect(), chat, id: "retry", request: "x" });
    expect(r.shows.map((s) => [s.toFix, s.repeat])).toEqual([[1, false], [0, false], [0, true]]);
    expect(r.shows[0]!.problems[0]).toMatch(/sparkle/);
  });

  it("stops after the turn limit and reports errors instead of throwing", async () => {
    const loop = scripted(Array.from({ length: 20 }, (_, i) => call("sayshape_docs", {}, `d${i}`)));
    expect((await runCase({ client: await connect(), chat: loop, id: "loop", request: "x", maxTurns: 3 })).turns).toBe(3);
    const failing: ChatFn = async () => { throw new Error("429 rate limited"); };
    expect((await runCase({ client: await connect(), chat: failing, id: "fail", request: "x" })).error).toBe("429 rate limited");
  });

  it("groups the same mistake on different names", () => {
    expect(mistakeOf(`Unknown element "sparkle". Did you mean "spacer"?`)).toBe(mistakeOf(`Unknown element "piechart". Did you mean "chart"?`));
    expect(mistakeOf(`line 12: value 40 is too big`)).toBe("line N: value N is too big");
  });

  it("summarizes first tries, retries and the top mistakes, and writes a report", async () => {
    const run = async (id: string, turns: ChatReply[]) => runCase({ client: await connect(), chat: scripted(turns), id, request: id });
    const results = [
      await run("a", [call("show_interface", { spec: GOOD })]),
      await run("b", [call("show_interface", { spec: BROKEN }), call("show_interface", { spec: GOOD })]),
      await run("c", [call("show_interface", { spec: BROKEN.replace("sparkle", "glitter") })]),
      await run("d", [{ text: "I can't draw that.", toolCalls: [] }]),
    ];
    const s = summarize(results);
    expect(s).toMatchObject({ cases: 4, showed: 3, firstTry: 1, endedClean: 2, extraShows: 1, repeats: 0 });
    expect(s.mistakes[0]).toMatchObject({ count: 2, cases: ["b", "c"] });
    const md = report("test-model", results);
    expect(md).toMatch(/Right the first time \| 1 of 3 \(33%\)/);
    expect(md).toMatch(/2×/);
  });
});
