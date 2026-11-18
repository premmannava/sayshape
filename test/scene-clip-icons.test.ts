/**
 * WS5: clip=true on a scene group, icons inside scenes (glyph, written icon
 * inside a scene) and after= on shapes that follow a label.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
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
