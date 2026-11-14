import { describe, expect, it } from "vitest";
import { announce, brandColorFor, chosenColors, HOST_BRANDS } from "../src/ui/host-brand";
import { themeForPreset } from "../src/ui/theme-selection";
import { contrast } from "../../playground/appearance/color";
import { resolveTheme } from "../../playground/appearance/presets";

const CLAUDE = "#D97757";

/** What the view does: the colors it lays over the preset, then the theme in a mode. */
function accentIn(scheme: "light" | "dark", choice: Parameters<typeof chosenColors>[0]): string {
  return themeForPreset(choice.picked ? "purple" : choice.startupPreset, scheme, undefined, chosenColors(choice)).colors.accent;
}

describe("a known chat app's brand color", () => {
  it("has the owner's table, in order", () => {
    expect(HOST_BRANDS.map((b) => [b.match, b.color])).toEqual([
      [["claude"], "#D97757"],
      [["chatgpt", "openai"], "#10A37F"],
      [["visual studio code", "vscode"], "#007ACC"],
      [["gemini"], "#4285F4"],
      [["grok"], "#000000"],
    ]);
  });

  it.each([
    ["claude", "#D97757"],
    ["Claude", "#D97757"],
    ["Claude Desktop", "#D97757"],
    ["claude-ai", "#D97757"],
    ["ChatGPT", "#10A37F"],
    ["chatgpt-web", "#10A37F"],
    ["OpenAI", "#10A37F"],
    ["openai-mcp-host", "#10A37F"],
    ["Visual Studio Code", "#007ACC"],
    ["Visual Studio Code - Insiders", "#007ACC"],
    ["vscode", "#007ACC"],
    ["VSCode-Copilot", "#007ACC"],
    ["Gemini", "#4285F4"],
    ["gemini-app", "#4285F4"],
    ["Grok", "#000000"],
    ["grok-web", "#000000"],
  ])("knows %s", (name, color) => {
    expect(brandColorFor(name)).toBe(color);
  });

  it("tries the table in order, first match wins", () => {
    expect(brandColorFor("claude via openai gateway")).toBe("#D97757");
    expect(brandColorFor("gemini in vscode")).toBe("#007ACC");
  });

  it("leaves an unknown host, a missing name or a name that isn't text without a brand color", () => {
    for (const name of ["Cursor", "my-chat-app", "", "   ", undefined, null, 42, true, {}, ["claude"], { name: "claude" }]) {
      expect(brandColorFor(name)).toBeUndefined();
    }
  });

  it("logs the name and version as announced, one line, and nothing else", () => {
    const line = announce({ name: "Claude Desktop", version: "1.2.3" });
    expect(line).toBe('SayShape view: host announced name="Claude Desktop" version="1.2.3"');
    expect(line).not.toContain("\n");
    expect(announce(undefined)).toContain("name=undefined");
    expect(announce({ name: 7 })).toContain("name=7");
  });

  describe("which colors win", () => {
    const brand = CLAUDE;
    it("gives a known host its brand color when nothing else was chosen", () => {
      expect(chosenColors({ picked: false, startupPreset: "teal", brand })).toEqual([brand]);
      expect(accentIn("light", { picked: false, startupPreset: "teal", brand })).toBe(resolveTheme("teal", "light", [brand]).theme.colors.accent);
      expect(accentIn("light", { picked: false, startupPreset: "teal", brand })).not.toBe(resolveTheme("teal", "light", null).theme.colors.accent);
    });

    it("stays teal for an unknown host", () => {
      expect(chosenColors({ picked: false, startupPreset: "teal" })).toBeUndefined();
      for (const scheme of ["light", "dark"] as const) {
        expect(accentIn(scheme, { picked: false, startupPreset: "teal" })).toBe(resolveTheme("teal", scheme, null).theme.colors.accent);
      }
    });

    it("keeps a preset the person picked, with its own accent, over a known host", () => {
      expect(chosenColors({ picked: true, startupPreset: "teal", brand })).toBeUndefined();
      for (const scheme of ["light", "dark"] as const) {
        expect(accentIn(scheme, { picked: true, startupPreset: "teal", brand })).toBe(resolveTheme("purple", scheme, null).theme.colors.accent);
      }
    });

    it("keeps the operator's --accent or --colors over a known host, picked or not", () => {
      for (const picked of [false, true]) {
        expect(chosenColors({ operatorColors: ["#e4572e"], picked, startupPreset: "teal", brand })).toEqual(["#e4572e"]);
      }
      expect(chosenColors({ operatorColors: ["#e4572e"], picked: false, startupPreset: "blue", brand })).toEqual(["#e4572e"]);
    });

    it("keeps a whole --colors list over a known host, and treats an empty one as none", () => {
      const list = ["#e4572e", "#2e86ab", "#f2c14e"];
      expect(chosenColors({ operatorColors: list, picked: false, startupPreset: "teal", brand })).toEqual(list);
      expect(chosenColors({ operatorColors: [], picked: false, startupPreset: "teal", brand })).toEqual([brand]);
      expect(chosenColors({ operatorColors: [], picked: false, startupPreset: "teal" })).toBeUndefined();
    });

    it("gives the brand color chart series worked out from it, like any first color", () => {
      for (const scheme of ["light", "dark"] as const) {
        const withBrand = themeForPreset("teal", scheme, undefined, chosenColors({ picked: false, startupPreset: "teal", brand }));
        const plain = themeForPreset("teal", scheme);
        expect(withBrand.colors.series1).toBe(withBrand.colors.accent);
        for (const k of ["series2", "series3", "series4", "series5", "series6"] as const) expect(withBrand.colors[k], `${scheme} ${k}`).not.toBe(plain.colors[k]);
        // The same series as a server started with that one color as its --colors.
        expect(withBrand).toEqual(themeForPreset("teal", scheme, undefined, [brand]));
      }
    });

    it("keeps a --theme other than the default over a known host, until the person picks", () => {
      expect(chosenColors({ picked: false, startupPreset: "purple", brand })).toBeUndefined();
      expect(chosenColors({ picked: false, startupPreset: "studio", brand })).toBeUndefined();
    });
  });

  describe("readability", () => {
    it("makes every table color readable on the surface, in light and dark", () => {
      for (const { color } of HOST_BRANDS) {
        for (const scheme of ["light", "dark"] as const) {
          const t = themeForPreset("teal", scheme, undefined, [color]);
          expect(contrast(t.colors.accent, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
          expect(t.colors.series1).toBe(t.colors.accent);
        }
      }
    });

    it("moves #000000 on dark, where black text cannot be read, and leaves it on light", () => {
      expect(themeForPreset("teal", "light", undefined, ["#000000"]).colors.accent).toBe("#000000");
      const dark = themeForPreset("teal", "dark", undefined, ["#000000"]).colors.accent;
      expect(dark).not.toBe("#000000");
    });
  });
});
