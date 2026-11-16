/**
 * --layout-first: the model is told to write the layout first and the data
 * last, so the view draws from the first element. Off by default, and then
 * everything the server says is what it was (test/ui-results.test.ts holds
 * the recorded fixtures for that).
 */
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UI_CLIENT } from "./clients";
import { createServer, docsText, guideText, quickStart, setLayoutFirst } from "../src/server";

const OLD = /^- State first, unindented, every value on one line:.*\n/m;
const NEW = /^- Elements first \(they draw as you write\), then unindented state at the end.*\n/m;

const LAYOUT_FIRST = `card
  text "Trails" style=title
  each items=trails as=t
    text "{t.name}: {t.miles} mi"
state trails=[{name: "Camelback", miles: 2.5}, {name: "Piestewa", miles: 2.1}]
`;

async function connect() {
  const server = createServer({ uiHtml: () => "<!doctype html>" });
  const client = new Client({ name: "test", version: "1.0.0" }, UI_CLIENT);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: Record<string, unknown>) => ((r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "");

afterEach(() => setLayoutFirst(false));

describe("--layout-first", () => {
  it("is off by default: the quick start says state first, and turning it on and off again restores everything", () => {
    const before = { quick: quickStart(), data: quickStart(true, true), text: quickStart(false, false, true), guide: guideText(), docs: docsText(["chart"], ["rules", "examples", "lists"]) };
    expect(before.quick).toMatch(OLD);
    expect(before.quick).not.toMatch(NEW);
    setLayoutFirst(true);
    expect(quickStart()).not.toBe(before.quick);
    setLayoutFirst(false);
    expect({ quick: quickStart(), data: quickStart(true, true), text: quickStart(false, false, true), guide: guideText(), docs: docsText(["chart"], ["rules", "examples", "lists"]) }).toEqual(before);
  });

  it("changes the quick start and the full guide by one line, and nothing else", () => {
    const quick = quickStart();
    const guide = guideText();
    setLayoutFirst(true);
    expect(quickStart()).toMatch(NEW);
    expect(quickStart()).not.toMatch(OLD);
    expect(quickStart().replace(NEW, "")).toBe(quick.replace(OLD, ""));
    expect(quickStart().length - quick.length).toBeLessThan(160);
    expect(guideText()).not.toMatch(/Declare state first/);
    expect(guideText()).toMatch(/Write elements first so they draw as you write/);
    expect(docsText(["chart"], ["lists"])).toBe((setLayoutFirst(false), docsText(["chart"], ["lists"])));
  });

  it("reaches models through show_interface's description and sayshape_docs", async () => {
    setLayoutFirst(true);
    const client = await connect();
    const tool = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(tool.description).toMatch(NEW);
    expect(tool.description).not.toMatch(OLD);
    expect(text(await client.callTool({ name: "sayshape_docs", arguments: {} }))).toMatch(NEW);
  });

  it("accepts a layout-first spec with no problems, and answers as for any other", async () => {
    setLayoutFirst(true);
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: LAYOUT_FIRST } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/with no problems/);
  });
});
