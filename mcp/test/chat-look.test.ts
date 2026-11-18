import { describe, expect, it } from "vitest";
import { viewBackground } from "../src/ui/chat-look";
import { themeForPreset } from "../src/ui/theme-selection";
import { decodeViewOptions, encodeViewOptions, parseViewArgs, DEFAULT_VIEW_OPTIONS } from "../src/ui/view-options";
import { PRESETS } from "../../playground/appearance/presets";
import { contrastRatio } from "../../src/scrim";

/** Page colors of common chat apps, light and dark, that a transparent view sits on when they don't share their variables. */
const CHAT_PAGES = { light: ["#ffffff", "#faf9f5", "#f9f9f9", "#f4f4f4"], dark: ["#262624", "#1f1e1d", "#212121", "#171717", "#000000"] } as const;

describe("the chat look in the MCP view", () => {
  it("lets the chat app's background show through only when the app said light or dark", () => {
    const theme = themeForPreset("teal", "light");
    expect(viewBackground(theme, "light", true)).toBe("transparent");
    expect(viewBackground(theme, "dark", true)).toBe("transparent");
    expect(viewBackground(theme, undefined, true)).toBe(theme.colors.surface);
    // --no-chat-look: the theme's surface, as before.
    expect(viewBackground(theme, "light", false)).toBe(theme.colors.surface);
  });

  it("is on by default; --no-chat-look turns it off and survives the view's tag", () => {
    expect(parseViewArgs([])).not.toHaveProperty("chatLook");
    const off = parseViewArgs(["--no-chat-look"]);
    expect(off.chatLook).toBe(false);
    expect(encodeViewOptions({ ...DEFAULT_VIEW_OPTIONS, chatLook: false })).toBe("picker=0&theme=teal&save=1&copy=1&chat=0");
    expect(decodeViewOptions("picker=0&theme=teal&save=1&copy=1&chat=0").chatLook).toBe(false);
    expect(decodeViewOptions("picker=0&theme=teal&save=1&copy=1")).not.toHaveProperty("chatLook");
  });

  it("keeps text readable (AA) on chat apps' own pages, in every preset, light and dark", () => {
    const failures: string[] = [];
    for (const { id } of PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const c = themeForPreset(id, mode).colors;
        for (const page of CHAT_PAGES[mode]) {
          for (const role of ["ink", "muted"] as const) {
            const ratio = contrastRatio(c[role], page) ?? 0;
            if (ratio < 4.5) failures.push(`${id} ${mode} ${role} on ${page}: ${ratio.toFixed(2)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
