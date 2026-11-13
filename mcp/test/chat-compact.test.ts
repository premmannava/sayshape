// The MCP view inside chat apps: tighter tokens for the interface, and a
// toolbar laid over the interface's top-right corner instead of above it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../../playground/appearance/presets";
import { darkTheme, lightTheme } from "../../src/theme";
import { CHAT_TOKENS, interfaceTheme, themeForPreset } from "../src/ui/theme-selection";

describe("MCP view theme", () => {
  it("overrides display text, large spacing and control height, and nothing else", () => {
    for (const { id } of PRESETS) {
      for (const scheme of ["light", "dark"] as const) {
        const preset = themeForPreset(id, scheme);
        const view = interfaceTheme(preset);
        expect(view.text.display).toBe(24);
        expect(view.space.lg).toBe(16);
        expect(view.control.height).toBe(32);
        expect({ ...view, text: preset.text, space: preset.space, control: preset.control }).toEqual(preset);
        expect(view.text.title).toBe(preset.text.title);
        expect(view.space.md).toBe(preset.space.md);
      }
    }
    expect(CHAT_TOKENS).toEqual({ text: { display: 24 }, space: { lg: 16 }, control: { height: 32 } });
  });

  it("leaves the library's base themes as they are", () => {
    interfaceTheme(lightTheme);
    expect(lightTheme.text.display).toBe(30);
    expect(lightTheme.space.lg).toBe(22);
    expect(lightTheme.control.height).toBe(40);
    expect(darkTheme.control.height).toBe(40);
  });
});

describe("MCP view toolbar placement", () => {
  const html = readFileSync(new URL("../src/ui/index.html", import.meta.url), "utf8");
  const rule = (selector: string): string => {
    const m = html.match(new RegExp(`${selector.replace(/[#[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? "";
  };

  it("adds no height above the interface: it's laid over its top-right corner", () => {
    expect(rule("#wrap")).toMatch(/position:\s*relative/);
    const bar = rule("#bar");
    expect(bar).toMatch(/position:\s*absolute/);
    expect(bar).toMatch(/top:\s*0/);
    expect(bar).toMatch(/right:\s*0/);
    // Above the interface's canvas, so it stays clickable.
    expect(bar).toMatch(/z-index:\s*[1-9]/);
    expect(bar).not.toMatch(/pointer-events:\s*none/);
    expect(rule("#bar[hidden]")).toMatch(/display:\s*none/);
  });

  it("comes before the interface in the page, so Tab reaches it first", () => {
    expect(html.indexOf('id="bar"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="bar"')).toBeLessThan(html.indexOf('id="sayshape"'));
  });
});
