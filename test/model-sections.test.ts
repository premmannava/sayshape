import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { languageGuide } from "../src/prompt";
import { generateSections, generateSpec, parsePlan, type ChatMessage } from "../src/model";
import { Registry } from "../src/registry";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "test-model" };
const guide = "GUIDE";

const PLAN = `state status="All"\nsection: Title and filter\nsection: The list\nsection: Totals`;
const S = [
  `card\n  text "Orders" style=title\n  button "All" on=set:status:All\n`,
  `card\n  text "Showing {status}"\n`,
  `card\n  text "Totals"\n`,
];

function sse(content: string, usage?: Record<string, unknown>) {
  const events = [{ choices: [{ delta: { content } }] }, ...(usage ? [{ choices: [], usage }] : [])];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** A fake server that tells the plan, each section, the repair and a single call apart, and holds each section until the test lets it go. */
function fake(o: { plan: string; sections?: string[]; repair?: string; single?: string; gate?: boolean; usage?: boolean }) {
  const requests: Array<{ kind: string; messages: ChatMessage[] }> = [];
  const gates = new Map<number, () => void>();
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const messages = (JSON.parse(init.body as string) as { messages: ChatMessage[] }).messages;
    const last = messages[messages.length - 1]!.content;
    const sec = /Write only section (\d+) of/.exec(last);
    const kind = last.includes("Do not write the interface yet") ? "plan" : sec ? `section${sec[1]}` : last.includes("Your SayShape has these problems") ? "repair" : "single";
    requests.push({ kind, messages });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const usage = o.usage ? { prompt_tokens: 100, completion_tokens: 10 } : undefined;
    try {
      if (kind === "plan") return sse(o.plan, usage);
      if (sec) {
        const k = Number(sec[1]);
        if (o.gate) await new Promise<void>((r) => gates.set(k, r));
        return sse(o.sections![k - 1]!, usage);
      }
      return sse(kind === "repair" ? o.repair! : o.single ?? "", usage);
    } finally { inFlight--; }
  }) as typeof fetch;
  return { fetch: fetchImpl, requests, gates, max: () => maxInFlight };
}

const base = { config, registry, request: "An orders screen", guide, stateNames: undefined };
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(f: () => boolean) { for (let i = 0; i < 200 && !f(); i++) await tick(); expect(f()).toBe(true); }

describe("parsePlan", () => {
  it("reads the plain format", () => {
    const p = parsePlan(PLAN);
    expect(p.shared).toEqual(['state status="All"']);
    expect(p.sections).toEqual(["Title and filter", "The list", "Totals"]);
  });

  it("is tolerant of fences, thinking, bullets, bold, numbering and prose", () => {
    const text = "<think>hmm\nsection: no</think>Sure! Here is the plan:\n```\n- **state** status=\"All\"\n- state status=\"Again\"\n* Section 1: Header\n2. The table\n**Section 3 -** Footer\nderive shown={count(orders)}\ndata orders mystery\n```\nHope that helps";
    const p = parsePlan(text, { stateNames: ["orders"] });
    expect(p.sections).toEqual(["Header", "The table", "Footer"]);
    expect(p.shared).toEqual(['state status="All"', "derive shown={count(orders)}"]);
    expect(p.data).toEqual(["orders"]);
  });

  it("folds sections past the limit into the last one", () => {
    const p = parsePlan("section: a\nsection: b\nsection: c\nsection: d", { maxSections: 2 });
    expect(p.sections).toEqual(["a", "b; also: c; also: d"]);
    expect(p.folded).toBe(2);
  });

  it("drops shared lines the parser rejects", () => {
    const p = parsePlan('state a=1\nderive x={1 +}\nsection: a\nsection: b', { check: registry });
    expect(p.shared).toEqual(["state a=1"]);
  });

  it("never throws on rubbish", () => {
    for (const t of ["", "```", "<think>", "🙂", "section:", "state", "\n\n"]) expect(() => parsePlan(t)).not.toThrow();
    expect(parsePlan("nothing useful").sections).toEqual([]);
  });
});

describe("generateSections", () => {
  it("runs the sections at the same time and assembles them in order", async () => {
    const f = fake({ plan: PLAN, sections: S, gate: true });
    const texts: string[] = [], done: number[] = [];
    const p = generateSections({ ...base, fetch: f.fetch, onText: (t) => texts.push(t), onSection: (i) => done.push(i) });
    // All three requests arrive before any answer is let go: they're in flight together.
    await until(() => f.requests.filter((r) => r.kind.startsWith("section")).length === 3);
    expect(f.max()).toBe(3);
    // The last section finishes first, then the middle one: nothing of them is shown yet, only the shared line.
    f.gates.get(3)!(); await until(() => done.length === 1);
    f.gates.get(2)!(); await until(() => done.length === 2);
    expect(texts.join("")).toBe('state status="All"\n');
    // The first finishes: everything held is shown, in screen order.
    f.gates.get(1)!();
    const r = await p;
    expect(done).toEqual([2, 1, 0]);
    expect(r.spec).toBe('state status="All"\n' + S.join(""));
    expect(texts.join("")).toBe(r.spec);
    expect(r.mode).toBe("sections");
    expect(r.diagnostics).toEqual([]);
    expect(r.repair).toBeUndefined();
    expect(r.maxInFlight).toBe(3);
    expect(r.calls.map((c) => c.role)).toEqual(["plan", "section", "section", "section"]);
  });

  it("streams the section whose turn it is as it arrives", async () => {
    const f = fake({ plan: PLAN, sections: S, gate: true });
    const texts: string[] = [];
    const p = generateSections({ ...base, fetch: f.fetch, onText: (t) => texts.push(t) });
    await until(() => f.gates.size === 3);
    f.gates.get(1)!();
    await until(() => texts.join("").includes("Orders"));
    expect(texts.join("")).toBe('state status="All"\n' + S[0]);
    f.gates.get(3)!(); f.gates.get(2)!();
    const r = await p;
    expect(texts.join("")).toBe(r.spec);
  });

  it("gives every section the guide, the request, the plan and its own instruction", async () => {
    const f = fake({ plan: PLAN, sections: S });
    await generateSections({ ...base, fetch: f.fetch });
    const sec = f.requests.filter((r) => r.kind.startsWith("section"));
    expect(sec).toHaveLength(3);
    for (const [i, r] of sec.entries()) {
      expect(r.messages[0]).toEqual({ role: "system", content: guide });
      const u = r.messages[1]!.content;
      expect(u.startsWith("An orders screen\n\n")).toBe(true);
      expect(u).toContain('state status="All"');
      for (const [j, b] of ["Title and filter", "The list", "Totals"].entries()) expect(u).toContain(`${j + 1}. ${b}`);
      expect(u).toContain(`Write only section ${i + 1} of 3`);
    }
    // The plan call shares the guide and the request prefix.
    expect(f.requests[0]!.messages[1]!.content.startsWith("An orders screen\n\n")).toBe(true);
  });

  it("repairs the assembled spec once when it has problems", async () => {
    const bad = [S[0]!, `card\n  text "Showing {status}" colour=red\n`, S[2]!];
    const fixed = 'state status="All"\n' + S.join("");
    const f = fake({ plan: PLAN, sections: bad, repair: fixed });
    const resets: string[] = [], texts: string[] = [];
    const r = await generateSections({ ...base, fetch: f.fetch, onReset: (w) => { resets.push(w); texts.length = 0; }, onText: (t) => texts.push(t) });
    expect(r.repair).toBeDefined();
    expect(r.spec).toBe(fixed);
    expect(r.diagnostics).toEqual([]);
    expect(resets).toEqual(["repair"]);
    expect(texts.join("")).toBe(fixed);
    const rep = f.requests.find((x) => x.kind === "repair")!;
    expect(rep.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(rep.messages[2]!.content).toContain('colour=red');
    expect(rep.messages[3]!.content).toContain("Your SayShape has these problems");
    expect(f.requests.filter((x) => x.kind === "repair")).toHaveLength(1);
    expect(r.calls.at(-1)!.role).toBe("repair");
  });

  it("keeps the first spec when the repair is no better, and never repairs twice", async () => {
    const bad = [S[0]!, `card\n  text "x" colour=red\n`, S[2]!];
    const f = fake({ plan: PLAN, sections: bad, repair: `card\n  text "y" colour=red\n  text "z" colour=blue\n` });
    const r = await generateSections({ ...base, fetch: f.fetch });
    expect(r.spec).toContain("Orders");
    expect(f.requests.filter((x) => x.kind === "repair")).toHaveLength(1);
  });

  it("does not repair with repairOn never", async () => {
    const f = fake({ plan: PLAN, sections: [S[0]!, `card\n  text "x" colour=red\n`, S[2]!] });
    const r = await generateSections({ ...base, fetch: f.fetch, repairOn: "never" });
    expect(r.repair).toBeUndefined();
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });

  it("falls back to one call when the plan can't be read", async () => {
    const f = fake({ plan: "I would build a nice screen.", single: S[0]! });
    const r = await generateSections({ ...base, fetch: f.fetch });
    expect(r.mode).toBe("fallback");
    expect(r.fallbackReason).toMatch(/couldn't be read/);
    expect(r.spec).toBe(S[0]);
    expect(f.requests.map((x) => x.kind)).toEqual(["plan", "single"]);
    expect(r.sections).toEqual([]);
    expect(r.cost.overheadChars).toBe(r.planner!.inputChars);
  });

  it("falls back when the plan has one section, and for refine and history", async () => {
    const one = fake({ plan: "section: everything", single: S[0]! });
    const r = await generateSections({ ...base, fetch: one.fetch });
    expect(r.mode).toBe("fallback");
    expect(r.fallbackReason).toMatch(/one section/);
    expect(one.requests.map((x) => x.kind)).toEqual(["plan", "single"]);

    const h = fake({ plan: PLAN, single: S[0]! });
    const r2 = await generateSections({ ...base, fetch: h.fetch, history: [{ role: "user", content: "hi" }, { role: "assistant", content: "card\n" }] });
    expect(r2.mode).toBe("fallback");
    expect(h.requests.map((x) => x.kind)).toEqual(["single"]);
    expect(r2.planner).toBeUndefined();
  });

  it("matches generateSpec's own call when falling back", async () => {
    const a = fake({ plan: "nothing", single: S[0]! });
    await generateSections({ ...base, fetch: a.fetch });
    const b = fake({ plan: "", single: S[0]! });
    await generateSpec({ ...base, fetch: b.fetch });
    expect(a.requests[1]!.messages).toEqual(b.requests[0]!.messages);
  });

  it("sums usage, and leaves a total unknown when a call didn't report it", async () => {
    const f = fake({ plan: PLAN, sections: S, usage: true });
    const r = await generateSections({ ...base, fetch: f.fetch });
    expect(r.usage.promptTokens).toBe(400);
    expect(r.usage.completionTokens).toBe(40);
    const g = fake({ plan: PLAN, sections: S });
    const r2 = await generateSections({ ...base, fetch: g.fetch });
    expect(r2.usage.promptTokens).toBeUndefined();
    expect(r2.usage.reported.attempts).toBe(4);
  });

  it("reports the extra input compared with one call", async () => {
    const real = languageGuide(registry, { mode: "compact" });
    const f = fake({ plan: PLAN, sections: S });
    const r = await generateSections({ ...base, guide: { mode: "compact" }, fetch: f.fetch });
    const request = "An orders screen";
    expect(r.cost.calls).toBe(4);
    expect(r.cost.singleCallInputChars).toBe(real.length + request.length);
    expect(r.cost.perCall).toHaveLength(4);
    expect(r.cost.inputChars).toBe(r.cost.perCall.reduce((a, b) => a + b, 0));
    expect(r.cost.overheadChars).toBe(r.cost.inputChars - r.cost.singleCallInputChars);
    // The guide and request go out once per call: three extra copies at least.
    expect(r.cost.overheadChars).toBeGreaterThan(3 * (real.length + request.length));
    expect(r.cost.overheadEstimatedTokens).toBe(Math.round(r.cost.overheadChars / 4));
    console.info(`sections cost (compact guide ${real.length} chars, 3 sections): calls ${r.cost.calls}, input ${r.cost.inputChars} chars, one call ${r.cost.singleCallInputChars}, overhead ${r.cost.overheadChars} chars (~${r.cost.overheadEstimatedTokens} tokens)`);
  });

  it("times the first line and the total with the clock it is given", async () => {
    let t = 0;
    const f = fake({ plan: PLAN, sections: S });
    const r = await generateSections({ ...base, fetch: f.fetch, now: () => (t += 10) });
    expect(r.timings.planMs).toBeGreaterThan(0);
    expect(r.timings.firstLineMs).toBeGreaterThanOrEqual(r.timings.planMs);
    expect(r.timings.firstSectionLineMs).toBeGreaterThanOrEqual(r.timings.firstLineMs!);
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.timings.firstSectionLineMs!);
  });

  it("drops a section's repeat of a shared state line", async () => {
    const f = fake({ plan: PLAN, sections: [`state status="All"\n${S[0]}`, S[1]!, S[2]!] });
    const r = await generateSections({ ...base, fetch: f.fetch });
    expect(r.spec.match(/^state status/gm)).toHaveLength(1);
    expect(r.diagnostics).toEqual([]);
  });

  it("stops every call when one fails", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const last = (JSON.parse(init.body as string) as { messages: ChatMessage[] }).messages.at(-1)!.content;
      if (last.includes("Do not write the interface yet")) return sse(PLAN);
      const n = /section (\d)/.exec(last)![1]!;
      calls.push(n);
      if (n === "2") return new Response("boom", { status: 500 });
      return new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))));
    }) as typeof fetch;
    await expect(generateSections({ ...base, fetch: fetchImpl })).rejects.toThrow();
    expect(calls.sort()).toEqual(["1", "2", "3"]);
  });
});
