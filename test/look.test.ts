import { describe, expect, it } from "vitest";
import { coreComponents, darkTheme, extendTheme, languageGuide, lightTheme, parse, Registry, studioLightTheme, type ComponentDef, type Theme } from "../src";
import { applyLook, LOOK_FONTS, LOOK_OPTIONS, LOOK_PROPS, lookGuide, type Look } from "../src/look";
import { forcedColorsTheme } from "../src/theme";
import { sayShapeLineTest } from "../src/model/clean";
import { render } from "../src/testing";
import { mapComponents } from "../src/components/map";
import { exampleSpec } from "./examples";
import { textOverflows } from "./overflow";
import { resolveTheme } from "../playground/appearance/presets";
import type { Box } from "../src/types";

const registry = new Registry(coreComponents);
const read = (src: string, opts = {}) => parse(src.endsWith("\n") ? src : src + "\n", registry, opts);
const messages = (src: string, opts = {}) => read(src, opts).diagnostics.map((d) => d.message);

describe("look line: parsing", () => {
  it("reads one named option per prop", () => {
    const r = read(`look mood=bold type=editorial shape=soft density=airy\ntext "Hi"`);
    expect(r.diagnostics).toEqual([]);
    expect(r.look).toEqual({ mood: "bold", type: "editorial", shape: "soft", density: "airy", line: 1 });
    // It's no element: the screen holds only the text.
    expect(r.root.children.map((n) => n.type)).toEqual(["text"]);
  });

  it("default, or leaving a prop out, keeps the host's", () => {
    expect(read(`look mood=default shape=sharp`).look).toEqual({ shape: "sharp", line: 1 });
    expect(read(`look mood=default`).look).toBeUndefined();
    expect(read(`text "Hi"`).look).toBeUndefined();
  });

  it("an unknown prop is left out and says what there is; the rest apply", () => {
    const r = read(`look vibe=fun shape=round`);
    expect(r.look).toEqual({ shape: "round", line: 1 });
    expect(r.diagnostics).toEqual([{ line: 1, severity: "warning", message: `look has no "vibe", so it was ignored. look takes mood, type, shape, density` }]);
  });

  it("never sets colors, fonts or sizes", () => {
    for (const bad of ["color=#ff0000", "accent=red", "font=Papyrus", "size=20", "background=black"]) {
      const r = read(`look ${bad} mood=quiet`);
      expect(r.look, bad).toEqual({ mood: "quiet", line: 1 });
      expect(r.diagnostics[0]!.message, bad).toMatch(/^look never sets colors, fonts or sizes \(the app chooses those\)/);
    }
  });

  it("an unknown option, a value or an expression lists the choices", () => {
    expect(messages(`look mood=loud`)).toEqual([`look mood=loud isn't one of its choices, so it was ignored. Use one of: default, quiet, bold`]);
    expect(messages(`look density=12`)[0]).toMatch(/^look density= takes one of its names, never a value or an expression/);
    expect(messages(`look type={fancy ? 'editorial' : 'classic'}`)[0]).toMatch(/^look type= takes one of its names/);
    expect(read(`look mood=loud`).look).toBeUndefined();
  });

  it("quoted text is ignored", () => {
    expect(messages(`look "Fancy" mood=bold`)[0]).toMatch(/^look takes named choices, not quoted text/);
    expect(read(`look "Fancy" mood=bold`).look).toEqual({ mood: "bold", line: 1 });
  });

  it("a second look line is ignored", () => {
    const r = read(`look mood=bold\nlook shape=round\ntext "Hi"`);
    expect(r.look).toEqual({ mood: "bold", line: 1 });
    expect(r.diagnostics).toEqual([{ line: 2, severity: "warning", message: `The look was already chosen on line 1, so this line was ignored. Put every choice on that one line, like look mood=bold type=editorial` }]);
  });

  it("an indented look line is ignored", () => {
    const r = read(`card\n  look mood=bold\n  text "Hi"`);
    expect(r.look).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ line: 2, severity: "warning" });
    expect(r.diagnostics[0]!.message).toMatch(/^look goes at the top level, unindented/);
    expect(r.root.children[0]!.children.map((n) => n.type)).toEqual(["text"]);
  });

  it("after state and derive lines is fine; after an element it still applies, with a warning to move it up", () => {
    expect(read(`state n=1\nderive m={n * 2}\nlook mood=bold\ntext "{m}"`).diagnostics).toEqual([]);
    const r = read(`text "Hi"\nlook mood=bold`);
    expect(r.look).toEqual({ mood: "bold", line: 2 });
    expect(r.diagnostics).toEqual([{ line: 2, severity: "warning", message: `look goes before the first element (line 1), so the screen doesn't change its look while it draws. It still applies to the whole interface; move it to the top` }]);
  });

  it("a host can turn look lines off", () => {
    const r = read(`look mood=bold\ntext "Hi"`, { look: false });
    expect(r.look).toBeUndefined();
    expect(r.diagnostics).toEqual([{ line: 1, severity: "warning", message: `This app keeps its own look, so the look line was ignored. Leave it out` }]);
  });

  it("a host's own element named look keeps its line", () => {
    const own: ComponentDef = { type: "look", category: "content", description: "A host's own element.", props: {}, layout(box) { box.h = 10; } };
    const r = parse(`look\n`, new Registry([...coreComponents, own]));
    expect(r.look).toBeUndefined();
    expect(r.root.children.map((n) => n.type)).toEqual(["look"]);
  });

  it("is read through presets, on the spec's own line", () => {
    const src = `state sales=[{region: "North", amount: 3}, {region: "South", amount: 5}]\nlook type=editorial\nreport "Sales" data=sales\n  sum amount\n`;
    const r = parse(src, registry, { presets: true });
    expect(r.look).toEqual({ type: "editorial", line: 2 });
    expect(r.diagnostics.filter((d) => /look/.test(d.message))).toEqual([]);
    const late = parse(`state sales=[{region: "North", amount: 3}]\nreport "Sales" data=sales\n  sum amount\nlook type=editorial\n`, registry, { presets: true });
    expect(late.look?.line).toBe(4);
    expect(late.diagnostics.find((d) => /^look goes before/.test(d.message))?.line).toBe(4);
  });
});

describe("look line: streaming", () => {
  const spec = `look mood=bold type=editorial shape=soft density=airy
state n=2
card
  text "Weekend" style=title
  stat label="Days" value={n}
  button "Add" on=inc:n
`;
  it("every prefix cut at a line boundary parses, with the look from the line it arrives on", () => {
    const lines = spec.split("\n");
    for (let i = 0; i <= lines.length; i++) {
      const prefix = lines.slice(0, i).join("\n") + (i ? "\n" : "");
      const r = read(prefix || "\n");
      expect(r.diagnostics, prefix).toEqual([]);
      expect(r.look === undefined, prefix).toBe(i === 0);
    }
    // Cut inside the look line: not read yet, no warning.
    const cut = parse("look mood=bo", registry, { partial: true });
    expect(cut.look).toBeUndefined();
    expect(cut.diagnostics).toEqual([]);
  });

  it("first: the screen draws in it from the first element on, and nothing drawn moves as lines arrive", () => {
    const ui = render("");
    const s = ui.sayshape;
    s.beginStream();
    let first: { x: number; y: number; w: number } | null = null;
    let theme: Theme | null = null;
    for (const line of spec.split("\n").filter(Boolean)) {
      s.push(line + "\n");
      s.renderNow();
      const card = s.boxes?.children[0];
      if (!card) continue;
      if (!first) { first = { x: card.x, y: card.y, w: card.w }; theme = s.theme; }
      expect({ x: card.x, y: card.y, w: card.w }).toEqual(first);
      expect(s.theme).toBe(theme);
    }
    expect(first).not.toBeNull();
    s.endStream();
    s.renderNow();
    expect(s.theme.space.md).toBeGreaterThan(lightTheme.space.md);
    ui.destroy();
  });

  it("late: it applies on the next layout after it arrives", () => {
    const ui = render("");
    const s = ui.sayshape;
    s.beginStream();
    s.push(`text "Hi"\n`);
    s.renderNow();
    expect(s.theme).toBe(lightTheme);
    s.push(`look density=airy\n`);
    s.renderNow();
    expect(s.theme.space.md).toBeGreaterThan(lightTheme.space.md);
    s.endStream();
    ui.destroy();
  });
});

describe("look line: the engine", () => {
  it("with no look line the theme is the host's very own", () => {
    const ui = render(`text "Hi"`, { theme: studioLightTheme });
    expect(ui.sayshape.theme).toBe(studioLightTheme);
    expect(ui.sayshape.look).toBeNull();
  });

  it("lays the look's tokens over the host's theme", () => {
    const ui = render(`look mood=quiet type=editorial shape=sharp density=compact\ntext "Hi" style=title`);
    const t = ui.sayshape.theme;
    expect(t.space.md).toBeLessThan(lightTheme.space.md);
    expect(t.control.height).toBeLessThan(lightTheme.control.height);
    expect(t.radius.lg).toBeLessThan(lightTheme.radius.lg);
    expect(t.font.display).toBe(LOOK_FONTS.serifDisplay);
    expect(t.font.family).toBe(lightTheme.font.family);
    expect(t.text.display).toBeGreaterThan(lightTheme.text.display);
    expect(t.colors.shadow).toBe("transparent");
    // Colors are the host's, apart from how the accent is used.
    const { shadow: _s, accent2: _a, ...rest } = t.colors;
    const { shadow: _s2, accent2: _a2, ...host } = lightTheme.colors;
    expect(rest).toEqual(host);
    // The screen's gap between top-level elements follows the density.
    expect(ui.sayshape.tree!.props.gap).toBe(String(t.space.md));
  });

  it("draws headings in the display face, other text in the host's", () => {
    const ui = render(`look type=editorial\ntext "Title" style=title\ntext "Body"\ntext "**Big** news" style=display rich=true`);
    const fonts = (text: string) => ui.drawOps.filter((op) => op.op === "fillText" && String(op.args[0]).includes(text)).map((op) => op.font);
    expect(fonts("Title")[0]).toContain("Georgia, serif");
    expect(fonts("Body")[0]).toContain(lightTheme.font.family);
    expect(fonts("Big")[0]).toContain("Georgia, serif");
  });

  it("classic sets serif text; technical sets the host's mono for headings", () => {
    expect(render(`look type=classic\ntext "Hi"`).sayshape.theme.font.family).toBe(LOOK_FONTS.serifText);
    expect(render(`look type=technical\ntext "Hi"`).sayshape.theme.font.display).toBe(lightTheme.font.mono);
  });

  it("passing the looked theme back in doesn't apply the look twice", () => {
    const ui = render(`look density=airy shape=round\ntext "Hi"`);
    const once = ui.sayshape.theme;
    ui.sayshape.setTheme(once);
    ui.sayshape.renderNow();
    expect(ui.sayshape.theme).toBe(once);
    expect(applyLook(once, { density: "airy" }).space).toEqual(applyLook(lightTheme, { density: "airy" }).space);
  });

  it("a new spec without a look line goes back to the host's", () => {
    const ui = render(`look mood=bold\ntext "Hi"`);
    expect(ui.sayshape.theme).not.toBe(lightTheme);
    ui.setSpec(`text "Hi"`);
    expect(ui.sayshape.theme).toBe(lightTheme);
  });

  it("a host's setTheme keeps the look over the new theme", () => {
    const ui = render(`look shape=round\ntext "Hi"`);
    ui.sayshape.setTheme(darkTheme);
    ui.sayshape.renderNow();
    expect(ui.sayshape.theme.colors.surface).toBe(darkTheme.colors.surface);
    expect(ui.sayshape.theme.radius.lg).toBeGreaterThan(darkTheme.radius.lg);
  });

  it("look: false keeps the host's look and reports the line", () => {
    const ui = render(`look mood=bold density=airy\ntext "Hi"`, { look: false });
    expect(ui.sayshape.theme).toBe(lightTheme);
    expect(ui.diagnostics.map((d) => d.message)).toContain(`This app keeps its own look, so the look line was ignored. Leave it out`);
  });

  it("bold's gradient moves away from the text on the accent, for any brand", () => {
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722); };
    // A light brand accent with dark text on it, in a light theme: the gradient goes lighter, not toward the ink.
    const yellow = extendTheme(lightTheme, { colors: { accent: "#F5C400", onAccent: "#1B262A" } });
    const end = applyLook(yellow, { mood: "bold" }).colors.accent2;
    expect(lum(end)).toBeGreaterThan(lum("#F5C400"));
    const teal = applyLook(lightTheme, { mood: "bold" }).colors.accent2;
    expect(lum(teal)).toBeLessThan(lum(lightTheme.colors.accent));
    // A theme that already has a gradient keeps its own.
    expect(applyLook(studioLightTheme, { mood: "bold" }).colors.accent2).toBe(studioLightTheme.colors.accent2);
  });

  it("slides keep their design size whatever the look", () => {
    for (const base of [lightTheme, extendTheme(lightTheme, { name: "no-slide" })]) {
      const plain = { ...base, slide: undefined } as Theme;
      for (const t of [base, plain]) {
        const looked = applyLook(t, { density: "airy", shape: "round", type: "editorial" });
        expect(looked.slide).toBeDefined();
        if (t.slide) expect(looked.slide).toEqual(t.slide);
        else expect(looked.slide!.space.md).toBe(Math.round(t.space.md * 1.6));
      }
    }
  });
});

/** Every combination of the look's options, one per prop at a time plus the loudest together. */
const SINGLE_LOOKS: Look[] = LOOK_PROPS.flatMap((p) => Object.keys(LOOK_OPTIONS[p]).map((o) => ({ [p]: o }) as Look));

describe("look line: text still fits", () => {
  const ALL = [...coreComponents, ...mapComponents];
  const skip = new Set(["map", "pin", "deck", "slide"]);
  for (const look of [{ density: "airy", type: "editorial", shape: "round", mood: "bold" }, { density: "compact", type: "classic", shape: "sharp" }] as Look[]) {
    const line = `look ${Object.entries(look).map(([k, v]) => `${k}=${v}`).join(" ")}`;
    describe.each([240, 360, 600])(`${line} at %ipx`, (width) => {
      it("every element's example keeps its text inside itself", () => {
        let checked = 0;
        for (const def of ALL) {
          if (skip.has(def.type) || !def.example) continue;
          checked++;
          const ui = render(`${line}\n${exampleSpec(def, ALL)}`, { components: ALL, width });
          expect(textOverflows(ui.sayshape.boxes!, ui.drawOps), def.type).toEqual([]);
          ui.destroy();
        }
        expect(checked).toBeGreaterThan(50);
      });
    });
  }
});

describe("look line: forced colors", () => {
  const system: Record<string, string> = { Canvas: "rgb(0, 0, 0)", CanvasText: "rgb(255, 255, 255)", Highlight: "rgb(26, 235, 255)", HighlightText: "rgb(0, 0, 0)", GrayText: "rgb(63, 242, 63)" };
  it.each(SINGLE_LOOKS.map((l) => [JSON.stringify(l), l] as const))("the person's colors win under %s", (_n, look) => {
    for (const t of [lightTheme, darkTheme]) {
      expect(forcedColorsTheme(applyLook(t, look), (n) => system[n]!).colors).toEqual(forcedColorsTheme(t, (n) => system[n]!).colors);
      // A host that passes a forced-colors theme in: the look leaves its colors alone.
      const forced = forcedColorsTheme(t, (n) => system[n]!);
      expect(applyLook(forced, look).colors).toEqual(forced.colors);
    }
  });
});

describe("look line: the guide", () => {
  it("says nothing about it unless asked", () => {
    expect(languageGuide(registry)).not.toMatch(/\blook\b.*mood=/);
    expect(languageGuide(registry, { mode: "compact" })).not.toMatch(/mood=/);
  });

  it("explains it when asked, in full and compact, from the options table", () => {
    const full = languageGuide(registry, { look: true });
    const compact = languageGuide(registry, { look: true, mode: "compact" });
    expect(full).toContain(lookGuide("full"));
    expect(compact).toContain(lookGuide("compact"));
    for (const p of LOOK_PROPS) for (const o of Object.keys(LOOK_OPTIONS[p])) {
      expect(full).toContain(o);
      expect(compact).toContain(o);
    }
    // The guide's own example line reads with no diagnostics.
    const example = /look (?:\w+=\w+ ?)+/.exec(lookGuide("full"))![0];
    expect(read(`${example.trim()}\ntext "Hi"`).diagnostics).toEqual([]);
  });

  it("a model's look line survives the prose filter; a sentence starting with Look doesn't", () => {
    const test = sayShapeLineTest((n) => registry.has(n));
    expect(test("look mood=bold type=editorial")).toBe(true);
    expect(test("Look, here's your page")).toBe(false);
    expect(test("look at this")).toBe(false);
  });
});

describe("look line: phones and small hosts", () => {
  const ALL = [...coreComponents, ...mapComponents];
  /** A chat app's tighter tokens (the MCP view's CHAT_TOKENS). */
  const chat = extendTheme(lightTheme, { text: { display: 24, title: 17, lead: 15 }, space: { lg: 16 }, control: { height: 32 } });
  const shortest = (ui: ReturnType<typeof render>) => Math.min(Infinity, ...ui.hits.filter((h) => h.focusable).map((h) => h.box.h));

  it.each([["light", lightTheme], ["chat", chat]] as const)("compact keeps every press target at least 24 px tall, or as tall as without it (%s)", (_n, theme) => {
    for (const def of ALL) {
      if (!def.example) continue;
      const spec = exampleSpec(def, ALL);
      const host = render(spec, { components: ALL, theme, width: 360 });
      const looked = render(`look density=compact shape=sharp\n${spec}`, { components: ALL, theme, width: 360 });
      expect(shortest(looked), def.type).toBeGreaterThanOrEqual(Math.min(24, shortest(host)));
      host.destroy();
      looked.destroy();
    }
  });

  it.each([240, 600])("airy and round lay every example out inside its parent at %ipx", (width) => {
    const registry = new Registry(ALL);
    for (const def of ALL) {
      if (!def.example) continue;
      const ui = render(`look density=airy shape=round type=editorial\n${exampleSpec(def, ALL)}`, { components: ALL, width });
      const check = (b: Box, parent: Box | null) => {
        const where = `${def.type}: ${b.node.type} (line ${b.node.line})`;
        for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v), where).toBe(true);
        expect(Math.min(b.w, b.h), where).toBeGreaterThanOrEqual(0);
        if (parent) {
          const scrolls = !!registry.get(parent.node.type)?.clipChildren?.(parent);
          expect(b.x, where).toBeGreaterThanOrEqual(parent.x - 0.01);
          expect(b.x + b.w, where).toBeLessThanOrEqual(parent.x + parent.w + 0.01);
          if (!scrolls) expect(b.y + b.h, where).toBeLessThanOrEqual(parent.y + parent.h + 0.01);
        }
        for (const k of b.children) check(k, b);
      };
      check(ui.sayshape.boxes!, null);
      ui.destroy();
    }
  });

  it("sharp corners never go below 1 px, so an inset radius can't turn negative", () => {
    const tiny = extendTheme(lightTheme, { radius: { sm: 1, md: 2, lg: 3 } });
    const r = applyLook(tiny, { shape: "sharp" }).radius;
    expect(Math.min(r.sm, r.md, r.lg)).toBeGreaterThanOrEqual(1);
  });
});

describe("look line: brand colors stay readable under every mood", () => {
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1, 7), 16);
      const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const brands = [["navy", "#1B2A6B"], ["pale", "#BFE3F2"], ["yellow", "#F5C400"], ["red", "#E0301E"]] as const;
  for (const [name, color] of brands) for (const scheme of ["light", "dark"] as const) {
    it(`${name} (${color}) in ${scheme}`, () => {
      const t = resolveTheme("teal", scheme, [color]).theme;
      for (const mood of ["quiet", "bold"] as const) {
        const c = applyLook(t, { mood }).colors;
        const where = `${mood}`;
        expect(contrast(c.onAccent, c.accent2), `${where}: text on accent2`).toBeGreaterThanOrEqual(Math.min(4.5, contrast(c.onAccent, c.accent)));
        for (const bg of ["surface", "raised"] as const) expect(contrast(c.accent2, c[bg]), `${where}: accent2 on ${bg}`).toBeGreaterThanOrEqual(Math.min(3, contrast(c.accent, c[bg])));
      }
    });
  }
});
