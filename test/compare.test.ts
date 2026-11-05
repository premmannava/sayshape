import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { Registry } from "../src/registry";
import { broken, reference } from "../eval/compare/reference";
import { cleanHtml, codeStats, costOf, report, runCheck, runCompare, score, summarize, type Format } from "../eval/compare/run";
import { parseCache } from "../scripts/model-env";
import { tasks } from "../eval/compare/tasks";

const registry = new Registry([...coreComponents, ...mapComponents]);

/** A model server that answers each request with the reference answer in the format its system prompt asks for. */
function fakeModel(answer: (request: string, format: Format) => string, usage: Record<string, unknown> = { prompt_tokens: 1000, completion_tokens: 200 }) {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages[0]!.content as unknown;
    const format: Format = (typeof system === "string" ? system : JSON.stringify(system)).includes("You write interactive UI") ? "html" : "sayshape";
    const request = body.messages.find((m) => m.role === "user")!.content as string;
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

describe("using answers the way people build them", () => {
  const task = (id: string) => tasks.find((t) => t.id === id)!;

  it("chooses a filter from an HTML dropdown", async () => {
    const html = `<select id="p"><option>All</option><option>High</option><option>Medium</option><option>Low</option></select><ul id="l"></ul>
<p>Mon Fri</p><script>const T=[['Login fails','High'],['Slow export','Medium'],['Typo on page','Low'],['Data missing','High'],['Billing error','Medium']];
function draw(){const p=document.getElementById('p').value;document.getElementById('l').replaceChildren(...T.filter(t=>p==='All'||t[1]===p).map(t=>{const li=document.createElement('li');li.textContent=t[0];return li;}));}
document.getElementById('p').onchange=draw;draw();</script>`;
    const s = await score("html", task("d2"), html);
    expect(s.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("doesn't take a dropdown's options for the text of the label around it", async () => {
    const html = `<input id="v" value="10"><label>Direction <select id="m"><option value="k">km to miles</option><option value="m">miles to km</option></select></label><p id="o"></p>
<script>function u(){const v=+document.getElementById('v').value;document.getElementById('o').textContent=document.getElementById('m').value==='k'?(v*0.621371).toFixed(2):(v/0.621371).toFixed(2);}
document.getElementById('m').onchange=u;u();</script>`;
    const s = await score("html", task("x3"), html);
    expect(s.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("chooses an option from a SayShape select", async () => {
    const spec = `state bill=84.5 tip=18 people=3 tips=[{pct: 15, label: "15%"}, {pct: 18, label: "18%"}, {pct: 20, label: "20%"}]
card
  select "Tip" items=tips value=pct label=label bind=tip
  stat label="Tip" value="{money(bill * tip / 100)}"
  stat label="Total" value="{money(bill * (1 + tip / 100))}"
  stat label="Per person" value="{money(bill * (1 + tip / 100) / people)}"`;
    const s = await score("sayshape", task("x2"), spec);
    expect(s.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("ticks the checkbox in a row when the row's text is pressed", async () => {
    const html = `<p id="w"></p><table><tbody id="b"></tbody></table>
<script>const T=[['Design mockups','Website','Ana',true],['Build pages','Website','Ben',false],['Write copy','Website','Ana',true],['Set up CI','App','Chen',true],['Login screen','App','Ben',false],['Push alerts','App','Chen',false]];
function draw(){const w=T.filter(t=>t[1]==='Website');document.getElementById('w').textContent='Website '+w.filter(t=>t[3]).length+' of 3, App '+T.filter(t=>t[1]==='App'&&t[3]).length+' of 3';}
for(const t of T){const tr=document.createElement('tr');const c=document.createElement('input');c.type='checkbox';c.checked=t[3];c.onchange=()=>{t[3]=c.checked;draw();};
const a=document.createElement('td');a.appendChild(c);const n=document.createElement('td');n.textContent=t[0];tr.append(a,n);document.getElementById('b').appendChild(tr);}draw();</script>`;
    const r = await runCheck("html", html, tasks.find((t) => t.id === "d3")!.checks[1]!);
    expect(r).toEqual({ label: r.label, passed: true });
  });

  it("ticks the check under a list-item's title when its text is pressed", async () => {
    const spec = `state tasks=[{n: "Design mockups", p: "Website", done: true}, {n: "Build pages", p: "Website", done: false}, {n: "Write copy", p: "Website", done: true}, {n: "Set up CI", p: "App", done: true}, {n: "Login screen", p: "App", done: false}, {n: "Push alerts", p: "App", done: false}]
derive web={filter(tasks, 'p', 'Website')}
derive app={filter(tasks, 'p', 'App')}
card
  text "Website {count(web, 'done')} of 3, App {count(app, 'done')} of 3"
  list
    each items=tasks as=t
      list-item "{t.n}" detail="{t.p}"
        check "Done" bind=t.done`;
    const r = await runCheck("sayshape", spec, tasks.find((t) => t.id === "d3")!.checks[1]!);
    expect(r).toEqual({ label: r.label, passed: true });
  });

  it("presses the button inside a header cell, not the cell", async () => {
    const html = reference.t1!.html.replace(/<th data-k="(\w+)">(\w+)<\/th>/g, '<th><button data-k="$1">$2</button></th>').replace("document.querySelectorAll('th').forEach(th=>th.onclick=()=>{dir=key===th.dataset.k?-dir:1;key=th.dataset.k;draw();});", "document.querySelectorAll('th button').forEach(b=>b.onclick=()=>{dir=key===b.dataset.k?-dir:1;key=b.dataset.k;draw();});");
    expect(html).toContain("th button");
    const s = await score("html", task("t1"), html);
    expect(s.checks.filter((c) => !c.passed)).toEqual([]);
  });
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

describe("repair", () => {
  it("sends problems back once, in both formats, and records the first try and the repaired one", async () => {
    const task = tasks.find((t) => t.id === "k3")!;
    const seen: Record<string, number> = {};
    const lastUser: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: unknown }> };
      const system = body.messages[0]!.content;
      const format: Format = (typeof system === "string" ? system : JSON.stringify(system)).includes("You write interactive UI") ? "html" : "sayshape";
      seen[format] = (seen[format] ?? 0) + 1;
      lastUser.push(String(body.messages.at(-1)!.content));
      // Mid-spec, where models write it: a leading non-Loom line is dropped as prose before the spec.
      const broken = format === "sayshape" ? `${reference.k3!.sayshape}\nlet left = budget - spent` : `<p id="x"></p><script>document.getElementById('missing').textContent = 'x';</script>`;
      const text = seen[format] === 1 ? broken : reference.k3![format];
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } })}\n\ndata: [DONE]\n\n`, { status: 200 });
    }) as typeof fetch;
    const results = await runCompare([task], { config: { url: "http://model.test/v1" }, models: ["fake"], registry, repair: true, fetch: fetchImpl });
    for (const r of results) {
      expect(r, r.format).toMatchObject({ repaired: true, firstSuccess: false, success: true, usage: { promptTokens: 2000, completionTokens: 200 } });
    }
    expect(seen).toEqual({ sayshape: 2, html: 2 });
    // The second message to each carries the first one's problems.
    expect(lastUser.find((m) => m.includes("Loom has no variables"))).toBeDefined();
    expect(lastUser.find((m) => m.startsWith("Your HTML had these problems when it ran:"))).toBeDefined();
    const sum = summarize(results);
    expect(sum.map((x) => [x.firstSuccessRate, x.successRate, x.repaired])).toEqual([[0, 1, 1], [0, 1, 1]]);
    expect(report(results, { date: "d", url: "u", runs: 1, guideChars: 1, htmlPromptChars: 1 })).toContain("| Works first try | Works after repair | Repairs |");
  });

  it("doesn't repair a first answer without problems", async () => {
    const task = tasks.find((t) => t.id === "k3")!;
    const results = await runCompare([task], { config: { url: "http://model.test/v1" }, models: ["fake"], registry, repair: true, fetch: fakeModel((_r, f) => reference.k3![f]) });
    for (const r of results) expect(r).toMatchObject({ repaired: false, success: true });
    expect(summarize(results).map((x) => x.firstSuccessRate)).toEqual([1, 1]);
  });
});

describe("prompt caching", () => {
  const prices = { prompt: 3e-6, completion: 15e-6, cacheRead: 0.3e-6, cacheWrite: 3.75e-6 };

  it("charges cached and cache-written input at their own prices", () => {
    // 10,500 of 11,000 input tokens read from the cache.
    expect(costOf({ promptTokens: 11000, completionTokens: 200, cachedTokens: 10500 }, prices)).toBeCloseTo(500 * 3e-6 + 10500 * 0.3e-6 + 200 * 15e-6);
    // The first request writes the cache.
    expect(costOf({ promptTokens: 11000, completionTokens: 200, cachedTokens: 0, cacheWriteTokens: 10500 }, prices)).toBeCloseTo(500 * 3e-6 + 10500 * 3.75e-6 + 200 * 15e-6);
    // No cache prices listed: cache tokens at the input price.
    expect(costOf({ promptTokens: 11000, completionTokens: 200, cachedTokens: 10500 }, { prompt: 3e-6, completion: 15e-6 })).toBeCloseTo(11000 * 3e-6 + 200 * 15e-6);
    expect(costOf({ promptTokens: 11000 }, prices)).toBeUndefined();
  });

  it("reads the LOOM_PROMPT_CACHE setting", () => {
    expect(parseCache("1h")).toBe("1h");
    for (const on of ["1", "true", "on", "yes", "5m", " 1 "]) expect(parseCache(on)).toBe(true);
    for (const off of [undefined, "", "0", "false", "off", "2h"]) expect(parseCache(off)).toBeUndefined();
  });

  it("marks the guide for caching and reports how much input came from the cache", async () => {
    const some = tasks.filter((t) => t.id === "k3");
    const sent: unknown[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { messages: Array<{ content: unknown }> };
      sent.push(body.messages[0]!.content);
      const html = typeof body.messages[0]!.content === "string" ? (body.messages[0]!.content as string).startsWith("You write") : JSON.stringify(body.messages[0]!.content).includes("You write");
      return fakeModel(() => reference.k3![html ? "html" : "sayshape"], { prompt_tokens: 11000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 10500 } } as never)(url, init);
    }) as typeof fetch;
    const results = await runCompare(some, { config: { url: "http://model.test/v1", cache: true }, models: ["fake"], registry, prices: { fake: prices }, fetch: fetchImpl });
    expect(sent[0]).toEqual([expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } })]);
    const s = summarize(results)[0]!;
    expect(s.cachedShare).toBeCloseTo(10500 / 11000);
    expect(results[0]!.cost).toBeCloseTo(500 * 3e-6 + 10500 * 0.3e-6 + 200 * 15e-6);
    expect(report(results, { date: "d", url: "u", runs: 1, guideChars: 1, htmlPromptChars: 1, cache: true })).toContain("Prompt caching: marked, about 5 minutes");
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
