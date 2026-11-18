/**
 * z= in scenes (S3, src/components/scene/depth.ts): siblings drawn back to
 * front by z, each copies and if blocks sorted with their parent's lines,
 * sorting per parent only, lets kept where they were written, presses
 * following what's drawn on top, and the parser's view of the prop.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { hasDepth } from "../src/components/scene/depth";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];
const reg = new Registry(ON);

/** The fill colors of the shapes drawn, in order. */
const fills = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fill").map((o) => String(o.fillStyle));
const fillsOf = (spec: string) => {
  const ui = render(spec, { components: ON });
  const out = fills(ui);
  ui.destroy();
  return out;
};
const sceneAt = (ui: Rendered, w: number, h: number) => {
  const box = ui.find({ type: "scene" }).box as Box;
  return (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h];
};

describe("z: drawing order", () => {
  it("draws siblings in ascending z, no z counting as 0 and ties in written order", () => {
    expect(fillsOf(`scene "Four boxes" w=400 h=200
  rect x=0 y=0 w=50 h=50 fill="#000002" z=2
  rect x=0 y=0 w=50 h=50 fill="#00000a"
  rect x=0 y=0 w=50 h=50 fill="#000009" z=-1
  rect x=0 y=0 w=50 h=50 fill="#000000" z=0`)).toEqual(["#000009", "#00000a", "#000000", "#000002"]);
  });

  it("counts a z that isn't a number as 0", () => {
    expect(fillsOf(`scene "Boxes" w=400 h=200
  rect x=0 y=0 w=50 h=50 fill="#00000a" z="abc"
  rect x=0 y=0 w=50 h=50 fill="#00000b" z=-1
  rect x=0 y=0 w=50 h=50 fill="#00000c"`)).toEqual(["#00000b", "#00000a", "#00000c"]);
  });

  it("moves planets inside each behind and in front of a Sun written beside the each", () => {
    const spec = `state planets=[{id: "earth", r: 150, per: 4, c: "#2a9d8f"}]
scene "A planet circling the Sun" w=600 h=400 duration=40
  each items={planets} as=p
    let a={t*6.2832/p.per}
    circle x={300 + p.r*cos(a)} y={200 + p.r*0.3*sin(a)} r=10 fill={p.c} z={sin(a)}
  circle x=300 y=200 r=30 fill="#ffd166" z=0`;
    const ui = render(spec, { components: ON, animate: true, clock: true });
    // t=1: a is a quarter turn, sin(a)=1, the planet passes in front.
    ui.clock.advance(1000);
    expect(fills(ui)).toEqual(["#ffd166", "#2a9d8f"]);
    // t=3: three quarters, sin(a)=-1, behind.
    ui.clock.advance(2000);
    expect(fills(ui)).toEqual(["#2a9d8f", "#ffd166"]);
    ui.destroy();
  });

  it("sorts per parent: a group's children stay inside it whatever their z", () => {
    expect(fillsOf(`scene "Layers" w=400 h=200
  rect x=0 y=0 w=50 h=50 fill="#00aa00" z=0
  group x=10 y=10 z=-1
    rect x=0 y=0 w=50 h=50 fill="#aa0000" z=99
    rect x=0 y=0 w=50 h=50 fill="#0000aa" z=1`)).toEqual(["#0000aa", "#aa0000", "#00aa00"]);
  });

  it("sorts lines in if blocks with their parent's lines", () => {
    expect(fillsOf(`state on=true
scene "If" w=400 h=200
  rect x=0 y=0 w=50 h=50 fill="#00000a" z=1
  if={on}
    rect x=0 y=0 w=50 h=50 fill="#00000b" z=-1
  rect x=0 y=0 w=50 h=50 fill="#00000c"`)).toEqual(["#00000b", "#00000c", "#00000a"]);
  });

  it("keeps a let out of reach of a line written above it, even when that line is drawn after", () => {
    const ui = render(`state a=1
scene "Lets" w=400 h=200
  label "above {a}" x=10 y=20 z=5
  let a={100}
  label "below {a}" x=10 y=60`, { components: ON });
    expect(ui.text()).toEqual(["below 100", "above 1"]);
    ui.destroy();
  });

  it("looks for z in each and if blocks, not inside groups", () => {
    const r = parse(`scene "S" w=100 h=100
  each items={range(2)} as=i
    if={i > 0}
      circle x=1 y=1 r=1 z=1
  group
    circle x=1 y=1 r=1 z=1
  circle x=1 y=1 r=1`, reg);
    const scene = r.root.children[0]!;
    expect(hasDepth(scene.children)).toBe(true);
    expect(hasDepth(scene.children.slice(1))).toBe(false);
    expect(hasDepth(scene.children[1]!.children)).toBe(true);
  });
});

describe("z: pressing follows what's on top", () => {
  it("presses the shape drawn on top of overlapping ones", () => {
    const ui = render(`state hit=''
scene "Stack" w=400 h=200
  rect x=20 y=20 w=200 h=150 fill=line on=set:hit:'back' z=1
  rect x=100 y=60 w=100 h=60 fill=accent on=set:hit:'front'`, { components: ON });
    const at = sceneAt(ui, 400, 200);
    ui.click(...at(150, 90));
    expect(ui.state.hit).toBe("back");
    ui.destroy();
  });

  it("presses the right each copy, with its own item", () => {
    const ui = render(`state sel='' items=[{id: "a"}, {id: "b"}, {id: "c"}]
scene "Coins" w=400 h=200
  each items={items} as=p index=i
    circle x={100 + i*40} y=100 r=30 fill=accent z={-i} on=set:sel:{p.id}`, { components: ON });
    const at = sceneAt(ui, 400, 200);
    // Where copies a and b overlap, a is drawn last (z=0 over -1), so it's pressed.
    ui.click(...at(120, 100));
    expect(ui.state.sel).toBe("a");
    ui.click(...at(160, 100));
    expect(ui.state.sel).toBe("b");
    ui.click(...at(200, 100));
    expect(ui.state.sel).toBe("c");
    ui.destroy();
  });

  it("writes through the item of the copy pressed, with lets around it", () => {
    const ui = render(`state items=[{id: "a", on: false}, {id: "b", on: false}]
scene "Switches" w=400 h=200
  let k={2}
  each items={items} as=p index=i
    let x={100 + i*100}
    circle x={x} y=100 r=30 fill=accent z={-i} on=set:p.on:true
  rect x=0 y=0 w=10 h=10 fill=line z=-5`, { components: ON });
    const at = sceneAt(ui, 400, 200);
    ui.click(...at(200, 100));
    expect(ui.state.items).toEqual([{ id: "a", on: false }, { id: "b", on: true }]);
    ui.click(...at(100, 100));
    expect(ui.state.items).toEqual([{ id: "a", on: true }, { id: "b", on: true }]);
    ui.destroy();
  });

  it("presses a shape inside a pressable group over the group, and the group over a sibling it's drawn above", () => {
    const ui = render(`state hit=''
scene "Machine" w=400 h=200
  group x=100 y=20 z=1 on=set:hit:'machine'
    rect x=0 y=0 w=120 h=150 fill=surface stroke=line
    circle x=60 y=40 r=16 fill=good on=set:hit:'light'
  rect x=0 y=0 w=400 h=200 fill=line on=set:hit:'floor'`, { components: ON });
    const at = sceneAt(ui, 400, 200);
    ui.click(...at(160, 60));
    expect(ui.state.hit).toBe("light");
    ui.click(...at(160, 140));
    expect(ui.state.hit).toBe("machine");
    ui.click(...at(20, 20));
    expect(ui.state.hit).toBe("floor");
    ui.destroy();
  });
});

describe("z: parsing", () => {
  it("takes z on shapes, groups and uses without a word, and warns about z on each", () => {
    const ok = parse(`scene "S" w=100 h=100
  define "dot"
    circle x=0 y=0 r=3 z=1
  rect x=1 y=1 w=2 h=2 z={sin(t)}
  circle x=1 y=1 r=1 z=-1
  ellipse x=1 y=1 rx=1 ry=1 z=2
  line x1=0 y1=0 x2=1 y2=1 stroke=ink z=1
  path d="M0 0 L1 1" stroke=ink z=1
  polygon points="0,0 1,0 0,1" z=1
  label "Hi" x=1 y=1 z=3
  group z=1
    circle x=1 y=1 r=1
  use "dot" x=5 y=5 z=4`, reg);
    expect(ok.diagnostics).toEqual([]);
    const each = parse(`scene "S" w=100 h=100
  each items={range(2)} as=i z=1
    circle x=1 y=1 r=1`, reg);
    expect(each.diagnostics.map((d) => `${d.line} ${d.severity}`)).toEqual(["2 warning"]);
    expect(each.diagnostics[0]!.message).toMatch(/"each" has no prop "z"/);
  });
});
