import { describe, expect, it } from "vitest";
import { coreComponents, darkTheme, forcedColorsTheme, languageGuide, lightTheme, parse, Registry, studioDarkTheme, studioLightTheme, type Theme } from "../src";
import { PICTURE_PROPS } from "../src/component";
import { pictureRadius, ZOOM_MS, ZOOM_TO } from "../src/components/media";
import { applyLook, LOOK_OPTIONS, LOOK_PROPS, type Look } from "../src/look";
import { parseColor } from "../src/theme";
import { contrastRatio, isForcedColors, overImageTheme, scrimAlpha } from "../src/scrim";
import { render } from "../src/testing";
import type { LoadedImage } from "../src/images";
import type { Box } from "../src/types";

const registry = new Registry(coreComponents);
const read = (src: string) => parse(src.endsWith("\n") ? src : src + "\n", registry);
const messages = (src: string) => read(src).diagnostics.map((d) => d.message);
const photo: LoadedImage = { source: {} as CanvasImageSource, width: 800, height: 600 };
const loaded = { loadImage: async () => photo };
const draws = (ui: ReturnType<typeof render>) => ui.drawOps.filter((d) => d.op === "drawImage");

const hero = `image "Lake at dawn" src="/lake.jpg" ratio=16:9
  text "Quiet mornings" style=title
  text "Cabins by the water"
  button "Book" on=emit:book
`;

describe("pictures: parsing", () => {
  it("accepts shape=, zoom= and elements laid over an image, without diagnostics", () => {
    expect(read(hero).diagnostics).toEqual([]);
    expect(read(`image "Ada" src="/a.jpg" ratio=1:1 shape=circle zoom=slow`).diagnostics).toEqual([]);
    expect(read(`image "Ada" src="/a.jpg" shape=square`).diagnostics).toEqual([]);
  });

  it("says which values work when one doesn't", () => {
    expect(messages(`image "Ada" src="/a.jpg" shape=oval`)).toEqual([`shape should be one of rounded, square, circle; got "oval"`]);
    expect(messages(`image "Ada" src="/a.jpg" zoom=fast`)).toEqual([`zoom should be one of none, slow; got "fast"`]);
  });

  it("keeps the Known props list for other elements as it was, and images take the new ones", () => {
    expect(messages(`image "Ada" src="/a.jpg" colour=red`)[0]).toMatch(/Known props: src, ratio, fit, caption, shape, zoom, if, tip/);
    expect(messages(`text "A" shape=circle`)[0]).toMatch(/"text" has no prop "shape"/);
  });

  it("streams: every prefix cut at a line boundary parses without errors", () => {
    const lines = hero.split("\n");
    for (let i = 0; i <= lines.length; i++) {
      const r = parse(lines.slice(0, i).join("\n") + "\n", registry, { partial: true });
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });
});

describe("pictures: the guide", () => {
  it("says nothing about them unless asked", () => {
    for (const mode of ["full", "compact"] as const) {
      const g = languageGuide(registry, { mode });
      expect(g).not.toMatch(/PICTURES|zoom=|shape=rounded/);
      expect(g).not.toMatch(/image .*holds elements/);
    }
  });

  it("explains them from the prop definitions when pictures is on", () => {
    const full = languageGuide(registry, { pictures: true });
    expect(full).toMatch(/PICTURES \(optional, on image\)\n {4}shape=<rounded\|square\|circle>/);
    expect(full).toMatch(/zoom=<none\|slow>/);
    expect(full).toMatch(/children: any elements/);
    expect(languageGuide(registry, { mode: "compact", pictures: true })).toMatch(/PICTURES \(optional\): image takes shape=rounded\|square\|circle and zoom=slow/);
    expect(Object.keys(PICTURE_PROPS)).toEqual(["shape", "zoom"]);
  });
});

describe("pictures: layout", () => {
  const boxOf = (ui: ReturnType<typeof render>, type: string) => ui.find(type).box as Box;

  it("is at least as tall as its ratio and holds what's over it, at narrow and wide widths", () => {
    for (const width of [240, 360, 600, 900]) {
      const ui = render(hero, { width, padding: 0 });
      const img = boxOf(ui, "image");
      const pad = lightTheme.space.lg;
      expect(img.w).toBe(width);
      expect(img.h).toBeGreaterThanOrEqual(Math.round(width / (16 / 9)));
      for (const k of img.children) {
        expect(k.x, `child at ${width}`).toBeGreaterThanOrEqual(img.x + pad);
        expect(k.x + k.w).toBeLessThanOrEqual(img.x + img.w - pad + 0.5);
        expect(k.y).toBeGreaterThanOrEqual(img.y + pad - 0.5);
        expect(k.y + k.h).toBeLessThanOrEqual(img.y + img.h - pad + 0.5);
      }
    }
  });

  it("grows past its ratio when the content is taller, and centres short content", () => {
    const tall = render(`image "x" src="/x.jpg" ratio=16:9\n  text "One"\n  text "Two"\n  text "Three"\n  text "Four"\n  text "Five"\n  text "Six"\n  text "Seven"\n  text "Eight"\n`, { width: 300, padding: 0 });
    const img = boxOf(tall, "image");
    expect(img.h).toBeGreaterThan(Math.round(300 / (16 / 9)));
    const last = img.children[img.children.length - 1]!;
    expect(last.y + last.h + lightTheme.space.lg).toBeCloseTo(img.y + img.h, 0);
    const short = boxOf(render(`image "x" src="/x.jpg" ratio=1:1\n  text "Hi"\n`, { width: 300, padding: 0 }), "image");
    const kid = short.children[0]!;
    expect(Math.abs(kid.y - short.y - (short.y + short.h - (kid.y + kid.h)))).toBeLessThanOrEqual(2);
  });

  it("is the same as before without elements over it (caption and all)", () => {
    const ui = render(`image "Shoe" src="/s.jpg" ratio=4:3 caption="Side view"\n`, { width: 440, padding: 20 });
    const img = boxOf(ui, "image");
    expect(img.children).toEqual([]);
    expect(img.h).toBeGreaterThan(300);
    expect(ui.text()).toContain("Side view");
  });

  it("warns that a caption isn't shown over an image with elements on it", () => {
    const ui = render(`image "x" src="/x.jpg" caption="Hello"\n  text "Over"\n`, { width: 300 });
    expect(ui.warnings.join(" ")).toMatch(/caption is not shown/);
    expect(ui.text()).not.toContain("Hello");
  });

  it("an element's if= still hides what's over it", () => {
    const ui = render(`state show=false\nimage "x" src="/x.jpg"\n  text "Over" if=show\n  text "Always"\n`, { width: 300 });
    expect(ui.text()).toEqual(["Always"]);
  });
});

describe("pictures: crop and shape", () => {
  it("crops to cover by default and shows the whole picture with fit=contain, in the same box", async () => {
    const ui = render(`image "x" src="/x.jpg" ratio=1:1 fit=contain\n`, { width: 440, padding: 20, ...loaded });
    await ui.sayshape.imagesLoaded();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = draws(ui)[0]!.args as number[];
    expect([sx, sy, sw, sh]).toEqual([0, 0, 800, 600]);
    expect([dx, dy, dw, dh]).toEqual([20, 70, 400, 300]);
  });

  it("rounds with the theme's radius, squares off, or goes fully round", () => {
    expect(pictureRadius("rounded", 200, 100, 8)).toBe(8);
    expect(pictureRadius("square", 200, 100, 8)).toBe(0);
    expect(pictureRadius("circle", 200, 200, 8)).toBe(100);
    expect(pictureRadius("circle", 200, 100, 8)).toBe(50);
  });

  it("clips the picture to the shape, in the same box whatever the shape", async () => {
    const sizes: number[][] = [];
    for (const shape of ["rounded", "square", "circle"]) {
      const ui = render(`image "x" src="/x.jpg" ratio=1:1 shape=${shape}\n`, { width: 240, padding: 0, ...loaded });
      await ui.sayshape.imagesLoaded();
      expect(draws(ui)).toHaveLength(1);
      const b = ui.find("image").box as Box;
      sizes.push([b.w, b.h]);
    }
    expect(sizes).toEqual([[240, 240], [240, 240], [240, 240]]);
  });
});

describe("pictures: words over a photo", () => {
  const BASE = [["light", lightTheme], ["dark", darkTheme], ["studio-light", studioLightTheme], ["studio-dark", studioDarkTheme]] as Array<[string, Theme]>;
  const LOOKS: Look[] = [
    ...LOOK_PROPS.flatMap((p) => Object.keys(LOOK_OPTIONS[p]).map((o) => ({ [p]: o }) as Look)),
    { mood: "bold", type: "editorial", shape: "round", density: "airy" },
  ];
  const THEMES = [
    ...BASE,
    ...BASE.flatMap(([name, t]) => LOOKS.map((l) => [`${name} + ${Object.entries(l).map(([k, v]) => `${k}=${v}`).join(" ")}`, applyLook(t, l)] as [string, Theme])),
  ];
  const TEXTS = ["ink", "muted", "accent", "good", "warn", "bad"] as const;
  /** Gray, saturated and mixed pixels from the blackest to the whitest. */
  const PIXELS: Array<[number, number, number]> = [];
  for (const r of [0, 128, 255]) for (const g of [0, 128, 255]) for (const b of [0, 128, 255]) PIXELS.push([r, g, b]);
  const over = (scrim: string, alpha: number, px: [number, number, number]) => {
    // The scrim blended over one pixel, as the canvas does it: 8 bits a channel.
    const a = Math.round(alpha * 255) / 255;
    const c = parseColor(scrim)!;
    const [r, g, b] = [0, 1, 2].map((i) => Math.round(c[i]! * a + px[i]! * (1 - a)));
    return `rgb(${r}, ${g}, ${b})`;
  };

  it.each(THEMES)("%s: every text color keeps 4.5:1 over any photo, the blackest to the whitest", (_n, theme) => {
    const inner = overImageTheme(theme);
    const alpha = scrimAlpha(inner);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(1);
    for (const px of PIXELS) {
      const under = over(inner.colors.surface, alpha, px);
      for (const key of TEXTS) {
        expect(contrastRatio(inner.colors[key], under), `${key} over pixel ${px}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Light and dark are both dark inside, so light text sits on a dark scrim.
    expect(contrastRatio(inner.colors.ink, inner.colors.surface)).toBeGreaterThanOrEqual(7);
  });

  it.each(THEMES)("%s: what's laid over a picture reads like text anywhere else", (_n, theme) => {
    const c = overImageTheme(theme).colors;
    for (const bg of ["surface", "raised"] as const) {
      for (const fg of TEXTS) expect(contrastRatio(c[fg], c[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.control, c[bg]), `control on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("a dark theme keeps its surface and ink; a light one is made dark; both once, cached", () => {
    expect(overImageTheme(darkTheme).colors.surface).toBe(darkTheme.colors.surface);
    expect(overImageTheme(darkTheme).colors.ink).toBe(darkTheme.colors.ink);
    const a = overImageTheme(lightTheme);
    expect(a).not.toBe(lightTheme);
    expect(overImageTheme(lightTheme)).toBe(a);
    expect(a.space).toBe(lightTheme.space);
    expect(a.colors.surface).toBe(lightTheme.colors.ink);
  });

  it("is drawn: the scrim sits between the picture and the words, at the strength the math gives", async () => {
    const ui = render(hero, { width: 360, theme: lightTheme, animate: false, ...loaded });
    await ui.sayshape.imagesLoaded();
    const inner = overImageTheme(lightTheme);
    const ops = ui.drawOps;
    const imageAt = ops.findIndex((d) => d.op === "drawImage");
    const scrimAt = ops.findIndex((d, i) => i > imageAt && d.op === "fill" && d.fillStyle === inner.colors.surface && Math.abs(d.globalAlpha - scrimAlpha(inner)) < 1e-9);
    const textAt = ops.findIndex((d) => d.op === "fillText" && d.args[0] === "Quiet mornings");
    expect(imageAt).toBeGreaterThanOrEqual(0);
    expect(scrimAt).toBeGreaterThan(imageAt);
    expect(textAt).toBeGreaterThan(scrimAt);
    // The words are the inner theme's light ink, never the page's dark one.
    expect(ops[textAt]!.fillStyle).toBe(inner.colors.ink);
    expect(ops[textAt]!.fillStyle).not.toBe(lightTheme.colors.ink);
    expect(contrastRatio(ops[textAt]!.fillStyle, over(inner.colors.surface, scrimAlpha(inner), [255, 255, 255]))).toBeGreaterThanOrEqual(4.5);
  });

  it("also reads while the picture loads, fails or is blocked: words on the dark surface", async () => {
    const ui = render(hero, { width: 360, theme: lightTheme, loadImage: async () => { throw new Error("404"); } });
    await ui.sayshape.imagesLoaded();
    expect(draws(ui)).toHaveLength(0);
    const text = ui.drawOps.find((d) => d.op === "fillText" && d.args[0] === "Quiet mornings")!;
    const surface = overImageTheme(lightTheme).colors.surface;
    expect(ui.drawOps.some((d) => d.op === "fill" && d.fillStyle === surface && d.globalAlpha === 1)).toBe(true);
    expect(contrastRatio(text.fillStyle, surface)).toBeGreaterThanOrEqual(4.5);
    // The alt text is not drawn over the words.
    expect(ui.text()).not.toContain("Lake at dawn");
  });

  it("forced colors win: no recoloring, no scrim, no picture, the person's colors", async () => {
    const system: Record<string, string> = { Canvas: "rgb(0, 0, 0)", CanvasText: "rgb(255, 255, 255)", Highlight: "rgb(26, 235, 255)", HighlightText: "rgb(0, 0, 0)", GrayText: "rgb(63, 242, 63)" };
    for (const base of [lightTheme, darkTheme]) {
      const forced = forcedColorsTheme(base, (n) => system[n]!);
      expect(isForcedColors(forced)).toBe(true);
      expect(overImageTheme(forced)).toBe(forced);
      const ui = render(hero, { width: 360, theme: forced, ...loaded });
      await ui.sayshape.imagesLoaded();
      expect(draws(ui)).toHaveLength(0);
      const text = ui.drawOps.find((d) => d.op === "fillText" && d.args[0] === "Quiet mornings")!;
      expect(text.fillStyle).toBe(forced.colors.ink);
      expect(ui.drawOps.some((d) => d.op === "fill" && d.globalAlpha > 0 && d.globalAlpha < 1 && d.fillStyle === forced.colors.surface)).toBe(false);
      expect(contrastRatio(text.fillStyle, forced.colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("only elements laid over the picture are recolored; a plain image, and the page around it, keep the page's theme", () => {
    const ui = render(`text "Before"\nimage "x" src="/x.jpg"\n  text "Over"\ntext "After"\n`, { width: 360, theme: lightTheme });
    const fill = (t: string) => ui.drawOps.find((d) => d.op === "fillText" && d.args[0] === t)!.fillStyle;
    expect(fill("Before")).toBe(lightTheme.colors.ink);
    expect(fill("After")).toBe(lightTheme.colors.ink);
    expect(fill("Over")).toBe(overImageTheme(lightTheme).colors.ink);
  });
});

describe("pictures: what's over a picture works", () => {
  it("presses a button over the photo, and Tab reaches it", async () => {
    const ui = render(hero, { width: 360, ...loaded });
    await ui.sayshape.imagesLoaded();
    ui.press({ type: "button", text: "Book" });
    expect(ui.emitted).toEqual([{ name: "book", value: undefined }]);
    const tabbed = render(hero, { width: 360, ...loaded });
    tabbed.key("Tab");
    expect(tabbed.focused?.type).toBe("button");
  });

  it("is a group named by what the picture shows, with its content inside; a plain image is still an img", () => {
    const over = render(hero, { width: 360 }).accessibility({ full: true });
    const find = (n: typeof over, role: string): typeof over | undefined => (n.role === role ? n : n.children.map((k) => find(k, role)).find(Boolean));
    const named = (n: typeof over, name: string): typeof over | undefined => (n.name === name ? n : n.children.map((k) => named(k, name)).find(Boolean));
    const group = named(over, "Lake at dawn");
    expect(group?.role).toBe("group");
    expect(group?.children.map((k) => k.role)).toContain("heading");
    expect(group?.children.map((k) => k.role)).toContain("button");
    const plain = render(`image "Lake at dawn" src="/lake.jpg"\n`, { width: 360 }).accessibility({ full: true });
    expect(named(plain, "Lake at dawn")?.role).toBe("img");
  });
});

describe("pictures: slow zoom", () => {
  const spec = `image "Lake" src="/lake.jpg" ratio=1:1 zoom=slow\n`;
  const moving = (s: string, opts: Parameters<typeof render>[1] = {}) => render(s, { width: 240, padding: 0, animate: true, clock: true, ...loaded, ...opts });
  /** How much larger than the box the last picture was drawn. */
  const growth = (ui: ReturnType<typeof render>) => {
    const a = draws(ui).at(-1)!.args as number[];
    return a[7]! / (ui.find("image").box as Box).w;
  };
  const settle = async (ui: ReturnType<typeof render>) => { await ui.sayshape.imagesLoaded(); ui.clock.advance(0); };

  it("starts unzoomed once the picture shows, drifts closer mid-way, and ends at ZOOM_TO and stays", async () => {
    const ui = moving(spec);
    await settle(ui);
    // 800x600 covers a square: the drawn width is the box's at no zoom.
    expect(growth(ui)).toBeCloseTo(1, 5);
    ui.clock.advance(ZOOM_MS / 2);
    const mid = growth(ui);
    expect(mid).toBeGreaterThan(1.01);
    expect(mid).toBeLessThan(ZOOM_TO - 0.01);
    ui.clock.advance(ZOOM_MS);
    expect(growth(ui)).toBeCloseTo(ZOOM_TO, 5);
    ui.clock.advance(ZOOM_MS);
    expect(growth(ui)).toBeCloseTo(ZOOM_TO, 5);
  });

  it("zooms about the centre and stays inside the picture's clip", async () => {
    const ui = moving(spec);
    await settle(ui);
    ui.clock.advance(ZOOM_MS);
    const [, , , , , dx, dy, dw, dh] = draws(ui).at(-1)!.args as number[];
    expect(dx! + dw! / 2).toBeCloseTo(120, 5);
    expect(dy! + dh! / 2).toBeCloseTo(120, 5);
    // Larger than its box, so it is the clip (always set before the picture is drawn) that keeps it inside.
    expect(dw).toBeGreaterThan(240);
    // Painting only: the box and its place in the layout never moved.
    expect((ui.find("image").box as Box).h).toBe(240);
  });

  it("does not start while the picture is still loading", async () => {
    let finish!: (img: LoadedImage) => void;
    const ui = moving(spec, { loadImage: () => new Promise((r) => { finish = r; }) });
    ui.clock.advance(ZOOM_MS);
    finish(photo);
    await ui.sayshape.imagesLoaded();
    expect(growth(ui)).toBeCloseTo(1, 5);
  });

  it("is drawn at rest under reduced motion and with animate: false", async () => {
    for (const opts of [{ reducedMotion: true }, { animate: false }, { animate: false, clock: false }]) {
      const ui = moving(spec, opts);
      await ui.sayshape.imagesLoaded();
      ui.sayshape.renderNow();
      expect(growth(ui)).toBeCloseTo(1, 5);
    }
  });

  it("an image without zoom= does not move", async () => {
    const ui = moving(`image "Lake" src="/lake.jpg" ratio=1:1\n`);
    await settle(ui);
    ui.clock.advance(ZOOM_MS);
    expect(growth(ui)).toBeCloseTo(1, 5);
  });

  it("also zooms the picture behind elements, which stay where they are", async () => {
    const ui = moving(`image "Lake" src="/lake.jpg" ratio=1:1 zoom=slow\n  button "Book" on=emit:book\n`);
    await settle(ui);
    const before = (ui.find({ type: "button" }).box as Box).y;
    ui.clock.advance(ZOOM_MS);
    expect(growth(ui)).toBeCloseTo(ZOOM_TO, 5);
    expect((ui.find({ type: "button" }).box as Box).y).toBe(before);
  });
});
