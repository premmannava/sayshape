import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { Registry } from "../src/registry";
import { broken, reference } from "../eval/compare/reference";
import { cleanHtml, codeStats, report, runCompare, score, summarize, type Format } from "../eval/compare/run";
import { tasks } from "../eval/compare/tasks";

const registry = new Registry([...coreComponents, ...mapComponents]);

/** A model server that answers each request with the reference answer in the format its system prompt asks for. */
function fakeModel(answer: (request: string, format: Format) => string, usage = { prompt_tokens: 1000, completion_tokens: 200 }) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> };
    const format: Format = body.messages[0]!.content.startsWith("You write interactive UI") ? "html" : "sayshape";
    const request = body.messages.find((m) => m.role === "user")!.content;
    const text = answer(request, format);
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
}

describe("benchmark tasks", () => {
  it("has unique ids and at least one check each", () => {
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    for (const t of tasks) expect(t.checks.length, t.id).toBeGreaterThan(0);
    for (const t of tasks) expect(reference[t.id], `${t.id} has a reference answer`).toBeDefined();
  });

  // The checks are only fair if a working answer passes all of them, in both formats.
  for (const t of tasks) {
    for (const format of ["sayshape", "html"] as const) {
      it(`${t.id}: the ${format} reference passes every check`, async () => {
        const s = await score(format, t, reference[t.id]![format]);
        expect(s.problems).toEqual([]);
        expect(s.checks.filter((c) => !c.passed)).toEqual([]);
      });
    }
  }

  for (const b of broken) {
    it(`${b.task}: catches a ${b.format} answer that ${b.why}`, async () => {
      const s = await score(b.format, tasks.find((t) => t.id === b.task)!, b.code);
      expect(!s.valid || s.checks.some((c) => !c.passed)).toBe(true);
    });
  }
});

describe("reading answers", () => {
  it("takes HTML out of fences and thinking", () => {
    expect(cleanHtml("<think>hmm</think>\n```html\n<p>Hi</p>\n```\nEnjoy!")).toBe("<p>Hi</p>");
    expect(cleanHtml("<p>Hi</p>")).toBe("<p>Hi</p>");
  });

  it("counts the HTML patterns that cost safety and theming", () => {
    const c = codeStats("html", `<script src="x.js"></script><script>el.innerHTML = a; el.insertAdjacentHTML('beforeend', b); eval(c); el.style.color = '#ff0000';</script>`);
    expect(c).toMatchObject({ htmlInserts: 2, codeFromStrings: 1, externalScripts: 1, fixedColors: 1 });
    expect(codeStats("sayshape", "text \"#ff0000 innerHTML\"")).toMatchObject({ htmlInserts: 0, fixedColors: 0 });
  });
});

describe("running the benchmark", () => {
  const some = tasks.filter((t) => ["k3", "t2", "s2"].includes(t.id));

  it("asks for both formats, scores them, and records usage, timing and cost", async () => {
    const results = await runCompare(some, {
      config: { url: "http://model.test/v1" },
      models: ["fake"],
      registry,
      prices: { fake: { prompt: 1e-6, completion: 2e-6 } },
      fetch: fakeModel((request, format) => reference[some.find((t) => t.request === request)!.id]![format]),
    });
    expect(results).toHaveLength(some.length * 2);
    for (const r of results) {
      expect(r.ok, `${r.task} ${r.format}`).toBe(true);
      expect(r.success, `${r.task} ${r.format}: ${r.checks.map((c) => c.why).join("; ")}`).toBe(true);
      expect(r.usage).toMatchObject({ promptTokens: 1000, completionTokens: 200 });
      expect(r.cost).toBeCloseTo(1000 * 1e-6 + 200 * 2e-6);
      expect(r.firstTokenMs).toBeGreaterThanOrEqual(0);
    }
    const [sayshape, html] = summarize(results);
    expect(sayshape).toMatchObject({ format: "sayshape", successRate: 1, safe: 1, safeOf: 1 });
    expect(html).toMatchObject({ format: "html", successRate: 1, safe: 1, safeOf: 1 });
    const md = report(results, { date: "2026-11-04", url: "http://model.test/v1", runs: 1, guideChars: 1, htmlPromptChars: 1 });
    expect(md).toContain("| fake | sayshape | 100% |");
  });

  it("records a failed request and keeps going", async () => {
    const results = await runCompare(some.slice(0, 1), {
      config: { url: "http://model.test/v1" },
      models: ["fake"],
      registry,
      fetch: (async () => new Response("overloaded", { status: 503 })) as typeof fetch,
    });
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(summarize(results)[0]).toMatchObject({ failedRequests: 1, successRate: 0 });
  });
});
