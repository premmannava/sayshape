import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { applyEdits, generateSpec, numberSpec, parseEdits, refineEditMessages, refineMessages, wholeSpecFrom, type RefineContext } from "../src/model";
import { sayShapeLineTest } from "../src/model/clean";
import { Registry } from "../src/registry";
import { fakeModel } from "./fake-model";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "test-model" };
const spec = `card\n  text "Cabin" style=title\n  text "Two nights"\n  button "Book" on=emit:book\n`;
const ctx: RefineContext = { task: "A cabin card", spec };
const isLine = sayShapeLineTest((n) => registry.has(n));

describe("parseEdits", () => {
  it("reads replace, insert and delete, ignoring fences, talk and stray blank lines", () => {
    const r = parseEdits("Here you go:\n```\n@replace 2-3\n\n  text \"A\"\n\n@insert 0\ncard\n@delete 4\n```\n");
    expect(r).toEqual({ ok: true, edits: [
      { op: "replace", from: 2, to: 3, lines: ['  text "A"'] },
      { op: "insert", from: 0, to: 0, lines: ["card"] },
      { op: "delete", from: 4, to: 4, lines: [] },
    ] });
  });
  it("gives no edits for a whole spec, and rejects bad commands", () => {
    expect(parseEdits(spec)).toEqual({ ok: true, edits: [] });
    expect(parseEdits("@swap 3\nx").ok).toBe(false);
    expect(parseEdits("@replace\nx").ok).toBe(false);
    expect(parseEdits("@replace 3\n").ok).toBe(false);
    expect(parseEdits("@delete 3\nstuff").ok).toBe(false);
    expect(parseEdits("@insert 1-2\nx").ok).toBe(false);
  });
  it("removes a copied N| gutter when every line has it", () => {
    expect(parseEdits("@replace 2\n2|  text \"A\"")).toEqual({ ok: true, edits: [{ op: "replace", from: 2, to: 2, lines: ['  text "A"'] }] });
  });
});

describe("applyEdits", () => {
  const e = (t: string) => { const p = parseEdits(t); if (!p.ok) throw new Error(p.reason); return p.edits; };
  it("applies against the spec as sent, not shifted by earlier edits", () => {
    const r = applyEdits(spec, e("@insert 0\nstate n=1\n@replace 2\n  text \"X\"\n  text \"Y\"\n@delete 3\n@insert 4\n  text \"Z\""));
    expect(r).toEqual({ ok: true, applied: 4, spec: `state n=1\ncard\n  text "X"\n  text "Y"\n  button "Book" on=emit:book\n  text "Z"\n` });
  });
  it("keeps a missing final newline missing", () => {
    expect(applyEdits("a\nb", e("@delete 1"))).toEqual({ ok: true, applied: 1, spec: "b" });
  });
  it("rejects out of range, backwards, overlapping and inside-a-range edits", () => {
    for (const t of ["@delete 5", "@replace 0\nx", "@insert 9\nx", "@delete 3-2", "@delete 1-2\n@replace 2\nx", "@replace 2-3\nx\n@insert 2\ny"]) {
      expect(applyEdits(spec, e(t)).ok, t).toBe(false);
    }
  });
});

describe("prompt helpers", () => {
  it("numbers lines without counting the final newline", () => {
    expect(numberSpec("a\n  b\n\nc\n")).toBe("1|a\n2|  b\n3|\n4|c");
  });
  it("accepts a whole spec (fenced, with talk, thinking) but not a fragment or prose", () => {
    expect(wholeSpecFrom("Sure!\n```\n" + spec + "```", isLine)).toBe(spec);
    expect(wholeSpecFrom("<think>x</think>" + spec, isLine)).toBe(spec);
    expect(wholeSpecFrom('  text "x"\n', isLine)).toBeUndefined();
    expect(wholeSpecFrom("I could not do that.", isLine)).toBeUndefined();
    expect(wholeSpecFrom("@delete 1\ncard\n", isLine)).toBeUndefined();
  });
  it("edit messages keep the first message, number the spec, and keep state", () => {
    const c = { ...ctx, changes: ["a"], state: { n: 1 } };
    const edit = refineEditMessages(c, "Bigger", {});
    const plain = refineMessages(c, "Bigger");
    expect(edit.messages[0]).toEqual(plain.messages[0]);
    expect(edit.messages[1]!.content).toBe(numberSpec(spec));
    expect(edit.messages[2]!.content).toContain("Change the interface above: Bigger\n");
    expect(edit.messages[2]!.content).toContain("@replace 4-5");
    expect(edit.messages[2]!.content).toContain('Current values from the app (use these names in state):\n{"n":1}');
    expect(edit.messages[2]!.content).not.toContain("Write the whole interface.");
  });
  it("keeps every line of a change written over several lines", () => {
    const edit = refineEditMessages(ctx, "Rename the title.\n\nAlso add a footer.\nKeep it short.", {});
    const text = edit.messages[2]!.content;
    expect(text).toContain("Change the interface above: Rename the title.\n\nAlso add a footer.\nKeep it short.\n");
    expect(text).toContain("@delete 9-10");
    expect(text).not.toContain("Write the whole interface.");
  });
});

describe("generateSpec with edits", () => {
  const usage = (p: number, c: number) => ({ prompt_tokens: p, completion_tokens: c });
  const base = { config, registry, request: "Rename the title", refine: ctx };

  it("sends the same messages as before when the option is off", async () => {
    const m = fakeModel([{ content: [spec] }]);
    await generateSpec({ ...base, fetch: m.fetch });
    const off = fakeModel([{ content: [spec] }]);
    await generateSpec({ ...base, edits: false, fetch: off.fetch });
    expect(off.requests[0]!.body.messages).toEqual(m.requests[0]!.body.messages);
    expect(m.requests[0]!.body.messages.slice(1)).toEqual(refineMessages(ctx, "Rename the title").messages);
  });

  it("applies edits, streams the patched spec once, and reports it", async () => {
    const m = fakeModel([{ content: ['@replace 2\n  text "Lodge" style=title\n'], usage: usage(100, 10) }]);
    const events: string[] = [];
    const r = await generateSpec({ ...base, edits: true, fetch: m.fetch, onText: (t) => events.push("text:" + t), onReset: (w) => events.push("reset:" + w) });
    expect(r.spec).toBe(`card\n  text "Lodge" style=title\n  text "Two nights"\n  button "Book" on=emit:book\n`);
    expect(r.edit).toMatchObject({ mode: "edits", applied: 1 });
    expect(events).toEqual(["reset:edits", "text:" + r.spec]);
    expect(m.requests).toHaveLength(1);
    expect(m.requests[0]!.body.messages[2]!.content).toBe(numberSpec(spec));
    expect(r.edit!.messages).toEqual(m.requests[0]!.body.messages);
    // The conversation kept for later is the normal refine shape with the final spec.
    expect(r.messages.slice(1, -1)).toEqual(refineMessages(ctx, "Rename the title").messages);
    expect(r.messages.at(-1)).toEqual({ role: "assistant", content: r.spec });
    expect(r.usage.completionTokens).toBe(10);
  });

  it("falls back to one full rewrite when the edits can't be applied, summing usage", async () => {
    const rewrite = spec.replace("Cabin", "Lodge");
    const m = fakeModel([{ content: ["@delete 40\n"], usage: usage(100, 5) }, { content: [rewrite], usage: usage(80, 30) }]);
    const r = await generateSpec({ ...base, edits: true, fetch: m.fetch });
    expect(r.spec).toBe(rewrite);
    expect(r.edit).toMatchObject({ mode: "fallback", applied: 0 });
    expect(r.edit!.reason).toContain("out of range");
    expect(m.requests).toHaveLength(2);
    expect(m.requests[1]!.body.messages.slice(1)).toEqual(refineMessages(ctx, "Rename the title").messages);
    expect(r.usage).toMatchObject({ promptTokens: 180, completionTokens: 35 });
  });

  it("falls back when the edits leave an error the current spec didn't have", async () => {
    const m = fakeModel([{ content: ['@replace 4\n  nonsense "Book"\n'] }, { content: [spec] }]);
    const r = await generateSpec({ ...base, edits: true, fetch: m.fetch });
    expect(r.edit?.mode).toBe("fallback");
    expect(r.edit?.reason).toMatch(/caused an error/);
    expect(r.spec).toBe(spec);
    expect(m.requests).toHaveLength(2);
  });

  it("doesn't blame edits for errors the current spec already had", async () => {
    const bad = `card\n  button "Buy" color=red\n  text "x"\n`;
    const m = fakeModel([{ content: ['@replace 3\n  text "y"\n'] }, { content: [bad] }]);
    const r = await generateSpec({ ...base, refine: { ...ctx, spec: bad }, edits: true, fetch: m.fetch });
    expect(r.edit?.mode).toBe("edits");
    // The normal repair still runs on what's left.
    expect(m.requests).toHaveLength(2);
    expect(m.requests[1]!.body.messages.at(-1)!.content).toMatch(/Your SayShape has these problems/);
  });

  it("accepts a whole spec as a rewrite", async () => {
    const whole = `card\n  text "New"\n`;
    const m = fakeModel([{ content: ["```\n", whole, "```\n"] }]);
    const r = await generateSpec({ ...base, edits: true, fetch: m.fetch });
    expect(r.spec).toBe(whole);
    expect(r.edit).toMatchObject({ mode: "rewrite", applied: 0 });
    expect(m.requests).toHaveLength(1);
  });

  it("falls back on an answer that is neither", async () => {
    const m = fakeModel([{ content: ["Sorry, I can't."] }, { content: [spec] }]);
    const r = await generateSpec({ ...base, edits: true, fetch: m.fetch });
    expect(r.edit?.mode).toBe("fallback");
    expect(r.spec).toBe(spec);
  });

  it("is ignored without refine", async () => {
    const m = fakeModel([{ content: [spec] }]);
    const r = await generateSpec({ config, registry, request: "a card", edits: true, fetch: m.fetch });
    expect(r.edit).toBeUndefined();
    expect(m.requests[0]!.body.messages).toHaveLength(2);
  });
});
