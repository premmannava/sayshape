/**
 * The page bench/browser/run.mjs drives: a scene of N pressable (or plain)
 * objects, animating, in a container whose width can change. It measures in
 * the page and reports to window.__bench.
 */
import { SayShape } from "../../src/engine";
import { coreComponents } from "../../src/components";
import { sceneComponents } from "../../src/components/scene";
import { lightTheme } from "../../src/theme";

/** N machines in a grid, each a body, a pulsing status light and a name, all animating. */
export function sceneOf(n: number, pressable: boolean, moving = false): string {
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  const w = cols * 60, h = rows * 60;
  const on = pressable ? ` on=set:sel:{i} selected={sel == i} tip="Unit {i + 1}"` : "";
  return `state sel=0
scene "${n} units" w=${w} h=${h} duration=4
  each items={range(${n})} as=i
    group x={30 + (i % ${cols}) * 60${moving ? " + 6 * sin(t * 2 * PI / 4 + i)" : ""}} y={30 + floor(i / ${cols}) * 60}${on}
      rect x=-26 y=-24 w=52 h=48 rx=8 fill=raised stroke=line width=2
      circle x=16 y=-12 r={4 + 2 * wave(t + i / 10, 1)} fill={pick(['good', 'warn', 'bad'], i)}
      label "{i + 1}" x=-16 y=8 size=14 weight=bold fill=ink`;
}

declare global {
  interface Window {
    __bench: {
      ready: boolean;
      load(n: number, pressable: boolean, moving?: boolean): void;
      frames(ms: number): Promise<number[]>;
      paints: number[];
      hitTest(count: number): number[];
      mirrorUpdates: number;
      treeMs(count: number): number[];
      ui: SayShape;
    };
  }
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ui = new SayShape(canvas, { components: [...coreComponents, ...sceneComponents], theme: lightTheme });
const paints: number[] = [];
ui.on("render", (m) => paints.push(m.paintMs));
let mirrorUpdates = 0;
new MutationObserver((list) => { mirrorUpdates += list.length; }).observe(document.body, { subtree: true, childList: true, attributes: true });

window.__bench = {
  ready: true,
  ui,
  paints,
  get mirrorUpdates() { return mirrorUpdates; },
  set mirrorUpdates(v: number) { mirrorUpdates = v; },
  load(n, pressable, moving = false) {
    ui.setSpec(sceneOf(n, pressable, moving), { resetState: true });
    ui.renderNow();
  },
  /** Frame-to-frame intervals from requestAnimationFrame for ms milliseconds. */
  frames(ms) {
    return new Promise((done) => {
      const out: number[] = [];
      let last = performance.now();
      const end = last + ms;
      const tick = (t: number) => {
        out.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(tick); else done(out.slice(1));
      };
      requestAnimationFrame(tick);
    });
  },
  /**
   * Mean time of one lookup of what's under a random point, per batch of 200
   * (browsers coarsen performance.now, so single lookups read as 0).
   */
  hitTest(count) {
    const out: number[] = [];
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (let b = 0; b < count / 200; b++) {
      const pts = Array.from({ length: 200 }, () => [Math.random() * w, Math.random() * h] as const);
      const t = performance.now();
      for (const [x, y] of pts) ui.targetAt(x, y);
      out.push((performance.now() - t) / 200);
    }
    return out;
  },
  /** Time to build the accessibility tree the mirror is made from. */
  treeMs(count) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = performance.now();
      ui.accessibilityTree();
      out.push(performance.now() - t);
    }
    return out;
  },
};
