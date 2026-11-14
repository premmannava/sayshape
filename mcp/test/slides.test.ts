import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { checkSpec, createServer, quickStart, setSlides } from "../src/server";
import { decodeViewOptions, encodeViewOptions, parseViewArgs } from "../src/ui/view-options";

const SPEC = `state page=0
deck bind=page
  slide "Q3 business review" layout=title
    text "Revenue is up 18% on last year" style=lead tone=muted
  slide "What we do next"
    text "Hire two in support"`;

const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

async function show(capabilities: object): Promise<unknown> {
  const server = createServer({ uiHtml: () => "<html><head></head><body></body></html>" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, capabilities);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client.callTool({ name: "show_interface", arguments: { spec: SPEC } });
}

describe("slide decks in the MCP server", () => {
  afterEach(() => setSlides(false));

  it("are off unless --slides turned them on", () => {
    expect(checkSpec(SPEC).errors[0]?.message).toMatch(/Unknown element "deck"/);
    expect(quickStart()).not.toMatch(/\bdeck\b/);
  });

  it("parse cleanly and are in the quick start when on", async () => {
    setSlides(true);
    const c = checkSpec(SPEC);
    expect([...c.errors, ...c.warnings]).toEqual([]);
    expect(quickStart()).toMatch(/deck bind=page/);
    expect(quickStart()).toMatch(/A PRESENTATION/);
    const r = await show(UI_CLIENT);
    expect((r as { structuredContent: { toFix: number } }).structuredContent.toFix).toBe(0);
  });

  it("give a text-only client a plain sentence, not a page that can't draw a deck", async () => {
    setSlides(true);
    const said = textOf(await show({}));
    expect(said).toMatch(/can't show slide decks yet/);
    expect(said).not.toMatch(/<html|<script/i);
  });

  it("take a logo for every slide, and allow its host like any image host", () => {
    const view = parseViewArgs(["--slides", "--image-hosts", "cdn.example.com", "--logo", "https://brand.example.com/logo.png?v=2"]);
    expect(view.logo).toBe("https://brand.example.com/logo.png?v=2");
    expect(view.imageHosts).toEqual(["cdn.example.com", "brand.example.com"]);
    const back = decodeViewOptions(encodeViewOptions(view));
    expect(back.logo).toBe(view.logo);
    expect(back.imageHosts).toEqual(view.imageHosts);
    // Only https, with a plain host: anything else is refused in plain words.
    for (const bad of ["http://brand.example.com/logo.png", "logo.png", "https://user:pw@brand.example.com/x.png", "javascript:alert(1)"]) {
      expect(() => parseViewArgs(["--logo", bad])).toThrow(/--logo needs the https address of an image/);
    }
    expect(() => parseViewArgs(["--logo"])).toThrow(/--logo needs/);
    // A logo whose host isn't allowed is dropped, as the engine would refuse it anyway.
    expect(decodeViewOptions("slides=1&logo=https%3A%2F%2Fother.example.com%2Fa.png&images=cdn.example.com").logo).toBeUndefined();
    expect(parseViewArgs([]).logo).toBeUndefined();
  });

  it("reach the view through its options", () => {
    const view = parseViewArgs(["--slides"]);
    expect(view.slides).toBe(true);
    expect(decodeViewOptions(encodeViewOptions(view)).slides).toBe(true);
    expect(decodeViewOptions(encodeViewOptions(parseViewArgs([]))).slides).toBeUndefined();
    expect(encodeViewOptions(parseViewArgs([]))).not.toMatch(/slides/);
  });
});
