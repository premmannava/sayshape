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
import { grade, pickCases, signatures } from "../eval/picks";
import { scoreAnswer } from "../scripts/pick-eval";

const registry = new Registry([...coreComponents, ...mapComponents]);
const VARIANTS: Record<string, readonly string[]> = {
  chart: KINDS,
  tree: ["list", "org"],
  meter: ["ring", "gauge"],
  schedule: ["day", "week", "timeline"],
  input: ["required", "email", "number", "lines"],
  select: ["multiple"],
  "date-picker": ["range"],
  text: ["rich"],
};

describe("representation eval cases", () => {
  it("have unique ids", () => {
    const ids = pickCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of pickCases) {
    it(`${c.id}: names real elements and variants, and keeps best, ok and poor apart`, () => {
      const all = [...c.best, ...(c.ok ?? []), ...(c.poor ?? [])];
      for (const s of all) {
        if (s === "tip" || s === "if") continue;
        const [type, variant] = s.split(":") as [string, string | undefined];
        expect(registry.get(type), `${s} is an element`).toBeDefined();
        if (variant) expect(VARIANTS[type], `${s} is a variant the grader reads`).toContain(variant);
      }
      expect(new Set(all).size, "no signature in two grades").toBe(all.length);
      expect(c.why.length).toBeGreaterThan(20);
    });

    it(`${c.id}: doesn't name its best answer in the request`, () => {
      for (const s of c.best) {
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
  const sigsOf = (spec: string) => signatures(parse(spec, registry).root);

  it("reads chart kinds (bar by default), tree kinds and input variants", () => {
    const s = sigsOf(`state r=[]\nchart items=r x=a y=b\ntree items=r parent=p kind=org\ninput "E" bind=e kind=email required=true lines=3\ntext "x" tip="y"\n`);
    for (const x of ["chart", "chart:bar", "tree:org", "input:email", "input:required", "input:lines", "tip"]) expect(s.has(x), x).toBe(true);
  });

  it("gives the best grade any part reaches", () => {
    expect(grade(hbar, sigsOf(`state r=[]\nchart kind=hbar items=r x=a y=b\n`)).grade).toBe("best");
    expect(grade(hbar, sigsOf(`state r=[]\nchart items=r x=a y=b\n`)).grade).toBe("ok");
    expect(grade(hbar, sigsOf(`state r=[]\nchart kind=pie items=r x=a y=b\n`)).grade).toBe("poor");
    expect(grade(hbar, sigsOf(`text "Nothing"\n`)).grade).toBe("other");
    expect(grade(hbar, sigsOf(`state r=[]\nchart kind=pie items=r x=a y=b\nchart kind=hbar items=r x=a y=b\n`)).grade).toBe("best");
  });

  it("scores points and checks the answer draws cleanly", () => {
    const r = scoreAnswer(hbar, { id: hbar.id, spec: `state r=[{a: "Harborview Regional Medical Center", b: 1420000}, {a: "Northwind Logistics", b: 1180000}]\nchart kind=hbar items=r x=a y=b format=money\n`, model: "m", setup: "s" });
    expect(r).toMatchObject({ grade: "best", points: 2, errors: 0, overflows: 0, model: "m", setup: "s" });
    expect(r.crashed).toBeUndefined();
  });
});
