import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { render } from "../src/testing";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);
const fills = (spec: string) => render(spec, { components: ON }).drawOps.filter((o) => o.op === "fill");

describe("scene depth: shadow, glow and shine", () => {
  it("parses on shapes, and says what shadow= takes", () => {
    expect(parse(`scene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent shadow=md glow=true shine=true\n  label "Hi" x=10 y=10 shadow=sm\n`, reg).diagnostics).toEqual([]);
    const bad = parse(`scene "S" w=100 h=100\n  rect x=0 y=0 w=10 h=10 shadow=huge\n`, reg).diagnostics;
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toContain("sm");
  });

  it("has no shine on lines and labels, which have nothing to light", () => {
    const d = parse(`scene "S" w=100 h=100\n  line x1=0 y1=0 x2=10 y2=10 shine=true\n`, reg).diagnostics;
    expect(d).toHaveLength(1);
  });

  it("shine adds one light over the fill, and nothing without a fill", () => {
    const plain = fills(`scene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent\n`);
    const lit = fills(`scene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent shine=true\n`);
    expect(lit.length).toBe(plain.length + 1);
    expect(lit[lit.length - 1]!.gradientStops?.[0]?.color).toContain("255, 255, 255");
    const hollow = fills(`scene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=none stroke=ink shine=true\n`);
    expect(hollow.length).toBe(plain.length - 1);
  });

  it("shadow and glow draw the shape once, as before", () => {
    const plain = render(`scene "S" w=100 h=100\n  rect x=10 y=10 w=40 h=40 fill=accent stroke=line\n`, { components: ON }).drawOps;
    const deep = render(`scene "S" w=100 h=100\n  rect x=10 y=10 w=40 h=40 fill=accent stroke=line shadow=lg glow=true\n`, { components: ON }).drawOps;
    expect(deep.length).toBe(plain.length);
  });

  it("a formula can turn them on and off", () => {
    const off = fills(`state on=false\nscene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent shine={on} glow={on}\n`);
    const on = fills(`state on=true\nscene "S" w=100 h=100\n  circle x=50 y=50 r=20 fill=accent shine={on} glow={on}\n`);
    expect(on.length).toBe(off.length + 1);
  });
});
