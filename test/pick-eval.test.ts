/**
 * The representation eval's own checks: its cases name real elements and
 * kinds, never give the answer away in the request, and its grader reads
 * specs the way the report says.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { KINDS } from "../src/components/chart-kit";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { elementSignatures, grade, pickCases, registryDefaults, scoreElements, signatures } from "../eval/picks";
import { completeResults, scoreAnswer } from "../scripts/pick-eval";

const registry = new Registry([...coreComponents, ...mapComponents]);
const VARIANTS: Record<string, readonly string[]> = {
  chart: KINDS,
  tree: ["list", "org"],
  meter: ["ring", "gauge"],
  map: ["markers", "choropleth", "bubble"],
  schedule: ["day", "week", "timeline"],
  input: ["required", "email", "number", "lines"],
  select: ["multiple"],
  "date-picker": ["range"],
  text: ["rich"],
};

/** Lower-case words, without punctuation, so "Jan 820 vs 640," and "jan 820 vs 640" match. */
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
/** Every run of n words in a text, joined. */
const runs = (ws: string[], n: number) => ws.slice(0, Math.max(0, ws.length - n + 1)).map((_, i) => ws.slice(i, i + n).join(" "));

describe("the guide's picks stay held out from the eval", () => {
  // A pick that quotes a request ("312 of 480 tickets closed") teaches to the test: the eval
  // would score the model reading its own answer key. Picks say what kind of data they're for.
  const requests = pickCases.map((c) => ({ id: c.id, ws: words(c.request) }));
  const picks = registry.all().flatMap((d) => (d.picks ?? []).map((p) => ({ type: d.type, text: `${p.for} ${p.write}` })));

  it("share no run of four words with any request", () => {
    const shared = picks.flatMap((p) => {
      const mine = new Set(runs(words(p.text), 4));
      return requests.flatMap((r) => runs(r.ws, 4).filter((x) => mine.has(x)).map((x) => `${p.type} pick "${p.text}" and ${r.id}: "${x}"`));
    });
    expect(shared).toEqual([]);
  });

  it("quote no number of three or more digits from a request", () => {
    const shared = picks.flatMap((p) => {
      const nums = words(p.text).filter((w) => /^\d{3,}$/.test(w));
      return requests.flatMap((r) => nums.filter((n) => r.ws.includes(n)).map((n) => `${p.type} pick "${p.text}" and ${r.id}: ${n}`));
    });
    expect(shared).toEqual([]);
  });
});

describe("representation eval cases", () => {
  it("have unique ids", () => {
    const ids = pickCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of pickCases) {
    it(`${c.id}: names real elements and variants, and keeps best, ok and poor apart`, () => {
      const all = [...c.best, ...(c.ok ?? []), ...(c.poor ?? []), ...(c.never ?? []), ...(c.parts ?? []).flatMap((x) => [...x.best, ...(x.ok ?? [])])];
      expect(c.best.length || c.parts?.length, "a best answer, or parts with their own").toBeTruthy();
      for (const s of all) {
        if (s === "tip") continue;
        const [type, variant] = s.split(":") as [string, string | undefined];
        expect(registry.get(type), `${s} is an element`).toBeDefined();
        if (variant) expect(VARIANTS[type], `${s} is a variant the grader reads`).toContain(variant);
      }
      for (const g of [c, ...(c.parts ?? [])]) {
        const own = [...g.best, ...(g.ok ?? []), ...("poor" in g ? g.poor ?? [] : []), ...("never" in g ? g.never ?? [] : [])];
        expect(new Set(own).size, "no signature in two grades").toBe(own.length);
      }
      expect(c.why.length).toBeGreaterThan(20);
    });

    it(`${c.id}: doesn't name its best answer in the request`, () => {
      for (const s of [...c.best, ...(c.parts ?? []).flatMap((x) => x.best)]) {
        // The element's name, and a chart's or tree's kind ("funnel", "org"); other variants are
        // everyday words a request has to use ("email", "week").
        const [type, variant] = s.split(":");
        const words = [type!, ...(variant && (type === "chart" || type === "tree") && variant !== "list" ? [variant] : [])];
        for (const w of words) expect(c.request.toLowerCase(), `"${w}" gives it away`).not.toMatch(new RegExp(`\\b${w.replace(/-/g, "[- ]")}\\b`));
      }
    });
  }
});

describe("grading an answer", () => {
  const hbar = pickCases.find((c) => c.id === "rank-long-names")!;
  const defaults = registryDefaults(registry);
  const els = (spec: string) => elementSignatures(parse(spec, registry).root, defaults);
  const sigsOf = (spec: string) => signatures(parse(spec, registry).root, defaults);
  const caseOf = (id: string) => pickCases.find((c) => c.id === id)!;

  it("reads chart kinds (bar by default), tree kinds and input variants", () => {
    const s = sigsOf(`state r=[]\nchart items=r x=a y=b\ntree items=r parent=p kind=org\ninput "E" bind=e kind=email required=true lines=3\ntext "x" tip="y"\n`);
    for (const x of ["chart", "chart:bar", "tree:org", "input:email", "input:required", "input:lines", "tip"]) expect(s.has(x), x).toBe(true);
  });

  it("can't read a variant written as {…}, and doesn't guess", () => {
    const s = sigsOf(`state k="line" m=true r=[]\nchart kind={k} items=r x=a y=b\nselect "R" bind=x options="A,B" multiple={m}\ninput "N" bind=n required={false}\n`);
    expect([...s].filter((x) => x.includes(":"))).toEqual([]);
  });

  it("gives the best grade reached, and only ok when a never-right one sits beside the best", () => {
    expect(grade(hbar, els(`state r=[]\nchart kind=hbar items=r x=a y=b\n`)).grade).toBe("best");
    expect(grade(hbar, els(`state r=[]\nchart items=r x=a y=b\n`)).grade).toBe("ok");
    expect(grade(hbar, els(`state r=[]\nchart kind=pie items=r x=a y=b\n`)).grade).toBe("poor");
    expect(grade(hbar, els(`text "Nothing"\n`)).grade).toBe("other");
    expect(grade(hbar, els(`state r=[]\nchart kind=hbar items=r x=a y=b\ntable items=r\n  table-column "A" field=a\n`)).grade).toBe("best");
    expect(grade(hbar, els(`state r=[]\nchart kind=pie items=r x=a y=b\nchart kind=hbar items=r x=a y=b\n`)).grade).toBe("best");
    expect(grade(caseOf("share-many"), els(`state r=[]\nchart kind=pie items=r x=a y=b\nchart kind=treemap items=r x=a y=b\n`)).grade).toBe("ok");
  });

  it("on a trap, the trap pick beside the best is only ok", () => {
    expect(grade(caseOf("one-kpi-change"), els(`stat label="Revenue" value=84200\n`)).grade).toBe("best");
    expect(grade(caseOf("one-kpi-change"), els(`state r=[]\nstat label="Revenue" value=84200\nchart items=r x=a y=b\n`)).grade).toBe("ok");
  });

  it("grades a variant by itself when the case lists it, not by its base element", () => {
    // A multiple select is poor for one status at a time, though a plain select is ok.
    expect(grade(caseOf("quick-filter"), els(`select "Status" bind=s options="To do,Doing,Done" multiple=true\n`)).grade).toBe("poor");
    expect(grade(caseOf("quick-filter"), els(`select "Status" bind=s options="To do,Doing,Done"\n`)).grade).toBe("ok");
  });

  it("averages a case's parts, each taking its own element", () => {
    const dash = caseOf("dashboard-mix");
    const all = scoreElements(dash, els(`state r=[]\nchart kind=bullet items=r x=a y=b target=c\nchart kind=line items=r x=a y=b\nchart kind=donut items=r x=a y=b\n`));
    expect(all).toMatchObject({ grade: "best", points: 2 });
    const some = scoreElements(dash, els(`state r=[]\nstat label="Revenue" value=1\nchart kind=line items=r x=a y=b\n`));
    expect(some.points).toBeCloseTo((1 + 2 + 0) / 3);
    expect(some.parts?.map((p) => p.grade)).toEqual(["ok", "best", "other"]);
    // One bar chart is best for the months or ok for the channels, never both.
    const one = scoreElements(dash, els(`state r=[]\nchart items=r x=a y=b\n`));
    expect(one.points).toBeCloseTo(2 / 3);
    // One segmented control is the theme or the page size, not both.
    const settings = scoreElements(caseOf("settings-page"), els(`input "Email" bind=e kind=email\nswitch "Weekly" bind=w\nsegmented bind=t options="Light,Dark,System"\n`));
    expect(settings.points).toBeCloseTo(6 / 4);
    expect(settings.parts?.filter((p) => p.grade === "other")).toHaveLength(1);
  });

  it("counts a case with no answer as 0, and keeps the last of a repeated one", () => {
    const a = scoreAnswer(hbar, { id: hbar.id, spec: `state r=[]\nchart kind=hbar items=r x=a y=b\n`, model: "m", setup: "s", run: 1 });
    const b = scoreAnswer(hbar, { id: hbar.id, spec: `text "x"\n`, model: "m", setup: "s", run: 1 });
    const { results, repeated } = completeResults([a, b], pickCases.slice(0, 3));
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.id === hbar.id)?.grade).toBe("other");
    expect(results.filter((r) => r.missing)).toHaveLength(2);
    expect(repeated).toHaveLength(1);
  });

  it("scores a request that failed as missing", () => {
    const r = scoreAnswer(hbar, { id: hbar.id, spec: "", model: "m", setup: "s", failed: "asking failed: timeout" });
    expect(r).toMatchObject({ points: 0, missing: "asking failed: timeout" });
  });

  it("scores points and checks the answer draws cleanly", () => {
    const r = scoreAnswer(hbar, { id: hbar.id, spec: `state r=[{a: "Harborview Regional Medical Center", b: 1420000}, {a: "Northwind Logistics", b: 1180000}]\nchart kind=hbar items=r x=a y=b format=money\n`, model: "m", setup: "s" });
    expect(r).toMatchObject({ grade: "best", points: 2, errors: 0, overflows: 0, model: "m", setup: "s" });
    expect(r.crashed).toBeUndefined();
  });
});
