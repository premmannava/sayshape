/**
 * The live smoke test's pure parts (eval/adaptive/smoke.ts): reading Claude
 * Code's stream, and judging what was shown. No model runs here.
 */
import { describe, expect, it } from "vitest";
import { checkOutcome, readStream, SMOKE_REQUESTS } from "../eval/adaptive/smoke";

const REPORT = `report "Revenue" data=sales filter=region
  sum amount
  bar month amount
state sales=[{month: "Jan", region: "West", amount: 1200}, {month: "Jan", region: "East", amount: 800}, {month: "Feb", region: "West", amount: 1500}, {month: "Feb", region: "East", amount: 600}, {month: "Mar", region: "West", amount: 900}, {month: "Mar", region: "East", amount: 1100}]
`;
const SCENE = `state bx=100 by=150 running=true
every 100ms if={running} do="set:bx:{bx >= 560 ? 40 : bx + 10}"
scene "A ball rolling across" w=600 h=300
  circle x={bx} y={by} r=20 fill=accent drag=true name="Ball"
button "{running ? 'Pause' : 'Play'}" on=toggle:running
`;

describe("the requests", () => {
  it("are plain words: no route, capability or SayShape name", () => {
    for (const r of SMOKE_REQUESTS) {
      expect(r.prompt).not.toMatch(/report|capabilit|sayshape|docs|scene|preset|forms|USE:/i);
      expect(r.flags.includes("--adaptive-guides")).toBe(false);
    }
  });
});

describe("reading Claude Code's stream", () => {
  const stream = [
    "not json",
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", name: "mcp__sayshape__sayshape_docs", input: { topics: ["forms"] } }], usage: { input_tokens: 10, output_tokens: 5 } } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }),
    JSON.stringify({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "Here" }], usage: { input_tokens: 20, output_tokens: 1 } } }),
    JSON.stringify({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", name: "mcp__sayshape__show_interface", input: { spec: REPORT } }], usage: { input_tokens: 20, output_tokens: 90 } } }),
    JSON.stringify({ type: "result", subtype: "success", duration_ms: 4200, num_turns: 3, total_cost_usd: 0.01, usage: { input_tokens: 40, cache_creation_input_tokens: 3000, cache_read_input_tokens: 9000, output_tokens: 120 }, modelUsage: { "claude-haiku": {} } }),
  ].join("\n");

  it("counts model calls by message, and keeps every tool call and the last spec", () => {
    const r = readStream(stream);
    expect(r.modelCalls).toBe(2);
    expect(r.toolCalls.map((c) => c.name)).toEqual(["sayshape_docs", "show_interface"]);
    expect(r.toolCalls[0]!.input).toEqual({ topics: ["forms"] });
    expect(r.spec).toBe(REPORT);
    expect(r.usage).toEqual({ input: 40, cacheCreation: 3000, cacheRead: 9000, output: 120 });
    expect(r).toMatchObject({ durationMs: 4200, numTurns: 3, costUsd: 0.01 });
    expect(Object.keys(r.modelUsage!)).toEqual(["claude-haiku"]);
  });

  it("adds up the messages when the run was cut off before its result", () => {
    const r = readStream(stream.split("\n").slice(0, -1).join("\n"));
    expect(r.usage.input).toBe(30);
    expect(r.usage.output).toBe(95);
  });
});

describe("judging what was shown", () => {
  it("a report works when it draws a chart, a filter and the total", () => {
    expect(checkOutcome("report", REPORT)).toEqual({ ok: true, notes: [] });
    const dropped = checkOutcome("report", REPORT.replace("bar month amount", "bar month visitors"));
    expect(dropped.ok).toBe(false);
    expect(dropped.notes.join()).toMatch(/This bar chart isn't shown/);
    expect(dropped.notes).toContain("no chart is drawn");
    expect(checkOutcome("report", undefined)).toEqual({ ok: false, notes: ["nothing was shown"] });
  });

  it("a scene works when it moves by itself, can be dragged, and a button stops it", () => {
    expect(checkOutcome("scene", SCENE)).toEqual({ ok: true, notes: [] });
    expect(checkOutcome("scene", SCENE.replace(/^button .*\n/m, "")).notes).toContain("no button stops it");
    expect(checkOutcome("scene", SCENE.replace(" drag=true", "")).notes).toContain("no shape has drag=true");
  });
});
