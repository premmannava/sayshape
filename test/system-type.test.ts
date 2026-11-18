import { describe, expect, it } from "vitest";
import { coreComponents, darkTheme, parse, Registry } from "../src";
import { LOOK_FONTS } from "../src/look";
import { render } from "../src/testing";
import { sceneComponents } from "../src/components/scene";

// WS1: look type=system and light weights, for large calm figures (72°, a price, a clock).
const registry = new Registry(coreComponents);
const read = (src: string) => parse(src + "\n", registry);
const fontsOf = (ui: ReturnType<typeof render>, text: string) =>
  ui.drawOps.filter((op) => op.op === "fillText" && String(op.args[0]).includes(text)).map((op) => op.font);

describe("look type=system", () => {
  it("parses as a type option", () => {
    const r = read(`look type=system\ntext "Hi"`);
    expect(r.diagnostics).toEqual([]);
    expect(r.look).toEqual({ type: "system", line: 1 });
  });

  it("draws headings and text in the platform's interface font, in light and dark", () => {
    for (const theme of [undefined, darkTheme]) {
      const ui = render(`look type=system\ntext "72°" style=display weight=light\ntext "Phoenix"`, theme ? { theme } : {});
      expect(ui.sayshape.theme.font.family).toBe(LOOK_FONTS.system);
      expect(ui.sayshape.theme.font.display).toBe(LOOK_FONTS.system);
      expect(fontsOf(ui, "72°")[0]).toBe(`300 ${ui.sayshape.theme.text.display}px ${LOOK_FONTS.system}`);
      expect(fontsOf(ui, "Phoenix")[0]).toContain("-apple-system");
    }
  });

  it("the stack names only installed system faces, ending in a generic family", () => {
    expect(LOOK_FONTS.system.startsWith("-apple-system, BlinkMacSystemFont")).toBe(true);
    expect(LOOK_FONTS.system.endsWith("sans-serif")).toBe(true);
  });
});

describe("weight=light", () => {
  it("text takes light; an unknown weight is reported and the text kept", () => {
    expect(read(`text "72°" style=display weight=light`).diagnostics).toEqual([]);
    const r = read(`text "72°" weight=hairline`);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.message).toMatch(/weight should be one of light, regular, semibold, bold/);
    expect(r.root.children[0]!.type).toBe("text");
  });

  it("stat draws its figure at the weight asked for, semibold by default", () => {
    const light = render(`stat label="Now" value="72°" weight=light`);
    expect(fontsOf(light, "72°")[0]).toMatch(/^300 /);
    const plain = render(`stat label="Now" value="72°"`);
    expect(fontsOf(plain, "72°")[0]).toMatch(/^600 /);
    expect(read(`stat label="Now" value="72°" weight=bold`).diagnostics[0]!.message).toMatch(/weight should be one of light, regular, semibold/);
  });

  it("scene labels take light", () => {
    const ui = render(`scene "A clock" w=300 h=100\n  label "10:42" x=150 y=50 size=40 weight=light align=center`, { components: [...coreComponents, ...sceneComponents] });
    expect(ui.diagnostics).toEqual([]);
    expect(fontsOf(ui, "10:42")[0]).toMatch(/^300 /);
  });
});
