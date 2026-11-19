import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, monoWidth, type DrawOp } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import { applyLook } from "../src/look";
import { CHAT_PADDING } from "../src/engine";
import { walkBoxes } from "../src/layout";
import type { Box } from "../src/types";
import { textOverflows } from "./overflow";

const spec = (name: string) => readFileSync(join(__dirname, "fixtures", "chat", `${name}.sayshape`), "utf8");
const FIXTURES = ["expense-tracker", "sales-dashboard"] as const;

/** Containers whose children are meant to sit on top of each other. */
const LAYERED = new Set(["overlap", "image", "chart", "scene", "slide", "deck"]);

/** Children of the same parent that cover each other. */
function overlaps(root: Box): string[] {
  const out: string[] = [];
  walkBoxes(root, (b) => {
    if (LAYERED.has(b.node.type)) return;
    const kids = b.children.filter((k) => k.w > 0 && k.h > 0);
    kids.forEach((a, i) => kids.slice(i + 1).forEach((c) => {
      const x = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const y = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (x > 1 && y > 1) out.push(`${a.node.type} (line ${a.node.line}) and ${c.node.type} (line ${c.node.line})`);
    }));
  });
  return out;
}

/** Words drawn on top of other words on the same line. */
function textCollisions(ops: readonly DrawOp[]): string[] {
  const spans = ops.filter((o) => o.op === "fillText" && String(o.args[0]).trim()).map((o) => {
    const [raw, x, y] = o.args as [unknown, number, number];
    const w = monoWidth(String(raw), o.font);
    const left = o.textAlign === "center" ? x - w / 2 : o.textAlign === "right" || o.textAlign === "end" ? x - w : x;
    return { text: String(raw), left, right: left + w, y };
  });
  const out: string[] = [];
  spans.forEach((a, i) => spans.slice(i + 1).forEach((b) => {
    if (Math.abs(a.y - b.y) < 4 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) out.push(`"${a.text}" and "${b.text}"`);
  }));
  return out;
}

describe("the chat density (context: \"chat\")", () => {
  it("is the compact scale over the host's tokens: 24 px figures, 12 px card padding, 32 px controls", () => {
    const t = applyLook(lightTheme, { density: "chat" });
    expect(t.text.display).toBe(24);
    expect(t.space.lg).toBe(12);
    expect(t.control.height).toBe(32);
    expect(t.text.body).toBe(lightTheme.text.body);
    expect(t.listInline).toBe(true);
  });

  it("is the default only in a chat, and a spec's density= wins", () => {
    const plain = render(`text "Hi"`);
    expect(plain.sayshape.theme.control.height).toBe(lightTheme.control.height);
    expect(plain.sayshape.theme.surfaces).toBeUndefined();
    const chat = render(`text "Hi"`, { context: "chat" });
    expect(chat.sayshape.theme.control.height).toBe(32);
    expect(chat.sayshape.theme.surfaces).toBe("lines");
    expect(chat.sayshape.boxes!.children[0]!.x).toBe(CHAT_PADDING);
    expect(render(`text "Hi"`, { context: "chat", width: 375 }).sayshape.theme.control.height).toBe(34);
    const airy = render(`look density=airy\ntext "Hi"`, { context: "chat" });
    expect(airy.sayshape.theme.control.height).toBe(applyLook(lightTheme, { density: "airy" }).control.height);
    expect(airy.sayshape.theme.listInline).toBeUndefined();
    // A spec's density changes the sizes, never the chat's Hairline surfaces.
    expect(airy.sayshape.theme.surfaces).toBe("lines");
    expect(airy.sayshape.theme.colors.raised).toBe(lightTheme.colors.surface);
    const editorial = render(`look type=editorial\ntext "Hi"`, { context: "chat" });
    expect(editorial.sayshape.theme.control.height).toBe(32);
  });

  it("puts a list row's title, detail and value on one line when they fit, and wraps them when they don't", () => {
    const row = `list\n  list-item "Groceries" detail="Food · Nov 12" trailing="$142.50"`;
    const chat = render(row, { context: "chat", width: 600 });
    const plain = render(row, { width: 600 });
    expect(chat.find("list-item").box!.h).toBeLessThan(plain.find("list-item").box!.h);
    const narrow = render(`list\n  list-item "Dinner with friends at the harbour" detail="Food and drink · Nov 9" trailing="$68.40"`, { context: "chat", width: 320 });
    expect(narrow.find("list-item").box!.h).toBeGreaterThanOrEqual(plain.find("list-item").box!.h);
    expect(textOverflows(narrow.sayshape.boxes!, narrow.drawOps)).toEqual([]);
  });

  for (const name of FIXTURES) {
    it(`draws the ${name} cleanly, shorter in a chat`, () => {
      const plain = render(spec(name), { width: 600 });
      const chat = render(spec(name), { width: 600, context: "chat" });
      expect(plain.diagnostics).toEqual([]);
      expect(plain.warnings).toEqual([]);
      const before = plain.sayshape.boxes!.h, after = chat.sayshape.boxes!.h;
      expect(after).toBeLessThan(before * 0.92);
      for (const width of [320, 375, 600, 900, 1024]) {
        for (const theme of [lightTheme, darkTheme]) {
          for (const context of [undefined, "chat"] as const) {
            const ui = render(spec(name), { width, theme, ...(context ? { context } : {}) });
            const where = `${width}px ${theme.name} ${context ?? "page"}`;
            expect(textOverflows(ui.sayshape.boxes!, ui.drawOps), where).toEqual([]);
            expect(overlaps(ui.sayshape.boxes!), where).toEqual([]);
            expect(textCollisions(ui.drawOps), where).toEqual([]);
          }
        }
      }
    });
  }
});
