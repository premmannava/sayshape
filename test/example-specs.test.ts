import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
import { deviceComponents } from "../src/components/device";
import { darkTheme, lightTheme } from "../src/theme";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { exampleSpecs } from "../examples/specs";

// The example specs (examples/specs) parse cleanly, draw in light and dark at phone and desktop
// widths, and their scenes pass the drawing review.
describe("example specs", () => {
  for (const [name, e] of Object.entries(exampleSpecs)) {
    const components = [...coreComponents, ...(e.scene ? sceneComponents : []), ...(e.device ? deviceComponents : [])];
    it(`${name}: parses with no diagnostics`, () => {
      expect(parse(e.spec, new Registry(components)).diagnostics).toEqual([]);
    });
    it(`${name}: draws in light and dark at 375 and 1024`, () => {
      for (const theme of [lightTheme, darkTheme]) {
        for (const width of [375, 1024]) {
          const ui = render(e.spec, { components, theme, width });
          expect(ui.diagnostics, `${theme.name} ${width}`).toEqual([]);
          expect(ui.warnings, `${theme.name} ${width}`).toEqual([]);
          expect(ui.drawOps.some((op) => op.op === "fillText")).toBe(true);
        }
      }
    });
    if (e.scene) {
      it(`${name}: the drawing review finds nothing`, () => {
        const r = parse(e.spec, new Registry(components));
        expect(reviewScenes(r).map((p) => `${p.line}: ${p.message}`)).toEqual([]);
      });
    }
  }
});
