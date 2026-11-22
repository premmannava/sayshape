/**
 * Warnings about the data an interface shows reach show_interface's result:
 * a chart with no numbers, values a total couldn't read. They don't hold the
 * interface back: toFix stays 0 and the view still draws.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { createServer, DATA_LEAD, dataProblems } from "../src/server";

async function connect() {
  const server = createServer({ uiHtml: () => "<!doctype html><title>view</title>" });
  const client = new Client({ name: "test", version: "1.0.0" }, UI_CLIENT);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const SPEC = `state t=[{p: "A", v: 5}, {p: "B", v: "lots"}]
card
  text "Total {sum(t, 'v')}"
  chart kind=bar items=t x=p y=v
`;

describe("data warnings in show_interface", () => {
  it("dataProblems draws the spec and returns its data warnings, on their lines", () => {
    expect(dataProblems(SPEC).map((d) => `${d.line} ${d.severity}: ${d.message}`)).toEqual([
      '3 warning: 1 of 2 "v" values isn\'t a number',
      '4 warning: 1 of 2 "v" values isn\'t a number, so the chart leaves it out',
    ]);
    expect(dataProblems("card\n  text \"Hi\"\n")).toEqual([]);
  });

  it("are in the result's text and diagnostics, and nothing needs fixing first", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: SPEC } });
    const text = (r.content as Array<{ text?: string }>)[0]!.text!;
    expect(text).toContain(DATA_LEAD);
    expect(text).toContain('line 3 (warning): 1 of 2 "v" values isn\'t a number');
    const sc = r.structuredContent as { toFix: number; warnings: number; diagnostics: Array<{ line: number; message: string }> };
    expect(sc.toFix).toBe(0);
    expect(sc.warnings).toBe(2);
    expect(sc.diagnostics.map((d) => d.line)).toEqual([3, 4]);
  });

  it("say nothing when the data is clean", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: SPEC.replace('"lots"', "7") } });
    expect((r.content as Array<{ text?: string }>)[0]!.text!).not.toContain(DATA_LEAD);
  });
});
