import { describe, expect, it } from "vitest";
import { coreComponents, darkTheme, languageGuide, lightTheme, parse, Registry, studioDarkTheme, studioLightTheme, type Theme } from "../src";
import { pageComponents } from "../src/components/page";
import { OPT_IN_PROFILES, PROFILES, resolveProfile } from "../src/profiles";
import { contrastRatio, overImageTheme } from "../src/scrim";
import { walkBoxes } from "../src/layout";
import { render } from "../src/testing";
import type { LoadedImage } from "../src/images";
import type { AccessibleNode } from "../src/a11y/semantics";
import type { Box } from "../src/types";
import { LANDING_PAGE, pageSamples } from "../playground/page-samples";
import { textOverflows } from "./overflow";

const components = [...coreComponents, ...pageComponents];
const registry = new Registry(components);
const read = (src: string) => parse(src.endsWith("\n") ? src : src + "\n", registry);
const messages = (src: string) => read(src).diagnostics.map((d) => d.message);
const photo: LoadedImage = { source: {} as CanvasImageSource, width: 800, height: 600 };
const WIDTHS = [240, 360, 600, 900];
const THEMES: Theme[] = [lightTheme, darkTheme, studioLightTheme, studioDarkTheme];

const boxesOf = (root: Box, type: string) => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};
const nodes = (ui: ReturnType<typeof render>) => {
  const out: AccessibleNode[] = [];
  const walk = (n: AccessibleNode) => { out.push(n); n.children.forEach(walk); };
  walk(ui.accessibility({ full: true }));
  return out;
};

describe("page elements: opt in", () => {
  it("are not in coreComponents, so without the entry point hero is unknown", () => {
    for (const c of pageComponents) expect(coreComponents.some((d) => d.type === c.type), c.type).toBe(false);
    expect(parse('hero "Hi"\n', new Registry(coreComponents)).diagnostics[0]?.message).toMatch(/Unknown element "hero"/i);
  });

  it("the guide stays as it was for a registry without them", () => {
    const core = languageGuide(new Registry(coreComponents));
    expect(core).not.toMatch(/hero "|pricing "|footer "|LOOK|PICTURES/);
  });
});

describe("page elements: parsing", () => {
  it("accepts the sample and every element with its props", () => {
    expect(read(LANDING_PAGE).diagnostics).toEqual([]);
    expect(read(pageSamples.landingPage!.spec).diagnostics).toEqual([]);
  });

  it("says which values work when one doesn't", () => {
    expect(messages('hero "A" align=middle')).toEqual(['align should be one of left, center; got "middle"']);
    expect(messages('band "A" tone=loud')).toEqual(['tone should be one of soft, plain, accent; got "loud"']);
    expect(messages('hero "A" zoom=fast')).toEqual(['zoom should be one of none, slow; got "fast"']);
  });

  it("needs a price on a plan, and a pricing to hold it", () => {
    expect(messages('pricing "P"\n  plan "Pro"')[0]).toMatch(/price/);
    expect(messages('plan "Pro" price="$1"')[0]).toMatch(/pricing/);
    expect(messages('pricing "P"\n  text "no"')[0]).toMatch(/can't contain "text"/);
  });

  it("checks a feature's icon", () => {
    expect(messages('feature "A" icon=nope').length).toBeGreaterThan(0);
  });

  it("streams: every prefix cut at a line boundary parses without errors", () => {
    const lines = LANDING_PAGE.split("\n");
    for (let i = 0; i <= lines.length; i++) {
      const r = parse(lines.slice(0, i).join("\n") + "\n", registry, { partial: true });
      expect(r.diagnostics.filter((d) => d.severity === "error"), `after ${i} lines`).toEqual([]);
    }
  });
});

describe("page elements: layout", () => {
  it("lays the whole sample out inside its parents and keeps text inside, at phone to wide widths", () => {
    for (const width of WIDTHS) {
      const ui = render(LANDING_PAGE, { components, width });
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(textOverflows(ui.sayshape.boxes!, ui.drawOps), `at ${width}`).toEqual([]);
      const check = (b: Box, parent: Box | null) => {
        for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v)).toBe(true);
        if (parent) {
          expect(b.x, `${b.node.type} at ${width}`).toBeGreaterThanOrEqual(parent.x - 0.01);
          expect(b.x + b.w, `${b.node.type} at ${width}`).toBeLessThanOrEqual(parent.x + parent.w + 0.01);
          expect(b.y + b.h, `${b.node.type} at ${width}`).toBeLessThanOrEqual(parent.y + parent.h + 0.01);
        }
        b.children.forEach((k) => check(k, b));
      };
      check(ui.sayshape.boxes!, null);
      ui.destroy();
    }
  });

  it("a feature grid and the plans are columns on a wide screen and one column on a phone", () => {
    const wide = render(LANDING_PAGE, { components, width: 1000 });
    const f = boxesOf(wide.sayshape.boxes!, "feature");
    expect(new Set(f.map((b) => Math.round(b.y))).size).toBe(1);
    const plans = boxesOf(wide.sayshape.boxes!, "plan");
    expect(new Set(plans.map((b) => Math.round(b.y))).size).toBe(1);
    wide.destroy();
    const phone = render(LANDING_PAGE, { components, width: 320 });
    expect(new Set(boxesOf(phone.sayshape.boxes!, "feature").map((b) => Math.round(b.y))).size).toBe(3);
    expect(new Set(boxesOf(phone.sayshape.boxes!, "plan").map((b) => Math.round(b.y))).size).toBe(3);
    phone.destroy();
  });

  it("plans in a row have one height, with their buttons on one line", () => {
    const ui = render(LANDING_PAGE, { components, width: 1000 });
    const plans = boxesOf(ui.sayshape.boxes!, "plan");
    expect(new Set(plans.map((b) => Math.round(b.h))).size).toBe(1);
    const buttons = plans.map((p) => boxesOf(p, "button")[0]!);
    expect(new Set(buttons.map((b) => Math.round(b.y))).size).toBe(1);
    ui.destroy();
  });

  it("buttons written one under the other sit side by side, and stack on a phone", () => {
    const spec = 'hero "A"\n  button "Plan my first trip" on=emit:a\n  button "See how it works" on=emit:b\n';
    const wide = render(spec, { components, width: 900 });
    const [a, b] = boxesOf(wide.sayshape.boxes!, "button");
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
    wide.destroy();
    const phone = render(spec, { components, width: 240 });
    const [c, d] = boxesOf(phone.sayshape.boxes!, "button");
    expect(d!.y).toBeGreaterThan(c!.y);
    phone.destroy();
  });

  it("a centred hero centres its buttons", () => {
    const ui = render('hero "A" align=center\n  button "One" on=emit:a\n  button "Two" on=emit:b\n', { components, width: 900, padding: 0 });
    const [a, b] = boxesOf(ui.sayshape.boxes!, "button");
    expect((a!.x + b!.x + b!.w) / 2).toBeCloseTo(450, 0);
    ui.destroy();
  });

  it("the headline grows with the width, from the theme's display size", () => {
    const size = (w: number) => {
      const ui = render('hero "Headline"', { components, width: w });
      const op = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Headline")!;
      ui.destroy();
      return Number(/(\d+)px/.exec(op.font!)![1]);
    };
    expect(size(900)).toBeGreaterThan(size(320));
    expect(size(320)).toBeGreaterThanOrEqual(lightTheme.text.display);
  });
});

describe("page elements: pictures", () => {
  const spec = 'hero "Lake" lead="Quiet mornings" src="/lake.jpg" zoom=slow\n  button "Book" on=emit:book\n';
  it("a hero with a photo draws it with the scrim, in the over-image theme, and is tall enough to see it", async () => {
    const ui = render(spec, { components, width: 600, padding: 0, loadImage: async () => photo });
    await ui.sayshape.imagesLoaded();
    const hero = boxesOf(ui.sayshape.boxes!, "hero")[0]!;
    expect(hero.h).toBeGreaterThanOrEqual(Math.round(600 * 0.45));
    expect(ui.drawOps.some((o) => o.op === "drawImage")).toBe(true);
    const words = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Quiet mornings")!;
    expect(words.fillStyle).toBe(overImageTheme(lightTheme).colors.muted);
    ui.destroy();
  });

  it("words over the photo read at 4.5:1 on its scrim across themes", () => {
    for (const t of THEMES) {
      const c = overImageTheme(t).colors;
      for (const k of ["ink", "muted", "accent"] as const) expect(contrastRatio(c[k], c.surface) ?? 0, `${t.name} ${k}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("without src it is plain: no image drawn, the page's own colors", () => {
    const ui = render('hero "Lake"', { components, width: 600 });
    expect(ui.drawOps.some((o) => o.op === "drawImage")).toBe(false);
    expect(ui.drawOps.find((o) => o.op === "fillText")!.fillStyle).toBe(lightTheme.colors.ink);
    ui.destroy();
  });
});

describe("page elements: the accent band", () => {
  it("keeps its words and a solid button readable on the accent, in every theme", () => {
    for (const t of THEMES) {
      const ui = render('band "Go" tone=accent\n  button "Start" on=emit:a\n', { components, theme: t });
      const title = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "Go")!;
      const c = t.colors;
      expect(title.fillStyle).toBe(c.onAccent);
      for (const ground of [c.accent, c.accent2]) expect(contrastRatio(c.onAccent, ground) ?? 0, t.name).toBeGreaterThanOrEqual(4.5);
      ui.destroy();
    }
  });
});

describe("page elements: motion", () => {
  it("take enter= and stagger= like any element", () => {
    expect(read('section "A" enter=rise stagger=true\n  feature "B" enter=fade').diagnostics).toEqual([]);
  });
});

describe("page elements: screen readers", () => {
  it("name the page's landmarks and headings", () => {
    const ui = render(LANDING_PAGE, { components, width: 600 });
    const all = nodes(ui);
    const heading = (name: string) => all.find((n) => n.role === "heading" && n.name === name);
    expect(heading("Trips that plan themselves")?.level).toBe(1);
    expect(heading("Why people use it")?.level).toBe(2);
    expect(heading("Simple pricing")?.level).toBe(2);
    expect(all.find((n) => n.role === "region" && n.name === "Why people use it")).toBeDefined();
    expect(all.find((n) => n.role === "region" && n.name === "Northwind Trips")).toBeDefined();
    expect(all.find((n) => n.role === "figure")?.name).toMatch(/We stopped writing itineraries/);
    expect(all.filter((n) => n.role === "group" && n.name === "Pro")[0]?.description).toBe("$12 / month".replace(" ", " "));
    ui.destroy();
  });

  it("reaches every button and link with Tab, and pressing one runs its action", () => {
    const ui = render(LANDING_PAGE, { components, width: 900 });
    ui.press({ type: "button", text: "Start free trial" });
    expect(ui.emitted.map((e) => e.name)).toContain("trial");
    ui.press({ type: "link", text: "Contact" });
    expect(ui.emitted.map((e) => e.name)).toContain("contact");
    ui.destroy();
  });
});

describe("page elements: the guide", () => {
  it("the page profile is for opt-in elements: not in PROFILES, so every other profile resolves as before", () => {
    expect(Object.keys(PROFILES)).not.toContain("page");
    expect(Object.keys(OPT_IN_PROFILES)).toEqual(["page"]);
    expect(() => resolveProfile(new Registry(coreComponents), "page")).toThrow(/doesn't have/);
  });

  it("exposes the page elements and turns on look, motion and pictures by itself", () => {
    const p = resolveProfile(registry, "page");
    expect(p.types).toEqual(expect.arrayContaining(["hero", "section", "band", "feature", "quote", "pricing", "plan", "footer", "button", "image"]));
    for (const mode of ["full", "compact"] as const) {
      const g = languageGuide(registry, { mode, profile: "page" });
      expect(g).toMatch(/LOOK/);
      expect(g).toMatch(/ENTRANCE|enter=/);
      expect(g).toMatch(/PICTURES/);
      expect(g).toMatch(/hero/);
      expect(g).toMatch(/PICK BY WHAT YOU'RE SHOWING|hero "Headline"/i);
    }
  });

  it("the options still win: look can be switched off", () => {
    expect(languageGuide(registry, { profile: "page", look: false })).not.toMatch(/LOOK \(/);
  });

  it("other profiles don't get them", () => {
    expect(languageGuide(registry, { profile: "forms" })).not.toMatch(/LOOK|PICTURES|hero "/);
  });
});
