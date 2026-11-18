/** SayShape's own icons, the icon element, and icon= on text and list-item. */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { ICON_ALIASES, ICON_NAMES, ICONS, drawIcon, isIconName, nearestIcon, resolveIcon } from "../src/icons";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { createRecordingContext } from "../src/testing/canvas";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const warnings = (spec: string) => parse(spec, registry).diagnostics.map((d) => d.message);

describe("the icon set", () => {
  it("draws every icon in the color it's given and nothing else, inside its square", () => {
    for (const name of ICON_NAMES) {
      const { context, take } = createRecordingContext();
      drawIcon(context, name, 0, 0, 24, lightTheme.colors.ink);
      const ops = take();
      expect(ops.length, name).toBeGreaterThan(0);
      for (const op of ops) expect(op.fillStyle || op.strokeStyle, name).toBe(lightTheme.colors.ink);
    }
  });

  it("keeps every coordinate on the 24×24 grid, with room for the stroke", () => {
    for (const [name, shapes] of Object.entries(ICONS)) {
      for (const shape of shapes) {
        const nums = (shape.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        // Arcs end with angles in degrees, which can be outside the grid.
        const coords = shape.startsWith("A") ? nums.slice(0, 3) : nums;
        for (const n of coords) expect(n >= 0 && n <= 24, `${name}: ${shape}`).toBe(true);
      }
    }
  });

  it("finds the icon a model probably meant", () => {
    expect(nearestIcon("tick")).toBe("check");
    expect(nearestIcon("Flight")).toBe("plane");
    expect(nearestIcon("trending-up")).toBe("trend-up");
    expect(nearestIcon("constructor")).toBe(null);
    expect(isIconName("constructor")).toBe(false);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});

const NEW_ICONS = [
  "settings", "edit", "trash", "eye", "upload", "external", "folder", "database", "server", "shield", "flag", "key", "wallet",
  "bank", "receipt", "play", "pause", "image", "book", "wrench", "bug", "code", "sparkle", "trophy", "map",
] as const;

describe("the newer icons", () => {
  it("has each one, drawing strokes in the given color", () => {
    for (const name of NEW_ICONS) {
      expect(isIconName(name), name).toBe(true);
      const { context, take } = createRecordingContext();
      drawIcon(context, name, 0, 0, 28, darkTheme.colors.ink);
      const ops = take();
      expect(ops.some((o) => o.op === "stroke" || o.op === "fill"), name).toBe(true);
      for (const op of ops) expect(op.fillStyle || op.strokeStyle, name).toBe(darkTheme.colors.ink);
    }
  });

  it("keeps every shape at least a stroke's width inside the grid, so nothing is clipped", () => {
    for (const name of NEW_ICONS) {
      for (const shape of ICONS[name]) {
        const n = (shape.match(/-?\d*\.?\d+/g) ?? []).map(Number);
        const edges: number[] = [];
        if (shape.startsWith("O") || shape.startsWith("A")) edges.push(n[0]! - n[2]!, n[0]! + n[2]!, n[1]! - n[2]!, n[1]! + n[2]!);
        else if (shape.startsWith("R")) edges.push(n[0]!, n[0]! + n[2]!, n[1]!, n[1]! + n[3]!);
        else edges.push(...n);
        for (const e of edges) expect(e >= 1 && e <= 23, `${name}: ${shape}`).toBe(true);
      }
    }
  });

  it("is named in the icon element's guide text and works through the element", () => {
    for (const name of NEW_ICONS) {
      expect(warnings(`icon name=${name}\n`), name).toEqual([]);
      const ui = render(`icon name=${name} size=lg\n`);
      expect(ui.drawOps.some((o) => o.op === "stroke" || o.op === "fill"), name).toBe(true);
      ui.destroy();
    }
    expect(warnings(`icon name=gear\n`)[0]).toMatch(/Did you mean name=settings\?/);
    expect(nearestIcon("delete")).toBe("trash");
    expect(nearestIcon("pencil")).toBe("edit");
  });
});

// Icons for phone and app mockups and everyday interfaces, drawn for SayShape.
const APP_ICONS = [
  "music", "video", "mic", "volume", "volume-off", "alarm", "timer", "laptop", "tablet", "watch", "camera", "headphones", "battery",
  "wifi", "tv", "sunrise", "sunset", "cloud-sun", "fog", "umbrella", "store", "gift", "ticket", "basket", "menu", "grid", "list",
  "more", "chevron-up", "chevron-down", "chevron-left", "chevron-right", "compass", "navigation", "route", "bookmark", "send",
  "archive", "clipboard", "note", "user-plus", "id-badge", "activity", "gauge", "flame", "plant", "leaf", "tree", "planet", "bowl",
  "coffee", "pizza", "bed", "sofa", "lamp", "bike", "bus", "train",
] as const;

/** How far a shape reaches on the grid: arcs by their actual sweep, paths by their points. */
function reach(shape: string): number[] {
  const n = (shape.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (shape.startsWith("O")) return [n[0]! - n[2]!, n[0]! + n[2]!, n[1]! - n[2]!, n[1]! + n[2]!];
  if (shape.startsWith("A")) {
    const [cx, cy, r, from, to] = n as [number, number, number, number, number];
    const out: number[] = [];
    for (let d = from; d <= to; d += 1) out.push(cx + r * Math.cos((d * Math.PI) / 180), cy + r * Math.sin((d * Math.PI) / 180));
    return out;
  }
  if (shape.startsWith("R")) return [n[0]!, n[0]! + n[2]!, n[1]!, n[1]! + n[3]!];
  return n;
}

describe("the app and everyday icons", () => {
  it("has each one, drawn in the given color, at least a stroke's width inside the grid", () => {
    for (const name of APP_ICONS) {
      expect(isIconName(name), name).toBe(true);
      const { context, take } = createRecordingContext();
      drawIcon(context, name, 0, 0, 28, darkTheme.colors.ink);
      const ops = take();
      expect(ops.some((o) => o.op === "stroke" || o.op === "fill"), name).toBe(true);
      for (const op of ops) expect(op.fillStyle || op.strokeStyle, name).toBe(darkTheme.colors.ink);
      for (const shape of ICONS[name]) for (const e of reach(shape)) expect(e >= 1 && e <= 23, `${name}: ${shape}`).toBe(true);
    }
  });

  it("works through the element with no warning, and is named in its guide text", () => {
    const description = String(registry.get("icon")!.props.name!.description);
    for (const name of APP_ICONS) {
      expect(warnings(`icon name=${name}\n`), name).toEqual([]);
      expect(description).toContain(` ${name},`.replace(",", name === APP_ICONS.at(-1) ? "." : ","));
    }
    const ui = render(`icon name=planet size=lg\nicon name=bowl size=lg\nicon name=plant size=lg\n`);
    expect(ui.drawOps.filter((o) => o.op === "stroke").length).toBeGreaterThan(6);
    ui.destroy();
    expect(nearestIcon("hamburger")).toBe("menu");
    expect(nearestIcon("microphone")).toBe("mic");
  });
});

describe("other names for an icon", () => {
  const opsOf = (name: string) => {
    const { context, take } = createRecordingContext();
    drawIcon(context, name as never, 0, 0, 24, lightTheme.colors.ink);
    return take();
  };

  it("draws an alias exactly as the icon it stands for", () => {
    for (const [alias, own] of Object.entries(ICON_ALIASES)) {
      expect(isIconName(alias), alias).toBe(true);
      expect(Object.hasOwn(ICONS, own), alias).toBe(true);
      expect(Object.hasOwn(ICONS, alias), `${alias} is an icon's own name`).toBe(false);
      expect(resolveIcon(alias as keyof typeof ICON_ALIASES)).toBe(own);
      expect(opsOf(alias), alias).toEqual(opsOf(own));
    }
    expect(resolveIcon("plant")).toBe("plant");
  });

  it("accepts an alias with no warning, on the element and on icon=, but lists only the icons' own names", () => {
    expect(warnings(`icon name=plant-2\nicon name=cup\ntext "Hi" icon=stopwatch\n`)).toEqual([]);
    const a = render(`icon name=plant-2 size=lg\n`), b = render(`icon name=plant size=lg\n`);
    expect(a.drawOps).toEqual(b.drawOps);
    a.destroy();
    b.destroy();
    for (const alias of Object.keys(ICON_ALIASES)) expect(ICON_NAMES as readonly string[]).not.toContain(alias);
    const description = String(registry.get("icon")!.props.name!.description);
    expect(description).not.toContain("plant-2,");
    expect(description).toMatch(/other names .*work too/);
  });

  it("still warns about a name that's neither, with the nearest icon", () => {
    expect(warnings(`icon name=plant-3\n`)[0]).toMatch(/name="plant-3" isn't an icon\. Did you mean name=plant\?/);
    expect(warnings(`icon name=hamburger\n`)[0]).toMatch(/Did you mean name=menu\?/);
    expect(isIconName("toString")).toBe(false);
  });
});

describe("the icon element", () => {
  it("shows a known icon at its size, and warns about an unknown one with the nearest", () => {
    expect(warnings(`icon name=plane size=lg\n`)).toEqual([]);
    const w = warnings(`icon name=tick\n`);
    expect(w[0]).toMatch(/name="tick" isn't an icon\. Did you mean name=check\? Icons: check, check-circle/);
    const ui = render(`icon name=plane size=lg tone=muted\n`);
    expect(ui.find("icon").box!.h).toBe(28);
    expect(ui.drawOps.every((o) => (o.fillStyle || o.strokeStyle) === lightTheme.colors.muted)).toBe(true);
    ui.destroy();
  });
});

describe("icon= on text and list-item", () => {
  it("starts the text with the icon in its tone, and keeps the words to its right", () => {
    const ui = render(`text "Payment received" icon=check-circle tone=good\n`, { theme: darkTheme });
    const strokes = ui.drawOps.filter((o) => o.op === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every((o) => o.strokeStyle === darkTheme.colors.good)).toBe(true);
    const label = ui.drawOps.find((o) => o.op === "fillText")!;
    const box = ui.find("text").box!;
    expect(Number(label.args[1])).toBeGreaterThan(box.x + 16);
    ui.destroy();
  });

  it("wraps text in the room left beside the icon", () => {
    const long = "A long line that has to wrap well before the edge of a narrow column";
    const plain = render(`text "${long}"\n`, { width: 240 });
    const iconed = render(`text "${long}" icon=info\n`, { width: 240 });
    expect(iconed.find("text").box!.h).toBeGreaterThanOrEqual(plain.find("text").box!.h);
    plain.destroy();
    iconed.destroy();
  });

  it("puts an accent icon at the start of a list row", () => {
    const ui = render(`list\n  list-item "Shipped" detail="Arrives Friday" icon=truck\n`);
    expect(ui.drawOps.some((o) => o.op === "stroke" && o.strokeStyle === lightTheme.colors.accent)).toBe(true);
    expect(warnings(`list\n  list-item "Shipped" icon=lorry\n`)[0]).toMatch(/icon="lorry" isn't an icon/);
    ui.destroy();
  });

  it("ignores an unknown icon on screen: the words show as usual", () => {
    const ui = render(`text "Hello" icon=nope\n`);
    expect(ui.drawOps.filter((o) => o.op === "stroke")).toEqual([]);
    expect(ui.drawOps.find((o) => o.op === "fillText")!.args[0]).toBe("Hello");
    ui.destroy();
  });
});
