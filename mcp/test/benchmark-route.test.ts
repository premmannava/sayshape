import { describe, expect, it } from "vitest";
import { askMcp } from "../../eval/compare/mcp-route";

/** A model that looks up docs, shows an interface, then says it's done: what a good chat model does. */
function scriptedModel() {
  const seen: Array<{ tools: Array<{ function: { name: string; description: string } }>; messages: Array<{ role: string; content: unknown }> }> = [];
  const replies = [
    { tool_calls: [{ id: "c1", type: "function", function: { name: "sayshape_docs", arguments: JSON.stringify({ elements: ["stat"] }) } }] },
    { tool_calls: [{ id: "c2", type: "function", function: { name: "show_interface", arguments: JSON.stringify({ spec: '```\nstat label="Revenue" value="$1.24M"\n```' }) } }] },
    { content: "Here are your figures." },
  ];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(init.body as string) as (typeof seen)[number]);
    const message = replies[seen.length - 1] ?? { content: "done" };
    return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } }), { status: 200 });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("the benchmark's MCP route", () => {
  it("offers the server's own tools, runs each call on the real server, and adds up every turn", async () => {
    const { seen, fetchImpl } = scriptedModel();
    const a = await askMcp("Show revenue of $1.24M", { url: "http://model.test/v1", model: "fake" }, fetchImpl);
    expect(a.output).toBe('stat label="Revenue" value="$1.24M"');
    expect([a.turns, a.docsCalls, a.showCalls]).toEqual([3, 1, 1]);
    expect(a.usage).toEqual({ promptTokens: 3000, completionTokens: 150, cachedTokens: 2400 });
    expect(seen[0]!.tools.map((t) => t.function.name).sort()).toEqual(["sayshape_docs", "show_interface"]);
    expect(seen[0]!.tools.find((t) => t.function.name === "show_interface")!.function.description).toMatch(/QUICK START/);
    expect(String(seen[0]!.messages[0]!.content)).toMatch(/show_interface/);
    // The docs the server returned, and its check of the spec, went back to the model.
    const toolText = seen[2]!.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(toolText[0]).toMatch(/stat/);
    expect(toolText).toHaveLength(2);
  });
});
