/**
 * The page bench/browser/upgrades.mjs drives: one scene spec at a time, in
 * light or dark, measuring frame intervals and the engine's paint time.
 */
import { SayShape } from "../../src/engine";
import { coreComponents } from "../../src/components";
import { sceneComponents } from "../../src/components/scene";
import { darkTheme, lightTheme } from "../../src/theme";
import { UPGRADE_SPECS } from "./upgrade-specs";

declare global {
  interface Window {
    __up: {
      ready: boolean;
      names: string[];
      load(name: string, dark: boolean, width: number): void;
      frames(ms: number): Promise<{ intervals: number[]; paints: number[] }>;
    };
  }
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const box = document.getElementById("box") as HTMLDivElement;
let ui: SayShape | null = null;
const paints: number[] = [];

window.__up = {
  ready: true,
  names: Object.keys(UPGRADE_SPECS),
  load(name, dark, width) {
    ui?.destroy();
    box.style.width = `${width}px`;
    document.body.style.background = dark ? "#0E1416" : "#F6F8F7";
    ui = new SayShape(canvas, { components: [...coreComponents, ...sceneComponents], theme: dark ? darkTheme : lightTheme, behavior: true, animate: true });
    ui.on("render", (m) => paints.push(m.paintMs));
    ui.setSpec(UPGRADE_SPECS[name]!, { resetState: true });
    ui.renderNow();
  },
  frames(ms) {
    paints.length = 0;
    return new Promise((done) => {
      const intervals: number[] = [];
      let last = performance.now();
      const end = last + ms;
      const step = (now: number) => {
        intervals.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(step);
        else done({ intervals, paints: [...paints] });
      };
      requestAnimationFrame(step);
    });
  },
};
