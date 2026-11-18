import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { fallbackPage } from "../src/fallback";
import { widgetFragment, type WidgetOptions } from "../src/widget-file";
import type { PackedEngine } from "../src/widget-engine";
import { adapterSource } from "../src/widget-hosts";
import { UI_CLIENT } from "./clients";

/**
 * Text outside ASCII must reach the screen as it was written, whatever path the interface takes and
 * whatever encoding the frame around it reads with. A widget file is a fragment with no <head>, so a
 * chat app's frame may well read it as windows-1252: then any UTF-8 byte in it (in the spec, or in the
 * engine's own "−", "…" and "—") turns into "âˆ’", "â€¦" and "â€”".
 */
const STRANGE = "— – − … é ñ ü É ß 中文 😀 ★";
const SPEC = `card\n  text "Prices — €12 – €15 … café, niño, über, École, Straße, 中文 😀"\n  stat label="Change ${STRANGE}" value="−5"\n`;

/** windows-1252 is a superset of latin1 for these purposes: every byte ≥ 0x80 decodes to something else. */
const asLatin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1");
const nonAscii = (s: string) => [...new Set(s.match(/[^\x00-\x7f]/gu) ?? [])].join("");
/** The spec the loader passes to setSpec: the JSON after `var spec =`. */
const specIn = (html: string) => JSON.parse(/var spec = (.*);\n/.exec(html)![1]!) as string;

// The real engine, built the way `npm run build` builds it, so its own characters are checked too
// (CI runs these tests without a build).
let engine: PackedEngine;
let built = "";
beforeAll(async () => {
  built = await mkdtemp(join(tmpdir(), "sayshape-engine-"));
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/pack-widget-engine.mjs", import.meta.url)), built], { stdio: "pipe" });
  engine = JSON.parse(await readFile(join(built, "widget-engine.json"), "utf8")) as PackedEngine;
}, 180_000);
afterAll(async () => { if (built) await rm(built, { recursive: true, force: true }); });

describe("text outside ASCII on every output path", () => {
  const variants: Array<[string, () => WidgetOptions]> = [
    ["widget file", () => ({ spec: SPEC, engine })],
    ["inline widget file", () => ({ spec: SPEC, engine, inline: true })],
    ["Muse widget file", () => ({ spec: SPEC, engine, host: adapterSource("muse") })],
    ["inline Muse widget file", () => ({ spec: SPEC, engine, inline: true, host: adapterSource("muse") })],
  ];
  it.each(variants)("%s: is plain ASCII, so the frame's encoding can't change it, and the spec round-trips", (_name, opts) => {
    const html = widgetFragment(opts());
    expect(nonAscii(html)).toBe("");
    expect(specIn(html)).toBe(SPEC);
    // Read as windows-1252 / latin1, as a frame without a charset might: still the same spec.
    expect(specIn(asLatin1(html))).toBe(SPEC);
  });

  it("widget file: the packed engine is ASCII outside a few regular expressions, and its blob: script says it's UTF-8", () => {
    // esbuild's ascii charset escapes everything but characters in regular expressions; the blob says UTF-8 for those.
    for (const s of [engine.engine, engine.map]) {
      const code = gunzipSync(Buffer.from(s.base64, "base64")).toString("utf8");
      expect(nonAscii(code)).toMatch(/^[€£¥’−]*$/u);
      expect(code).not.toMatch(/[—…▲▼★⋯]/u);
    }
    expect(widgetFragment({ spec: SPEC, engine })).toMatch(/type: "text\/javascript;charset=utf-8"/);
  });

  it("HTML fallback page: declares UTF-8 in its first 1024 bytes, and the spec round-trips", () => {
    const html = fallbackPage({ spec: SPEC });
    expect(Buffer.from(html, "utf8").subarray(0, 1024).toString("latin1")).toMatch(/<meta charset="utf-8">/i);
    expect(html).toContain(JSON.stringify(SPEC).slice(1, 20));
  });

  describe("through the server", () => {
    let dir = "";
    beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "sayshape-encoding-")); });
    afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
    type Result = { content: Array<{ type: string; text: string }>; structuredContent?: { spec?: string } };
    async function show(client: ConstructorParameters<typeof Client>[1], extra: Record<string, unknown> = {}): Promise<Result> {
      const server = createServer({ uiHtml: () => "<!doctype html>", widgetEngine: async () => engine, ...extra });
      const c = new Client({ name: "client", version: "1.0.0" }, client);
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), c.connect(b)]);
      return (await c.callTool({ name: "show_interface", arguments: { spec: SPEC, title: `Title ${STRANGE}` } })) as unknown as Result;
    }

    it("MCP view: the view page declares UTF-8, and nothing in the result is garbled", async () => {
      const page = await readFile(new URL("../src/ui/index.html", import.meta.url), "utf8");
      expect(page.slice(0, 1024)).toMatch(/<meta charset="utf-8"/i);
      const r = await show(UI_CLIENT);
      // The view reads the spec from the tool's own arguments (JSON, UTF-8); the result mustn't mangle any text it repeats.
      expect(JSON.stringify(r)).not.toMatch(/â€|âˆ|Ã[©±¼‰Ÿ]/);
    });

    it("widget file and Muse, as written to disk: ASCII bytes, same spec", async () => {
      for (const extra of [{ widgetDir: dir }, { widgetDir: dir, widgetHost: { name: "muse" } }]) {
        const text = (await show(undefined, extra)).content[0]!.text;
        const path = /^(\/\S+\.html)$/m.exec(text)![1]!;
        const bytes = await readFile(path);
        expect(bytes.every((b) => b < 0x80)).toBe(true);
        expect(specIn(bytes.toString("latin1"))).toBe(SPEC);
      }
    });

    it("HTML fallback page in the text result: the spec round-trips", async () => {
      const text = (await show(undefined)).content.map((c) => c.text).join("\n");
      const html = /```html\n([\s\S]*?)```/.exec(text)?.[1] ?? text;
      expect(html).toMatch(/<meta charset="utf-8">/i);
      expect(html).not.toMatch(/â€|âˆ|Ã[©±¼‰Ÿ]/);
    });
  });
});
