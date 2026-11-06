import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { cachedPrompt } from "../src/model";
import { languageGuide } from "../src/prompt";
import { Registry } from "../src/registry";

const registry = new Registry(coreComponents);

describe("cachedPrompt", () => {
  it("puts the compact guide first by default, then the app's instructions, then the per-request context", () => {
    const p = cachedPrompt(registry, { instructions: "You help sales managers at Acme.", context: "The user is Ana. Today is 2026-11-06." });
    expect(p.stable).toBe(languageGuide(registry, { mode: "compact", notes: "You help sales managers at Acme." }));
    expect(p.stable.startsWith(languageGuide(registry, { mode: "compact" }).split("\n")[0]!)).toBe(true);
    expect(p.variable).toBe("The user is Ana. Today is 2026-11-06.");
    expect(p.text).toBe(`${p.stable}\n\nThe user is Ana. Today is 2026-11-06.`);
    expect(p.stable).not.toMatch(/Ana|2026-11-06/);
  });

  it("keeps the stable part, and its key, identical whatever changes per request", () => {
    const a = cachedPrompt(registry, { instructions: "Be brief.", context: "User: Ana" });
    const b = cachedPrompt(registry, { instructions: "Be brief.", context: "User: Ben, on 2026-12-01" });
    expect(b.stable).toBe(a.stable);
    expect(b.cacheKey).toBe(a.cacheKey);
    expect(a.cacheKey).toMatch(/^[0-9a-f]{16}$/);
    // Changing what's meant to be cached changes the key, so it's easy to notice.
    expect(cachedPrompt(registry, { instructions: "Be very brief." }).cacheKey).not.toBe(a.cacheKey);
    expect(cachedPrompt(registry, { instructions: "Be brief.", guide: { mode: "full" } }).cacheKey).not.toBe(a.cacheKey);
  });

  it("gives Anthropic's system field, with only the stable part marked", () => {
    const p = cachedPrompt(registry, { context: "User: Ana" });
    expect(p.anthropic()).toEqual([
      { type: "text", text: p.stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: "User: Ana" },
    ]);
    expect(p.anthropic("1h")[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // With no context, just the one marked block.
    expect(cachedPrompt(registry).anthropic()).toHaveLength(1);
  });

  it("gives one system message for servers that cache on their own, and a marked one for OpenRouter", () => {
    const p = cachedPrompt(registry, { context: "User: Ana" });
    expect(p.messages()).toEqual([{ role: "system", content: p.text }]);
    expect(p.marked()).toEqual([{ role: "system", content: p.anthropic() }]);
    expect(cachedPrompt(registry).messages()[0]!.content).toBe(cachedPrompt(registry).stable);
  });

  it("refuses instructions given twice, so the cached part is never a guess", () => {
    expect(() => cachedPrompt(registry, { instructions: "A", guide: { notes: "B" } })).toThrow(/instructions or as guide.notes/);
    expect(cachedPrompt(registry, { guide: { notes: "B" } }).stable).toBe(languageGuide(registry, { mode: "compact", notes: "B" }));
  });
});
