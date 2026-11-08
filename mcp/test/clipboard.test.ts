import { describe, expect, it } from "vitest";
import { writeClipboard } from "../src/ui/clipboard";

describe("copying to the clipboard from the view", () => {
  it("uses the Clipboard API when the chat app allows it", async () => {
    const written: string[] = [];
    let commands = 0;
    const ok = await writeClipboard("Revenue: $31.7K", {
      writeText: async (t) => { written.push(t); },
      copyCommand: () => { commands++; return true; },
    });
    expect(ok).toBe(true);
    expect(written).toEqual(["Revenue: $31.7K"]);
    expect(commands).toBe(0);
  });

  it("falls back to the copy command when the Clipboard API is refused", async () => {
    const copied: string[] = [];
    const ok = await writeClipboard("a\tb", {
      writeText: async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); },
      copyCommand: (t) => { copied.push(t); return true; },
    });
    expect(ok).toBe(true);
    expect(copied).toEqual(["a\tb"]);
  });

  it("says it failed, without throwing, when neither route works", async () => {
    expect(await writeClipboard("x", { copyCommand: () => false })).toBe(false);
    expect(await writeClipboard("x", { copyCommand: () => { throw new Error("blocked"); } })).toBe(false);
    expect(await writeClipboard("x", {})).toBe(false);
  });
});
