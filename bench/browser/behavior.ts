/**
 * The page bench/browser/behavior.mjs drives: a screen with one rule ticking
 * at a chosen interval, in a real browser with real timers and frames. It
 * measures in the page and reports to window.__behavior.
 */
import { SayShape } from "../../src/engine";
import { coreComponents } from "../../src/components";
import { lightTheme } from "../../src/theme";
import { bigSpec } from "../specs";

declare global {
  interface Window {
    __behavior: {
      ready: boolean;
      /** Load a screen ("small", or about 1000 or 5000 elements) whose rule ticks every `every` ms, and run it for ms. */
      run(size: string, every: number, ms: number, control?: boolean): Promise<{ ticks: number; frames: number[]; work: number[]; floor: number; warnings: string[]; canvasHeight: number }>;
    };
  }
}

const SMALL = (every: number) => `state running=true left=90
every ${every}ms if={running} do="set:left:{left > 0 ? left - 1 : 90}"
card
  text "Tea timer" style=title
  stat label="Time left" value="{floor(left / 60)}:{left % 60 < 10 ? '0' : ''}{left % 60}"
  progress value={90 - left} max=90
  row
    button "{running ? 'Pause' : 'Start'}" on=toggle:running
    button "Reset" variant=secondary on="set:left:90"
`;
const BIG = (n: number, every: number) => bigSpec(n).replace("state qty=2 price=24 gift=false", "state qty=2 price=24 gift=false running=true") +
  `\nevery ${every}ms if={running} do="set:qty:{(qty + 1) % 10}"\nbutton "Stop" on=toggle:running\n`;

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const warnings: string[] = [];
let ui: SayShape | null = null;

window.__behavior = {
  ready: true,
  /** control: no rule; the page writes the same state on its own timer, as a host could today. */
  run(size, every, ms, control = false) {
    ui?.destroy();
    warnings.length = 0;
    ui = new SayShape(canvas, { components: coreComponents, theme: lightTheme, behavior: true, onWarning: (m) => warnings.push(m) });
    // Everything the engine does in a frame (parse, layout, paint, the screen reader mirror), timed around renderNow.
    const work: number[] = [];
    const inner = ui.renderNow.bind(ui);
    ui.renderNow = () => { const t = performance.now(); inner(); work.push(performance.now() - t); };
    let ticks = 0;
    ui.on("change", ({ key }) => { if (key === "qty" || key === "left") ticks++; });
    const spec = size === "small" ? SMALL(every) : BIG(Number(size), every);
    ui.setSpec(control ? spec.split("\n").filter((l) => !l.startsWith("every ")).join("\n") : spec);
    ui.renderNow();
    const key = size === "small" ? "left" : "qty";
    const timer = control ? setInterval(() => {
      const v = Number(ui!.state.get(key));
      ui!.state.set(key, key === "left" ? (v > 0 ? v - 1 : 90) : (v + 1) % 10);
    }, every) : null;
    work.length = 0;
    ticks = 0;
    return new Promise((done) => {
      const frames: number[] = [];
      let last = performance.now();
      const end = last + ms;
      const step = (t: number) => {
        frames.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(step);
        else {
          const floor = (ui as unknown as { rules: { currentFloor: number } | null }).rules?.currentFloor ?? 16;
          ui?.pauseRules();
          if (timer) clearInterval(timer);
          done({ ticks, frames: frames.slice(1), work: [...work], floor, warnings: [...warnings], canvasHeight: canvas.height });
        }
      };
      requestAnimationFrame(step);
    });
  },
};
