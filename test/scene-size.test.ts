import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents, shownWidth } from "../src/components/scene";
import { darkTheme } from "../src/theme";
import { render } from "../src/testing";

// WS3: maxw= and scale= show a scene smaller than its space, centered, at its own proportions.
const components = [...coreComponents, ...sceneComponents];
const sceneBox = (spec: string, width: number, opts = {}) => {
  const ui = render(spec, { components, width, ...opts });
  expect(ui.diagnostics).toEqual([]);
  return { ui, box: ui.find({ type: "scene" }).box! };
};
const PHONE = `scene "A phone" w=393 h=852 maxw=295\n  rect x=0 y=0 w=393 h=852 fill=accent`;

describe("scene maxw= and scale=", () => {
  it("maxw shows it at that width, centered, at its own proportions", () => {
    for (const theme of [undefined, darkTheme]) {
      const { ui, box } = sceneBox(PHONE, 800, theme ? { theme } : {});
      expect(box.w).toBe(295);
      expect(box.h).toBeCloseTo((295 * 852) / 393, 5);
      // Centered: as much room on its left as on its right, in the 800 px view.
      expect(box.x - 0).toBeCloseTo(800 - (box.x + box.w), 0);
      const fill = ui.drawOps.find((op) => op.op === "fillRect" || op.op === "fill");
      expect(fill).toBeTruthy();
    }
  });

  it("a narrower space still shrinks it", () => {
    const { box } = sceneBox(PHONE, 240);
    expect(box.w).toBeLessThan(295);
    expect(box.h / box.w).toBeCloseTo(852 / 393, 5);
  });

  it("scale is a share of its own width, between 0.1 and 1", () => {
    expect(sceneBox(`scene "A phone" w=393 h=852 scale=0.75`, 800).box.w).toBeCloseTo(294.75, 5);
    expect(shownWidth(800, 400, undefined, 5)).toBe(400);
    expect(shownWidth(800, 400, undefined, 0)).toBe(40);
    expect(shownWidth(300, 400, undefined, 1)).toBe(300);
    expect(shownWidth(800, 400, 0)).toBe(800);
  });

  it("without either it fills its space as before", () => {
    const { box } = sceneBox(`scene "Hills" w=600 h=300`, 500);
    const { box: plain } = sceneBox(`scene "Hills" w=600 h=300 maxw=5000`, 500);
    expect([box.x, box.y, box.w, box.h]).toEqual([plain.x, plain.y, plain.w, plain.h]);
  });

  it("pressable shapes are hit where the smaller scene draws them", () => {
    const { ui, box } = sceneBox(`state n=0\nscene "A dot" w=100 h=100 maxw=100\n  circle x=50 y=50 r=20 fill=accent on=inc:n`, 600);
    ui.click(box.x + box.w / 2, box.y + box.h / 2);
    expect(ui.state.n).toBe(1);
    ui.click(box.x - 30, box.y + box.h / 2);
    expect(ui.state.n).toBe(1);
  });

  it("warns about a scale= outside 0.1 to 1, and draws it clamped", () => {
    const ui = render(`scene "A phone" w=393 h=852 scale=3`, { components, width: 800 });
    expect(ui.diagnostics.map((d) => d.message)).toEqual([expect.stringMatching(/^scale= goes from 0.1 to 1/)]);
    expect(ui.find({ type: "scene" }).box!.w).toBe(393);
  });
});
