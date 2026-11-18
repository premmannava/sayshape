/** Hover follows parts that move under a resting mouse (the reviewer's planets case). */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents } from "../src/components/scene";
import { render } from "../src/testing";
import type { Box } from "../src/types";

const ON = [...coreComponents, ...sceneComponents];

describe("hover on moving shapes", () => {
  it("leaves a planet that orbits away from a resting mouse, and enters one that arrives", () => {
    const spec = `state hov=""
scene "Orbit" w=400 h=200 duration=8
  circle x={60 + 40*t} y=100 r=20 fill=accent on-hover=set:hov:'moving' on-leave="set:hov:''"`;
    const ui = render(spec, { components: ON, animate: true, clock: true });
    const box = ui.find({ type: "scene" }).box as Box;
    const at = (x: number, y: number): [number, number] => [box.x + (x * box.w) / 400, box.y + (y * box.h) / 200];
    ui.hover(...at(60, 100));
    expect(ui.state.hov).toBe("moving");
    // Three seconds later the circle is at x=180; the mouse hasn't moved.
    for (let i = 0; i < 30; i++) ui.clock.advance(100);
    expect(ui.state.hov).toBe("");
    // The loop brings it back under the mouse: it's entered again, with no move.
    for (let i = 0; i < 50; i++) ui.clock.advance(100);
    expect(ui.state.hov).toBe("moving");
    ui.destroy();
  });
});
