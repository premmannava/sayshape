/**
 * The element pages and atlas on the website: every element's live example
 * renders cleanly, the prop controls' text edits produce specs the parser
 * accepts, and the "try a typo" button produces a real diagnostic.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { componentExampleSpec } from "../src/prompt";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import { editLine, findElementLine, formatValue, readProp, readText, TYPO, writeProp, writeText } from "../site/.vitepress/theme/loom/specEdit";

const all = [...coreComponents, ...mapComponents];
type Node = ReturnType<typeof parse>["root"];
const findNode = (n: Node, type: string): Node | undefined => (n.type === type ? n : n.children.map((c) => findNode(c, type)).find(Boolean));
const registry = new Registry(all);
const TODAY = "2026-10-21";

describe("spec edits", () => {
  const line = `  stepper "Quantity" bind=qty min=1 max=10`;

  it("reads props and text as written", () => {
    expect(readProp(line, "min")).toBe("1");
    expect(readProp(line, "bind")).toBe("qty");
    expect(readProp(line, "step")).toBeNull();
    expect(readText(line, "stepper")).toBe("Quantity");
    expect(readProp(`text "Hi" style=title value={a * 2}`, "value")).toBe("{a * 2}");
    expect(readProp(`badge "x" label="Two words"`, "label")).toBe("Two words");
  });

  it("does not mistake one prop for another that ends the same way", () => {
    expect(readProp(`chart items=sales x=month y=revenue`, "x")).toBe("month");
    expect(readProp(`slider bind=maxPrice max=300`, "max")).toBe("300");
  });

  it("replaces, adds and removes props", () => {
    expect(writeProp(line, "max", 20)).toBe(`  stepper "Quantity" bind=qty min=1 max=20`);
    expect(writeProp(line, "step", 2)).toBe(`  stepper "Quantity" bind=qty min=1 max=10 step=2`);
    expect(writeProp(line, "min", null)).toBe(`  stepper "Quantity" bind=qty max=10`);
    expect(writeProp(`text "Hi" tone=muted`, "tone", "good")).toBe(`text "Hi" tone=good`);
  });

  it("quotes text values and strips quotes people type", () => {
    expect(formatValue("Two words")).toBe('"Two words"');
    expect(formatValue('say "hi"')).toBe('"say hi"');
    expect(formatValue("primary")).toBe("primary");
    expect(formatValue(true)).toBe("true");
  });

  it("edits the quoted text, or adds it when there is none", () => {
    expect(writeText(line, "stepper", "Guests")).toBe(`  stepper "Guests" bind=qty min=1 max=10`);
    expect(writeText(`stepper bind=qty`, "stepper", "Guests")).toBe(`stepper "Guests" bind=qty`);
  });

  it("finds the element's own line, not a longer name that starts the same way", () => {
    const spec = `state a=1\nlist\n  list-item "One"\n  list-item "Two"`;
    expect(findElementLine(spec, "list")).toBe(1);
    expect(findElementLine(spec, "list-item")).toBe(2);
    expect(editLine(spec, 2, (l) => writeText(l, "list-item", "First"))).toContain(`list-item "First"`);
  });
});

describe("element pages", () => {
  for (const def of all) {
    if (!def.example) continue;
    const spec = componentExampleSpec(def, all).trimEnd();
    const index = findElementLine(spec, def.type);

    it(`${def.type}: the page's example has the element on a line of its own`, () => {
      expect(index).toBeGreaterThanOrEqual(0);
    });

    if (/^\s*image\b/m.test(spec)) continue;

    it(`${def.type}: the live example renders cleanly at card and page widths`, () => {
      for (const width of [300, 640]) {
        const ui = render(spec, { width, today: TODAY, components: all });
        expect(ui.diagnostics).toEqual([]);
        ui.destroy();
      }
    });

    it(`${def.type}: "try a typo" produces a diagnostic that names the prop`, () => {
      const typo = editLine(spec, index, (l) => writeProp(l, TYPO.name, TYPO.value));
      const problems = parse(typo + "\n", registry).diagnostics;
      expect(problems.some((d) => d.message.includes(`"${TYPO.name}"`))).toBe(true);
    });

    it(`${def.type}: every edit the controls make keeps the line parsing`, () => {
      const noErrors = (edited: string, what: string) => {
        const errors = parse(edited + "\n", registry).diagnostics.filter((d) => d.severity === "error");
        expect(errors, what).toEqual([]);
      };
      const at = (edit: (l: string) => string) => editLine(spec, index, edit);
      for (const [name, p] of Object.entries(def.props)) {
        if (name === "bind") continue;
        if (p.type === "enum" && p.values) for (const v of p.values) noErrors(at((l) => writeProp(l, name, v)), `${name}=${v}`);
        if (p.type === "boolean") for (const v of [true, false]) noErrors(at((l) => writeProp(l, name, v)), `${name}=${v}`);
        if (p.type === "number") for (const v of [0, 3, -1]) noErrors(at((l) => writeProp(l, name, v)), `${name}=${v}`);
        if (p.type === "string") for (const v of ["", "Two words", 'say "hi"']) noErrors(at((l) => writeProp(l, name, v || null)), `${name}="${v}"`);
      }
      if (def.text && readText(spec.split("\n")[index]!, def.type) !== null) {
        for (const v of ["New label", 'with "quotes"', ""]) noErrors(at((l) => writeText(l, def.type, v)), `text "${v}"`);
      }
    });

    it(`${def.type}: a control's edit is what the parser then reads`, () => {
      const numberProp = Object.entries(def.props).find(([n, p]) => p.type === "number" && n !== "bind");
      if (!numberProp) return;
      const edited = editLine(spec, index, (l) => writeProp(l, numberProp[0], 7));
      const node = parse(edited + "\n", registry).root.children.map((c) => findNode(c, def.type)).find(Boolean);
      expect(node?.props[numberProp[0]]).toBe("7");
    });
  }
});
