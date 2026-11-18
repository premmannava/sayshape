import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { DEVICE_KINDS, DEVICE_SIZES, STATUS_TIME, deviceComponents, deviceScale, type DeviceData } from "../src/components/device";
import { walkBoxes } from "../src/layout";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { AccessibleSummary } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";
import type { Box } from "../src/types";
import { deviceSamples } from "../playground/device-samples";

const WITH = [...coreComponents, ...deviceComponents];
const on = (spec: string, width = 600, theme = lightTheme) => render(spec, { components: WITH, width, theme });
const errors = (ui: { diagnostics: { severity: string }[] }) => ui.diagnostics.filter((d) => d.severity === "error");

const HOME = `state taps=0
device "Weather app home" kind=iphone scale=0.75 status=true
  text "Today" style=title
  stat label="Phoenix" value="31°"
  button "See the week" on=inc:taps`;

const boxesOf = (root: Box, type: string): Box[] => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};
const deviceBox = (ui: ReturnType<typeof on>) => boxesOf(ui.sayshape.boxes!, "device")[0]!;
const dataOf = (b: Box) => b.data as DeviceData;
const EPS = 0.01;

describe("device is opt-in", () => {
  it("is its own entry point, not in coreComponents", () => {
    expect(deviceComponents.map((c) => c.type)).toEqual(["device"]);
    expect(coreComponents.some((c) => c.type === "device")).toBe(false);
  });

  it("is an unknown element, skipped with what's inside it, when the host hasn't registered it", () => {
    const r = parse(HOME, new Registry(coreComponents));
    const d = r.diagnostics.find((x) => x.line === 2);
    expect(d?.severity).toBe("error");
    expect(d?.message).toMatch(/Unknown element "device"\. It was skipped/);
    const types: string[] = [];
    const visit = (n: { type: string; children: { type: string; children: unknown[] }[] }) => { types.push(n.type); n.children.forEach((k) => visit(k as typeof n)); };
    visit(r.root as unknown as { type: string; children: { type: string; children: unknown[] }[] });
    expect(types).not.toContain("device");
    expect(types).not.toContain("button");
  });

  it("parses with no diagnostics when registered", () => {
    expect(parse(HOME, new Registry(WITH)).diagnostics).toEqual([]);
  });
});

describe("a home screen at scale=0.75", () => {
  it("is drawn at 0.75 of the iphone frame, at its proportions, centred", () => {
    const ui = on(HOME, 600);
    const b = deviceBox(ui);
    const size = DEVICE_SIZES.iphone;
    expect(b.w).toBeCloseTo(size.frameW * 0.75, 3);
    expect(b.h / b.w).toBeCloseTo(size.frameH / size.frameW, 5);
    expect(dataOf(b).screen.w / dataOf(b).screen.h).toBeCloseTo(393 / 852, 5);
    expect(b.x + b.w / 2).toBeCloseTo(300, 0);
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("keeps its children inside the screen", () => {
    const ui = on(HOME, 600);
    const screen = dataOf(deviceBox(ui)).screen;
    for (const k of deviceBox(ui).children) {
      expect(k.x).toBeGreaterThanOrEqual(screen.x - EPS);
      expect(k.y).toBeGreaterThanOrEqual(screen.y - EPS);
      expect(k.x + k.w).toBeLessThanOrEqual(screen.x + screen.w + EPS);
      expect(k.y + k.h).toBeLessThanOrEqual(screen.y + screen.h + EPS);
    }
    ui.destroy();
  });

  it("lays children out at the phone's own width, whatever the page's", () => {
    const narrow = on(HOME, 300), wide = on(HOME, 1000);
    const w = (ui: ReturnType<typeof on>) => { const d = deviceBox(ui); return d.children[0]!.w / dataOf(d).scale; };
    expect(w(narrow)).toBeCloseTo(w(wide), 3);
    narrow.destroy();
    wide.destroy();
  });

  it("presses a button through the scale", () => {
    const ui = on(HOME, 600);
    const r = ui.hits.find((h) => h.box.node.type === "button")!;
    const screen = dataOf(deviceBox(ui)).screen;
    expect(r.box.x).toBeGreaterThanOrEqual(screen.x - EPS);
    ui.click(r.box.x + r.box.w / 2, r.box.y + r.box.h / 2);
    expect(ui.state.taps).toBe(1);
    ui.press({ type: "button" });
    expect(ui.state.taps).toBe(2);
    ui.destroy();
  });

  it("is a named group to screen readers, with its children's roles kept", () => {
    const ui = on(HOME, 600);
    const find = (n: AccessibleSummary, role: string): AccessibleSummary | undefined =>
      n.role === role ? n : n.children?.map((k) => find(k, role)).find(Boolean);
    const inside = (ui: ReturnType<typeof on>) => ui.accessibility().children?.map((k) => find(k, "group")).find(Boolean);
    const group = inside(ui)!;
    expect(group.name).toBe("Weather app home");
    expect(find(group, "button")?.name).toBe("See the week");
    ui.destroy();
    const plain = on(`device\n  button "Go"`);
    expect(inside(plain)?.name).toBe("Phone screen");
    plain.destroy();
    const laptop = on(`device kind=laptop\n  button "Go"`);
    expect(inside(laptop)?.name).toBe("Laptop screen");
    laptop.destroy();
  });
});

describe("sizes", () => {
  it.each(DEVICE_KINDS)("%s never draws wider than its space", (kind) => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = on(`device kind=${kind}\n  text "Hello"`, width);
      const b = deviceBox(ui);
      const size = DEVICE_SIZES[kind];
      expect(b.w).toBeLessThanOrEqual(width + EPS);
      expect(b.x).toBeGreaterThanOrEqual(-EPS);
      expect(b.h / b.w).toBeCloseTo(size.frameH / size.frameW, 5);
      ui.destroy();
    }
  });

  it("has the standard logical screen sizes", () => {
    expect([DEVICE_SIZES.iphone.screenW, DEVICE_SIZES.iphone.screenH]).toEqual([393, 852]);
    expect([DEVICE_SIZES.android.screenW, DEVICE_SIZES.android.screenH]).toEqual([412, 915]);
    expect([DEVICE_SIZES.laptop.screenW, DEVICE_SIZES.laptop.screenH]).toEqual([1440, 900]);
  });

  it("keeps scale= to 0.1..1, with a warning", () => {
    expect(deviceScale(0.05)).toBe(0.1);
    expect(deviceScale(3)).toBe(1);
    expect(deviceScale(Number.NaN)).toBe(1);
    const small = on(`device scale=0.05\n  text "Hi"`, 1000);
    expect(deviceBox(small).w).toBeCloseTo(DEVICE_SIZES.iphone.frameW * 0.1, 3);
    expect(small.diagnostics.some((d) => d.severity === "warning" && /scale= goes from 0.1 to 1/.test(d.message))).toBe(true);
    small.destroy();
    const big = on(`device scale=3\n  text "Hi"`, 2000);
    expect(deviceBox(big).w).toBeCloseTo(DEVICE_SIZES.iphone.frameW, 3);
    big.destroy();
  });
});

describe("what it draws", () => {
  it("cuts content taller than the screen, with a warning", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `  card\n    text "Row ${i + 1}"`).join("\n");
    const ui = on(`device "Long list"\n${rows}`);
    const d = dataOf(deviceBox(ui));
    expect(d.clipped).toBe(true);
    expect(ui.warnings.some((w) => /more than fits on one phone screen/.test(w))).toBe(true);
    ui.destroy();
  });

  // A phone keeps the camera's strip clear either way, and the status bar sits in it; a laptop's screen gives it room.
  it("draws a status bar with status=true, and moves the content below it", () => {
    const without = on(`device kind=laptop\n  text "Hi"`);
    const withBar = on(`device kind=laptop status=true\n  text "Hi"`);
    const time = (ui: ReturnType<typeof on>) => ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === STATUS_TIME);
    expect(time(without)).toHaveLength(0);
    expect(time(withBar)).toHaveLength(1);
    expect(time(withBar)[0]!.fillStyle).toBe(lightTheme.colors.ink);
    const top = (ui: ReturnType<typeof on>) => deviceBox(ui).children[0]!.y;
    expect(top(withBar)).toBeGreaterThan(top(without));
    without.destroy();
    withBar.destroy();
  });

  it("paints its frame in theme colors only, light and dark", () => {
    for (const theme of [lightTheme, darkTheme]) {
      for (const kind of DEVICE_KINDS) {
        const ui = on(`device kind=${kind} status=true\n  text "Hi"`, 600, theme);
        const palette = new Set<string>(Object.values(theme.colors));
        for (const op of ui.drawOps) expect(palette.has(op.fillStyle || op.strokeStyle), `${kind} ${op.op} ${op.fillStyle}`).toBe(true);
        ui.destroy();
      }
    }
  });

  it("streams: every line prefix parses and draws", () => {
    const lines = HOME.split("\n");
    for (let n = 1; n <= lines.length; n++) {
      const ui = on(lines.slice(0, n).join("\n"));
      expect(errors(ui), `prefix of ${n} lines`).toEqual([]);
      expect(ui.sayshape.boxes).not.toBeNull();
      ui.destroy();
    }
  });

  it("warns about unknown props and keeps the device", () => {
    const ui = on(`device colour=red\n  text "Hi"`);
    expect(ui.diagnostics.some((d) => d.severity === "warning" && /colour/.test(d.message))).toBe(true);
    expect(deviceBox(ui)).toBeDefined();
    ui.destroy();
  });
});

describe("playground samples", () => {
  it.each(Object.entries(deviceSamples))("%s parses, fits its screen and draws in light and dark", (_name, sample) => {
    for (const theme of [lightTheme, darkTheme]) {
      const ui = on(sample.spec, 600, theme);
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
      expect(dataOf(deviceBox(ui)).clipped).toBe(false);
      ui.destroy();
    }
  });
});
