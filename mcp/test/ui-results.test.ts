/**
 * Clients that announce MCP Apps get exactly the results they got before the
 * text-only fallback existed. test/fixtures/ui-results.json was recorded from
 * the server as it was then (when every client got these results); record it
 * again only for a change meant to reach MCP Apps clients too:
 *
 *   SAYSHAPE_RECORD=1 npx vitest run test/ui-results.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { McpResultStore } from "../src/mcp-results";
import { UI_CLIENT } from "./clients";

const FIXTURE = new URL("./fixtures/ui-results.json", import.meta.url);

const GOOD = 'state days=2\ncard\n  text "Weekend hike" style=title\n  stat label="Days" value={days}\n  button "Add day" on=inc:days\n';
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["good", { spec: GOOD, title: "Hike" }],
  ["repeat", { spec: GOOD, title: "Hike" }],
  ["to fix", { spec: 'card\n  txet "Typo"\n  button "Go" on=nope:x\n' }],
  ["ignored prop", { spec: 'card\n  text "Hi" colour=red\n' }],
  ["dataset", { spec: 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n', data: { sales: "m1" } }],
  ["script in a string", { spec: 'card\n  text "</script><script>alert(1)</script><!--"\n' }],
];

async function results(options: typeof UI_CLIENT | undefined) {
  const store = new McpResultStore();
  store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12000 }, { team: "East", revenue: 9000 }] } }, { label: "sales" });
  const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store, now: () => 1_000 });
  const client = new Client({ name: "test", version: "1.0.0" }, options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const out: Record<string, unknown> = {};
  for (const [name, args] of CALLS) out[name] = await client.callTool({ name: "show_interface", arguments: args });
  await client.close();
  return out;
}

describe("MCP Apps clients", () => {
  it("get byte-for-byte the results they got before the text-only fallback", async () => {
    if (process.env.SAYSHAPE_RECORD) {
      writeFileSync(FIXTURE, JSON.stringify(await results(UI_CLIENT), null, 2) + "\n");
      return;
    }
    const before = readFileSync(FIXTURE, "utf8");
    expect(JSON.stringify(await results(UI_CLIENT), null, 2) + "\n").toBe(before);
  });

  it("see the tools, the docs and emit: exactly as before: test/fixtures/ui-tools.json, recorded from main", async () => {
    const recorded = JSON.parse(readFileSync(new URL("./fixtures/ui-tools.json", import.meta.url), "utf8")) as Record<string, unknown>;
    const EMIT_SPEC = 'state n=1\ncard\n  text "Pick one" style=title\n  button "Plan this trip" on=set:n:2;emit:plan_trip:{n}\n  text "Read [the guide](https://example.com/guide)" rich=true\n';
    for (const [name, store] of [["plain", undefined], ["datasets", new McpResultStore()]] as const) {
      const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store });
      const client = new Client({ name: "test", version: "1.0.0" }, UI_CLIENT);
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      const now = { tools: (await client.listTools()).tools, docs: await client.callTool({ name: "sayshape_docs", arguments: {} }), emit: await client.callTool({ name: "show_interface", arguments: { spec: EMIT_SPEC } }) };
      expect(JSON.stringify(now, null, 2)).toBe(JSON.stringify(recorded[name], null, 2));
      await client.close();
    }
  });
});
