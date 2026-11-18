/**
 * WS5: clip=true on a scene group, icons inside scenes (glyph, written icon
 * inside a scene) and after= on shapes that follow a label.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScene, reviewScenes, type MeasureText } from "../src/components/scene";
import { darkTheme, lightTheme } from "../src/theme";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";

const ALL = [...coreComponents, ...sceneComponents];
const reg = new Registry(ALL);
const THEMES = [lightTheme, darkTheme];

/** Warnings and errors for a spec, as "severity: message". */
const problems = (spec: string) => parse(spec, reg).diagnostics.map((d) => `${d.severity}: ${d.message}`);
/** The first scene's box, and a function from scene coordinates to canvas pixels. */
function sceneAt(ui: Rendered, w: number, h: number) {
  const box = ui.find({ type: "scene" }).box as Box;
  return { box, at: (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h] };
}
const sceneHits = (ui: Rendered) => ui.hits.filter((h) => h.box.node.type === "scene");
/**
 * Paint again, noting each clip() and each accent stroke in order (the
 * recording canvas keeps only rectangular clips, and these are rounded).
 */
function paintTrace(ui: Rendered): string[] {
  const g = ui.canvas.getContext("2d") as unknown as Record<string, unknown>;
  const seq: string[] = [];
  const clip = g.clip as () => void, stroke = g.stroke as () => void, fill = g.fill as () => void;
  g.clip = () => { seq.push("clip"); clip(); };
  g.fill = () => { seq.push("fill"); fill(); };
  g.stroke = () => { if (g.strokeStyle === lightTheme.colors.accent) seq.push("outline"); stroke(); };
  ui.sayshape.invalidate("paint");
  ui.sayshape.renderNow();
  g.clip = clip; g.stroke = stroke; g.fill = fill;
  return seq;
}
/** Every prefix of a spec, cut at line boundaries, parses without an error. */
function streams(spec: string): void {
  const lines = spec.split("\n");
  for (let i = 1; i <= lines.length; i++) {
    const r = parse(lines.slice(0, i).join("\n") + "\n", reg);
    expect(r.diagnostics.filter((d) => d.severity === "error"), `prefix of ${i} lines`).toEqual([]);
  }
}

describe("clip=true on a group", () => {
  it("parses w, h, rx and clip, and warns when they don't go together", () => {
    expect(problems(`scene "S" w=300 h=200\n  group x=10 y=10 w=100 h=80 rx=12 clip=true\n    circle x=0 y=0 r=40 fill=accent`)).toEqual([]);
    expect(problems(`scene "S" w=300 h=200\n  group x=10 y=10 clip=true\n    circle x=0 y=0 r=40`)).toEqual([
      "warning: clip=true needs w= and h=, the size of the box its shapes are cut to",
    ]);
    expect(problems(`scene "S" w=300 h=200\n  group x=10 y=10 w=100 h=80\n    circle x=0 y=0 r=40`)).toEqual([
      "warning: w= and h= only size a group's clip=true box; add clip=true, or leave them out",
    ]);
    expect(problems(`scene "S" w=300 h=200\n  group w=100 h=80 clip=maybe`)[0]).toMatch(/clip/);
  });

  it("streams: every prefix of a clipped group parses", () => {
    streams(`scene "Phone" w=200 h=400\n  group x=10 y=10 w=180 h=380 rx=30 clip=true\n    circle x=160 y=20 r=90 fill="accent 40%" glow=true\n    rect x=0 y=0 w=180 h=40 fill=surface`);
  });

  it("cuts drawing to the group's rounded box", () => {
    const spec = (clip: string) => `scene "S" w=300 h=200\n  group x=20 y=30 w=100 h=80 rx=12${clip}\n    circle x=0 y=0 r=200 fill=accent`;
    const ui = render(spec(" clip=true"), { components: ALL, width: 300 });
    // The scene's own rounded edge, then the group's box, before the circle.
    expect(paintTrace(ui)).toEqual(["clip", "clip", "fill"]);
    ui.destroy();
    const plain = render(spec(""), { components: ALL, width: 300 });
    expect(paintTrace(plain)).toEqual(["clip", "fill"]);
    plain.destroy();
  });

  for (const theme of THEMES) {
    it(`a pressable circle partly outside the clip is hit inside and not outside (${theme === darkTheme ? "dark" : "light"})`, () => {
      const spec = `state n=0\nscene "S" w=300 h=200\n  group x=50 y=50 w=100 h=100 rx=0 clip=true\n    circle x=100 y=50 r=50 fill=accent on=inc:n name="Half"`;
      const ui = render(spec, { components: ALL, width: 300, theme });
      const { at } = sceneAt(ui, 300, 200);
      // Its region covers only the part inside the clip: x 150..200 in the scene is cut off.
      const hit = sceneHits(ui)[0]!;
      const [right] = at(150, 0);
      expect(hit.box.x + hit.box.w).toBeCloseTo(right, 0);
      ui.click(...at(190, 100));
      expect(ui.state.n).toBe(0);
      ui.click(...at(130, 100));
      expect(ui.state.n).toBe(1);
      ui.destroy();
    });
  }

  it("a pressable shape clipped away entirely has no hit, no Tab stop and no part", () => {
    const spec = `state n=0\nscene "S" w=300 h=200\n  group x=0 y=0 w=100 h=100 clip=true\n    circle x=250 y=150 r=20 fill=accent on=inc:n name="Hidden"`;
    const ui = render(spec, { components: ALL, width: 300 });
    expect(sceneHits(ui)).toEqual([]);
    ui.tab();
    expect(ui.focused?.type).not.toBe("scene");
    // A plain picture, with no parts to reach.
    expect(ui.accessibility({ full: true }).children[0]!.role).toBe("img");
    ui.destroy();
  });

  it("cuts the focus outline to the clip", () => {
    const spec = `state n=0\nscene "S" w=300 h=200\n  group x=50 y=50 w=100 h=100 clip=true\n    circle x=100 y=50 r=50 fill=accent on=inc:n name="Half"`;
    const ui = render(spec, { components: ALL, width: 300 });
    ui.tab();
    expect(ui.focused?.type).toBe("scene");
    // Scene edge, the group, the circle; then the outline, cut to the group again.
    expect(paintTrace(ui)).toEqual(["clip", "clip", "fill", "clip", "outline"]);
    ui.destroy();
  });

  it("review: drops what a clip hides and warns about a label it cuts", () => {
    const cutLabel = parse(`scene "S" w=300 h=200\n  group x=0 y=0 w=100 h=100 clip=true\n    label "Phoenix weather" x=40 y=50 size=20 fill=ink`, reg);
    expect(reviewScenes(cutLabel).map((d) => d.message)).toContain(
      `Drawing: the label "Phoenix weather" is cut off by the clipped group on line 2. Move it inside or make the group bigger`,
    );
    // A label entirely outside the clip isn't drawn, so it isn't off the picture's edge either.
    const hidden = parse(`scene "S" w=300 h=200\n  group x=0 y=0 w=100 h=100 clip=true\n    label "Gone" x=280 y=50 size=20 fill=ink`, reg);
    expect(reviewScenes(hidden)).toEqual([]);
    // A glow blob bigger than the screen is cut by it, not reported.
    const blobs = parse(`scene "S" w=300 h=200\n  group x=0 y=0 w=300 h=200 rx=30 clip=true\n    circle x=280 y=0 r=150 fill="accent 40%"`, reg);
    expect(reviewScenes(blobs)).toEqual([]);
  });
});

describe("icons in a scene", () => {
  const nodeTypes = (spec: string) => {
    const out: string[] = [];
    const walk = (n: { type: string; children: readonly { type: string; children: readonly unknown[] }[] }) => {
      out.push(n.type);
      for (const c of n.children) walk(c as typeof n);
    };
    walk(parse(spec, reg).root);
    return out.slice(1);
  };

  it("reads icon inside a scene as the scene's glyph, silently", () => {
    const spec = `scene "S" w=300 h=200\n  icon name=sun x=10 y=20 size=30 fill=warn\n  group x=50 y=50\n    icon name=heart x=0 y=0\n  each items={range(2)} as=i\n    icon name=star x={i*40} y=100`;
    expect(problems(spec)).toEqual([]);
    expect(nodeTypes(spec)).toEqual(["scene", "glyph", "group", "glyph", "each", "glyph"]);
    // glyph is its own name too.
    expect(problems(`scene "S" w=300 h=200\n  glyph name=sun x=10 y=20`)).toEqual([]);
  });

  it("warns about a name that isn't an icon, as icon does", () => {
    const main = problems(`icon name=tick`);
    expect(main).toHaveLength(1);
    expect(problems(`scene "S" w=300 h=200\n  icon name=tick x=10 y=20`)).toEqual(main);
    expect(main[0]).toMatch(/^warning: name="tick" isn't an icon\. Did you mean name=check\?/);
    expect(problems(`scene "S" w=300 h=200\n  icon x=10 y=20`)).toEqual([`warning: "glyph" needs name=`]);
    expect(problems(`scene "S" w=300 h=200\n  icon name=sun x=10 y=20 size=12px`)[0]).toMatch(/size/);
  });

  it("outside a scene, icon is the main element and glyph isn't allowed", () => {
    expect(nodeTypes(`icon name=sun tone=warn`)).toEqual(["icon"]);
    expect(problems(`icon name=sun tone=warn`)).toEqual([]);
    expect(problems(`icon name=sun x=10`)[0]).toMatch(/^warning: "icon" has no prop "x"/);
    expect(problems(`glyph name=sun x=10 y=10`)).toEqual([`error: "glyph" only goes inside scene or group or define`]);
    // Without scenes registered, glyph is unknown and icon is unchanged.
    const core = new Registry(coreComponents);
    expect(parse(`glyph name=sun`, core).diagnostics[0]!.message).toMatch(/Unknown element "glyph"/);
    expect(parse(`icon name=sun`, core).diagnostics).toEqual([]);
  });

  it("streams: every prefix of a scene with icons parses", () => {
    streams(`state liked=false\nscene "Apps" w=300 h=200\n  rect x=20 y=20 w=60 h=60 rx=14 fill=accent\n  icon name=heart x=34 y=50 size=32 fill=onAccent on=toggle:liked tip="Like"\n  label "Likes" x=20 y=100 size=14 fill=ink`);
  });

  for (const theme of THEMES) {
    it(`draws in the theme color it names (${theme === darkTheme ? "dark" : "light"})`, () => {
      const ui = render(`scene "S" w=300 h=200\n  icon name=sun x=10 y=100 size=40 fill=accent`, { components: ALL, width: 300, theme });
      const strokes = ui.drawOps.filter((o) => o.op === "stroke");
      expect(strokes.length).toBeGreaterThan(0);
      expect(strokes.every((o) => o.strokeStyle === theme.colors.accent)).toBe(true);
      ui.destroy();
    });
  }

  it("a pressable icon's region is its size, and pressing it runs on=", () => {
    const ui = render(`state n=0\nscene "S" w=300 h=200\n  icon name=heart x=100 y=100 size=40 fill=bad on=inc:n`, { components: ALL, width: 300 });
    const { box, at } = sceneAt(ui, 300, 200);
    const k = box.w / 300;
    const hit = sceneHits(ui)[0]!;
    expect(hit.box.w).toBeCloseTo(40 * k, 5);
    expect(hit.box.h).toBeCloseTo(40 * k, 5);
    expect(hit.box.x).toBeCloseTo(at(100, 0)[0], 5);
    expect(hit.box.y).toBeCloseTo(at(0, 80)[1], 5);
    ui.click(...at(120, 100));
    expect(ui.state.n).toBe(1);
    ui.click(...at(160, 100));
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });

  it("Tab reaches a pressable icon, Enter presses it, and it has a screen-reader name", () => {
    const parts = (spec: string) => {
      const ui = render(spec, { components: ALL, width: 300 });
      const p = ui.accessibility({ full: true }).children[0]!;
      ui.destroy();
      return p;
    };
    const ui = render(`state liked=false\nscene "S" w=300 h=200\n  icon name=heart x=100 y=100 size=40 on=toggle:liked tip="Like this photo"`, { components: ALL, width: 300 });
    ui.tab();
    expect(ui.focused?.type).toBe("scene");
    ui.key("Enter");
    expect(ui.state.liked).toBe(true);
    ui.destroy();
    const named = (extra: string) => JSON.stringify(parts(`state n=0\nscene "S" w=300 h=200\n  icon name=arrow-right x=100 y=100 size=40 on=inc:n${extra}`));
    expect(named(` tip="Next"`)).toContain(`"role":"button","name":"Next"`);
    expect(named(` tip="Next" label="Go on"`)).toContain(`"role":"button","name":"Go on","description":"Next"`);
    expect(named(``)).toContain(`"role":"button","name":"arrow right"`);
    // Not pressable: decoration, and the scene stays a plain picture.
    expect(parts(`scene "S" w=300 h=200\n  icon name=sun x=100 y=100 size=40`).role).toBe("img");
  });

  it("review: an icon name a formula works out to that isn't an icon", () => {
    const r = parse(`state kind="sunny"\nscene "S" w=300 h=200\n  icon name={kind} x=100 y=100 size=40`, reg);
    expect(r.diagnostics).toEqual([]);
    expect(reviewScenes(r).map((d) => `${d.line}: ${d.message}`)).toEqual([
      `3: Drawing: this icon's name works out to "sunny", which isn't an icon. Use one of icon's names`,
    ]);
    const ok = parse(`state kind="sun"\nscene "S" w=300 h=200\n  icon name={kind} x=100 y=100 size=40`, reg);
    expect(reviewScenes(ok)).toEqual([]);
  });
});

describe("after= places a shape after a label's words", () => {
  it("parses id= on labels and after= on every shape, group and use", () => {
    const lines = [
      `rect after=city x=8 y=0 w=10 h=10`, `circle after=city x=8 y=0 r=5`, `ellipse after=city x=8 y=0 rx=5 ry=3`,
      `line after=city x1=0 y1=0 x2=10 y2=0 stroke=ink`, `path after=city d="M0 0 L10 10"`, `polygon after=city points="0,0 10,0 5,8"`,
      `label "AZ" after=city x=8 y=50`, `icon name=arrow-right after=city x=8 y=50`, `group after=city x=8 y=0`, `use "dot" after=city x=8 y=50`,
    ];
    const spec = [`scene "S" w=300 h=200`, `  define "dot"`, `    circle x=0 y=0 r=4`, `  label "Phoenix" id=city x=10 y=50`, ...lines.map((l) => `  ${l}`)].join("\n");
    expect(problems(spec)).toEqual([]);
    expect(problems(`scene "S" w=300 h=200\n  label "Phoenix" id="the city" x=10 y=50`)[0]).toMatch(/^warning: id should be a plain name/);
    expect(problems(`scene "S" w=300 h=200\n  circle after="two words" x=8 y=0 r=5`)[0]).toMatch(/^warning: after should be a plain name/);
    expect(problems(`scene "S" w=300 h=200\n  gradient id=g after=city`)[0]).toMatch(/"gradient" has no prop "after"/);
  });

  it("streams: every prefix with after= parses", () => {
    streams(`scene "S" w=300 h=200\n  label "Phoenix" id=city x=10 y=50 size=24\n  icon name=arrow-right after=city x=8 y=50 size=24\n  label "AZ" after=city x=40 y=50`);
  });

  /** Where a pressable label's words end and a pressable icon after it starts, in canvas pixels, and the scene's scale. */
  function placed(label: string, icon: string, theme = lightTheme) {
    const spec = `state n=0\nscene "S" w=400 h=200\n${label}\n  icon name=arrow-right after=city x=8 y=100 size=24 on=inc:n tip="Go"`;
    const ui = render(spec, { components: ALL, width: 400, theme });
    expect(ui.diagnostics).toEqual([]);
    const { box } = sceneAt(ui, 400, 200);
    const [words, arrow] = sceneHits(ui);
    ui.destroy();
    return { end: words!.box.x + words!.box.w, start: arrow!.box.x, k: box.w / 400 };
  }

  for (const theme of THEMES) {
    it(`an arrow with after=city x=8 starts 8 past the end of "Phoenix" at any size, weight or text (${theme === darkTheme ? "dark" : "light"})`, () => {
      for (const label of [
        `  label "Phoenix" id=city x=20 y=100 size=16 fill=ink on=inc:n`,
        `  label "Phoenix" id=city x=20 y=100 size=40 fill=ink on=inc:n`,
        `  label "Phoenix" id=city x=20 y=100 size=40 weight=bold fill=ink on=inc:n`,
        `  label "Phoenix, Arizona" id=city x=20 y=100 size=16 weight=light fill=ink on=inc:n`,
        `  label "Phoenix" id=city x=200 y=100 size=24 align=center fill=ink on=inc:n`,
        `  label "Phoenix" id=city x=300 y=100 size=24 align=right fill=ink on=inc:n`,
        // In a group scaled up: the end is found on screen, and the gap is in the arrow's own coordinates.
        `  group x=10 y=0 scale=1.5\n    label "Phoenix" id=city x=0 y=66 size=20 fill=ink on=inc:n`,
      ]) {
        const { end, start, k } = placed(label, "", theme);
        expect(start - end, label).toBeCloseTo(8 * k, 5);
      }
    });
  }

  it("bigger or bolder words push the arrow further along", () => {
    const small = placed(`  label "Phoenix" id=city x=20 y=100 size=16 fill=ink on=inc:n`, "");
    const big = placed(`  label "Phoenix" id=city x=20 y=100 size=40 weight=bold fill=ink on=inc:n`, "");
    expect(big.start).toBeGreaterThan(small.start + 20);
  });

  it("each copy of a label: the last one drawn before counts", () => {
    const spec = `state n=0\nscene "S" w=400 h=200\n  each items={['A', 'Phoenix']} as=c\n    label "{c}" id=city x=20 y=100 size=20 fill=ink\n  label "Phoenix" x=20 y=150 size=20 fill=ink on=inc:n\n  icon name=arrow-right after=city x=8 y=100 size=24 on=inc:n`;
    const ui = render(spec, { components: ALL, width: 400 });
    const [words, arrow] = sceneHits(ui);
    const k = sceneAt(ui, 400, 200).box.w / 400;
    expect(arrow!.box.x - (words!.box.x + words!.box.w)).toBeCloseTo(8 * k, 5);
    ui.destroy();
  });

  it("with no label drawn before it, it's drawn at its plain x and the drawing check says so", () => {
    const spec = `state n=0\nscene "S" w=400 h=200\n  icon name=arrow-right after=city x=8 y=100 size=24 on=inc:n\n  label "Phoenix" id=city x=20 y=100 size=20 fill=ink`;
    const ui = render(spec, { components: ALL, width: 400 });
    const { at } = sceneAt(ui, 400, 200);
    expect(sceneHits(ui)[0]!.box.x).toBeCloseTo(at(8, 0)[0], 5);
    ui.destroy();
    expect(reviewScenes(parse(spec, reg)).map((d) => `${d.line}: ${d.message}`)).toContain(
      `3: Drawing: after=city names no label drawn before this line. Give a label above it id=city, or set x= on its own`,
    );
  });

  it("review places it with whatever measures the words", () => {
    const spec = `scene "S" w=300 h=100\n  label "Phoenix" id=city x=60 y=50 size=20 fill=ink\n  label "AZ, USA" after=city x=6 y=50 size=20 fill=ink`;
    const scene = parse(spec, reg).root.children[0]!;
    const narrow: MeasureText = (text, size) => text.length * size * 0.4;
    const wide: MeasureText = (text, size) => text.length * size * 1.1;
    const scope = () => undefined;
    // Narrow words: "AZ, USA" ends well inside the picture, never on top of Phoenix.
    expect(reviewScene(scene, scope, { measure: narrow })).toEqual([]);
    // Wide words push it past the right edge, and it still doesn't sit on Phoenix.
    const wideProblems = reviewScene(scene, scope, { measure: wide }).map((d) => d.message);
    expect(wideProblems).toEqual([`Drawing: the label "AZ, USA" is cut off by the right edge of the picture. Move it in or make it smaller`]);
  });
});

describe("acceptance: a phone screen", () => {
  const PHONE = [
    `state liked=false`,
    `scene "A phone's home screen" w=393 h=852 maxw=295`,
    `  rect x=0 y=0 w=393 h=852 rx=56 fill="#111111"`,
    `  group x=12 y=12 w=369 h=828 rx=46 clip=true`,
    `    rect x=0 y=0 w=369 h=828 fill="#1B2440"`,
    `    circle x=330 y=40 r=220 fill="#7C5CFF" opacity=0.6 glow=true`,
    `    circle x=20 y=780 r=260 fill="#FF6B8B" opacity=0.5 glow=true`,
    `    label "Phoenix" id=city x=32 y=110 size=34 weight=bold fill="#FFFFFF"`,
    `    icon name=arrow-right after=city x=8 y=110 size=28 fill="#FFFFFF"`,
    `    label "72°" x=32 y=170 size=56 weight=light fill="#FFFFFF"`,
    `    each items={range(4)} as=i`,
    `      rect x={32 + i*80} y=300 w=64 h=64 rx=16 fill="#FFFFFF" opacity=0.9`,
    `      icon name={pick(['sun', 'mail', 'image', 'heart'], i)} x={48 + i*80} y=332 size=32 fill="#1B2440" on=toggle:liked tip={pick(['Weather', 'Mail', 'Photos', 'Likes'], i)}`,
  ].join("\n");

  it("parses and streams cleanly, and the drawing check finds nothing wrong", () => {
    const r = parse(PHONE, reg);
    expect(r.diagnostics).toEqual([]);
    streams(PHONE);
    expect(reviewScenes(r)).toEqual([]);
  });

  for (const theme of THEMES) {
    it(`clips the wallpaper, presses the app icons and names them (${theme === darkTheme ? "dark" : "light"})`, () => {
      const ui = render(PHONE, { components: ALL, width: 400, theme });
      const hits = sceneHits(ui);
      expect(hits).toHaveLength(4);
      ui.tab();
      ui.key("Enter");
      expect(ui.state.liked).toBe(true);
      const tree = JSON.stringify(ui.accessibility({ full: true }));
      for (const name of ["Weather", "Mail", "Photos", "Likes"]) expect(tree).toContain(`"role":"button","name":"${name}"`);
      ui.destroy();
    });
  }
});

describe("named fills on scene shapes", () => {
  it("fill=sky paints the same theme gradient as card fill=sky, light and dark; accent stays solid", async () => {
    const { fillOf } = await import("../src/fills");
    const { darkTheme: dark, lightTheme: light } = await import("../src/theme");
    const { coreComponents: core } = await import("../src/components");
    const { sceneComponents: scenes } = await import("../src/components/scene");
    const { render: draw } = await import("../src/testing");
    for (const theme of [light, dark]) {
      const ui = draw(`scene "Sky" w=200 h=100\n  rect x=0 y=0 w=200 h=100 fill=sky\n  circle x=50 y=50 r=10 fill=accent`, { components: [...core, ...scenes], theme });
      expect(ui.diagnostics).toEqual([]);
      const sky = fillOf(ui.sayshape.theme, "sky")!;
      const grad = ui.drawOps.find((op) => op.op === "fill" && op.gradientStops?.length);
      expect(grad?.gradientStops?.map((s) => s.color)).toEqual([sky.from, sky.to]);
      expect(ui.drawOps.some((op) => op.op === "fill" && op.fillStyle === ui.sayshape.theme.colors.accent)).toBe(true);
    }
  });
});
