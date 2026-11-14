/**
 * Component contract tests. These run over every registered component, so a
 * new component is checked against the project rules (CLAUDE.md) without
 * anyone writing tests for it first.
 */
import { accessibleKey, type AccessibleNode } from "../src/a11y/semantics";
import { describe, expect, it } from "vitest";
import type { ComponentDef } from "../src/component";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";
import { slideComponents } from "../src/components/slides";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { darkTheme, lightTheme, studioDarkTheme, studioLightTheme, type Theme } from "../src/theme";
import { walkBoxes } from "../src/layout";
import type { Box } from "../src/types";
import { exampleSpec as exampleOf } from "./examples";
import { textOverflows } from "./overflow";

const ALL: ComponentDef[] = [...coreComponents, ...mapComponents, ...sceneComponents, ...slideComponents];

/**
 * Experimental scenes are where the model paints: their colors are the spec's,
 * the one deliberate exception to theme-only colors (CLAUDE.md rule 4), and
 * they draw through a transform (scaled to fit), which the text check can't follow.
 */
const SCENE_TYPES = new Set(sceneComponents.map((c) => c.type));
/** Experimental slides draw a slide, and everything on it, scaled to fit (childTransform), which the text check can't follow either. */
const SLIDE_TYPES = new Set(slideComponents.map((c) => c.type));
const registry = new Registry(ALL);
const WIDTHS = [320, 600, 1024];
/** Phone and chat widths, where text is most likely not to fit. */
const FIT_WIDTHS = [240, 360, 600];
const THEMES: Theme[] = [lightTheme, darkTheme, studioLightTheme, studioDarkTheme];

/**
 * Interactive components that can't be reached with Tab yet, and why. The
 * test below fails once one of them becomes reachable, so this list can't
 * silently go stale: remove the entry when that happens.
 */
const NOT_KEYBOARD_REACHABLE_YET: Record<string, string> = {
  map: "Countries can be clicked but not reached by keyboard. Planned with the accessibility work in Phase 3.",
};

/**
 * Elements their parent draws and presses on their behalf, in its popup list
 * (a menu's menu-item): they have no box or hit region of their own while the
 * list is closed. Instead of the two checks below, they're checked through the
 * parent: Tab reaches it, the arrow key opens its list with a region per item,
 * and Enter runs the first item's own on=.
 */
const PRESSED_IN_PARENT_LIST: Record<string, string> = {
  "menu-item": "menu",
};

const exampleSpec = (def: ComponentDef) => exampleOf(def, ALL);

/** Components that can be interactive: they take an action or a state to write. */
const canInteract = (def: ComponentDef) => Object.values(def.props).some((p) => p.type === "action" || p.type === "state");

/** Instances that set an action or state prop must be pressable (a card is only pressable with on=). */
const interactiveBoxes = (root: Box, def: ComponentDef) =>
  boxesOf(root, def.type).filter((b) =>
    Object.entries(def.props).some(([name, p]) => (p.type === "action" || p.type === "state") && name in b.node.props),
  );

const boxesOf = (root: Box, type: string) => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};

const EPS = 0.01;

describe.each(ALL.map((d) => [d.type, d] as const))("%s", (_type, def) => {
  describe("accessibility", () => {
    it("describes itself to screen readers (semantics)", () => {
      expect(typeof def.semantics, "add semantics to its ComponentDef: see docs/plans/accessibility.md").toBe("function");
    });

    it("gives every place Tab can land a node in the accessibility tree", () => {
      const ui = render(exampleSpec(def), { components: ALL });
      const keys = new Set<string>();
      const walk = (n: AccessibleNode) => { keys.add(n.key); n.children.forEach(walk); };
      walk(ui.accessibility({ full: true }));
      for (const h of ui.hits.filter((r) => r.focusable)) {
        const key = accessibleKey(h.box.node, h.detail);
        expect(keys.has(key), `${h.box.node.type} on line ${h.box.node.line}, part ${String(h.detail)}: no node with key ${key}`).toBe(true);
      }
      ui.destroy();
    });

    it("names every control a screen reader can focus", () => {
      const ui = render(exampleSpec(def), { components: ALL });
      const unnamed: string[] = [];
      const walk = (n: AccessibleNode) => {
        if (n.focusable && !n.name?.trim()) unnamed.push(`${n.role} ${n.key}`);
        n.children.forEach(walk);
      };
      walk(ui.accessibility({ full: true }));
      expect(unnamed).toEqual([]);
      ui.destroy();
    });
  });

  describe("definition", () => {
    it("has no placeholders left from the scaffold", () => {
      const texts = [def.description, def.text?.description, def.example, ...Object.values(def.props).map((p) => p.description)];
      const left = texts.filter((t) => t && /\bTODO\b/.test(t));
      expect(left, "fill in the TODOs from npm run new:component").toEqual([]);
    });

    it("has a one or two sentence description", () => {
      expect(def.description.trim()).not.toBe("");
      const sentences = def.description.split(/[.!?](\s|$)/).filter((s) => s.trim().length > 1);
      expect(sentences.length).toBeLessThanOrEqual(2);
    });

    it("has an example that parses with no diagnostics", () => {
      expect(def.example, "every component needs an example").toBeTruthy();
      const r = parse(exampleSpec(def), registry);
      expect(r.diagnostics).toEqual([]);
      expect(r.nodeCount).toBeGreaterThan(0);
    });

    it("describes its text, if it takes any", () => {
      if (def.text) expect(def.text.description.trim()).not.toBe("");
    });

    it("documents every prop with a consistent type and default", () => {
      for (const [name, p] of Object.entries(def.props)) {
        const where = `${def.type}.${name}`;
        expect(p.description.trim(), where).not.toBe("");
        if (p.required) expect(p.default, `${where} is required, so it shouldn't have a default`).toBeUndefined();
        if (p.type === "enum") {
          expect(p.values?.length, `${where} needs values`).toBeGreaterThan(0);
          if (p.default !== undefined) expect(p.values, `${where} default`).toContain(p.default);
        }
        if (p.default !== undefined && p.type === "number") expect(typeof p.default, where).toBe("number");
        if (p.default !== undefined && p.type === "boolean") expect(typeof p.default, where).toBe("boolean");
      }
    });

    it("only allows children that exist", () => {
      if (Array.isArray(def.children)) for (const c of def.children) expect(registry.has(c), c).toBe(true);
      for (const p of def.parents ?? []) expect(p === "root" || registry.has(p), p).toBe(true);
    });
  });

  describe.each(WIDTHS)("at %ipx", (width) => {
    it("lays out inside its parent with finite, non-negative sizes", () => {
      const ui = render(exampleSpec(def), { components: ALL, width });
      const root = ui.sayshape.boxes!;
      const check = (b: Box, parent: Box | null) => {
        const where = `${b.node.type} (line ${b.node.line}) at ${width}px`;
        for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v), where).toBe(true);
        expect(b.w, where).toBeGreaterThanOrEqual(0);
        expect(b.h, where).toBeGreaterThanOrEqual(0);
        if (parent) {
          // A parent that scrolls its children (it clips them to its box) holds them taller than
          // itself, moved up as it scrolls: across, they still keep inside it.
          const scrolls = !!registry.get(parent.node.type)?.clipChildren?.(parent);
          expect(b.x, `${where} starts left of its parent`).toBeGreaterThanOrEqual(parent.x - EPS);
          if (!scrolls) expect(b.y, `${where} starts above its parent`).toBeGreaterThanOrEqual(parent.y - EPS);
          expect(b.x + b.w, `${where} extends past its parent's right edge`).toBeLessThanOrEqual(parent.x + parent.w + EPS);
          if (!scrolls) expect(b.y + b.h, `${where} extends past its parent's bottom edge`).toBeLessThanOrEqual(parent.y + parent.h + EPS);
        }
        for (const k of b.children) check(k, b);
      };
      check(root, null);
      ui.destroy();
    });
  });

  // The map draws through a transform (it scales the world to fit), which the check can't follow.
  if (!["map", "pin"].includes(def.type) && !SCENE_TYPES.has(def.type) && !SLIDE_TYPES.has(def.type)) {
    describe.each(FIT_WIDTHS)("drawn at %ipx", (width) => {
      it("keeps its text inside itself, without squeezing it", () => {
        const ui = render(exampleSpec(def), { components: ALL, width });
        expect(textOverflows(ui.sayshape.boxes!, ui.drawOps)).toEqual([]);
        ui.destroy();
      });
    });
  }

  describe.each(THEMES.map((t) => [t.name, t] as const))("painted in %s", (_name, theme) => {
    it("uses only theme colors and the theme font", () => {
      const ui = render(exampleSpec(def), { components: ALL, theme });
      const palette = new Set<string>(Object.values(theme.colors));
      const ops = ui.drawOps;
      if (def.paint || def.paintOver) expect(ops.length, "painting the example should draw something").toBeGreaterThan(0);
      for (const op of ops) {
        if (op.op === "drawImage") continue; // pictures carry their own colors
        const color = op.fillStyle || op.strokeStyle;
        // A scene is painted in the spec's colors; its words still use the theme font.
        if (!SCENE_TYPES.has(def.type)) expect(palette.has(color), `${op.op} used "${color}", which isn't a theme color`).toBe(true);
        if (op.font) {
          const themed = op.font.includes(theme.font.family) || op.font.includes(theme.font.mono);
          expect(themed, `${op.op} used the font "${op.font}", which isn't a theme font`).toBe(true);
        }
      }
      ui.destroy();
    });
  });

  // Scene shapes have no boxes: their scene registers their regions. They're checked below, under "pressable scene shapes".
  const listParent = PRESSED_IN_PARENT_LIST[def.type];
  if (listParent) {
    it(`is reached and pressed through its ${listParent}'s list`, () => {
      const ui = render(exampleSpec(def), { components: ALL });
      const items = boxesOf(ui.sayshape.boxes!, def.type).length || ui.findAll(def.type).length;
      ui.tab();
      expect(ui.focused?.type, `Tab reaches the ${listParent}`).toBe(listParent);
      ui.key("ArrowDown");
      expect(ui.popup?.owner.type, `the arrow key opens the ${listParent}'s list`).toBe(listParent);
      expect(ALL.find((d) => d.type === listParent)?.popup, `${listParent} draws its items in a popup`).toBeDefined();
      const regions = ui.popup!.regions;
      expect(regions.length, "a region per item in the open list").toBe(items);
      // Each item is a named node a screen reader can reach.
      const keys = new Map<string, AccessibleNode>();
      const walk = (n: AccessibleNode) => { keys.set(n.key, n); n.children.forEach(walk); };
      walk(ui.accessibility({ full: true }));
      for (const r of regions) expect(keys.get(accessibleKey(r.box.node, r.detail))?.name?.trim(), `item ${String(r.detail)}`).toBeTruthy();
      const first = ui.findAll(def.type)[0]!;
      const on = first.node.props.on ?? "";
      ui.key("Enter");
      const emitted = /^emit:(\w+)/.exec(on)?.[1];
      if (emitted) expect(ui.emitted.map((e) => e.name)).toContain(emitted);
      expect(ui.popup, "choosing closes the list").toBeNull();
      expect(ui.focused?.type, `focus goes back to the ${listParent}`).toBe(listParent);
      ui.destroy();
    });
  }

  if (canInteract(def) && !SCENE_TYPES.has(def.type) && !listParent) {
    describe("interaction", () => {
      it("registers a hit region for every instance that uses an action or state", () => {
        const ui = render(exampleSpec(def), { components: ALL });
        const boxes = interactiveBoxes(ui.sayshape.boxes!, def);
        expect(boxes.length, "the example should show the component being interactive").toBeGreaterThan(0);
        for (const b of boxes) expect(ui.hits.some((h) => h.box.node.id === b.node.id), `line ${b.node.line}`).toBe(true);
        ui.destroy();
      });

      const gap = NOT_KEYBOARD_REACHABLE_YET[def.type];
      it(gap ? `can't be reached with Tab yet (known gap: ${gap})` : "can be reached with Tab", () => {
        const ui = render(exampleSpec(def), { components: ALL });
        const want = new Set(interactiveBoxes(ui.sayshape.boxes!, def).map((b) => b.node.id));
        const reached = new Set<string>();
        for (let i = 0; i < ui.hits.length + 1; i++) {
          ui.tab();
          if (ui.focused) reached.add(ui.focused.id);
        }
        const all = [...want].every((id) => reached.has(id));
        expect(all).toBe(!gap);
        ui.destroy();
      });
    });
  }
});

// Picks are what a model reads before any element's docs, to choose the right
// element; one naming a prop or value that doesn't exist would teach it wrong.
describe("element picks", () => {
  const byType = new Map(ALL.map((c) => [c.type, c] as const));
  // Words, "quoted text" and name=value (the value may be quoted).
  const tokens = (write: string) => write.match(/[\w-]+="[^"]*"|"[^"]*"|\S+/g) ?? [];

  for (const def of ALL) {
    for (const pick of def.picks ?? []) {
      it(`${def.type}: "${pick.for}" writes ${pick.write}`, () => {
        expect(pick.for.length).toBeLessThanOrEqual(100);
        const words = tokens(pick.write);
        expect(words[0]).toBe(def.type);
        // "holding x" names a child the element takes; x's props may follow it.
        let current = def;
        for (let i = 1; i < words.length; i++) {
          const w = words[i]!;
          if (w === "holding") {
            const child = byType.get(words[i + 1] ?? "");
            expect(child, `"holding" is followed by an element in ${pick.write}`).toBeDefined();
            expect(Array.isArray(current.children) ? current.children : []).toContain(child!.type);
            current = child!;
            i++;
            continue;
          }
          if (w.startsWith('"')) {
            expect(current.text, `${current.type} takes quoted text`).toBeDefined();
            continue;
          }
          const m = /^([\w-]+)=(.*)$/.exec(w);
          expect(m, `"${w}" in ${pick.write} is a name=value prop`).not.toBeNull();
          const [, name, raw] = m!;
          const prop = current.props[name!];
          expect(prop, `${current.type} has a prop ${name}`).toBeDefined();
          const value = raw!.replace(/^"|"$/g, "");
          if (prop!.type === "enum") for (const v of value.split("|")) expect(prop!.values).toContain(v);
        }
      });
    }
  }

  it("covers every chart kind beyond bar and line, so models know they exist", () => {
    const chart = byType.get("chart")!;
    const kinds = (chart.picks ?? []).map((p) => /kind=(\w+)/.exec(p.write)?.[1]);
    const values = chart.props.kind!.values ?? [];
    for (const k of values) if (!["bar", "line", "pie"].includes(k)) expect(kinds, `a pick for kind=${k}`).toContain(k);
  });
});

/**
 * Scene shapes are drawn by their scene, which registers a hit region for
 * each one with on= (keyed by the shape's line), so the box-based checks
 * above don't apply. The same promises are kept here: pressable, a Tab stop,
 * and a named node for screen readers.
 */
describe("pressable scene shapes", () => {
  const SHAPE_LINES: Record<string, string> = {
    rect: `rect x=20 y=20 w=120 h=80 fill=accent`,
    circle: `circle x=80 y=60 r=40 fill=accent`,
    ellipse: `ellipse x=80 y=60 rx=60 ry=40 fill=accent`,
    line: `line x1=20 y1=60 x2=200 y2=60 stroke=accent width=6`,
    path: `path d="M20 20 L200 20 L200 100 Z" fill=accent`,
    polygon: `polygon points="20,100 110,20 200,100" fill=accent`,
    label: `label "Press me" x=40 y=60 size=24 fill=ink`,
    group: `group x=20 y=20\n    rect x=0 y=0 w=120 h=80 fill=accent`,
    use: `use "dot" x=80 y=60`,
  };
  for (const def of sceneComponents.filter((c) => "on" in c.props)) {
    it(`${def.type} with on= is pressable, reached by Tab and named`, () => {
      const first = SHAPE_LINES[def.type];
      expect(first, `a pressable line for ${def.type}`).toBeDefined();
      const [head, ...rest] = first!.split("\n");
      const spec = [`state n=0`, `scene "Shapes" w=300 h=200`, `  define "dot"`, `    circle x=0 y=0 r=30 fill=accent`,
        `  ${head} on=inc:n name="Thing"`, ...rest].join("\n");
      const ui = render(spec, { components: ALL, width: 300 });
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const shape = ui.findAll({ type: def.type }).map((f) => f.node).find((n) => n.props.on);
      const region = ui.hits.find((h) => h.box.node.type === "scene" && String(h.detail).startsWith(shape!.id));
      expect(region, "a hit region on the scene for the shape").toBeDefined();
      ui.tab();
      expect(ui.focused?.type).toBe("scene");
      ui.key("Enter");
      expect(ui.state.n).toBe(1);
      const tree = ui.accessibility({ full: true });
      const named = JSON.stringify(tree).includes('"name":"Thing"');
      expect(named, "a node named Thing").toBe(true);
      ui.destroy();
    });
  }
});
