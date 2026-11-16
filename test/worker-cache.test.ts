/**
 * Prompt caching on the website's model proxy (worker/src/handler.ts): the guide is one stable system
 * message, identical for every visitor and question, sent first as its own marked text block when
 * PROMPT_CACHE is on, and never marked when it's off or the provider refuses the marker.
 */
import { describe, expect, it } from "vitest";
import { chatRegistry, chatStable, dataStable, handle, cacheSetting, type Env } from "../worker/src/handler";
import { chatGuide } from "../worker/src/chat";
import { answerGuide } from "../worker/src/answer";
import { coreComponents } from "../src/components";
import { cachedPrompt } from "../src/model";
import { Registry } from "../src/registry";
import { fakeModel } from "./fake-model";

const ORIGIN = "https://premmannava.github.io";
const base: Env = { MODEL_API_KEY: "test-key-not-real", MODEL: "vendor/model", ALLOWED_ORIGINS: ORIGIN };
const withCache = (extra: Partial<Env> = {}): Env => ({ ...base, PROMPT_CACHE: "true", ...extra });

const post = (body: unknown) =>
  new Request("https://proxy.example/answer", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7" }, body: JSON.stringify(body) });

const SPEC = `state plan="family"
card
  text "Phone plans" style=title
  segmented options="family,solo" bind=plan
`;
const BAD = "card\n  text \"Oops\" style=nonsense\n  nosuchelement\n";
const DATA_SPEC = `derive byCountry={sort(group(data, 'country', 'tiv'), 'tiv', 'desc')}
chart "TIV" kind=hbar items={take(byCountry, 10)} x=country y=tiv
`;
const question = {
  rows: 10,
  columns: [{ name: "country", type: "text", distinct: 3 }, { name: "tiv", type: "number" }],
  sample: [{ country: "Peru", tiv: 5 }],
};

type Msg = { role: string; content: unknown };
const system = (m: ReturnType<typeof fakeModel>, i = 0) => m.requests[i]!.body.messages[0] as unknown as Msg;
async function run(env: Env, body: unknown, model: ReturnType<typeof fakeModel>) {
  const res = await handle(post(body), env, { fetch: model.fetch });
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("the proxy's prompt caching", () => {
  it("builds the stable part with cachedPrompt, from the guide and this page's notes only", () => {
    const p = cachedPrompt(chatRegistry, { guide: chatGuide(chatRegistry) });
    expect(chatStable()).toBe(p.stable);
    expect(p.variable).toBe("");
    expect(dataStable()).toBe(cachedPrompt(new Registry(coreComponents), { guide: answerGuide() }).stable);
    // Nothing that changes: no dates, years, ids or addresses.
    for (const s of [chatStable(), dataStable()]) expect(s).not.toMatch(/\b20\d\d-\d\d-\d\d\b|[0-9a-f]{8}-[0-9a-f]{4}-|@\w+\.\w+/);
  });

  it("sends the same marked system block first for every user, question and follow-up", async () => {
    const model = fakeModel([{ content: [SPEC] }, { content: [SPEC] }, { content: [SPEC] }, { content: [DATA_SPEC] }, { content: [DATA_SPEC] }]);
    const refine = { task: "Plans for Ana Lopez", changes: ["Add a solo option for ana@example.com"], spec: SPEC };
    await run(withCache(), { kind: "chat", message: "Compare phone plans for a family" }, model);
    await run(withCache(), { kind: "chat", message: "My name is Ben Okafor, order 4417: what now?" }, model);
    await run(withCache(), { kind: "chat", message: "Make it a donut", refine }, model);
    await run(withCache(), { question: "Sum of tiv by country", ...question }, model);
    await run(withCache(), { question: "Is Zed Zimmer's row an outlier?", ...question, sample: [{ country: "Zed Zimmer", tiv: 9 }] }, model);

    const marked = cachedPrompt(chatRegistry, { guide: chatGuide(chatRegistry) }).marked()[0]!;
    for (const i of [0, 1, 2]) expect(system(model, i)).toEqual(marked);
    const dataMarked = cachedPrompt(new Registry(coreComponents), { guide: answerGuide() }).marked()[0]!;
    expect(system(model, 3)).toEqual(dataMarked);
    expect(system(model, 4)).toEqual(dataMarked);

    // The block is first, the only system message, and carries the marker; the guide is the whole text.
    for (let i = 0; i < 5; i++) {
      const messages = model.requests[i]!.body.messages as unknown as Msg[];
      expect(messages[0]!.role).toBe("system");
      expect(messages.slice(1).every((m) => m.role !== "system")).toBe(true);
      const blocks = messages[0]!.content as Array<{ type: string; text: string; cache_control?: unknown }>;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
      expect(blocks[0]!.text).toBe(i < 3 ? chatStable() : dataStable());
    }
    // Per-visitor words are only ever in the messages after it.
    const all = model.requests.map((r) => JSON.stringify(r.body.messages[0]));
    for (const w of ["Ben Okafor", "4417", "ana@example.com", "Ana Lopez", "Zed Zimmer", "Peru"]) expect(all.join()).not.toContain(w);
    expect(JSON.stringify(model.requests[1]!.body.messages.slice(1))).toContain("Ben Okafor");
  });

  it("is off by default: the same text, as one plain system message, and PROMPT_CACHE=1h asks for an hour", async () => {
    const off = fakeModel([{ content: [SPEC] }]);
    await run(base, { kind: "chat", message: "Compare phone plans" }, off);
    expect(system(off)).toEqual({ role: "system", content: chatStable() });

    const hour = fakeModel([{ content: [SPEC] }]);
    await run(withCache({ PROMPT_CACHE: "1h" }), { kind: "chat", message: "Compare phone plans" }, hour);
    expect(system(hour)).toEqual(cachedPrompt(chatRegistry, { guide: chatGuide(chatRegistry) }).marked("1h")[0]);

    expect([undefined, "", "false", "no"].map((v) => cacheSetting({ PROMPT_CACHE: v }))).toEqual([undefined, undefined, undefined, undefined]);
    expect(["true", "5m", " On "].map((v) => cacheSetting({ PROMPT_CACHE: v }))).toEqual([true, true, true]);
  });

  it("sends the same marked block again on the repair", async () => {
    const model = fakeModel([{ content: [BAD] }, { content: [SPEC] }]);
    const ev = await run(withCache(), { kind: "chat", message: "Compare phone plans" }, model);
    expect(model.requests).toHaveLength(2);
    expect(system(model, 1)).toEqual(system(model, 0));
    expect(ev.at(-1)).toMatchObject({ t: "done", repaired: true });
  });

  it("passes the provider's cache counts on to the page, and leaves them out when it reports none", async () => {
    const model = fakeModel([
      { content: [SPEC], usage: { prompt_tokens: 5_600, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 5_500, cache_write_tokens: 0 } } },
      { content: [SPEC], usage: { prompt_tokens: 5_600, completion_tokens: 90 } },
      { content: [SPEC], usage: { prompt_tokens: 5_600, completion_tokens: 90, cache_creation_input_tokens: 5_500, cache_read_input_tokens: 0 } },
    ]);
    const done = async () => (await run(withCache(), { kind: "chat", message: "Compare phone plans" }, model)).at(-1)!;
    expect(await done()).toMatchObject({ t: "done", tokens: { in: 5_600, out: 90, cached: 5_500, cacheWrite: 0 } });
    expect((await done()).tokens).toEqual({ in: 5_600, out: 90 });
    expect((await done()).tokens).toEqual({ in: 5_600, out: 90, cached: 0, cacheWrite: 5_500 });
  });

  it("sends the request again unmarked when the provider refuses the marker, and remembers it", async () => {
    const real = fakeModel([{ content: [SPEC] }, { content: [SPEC] }]);
    let refused = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (typeof JSON.parse(init.body as string).messages[0].content !== "string") { refused++; return new Response("content must be a string", { status: 400 }); }
      return real.fetch(url, init);
    }) as typeof fetch;
    const env = withCache({ MODEL: "vendor/strict-model" });
    for (let i = 0; i < 2; i++) {
      const res = await handle(post({ kind: "chat", message: "Compare phone plans" }), env, { fetch: fetchImpl });
      const ev = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { t: string });
      expect(ev.at(-1)!.t).toBe("done");
    }
    expect(refused).toBe(1); // the first request tried the marker; the second didn't
    expect(real.requests).toHaveLength(2);
    expect(system(real, 0)).toEqual({ role: "system", content: chatStable() });
  });

  it("still shows an error for a provider failure that isn't about the marker", async () => {
    const fetchImpl = (async () => new Response("busy", { status: 429 })) as typeof fetch;
    const res = await handle(post({ kind: "chat", message: "Compare phone plans" }), withCache({ MODEL: "vendor/busy" }), { fetch: fetchImpl });
    const ev = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { t: string; message?: string });
    expect(ev.at(-1)).toMatchObject({ t: "error", message: expect.stringContaining("busy") });
  });
});
