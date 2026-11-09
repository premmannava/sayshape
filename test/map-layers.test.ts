import { describe, expect, it } from "vitest";
import { placeNames, scaleBar } from "../src/components/map/layers";
import { render } from "../src/testing";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { lightTheme } from "../src/theme";

const components = [...coreComponents, ...mapComponents];

describe("map context layers", () => {
  it("picks a round scale distance that fits", () => {
    const bar = scaleBar(1000, 90)!;
    expect(bar.miles).toBe(50);
    expect(bar.px).toBeLessThanOrEqual(90);
    expect(bar.km).toBe(80);
  });

  it("names cities only when zoomed in, and never on top of each other", () => {
    const measure = (t: string) => t.length * 6;
    expect(placeNames(1, (x, y) => [x, y], 1000, 512, measure, [])).toHaveLength(0);
    const names = placeNames(6, (x, y) => [x * 6 - 1000, y * 6 - 900], 900, 500, measure, []);
    expect(names.length).toBeGreaterThan(0);
    for (const a of names) for (const b of names) {
      if (a !== b) expect(Math.abs(a.y - b.y) >= 16 || Math.abs(a.x - b.x) >= 6).toBe(true);
    }
  });

  it("draws a route through the pins only when asked", () => {
    const spec = (route: string) => `map fit=pins${route}\n  pin "A" lat=34.87 lon=-111.76\n  pin "B" lat=35.2 lon=-111.66`;
    const strokes = (ui: ReturnType<typeof render>) => ui.drawOps.filter((op) => op.op === "stroke" && op.strokeStyle === lightTheme.colors.accent).length;
    const plain = render(spec(""), { components });
    const routed = render(spec(" route=true"), { components });
    expect(strokes(routed)).toBe(strokes(plain) + 1);
    plain.destroy(); routed.destroy();
  });
});
