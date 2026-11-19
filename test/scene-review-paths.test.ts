/**
 * The drawing check's marker-off-its-path rule: a station, pin or dot a few
 * pixels off the line it's meant to sit on, so the line seems to miss it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes, MAX_DRAWING_PROBLEMS } from "../src/components/scene";
import { sceneSamples } from "../playground/scene-samples";
import { behaviorSceneSamples } from "../playground/behavior-samples";

const on = new Registry([...coreComponents, ...sceneComponents]);
const review = (spec: string, behavior = false) => reviewScenes(parse(spec, on, { behavior }), { behavior }).map((d) => `${d.line}: ${d.message}`);
const OFF = /px off the (path|line) on line/;
const offPath = (spec: string, behavior = false) => review(spec, behavior).filter((m) => OFF.test(m));

/** Two metro lines crossing at Central, with four more stations on them. */
const metro = (central: string, line = (d: string) => `path d="${d}" stroke="#E63946" width=6`) => `scene "Metro map: two lines meeting at Central" w=320 h=240
  ${line("M20 120 L300 120")}
  ${line("M160 20 L160 220").replace("#E63946", "#457B9D")}
  circle x=50 y=120 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'West' name="West"
  circle x=270 y=120 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'East' name="East"
  circle x=160 y=50 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'North' name="North"
  circle x=160 y=190 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'South' name="South"
  ${central}`;
const asLines = (d: string) => {
  const [, x1, y1, x2, y2] = /M(\d+) (\d+) L(\d+) (\d+)/.exec(d)!;
  return `line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke="#E63946" width=6`;
};
const CENTRAL_OFF = `circle x=168 y=128 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'Central' name="Central"`;
const CENTRAL_ON = `circle x=160 y=120 r=12 fill="#FFFFFF" stroke="#1D3557" width=3 on=set:st:'Central' name="Central"`;

describe("a marker just off its path", () => {
  it("flags the shared station both lines miss, once", () => {
    expect(review(`state st=''\n${metro(CENTRAL_OFF)}`)).toEqual([
      `9: Drawing: the marker "Central" is 8 px off the path on line 3, so it looks like it misses it. Move its centre onto the path, or well clear of it if it isn't meant to be on it`,
    ]);
  });

  it("stays quiet on the same map drawn right", () => {
    expect(review(`state st=''\n${metro(CENTRAL_ON)}`)).toEqual([]);
  });

  it("works with line elements, and says line", () => {
    expect(offPath(`state st=''\n${metro(CENTRAL_OFF, asLines)}`)).toEqual([
      expect.stringMatching(/^9: Drawing: the marker "Central" is 8 px off the line on line 3, .* Move its centre onto the line/),
    ]);
    expect(offPath(`state st=''\n${metro(CENTRAL_ON, asLines)}`)).toEqual([]);
  });

  it("measures through a group's move and scale", () => {
    const spec = `state st=''
scene "Metro map, scaled" w=320 h=240
  group x=10 y=10 scale=1.5
    path d="M10 70 L190 70" stroke="#E63946" width=4
    path d="M100 5 L100 145" stroke="#457B9D" width=4
    circle x=30 y=70 r=7 fill="#FFFFFF" on=set:st:'West' name="West"
    circle x=170 y=70 r=7 fill="#FFFFFF" on=set:st:'East' name="East"
    circle x=100 y=20 r=7 fill="#FFFFFF" on=set:st:'North' name="North"
    circle x=100 y=125 r=7 fill="#FFFFFF" on=set:st:'South' name="South"
    circle x=106 y=76 r=7 fill="#FFFFFF" on=set:st:'Central' name="Central"`;
    expect(offPath(spec)).toEqual([expect.stringMatching(/^10: Drawing: the marker "Central" is 9 px off the path on line 4/)]);
    expect(offPath(spec.replace("x=106 y=76", "x=100 y=70"))).toEqual([]);
  });

  it("judges a pressable group by its shapes, and names it by its words", () => {
    const spec = metro(`group x=168 y=128 on=set:st:'Central'
    circle x=0 y=0 r=12 fill="#FFFFFF" stroke="#1D3557" width=3
    label "Central" x=16 y=14 size=12 fill=ink`);
    expect(offPath(`state st=''\n${spec}`)).toEqual([expect.stringMatching(/^9: Drawing: the marker "Central" is 8 px off the path/)]);
  });

  it("follows curves and arcs", () => {
    const spec = `scene "A loop line" w=320 h=240
  path d="M40 120 Q160 0 280 120" stroke="#2A9D8F" width=6
  path d="M60 200 A100 100 0 0 1 260 200" stroke="#E9C46A" width=6
  circle x=40 y=120 r=8 fill="#FFFFFF"
  circle x=280 y=120 r=8 fill="#FFFFFF"
  circle x=160 y=70 r=8 fill="#FFFFFF"
  circle x=160 y=100 r=8 fill="#FFFFFF"
  circle x=60 y=200 r=8 fill="#FFFFFF"
  circle x=160 y=111 r=8 fill="#FFFFFF"`;
    // The quadratic's top is at y=60, so the dot at y=70 is 10 off; the arc's top is y=100, so 111 is 11 off.
    const found = offPath(spec);
    expect(found).toEqual([
      expect.stringMatching(/^6: Drawing: this circle is 10 px off the path on line 2/),
      expect.stringMatching(/^9: Drawing: this circle is 11 px off the path on line 3/),
    ]);
  });

  it("names a plain circle by the label beside it", () => {
    const spec = metro(`circle x=168 y=128 r=10 fill="#FFFFFF"\n  label "Central" x=182 y=140 size=12 fill=ink`);
    expect(offPath(`state st=''\n${spec}`)).toEqual([expect.stringMatching(/^9: Drawing: the marker "Central" is 8 px off/)]);
  });

  it("reports at most three, and keeps the phone summary last", () => {
    const stations = Array.from({ length: 6 }, (_, i) => `  circle x=${40 + i * 50} y=${i % 2 ? 120 : 128} r=6 fill="#FFFFFF"`).join("\n");
    const spec = `scene "Many stations" w=600 h=240
  path d="M20 120 L580 120" stroke="#E63946" width=6
${stations}
  circle x=20 y=120 r=6 fill="#FFFFFF"
  circle x=580 y=120 r=6 fill="#FFFFFF"
  label "tiny" x=10 y=200 size=6 fill=ink`;
    const all = review(spec);
    expect(all.filter((m) => OFF.test(m))).toHaveLength(3);
    expect(all.length).toBeLessThanOrEqual(MAX_DRAWING_PROBLEMS);
    expect(all[all.length - 1]).toMatch(/too small to read on a phone|only .* px tall on a phone/);
  });
});

describe("markers meant to be off a path stay quiet", () => {
  it("a node-link diagram whose links end at the circles' edges", () => {
    expect(offPath(`scene "Three services" w=320 h=240
  line x1=70 y1=60 x2=190 y2=60 stroke="#888888" width=2
  line x1=66 y1=69 x2=124 y2=151 stroke="#888888" width=2
  line x1=194 y1=69 x2=136 y2=151 stroke="#888888" width=2
  circle x=60 y=60 r=10 fill="#2A9D8F"
  circle x=200 y=60 r=10 fill="#2A9D8F"
  circle x=130 y=160 r=10 fill="#2A9D8F"`)).toEqual([]);
  });

  it("a legend swatch next to its sample line", () => {
    expect(offPath(`scene "Metro with a legend" w=320 h=240
  path d="M20 100 L300 100" stroke="#E63946" width=6
  circle x=60 y=100 r=7 fill="#FFFFFF"
  circle x=160 y=100 r=7 fill="#FFFFFF"
  circle x=260 y=100 r=7 fill="#FFFFFF"
  line x1=20 y1=210 x2=50 y2=210 stroke="#E63946" width=6
  circle x=60 y=218 r=5 fill="#E63946"
  label "Red line" x=72 y=218 size=12 fill=ink`)).toEqual([]);
  });

  it("scatter dots around a trend line", () => {
    expect(offPath(`scene "Price against size" w=320 h=240
  path d="M20 200 L300 88" stroke="#457B9D" width=2
  each items={range(40)} as=i
    circle x={20 + i*7} y={200 - 0.4*i*7 + (random(i) - 0.5)*50} r=4 fill="#E76F51"`)).toEqual([]);
  });

  it("a station people drag (behavior on, or the prop written anyway)", () => {
    const spec = `state cx=168 cy=128
${metro(`circle x={cx} y={cy} r=12 fill="#FFFFFF" drag=true name="Central"`).replace(/ on=set:st:'\w+'/g, "")}`;
    expect(offPath(spec, true)).toEqual([]);
    expect(offPath(spec, false)).toEqual([]);
  });

  it("a dot that moves with the clock", () => {
    expect(offPath(`state st=''\n${metro(`circle x={150 + t*6} y=128 r=12 fill="#FFFFFF"`).replace('w=320 h=240', 'w=320 h=240 duration=3')}`)).toEqual([]);
  });

  it("a station on one line with its label near another", () => {
    expect(offPath(`scene "Two lines side by side" w=320 h=240
  path d="M20 110 L300 110" stroke="#E63946" width=6
  path d="M20 126 L300 126" stroke="#457B9D" width=6
  circle x=60 y=110 r=6 fill="#FFFFFF"
  circle x=160 y=110 r=6 fill="#FFFFFF"
  circle x=260 y=110 r=6 fill="#FFFFFF"
  circle x=210 y=126 r=6 fill="#FFFFFF"
  label "Pine" x=150 y=140 size=12 fill=ink`)).toEqual([]);
  });

  it("an interchange spanning two lines", () => {
    expect(offPath(`scene "An interchange" w=320 h=240
  path d="M20 110 L300 110" stroke="#E63946" width=6
  path d="M20 124 L300 124" stroke="#457B9D" width=6
  circle x=60 y=110 r=6 fill="#FFFFFF"
  circle x=260 y=110 r=6 fill="#FFFFFF"
  circle x=60 y=124 r=6 fill="#FFFFFF"
  circle x=260 y=124 r=6 fill="#FFFFFF"
  rect x=150 y=103 w=20 h=28 rx=8 fill="#FFFFFF" stroke="#1D3557" width=2 on=set:st:'Hub'`)).toEqual([]);
  });

  it("a pin whose stem ends at its head", () => {
    expect(offPath(`scene "Pins" w=320 h=240
  path d="M20 200 L300 200" stroke="#888888" width=3
  circle x=60 y=200 r=5 fill="#333333"
  circle x=160 y=200 r=5 fill="#333333"
  line x1=250 y1=120 x2=250 y2=178 stroke="#333333" width=2
  circle x=250 y=188 r=10 fill="#E63946"`)).toEqual([]);
  });
});

/** Every scene the repo already shows: samples, the scene elements' own examples, and the README's and docs' scene blocks. */
function repoScenes(): Array<[string, string, boolean]> {
  const out: Array<[string, string, boolean]> = [];
  for (const [k, v] of Object.entries(sceneSamples)) out.push([`sample ${k}`, v.spec, false]);
  for (const [k, v] of Object.entries(behaviorSceneSamples)) out.push([`behavior sample ${k}`, v.spec, true]);
  for (const c of sceneComponents) {
    if (!c.example) continue;
    out.push([`${c.type} example`, c.type === "scene" ? c.example : `scene "x" w=600 h=340 duration=3\n${c.example.split("\n").map((l) => `  ${l}`).join("\n")}`, false]);
  }
  for (const file of ["README.md", "docs/engine.md", "docs/language.md"]) {
    const text = readFileSync(resolve(__dirname, "..", file), "utf8");
    [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => /^\s*scene "/m.test(b)).forEach((b, i) => out.push([`${file} block ${i}`, b, false]));
  }
  return out;
}

describe("the repo's own scenes", () => {
  const scenes = repoScenes();
  it("finds them", () => {
    expect(scenes.length).toBeGreaterThan(10);
  });
  it.each(scenes)("%s gets no marker-off-its-path warning", (_name, spec, behavior) => {
    expect(offPath(spec, behavior)).toEqual([]);
  });
});

describe("cost", () => {
  it("reviews 300 dots near 20 long paths quickly", () => {
    const paths = Array.from({ length: 20 }, (_, k) => {
      const pts = Array.from({ length: 200 }, (_, i) => `${i === 0 ? "M" : "L"}${(i * 3).toFixed(0)} ${(20 + k * 15 + 6 * Math.sin(i / 7 + k)).toFixed(1)}`).join(" ");
      return `  path d="${pts}" stroke="#457B9D" width=3`;
    }).join("\n");
    const spec = `scene "Busy" w=600 h=340\n${paths}\n  each items={range(300)} as=i\n    circle x={random(i)*600} y={random(i + 7)*340} r=4 fill="#E76F51"`;
    const parsed = parse(spec, on);
    reviewScenes(parsed);
    const start = performance.now();
    reviewScenes(parsed);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("tappable stations (a 44 px tap area around each)", () => {
  // The metro map from chat: stations are groups with a big, nearly clear tap circle and a small
  // visible one. The tap area was too big to judge and the circle inside was skipped with it, so
  // a station 20 px off its line was never reported.
  const map = (college: string) => `state sel=""
state stations=[{name: "Harbor", x: 40, y: 120}, {name: "Market", x: 220, y: 120}, {name: "Central", x: 300, y: 200}, {name: "Riverside", x: 560, y: 260}, {name: "Airport", x: 60, y: 300}, {name: "College", x: 200, y: ${college}}, {name: "Uptown", x: 560, y: 140}]
scene "Two metro lines crossing at Central" w=600 h=360
  path d="M40 120 L220 120 L360 260 L560 260" fill="none" stroke=bad width=10 cap=round join=round round=24
  path d="M60 300 L200 300 L360 140 L560 140" fill="none" stroke=good width=10 cap=round join=round round=24
  each items=stations as=s
    group x={s.x} y={s.y} on=set:sel:{s.name} tip="{s.name}"
      rect x=-22 y=-22 w=44 h=44 rx=22 fill="surface 1%"
      circle x=0 y=0 r=8 fill=surface stroke=ink width=3
      label "{s.name}" x=0 y=-30 size=15 align=center fill=ink`;

  it("reports the one drawn off its line", () => {
    const found = offPath(map("320"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/px off the path on line 5/);
  });

  it("says nothing when every station is on its line", () => {
    expect(offPath(map("300"))).toEqual([]);
  });
});
