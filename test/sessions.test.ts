import { describe, expect, it } from "vitest";
import { score } from "../eval/compare/run";
import { sessionReference, sessions } from "../eval/compare/sessions";

describe("conversation benchmark", () => {
  for (const s of sessions) {
    it(`${s.id}: has a reference screen for every step`, () => {
      expect(sessionReference[s.id]).toHaveLength(s.steps.length);
    });
    s.steps.forEach((step, i) => {
      it(`${s.id} step ${i + 1}: the reference passes every check`, async () => {
        const r = await score("sayshape", { id: `${s.id}.${i + 1}`, category: "dashboard", request: step.request, checks: step.checks }, sessionReference[s.id]![i]!);
        expect(r.problems).toEqual([]);
        expect(r.checks.filter((c) => !c.passed)).toEqual([]);
      });
    });
  }
});

import { runSessions } from "../eval/compare/session-run";
import { coreComponents } from "../src/components";
import { Registry } from "../src/registry";

describe("running a conversation", () => {
  it("refines SayShape, sends HTML its history, and keeps A2UI's surface", async () => {
    const seen: Array<{ format: string; messages: Array<{ role: string; content: unknown }> }> = [];
    const answers: Record<string, string[]> = {
      sayshape: ['text "One"', 'text "Two"'],
      html: ["<p>One</p>", "<p>Two</p>"],
      a2ui: [
        '{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Text","text":"One"}]}}',
        '{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Text","text":"Two"}]}}',
      ],
    };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: unknown }> };
      const system = JSON.stringify(body.messages[0]!.content);
      const format = system.includes("A2UI") ? "a2ui" : system.includes("You write interactive UI") ? "html" : "sayshape";
      const turn = seen.filter((s) => s.format === format).length;
      seen.push({ format, messages: body.messages });
      const text = answers[format]![turn]!;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`, { status: 200 });
    }) as typeof fetch;
    const session = { id: "t", title: "test", steps: [
      { request: "Show one", checks: [{ label: "one", shows: [/One/] }] },
      { request: "Make it two", checks: [{ label: "two", shows: [/Two/], hides: [/One/] }] },
    ] };
    const results = await runSessions([session], { config: { url: "http://model.test/v1" }, models: ["fake"], registry: new Registry(coreComponents), prices: { fake: { prompt: 1e-6, completion: 2e-6 } }, fetch: fetchImpl });
    expect(results.map((r) => `${r.format} ${r.step} ${r.success}`).sort()).toEqual(["a2ui 1 true", "a2ui 2 true", "html 1 true", "html 2 true", "sayshape 1 true", "sayshape 2 true"]);
    const second = (f: string) => seen.filter((s) => s.format === f)[1]!.messages.map((m) => `${m.role}: ${String(m.content)}`).join("\n");
    // SayShape: the current spec as the assistant's turn, then the change.
    expect(second("sayshape")).toMatch(/assistant: text "One"[\s\S]*user:[\s\S]*Make it two/);
    // HTML: the whole conversation, its first page included.
    expect(second("html")).toMatch(/user: Show one\nassistant: <p>One<\/p>\nuser: Make it two/);
    // A2UI: what's drawn after step 2 is both replies, on the surface made in step 1.
    expect(results.find((r) => r.format === "a2ui" && r.step === 2)!.output).toMatch(/createSurface[\s\S]*"Two"/);
    for (const r of results) expect(r.cost).toBeCloseTo(100e-6 + 10 * 2e-6, 12);
  });
});
