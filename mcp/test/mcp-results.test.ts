import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { MAX_ROWS, MAX_VALUES } from "../src/data";
import {
  MAX_MCP_CELL_CHARS, MAX_MCP_COLUMNS, McpResultError,
  McpResultStore, listMcpDatasets, normalizeMcpResult,
} from "../src/mcp-results";

describe("MCP result normalization", () => {
  it("reads structuredContent records, preserving numeric columns and useful nested fields", () => {
    const r = normalizeMcpResult({ structuredContent: { data: { items: [
      { number: 42, title: "Refine charts", author: { login: "ada" }, checks: 3, draft: false },
      { number: 43, title: "Build adapter", author: { login: "lin" }, checks: 5, draft: true },
    ], total: 100 } } });
    expect(r.rows).toEqual([
      { number: 42, title: "Refine charts", author_login: "ada", checks: 3, draft: false },
      { number: 43, title: "Build adapter", author_login: "lin", checks: 5, draft: true },
    ]);
    expect(r.columns).toContainEqual({ name: "checks", type: "number" });
    expect(r.columns).toContainEqual({ name: "draft", type: "boolean" });
    expect(r.truncated).toBe(false);
  });

  it("reads MCP JSON text when structuredContent is missing", () => {
    const result = { content: [{ type: "text", text: "Here are the results." },
      { type: "text", text: JSON.stringify({ results: [{ team: "West", revenue: 12500 }] }) }] };
    expect(normalizeMcpResult(result).rows).toEqual([{ team: "West", revenue: 12500 }]);
  });

  it("accepts scalars and an individual object as a one-row dataset", () => {
    expect(normalizeMcpResult({ status: "healthy", requests: 7 }).rows).toEqual([{ status: "healthy", requests: 7 }]);
    expect(normalizeMcpResult([3, 5, 9]).rows).toEqual([{ value: 3 }, { value: 5 }, { value: 9 }]);
  });

  it("requires an explicit path when multiple arrays are possible", () => {
    const v = { structuredContent: { issues: [{ id: 1 }], comments: [{ id: 2 }] } };
    expect(() => normalizeMcpResult(v)).toThrow(/Multiple record lists/);
    expect(normalizeMcpResult(v, { path: "issues" }).rows).toEqual([{ id: 1 }]);
    expect(() => normalizeMcpResult(v, { path: "missing" })).toThrow(/No records at path/);
    expect(() => normalizeMcpResult(v, { path: "__proto__" })).toThrow(/Invalid path/);
  });

  it("accepts GraphQL-style node edges and reports missing values as null", () => {
    const v = { structuredContent: { edges: [
      { cursor: "a", node: { id: 1, amount: 22 } },
      { cursor: "b", node: { id: 2 } },
    ] } };
    expect(normalizeMcpResult(v).rows).toEqual([{ id: 1, amount: 22 }, { id: 2, amount: null }]);
  });

  it("normalizes hostile keys, collisions and oversized strings without prototype pollution", () => {
    const dangerous = JSON.parse('{"__proto__":{"polluted":true},"constructor":"oops","first name":"Ada","first-name":"Lin","9count":3,"huge":"' + "x".repeat(900) + '"}');
    const r = normalizeMcpResult({ structuredContent: { rows: [dangerous] } });
    expect(r.rows[0]).toMatchObject({ first_name: "Ada", first_name_2: "Lin", field_9count: 3 });
    expect(r.rows[0]).not.toHaveProperty("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(String(r.rows[0]!.huge).length).toBe(MAX_MCP_CELL_CHARS);
    expect(r.truncated).toBe(true);
  });

  it("caps row count, column count and the engine's 9000 value limit", () => {
    const many = normalizeMcpResult({ rows: Array.from({ length: MAX_ROWS + 30 }, (_, i) => ({ id: i })) });
    expect(many.rows).toHaveLength(MAX_ROWS);
    expect(many.truncated).toBe(true);
    const wideRows = Array.from({ length: MAX_ROWS }, (_, i) =>
      Object.fromEntries(Array.from({ length: MAX_MCP_COLUMNS + 9 }, (_, j) => ["col" + j, i * j])));
    const wide = normalizeMcpResult({ records: wideRows });
    expect(wide.columns).toHaveLength(MAX_MCP_COLUMNS);
    expect(wide.rows.length * wide.columns.length).toBeLessThanOrEqual(MAX_VALUES);
    expect(wide.truncated).toBe(true);
  });

  it("rejects unsupported inputs and failed upstream calls", () => {
    for (const value of [null, "plain text", { isError: true, content: [] }, { content: [{ type: "text", text: "not-json" }] }]) {
      expect(() => normalizeMcpResult(value)).toThrow(McpResultError);
    }
  });
});

describe("scoped MCP datasets over the existing app-only protocol", () => {
  async function connect(store: McpResultStore) {
    const server = createServer({ uiHtml: () => "<!doctype html>", mcpResults: store });
    const client = new Client({ name: "dataset-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, server };
  }
  const text = (r: Record<string, unknown>) => (r.content as Array<{ text?: string }>)[0]?.text ?? "";

  it("exposes a list tool and app-only fetch, but no database SQL tools", async () => {
    const store = new McpResultStore();
    const dataset = store.ingest({ structuredContent: { items: [{ team: "West", revenue: 12000 }, { team: "East", revenue: 9000 }] } }, { label: "sales query" });
    const { client, server } = await connect(store);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["fetch_dataset", "list_datasets", "sayshape_docs", "show_interface"]);
    expect((tools.find((t) => t.name === "fetch_dataset")!._meta as { ui: { visibility: string[] } }).ui.visibility).toEqual(["app"]);
    const listing = text(await client.callTool({ name: "list_datasets", arguments: {} }));
    expect(listing).toContain("m1 (sales query)");
    expect(listing).toContain("revenue number");
    expect(listing).not.toContain("12000");

    const spec = 'card\n  chart "Sales" kind=bar items=sales x=team y=revenue\n  table items=sales key=team\n    table-column "Team" field=team\n    table-column "Revenue" field=revenue format=number\n';
    const shown = await client.callTool({ name: "show_interface", arguments: { spec, data: { sales: dataset.id } } });
    expect(shown.isError).toBeFalsy();
    expect(text(shown)).toContain("no problems");
    expect(text(shown)).not.toContain("12000");
    const fetched = await client.callTool({ name: "fetch_dataset", arguments: { id: dataset.id } });
    expect((fetched.structuredContent as { rows: unknown[] }).rows).toEqual(dataset.rows);
    expect((fetched.structuredContent as { rows: unknown[] }).rows).toHaveLength(2);
    await client.close();
    await server.close();
  });

  it("does not leak references between independent per-session stores", async () => {
    const a = new McpResultStore(), b = new McpResultStore();
    a.ingest([{ id: 1, secret: "session A" }]);
    const { client, server } = await connect(b);
    const r = await client.callTool({ name: "fetch_dataset", arguments: { id: "m1" } });
    expect(r.isError).toBe(true);
    expect(listMcpDatasets(b)).toMatch(/No MCP datasets loaded/);
    await client.close();
    await server.close();
  });

  it("evicts old datasets and never reuses references", () => {
    const store = new McpResultStore();
    for (let i = 0; i < 102; i++) store.ingest([{ i }]);
    expect(store.get("m1")).toBeUndefined();
    expect(store.get("m2")).toBeUndefined();
    expect(store.get("m3")?.rows[0]).toEqual({ i: 2 });
    expect(store.get("m102")?.rows[0]).toEqual({ i: 101 });
  });
});
