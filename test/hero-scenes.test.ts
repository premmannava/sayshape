/**
 * The landing page's hero scenes (site/examples/hero-scenes.ts): each spec
 * parses with no problems, every press it plays lands on a real pressable
 * part, and the presses do what the scene shows.
 */
import { describe, expect, it } from "vitest";
import { render, type Rendered } from "../src/testing";
import { heroScenes, type Tap } from "../site/examples/hero-scenes";

/** Press part of an element the way the hero does: find its hit region, click its centre. */
function tap(r: Rendered, t: Tap) {
  const regions = r.hits.filter((h) => h.box.node.type === t.type);
  const nodes = [...new Set(regions.map((h) => h.box.node.id))];
  const id = nodes[t.nth ?? 0];
  const hit = regions.find((h) => h.box.node.id === id && (t.detail === undefined || h.detail === t.detail));
  if (!hit) throw new Error(`nothing to press for ${JSON.stringify(t)}`);
  r.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
}

const scene = (id: string) => heroScenes.find((s) => s.id === id)!;

describe("hero scenes", () => {
  for (const s of heroScenes) {
    it(`${s.id}: parses cleanly and draws with no warnings, at desktop and phone widths`, () => {
      for (const width of [340, 560]) {
        const r = render(s.spec, { width });
        expect(r.diagnostics).toEqual([]);
        expect(r.warnings).toEqual([]);
        for (const t of s.taps) tap(r, t);
        r.destroy();
      }
    });
  }

  it("trip: two presses on + add two nights, and the totals follow", () => {
    const r = render(scene("trip").spec, { width: 560 });
    expect(r.text()).toContain("$1,196");
    for (const t of scene("trip").taps) tap(r, t);
    expect(r.state.nights).toBe(4);
    expect(r.text()).toContain("$2,392");
  });

  it("refund: choosing a reason enables Submit, which sends the reason back to the agent", () => {
    const r = render(scene("refund").spec, { width: 560 });
    const [choose, submit] = scene("refund").taps as [Tap, Tap];
    tap(r, choose);
    expect(r.state.reason).toBe("size");
    tap(r, submit);
    expect(r.emitted).toEqual([{ name: "refund", value: "size" }]);
  });

  it("laptop: the budget filter narrows the comparison to two", () => {
    const r = render(scene("laptop").spec, { width: 560 });
    expect(r.text()).toContain("Summit 14");
    for (const t of scene("laptop").taps) tap(r, t);
    expect(r.state.budget).toBe("Under $1.2K");
    expect(r.text()).not.toContain("Summit 14");
    expect(r.text()).toEqual(expect.arrayContaining(["Atlas 13", "Breeze 13"]));
  });
});
