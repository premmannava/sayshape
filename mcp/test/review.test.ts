import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { createServer, checkSpec } from "../src/server";

const NESTED = `text "October expenses" style=title
card
  text "Budget" weight=semibold
  meter "Spent" value=860 max=1200
  card
    text "Groceries"`;

const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

describe("layout review in the MCP server", () => {
  it("sends a card inside a card back to tidy, without holding the interface back", async () => {
    const c = checkSpec(NESTED);
    expect(c.errors).toEqual([]);
    expect(c.warnings).toEqual([]);
    expect(c.drawing.map((d) => d.line)).toEqual([5]);

    const server = createServer({ uiHtml: () => "<html><head></head><body></body></html>" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" }, UI_CLIENT);
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "show_interface", arguments: { spec: NESTED } });
    expect(textOf(r)).toMatch(/^The interface is showing, but its drawing has problems the person can see/);
    expect(textOf(r)).toMatch(/line 5: card inside a card; use a column or divider instead/);
    expect((r as unknown as { structuredContent: { toFix: number } }).structuredContent.toFix).toBe(0);
  });
});
