import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, checkSpec, setScenes } from "../src/server";

const SPEC = `scene "Outage" w=600 h=300
  line x1=230 y1=150 x2=470 y2=150 stroke=line width=3
  rect x=300 y=125 w=100 h=50 fill=surface
  rect x=470 y=125 w=100 h=50 fill=surface
  label "Orders" x=350 y=150 size=16 align=center fill=ink`;

const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

describe("scenes in the MCP server", () => {
  afterEach(() => setScenes(false));

  it("are off unless --scene turned them on", () => {
    const c = checkSpec(SPEC);
    expect(c.errors[0]?.message).toMatch(/Unknown element "scene"/);
    expect(c.drawing).toEqual([]);
  });

  it("report drawing problems separately, without holding the interface back", async () => {
    setScenes(true);
    const c = checkSpec(SPEC);
    expect(c.errors).toEqual([]);
    expect(c.drawing.map((d) => d.line)).toEqual([2]);

    const server = createServer({ uiHtml: () => "<html><head></head><body></body></html>" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "show_interface", arguments: { spec: SPEC } });
    expect(textOf(r)).toMatch(/^The interface is showing, but its drawing has problems the person can see/);
    expect(textOf(r)).toMatch(/line 2: this line runs under the rect on line 3/);
    expect((r as unknown as { structuredContent: { toFix: number } }).structuredContent.toFix).toBe(0);
  });
});
