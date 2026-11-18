/**
 * Capability guides (src/capabilities.ts): the map, the assembler, what each
 * host offers, and the screens written from them working when used. Everything
 * here is deterministic: no model runs. Whether a model picks the right
 * capabilities on its own is for a live run (scripts/adaptive-smoke.ts).
 */
import { describe, expect, it } from "vitest";
import { assembleGuide, availableCapabilities, CAPABILITIES, capabilityElements, languageMap, problemsText, sceneElements } from "../src/capabilities";
import { CATEGORIES, type ComponentDef } from "../src/component";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";
import { slideComponents } from "../src/components/slides";
import { parse } from "../src/parser";
import { languageGuide, WORKED_EXAMPLES } from "../src/prompt";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import type { Box, Value } from "../src/types";
import { readFileSync } from "node:fs";

const core = new Registry(coreComponents);
const withMap = new Registry([...coreComponents, ...mapComponents]);
const everything = new Registry([...coreComponents, ...mapComponents, ...sceneComponents]);
const ALL: ComponentDef[] = [...coreComponents, ...mapComponents, ...sceneComponents];
const names = (r: Registry) => r.all().map((c) => c.type);

describe("coverage: no registered element can be missed", () => {
  for (const [label, reg] of [["core", core], ["core + map", withMap], ["core + map + scene", everything], ["slides alone", new Registry([...coreComponents.filter((c) => c.type !== "deck" && c.type !== "slide"), ...slideComponents])]] as const) {
    it(`${label}: every element is in a capability, and named in the map`, () => {
      const reachable = new Set(CAPABILITIES.flatMap((c) => capabilityElements(reg, c.name)));
      const map = languageMap(reg, { presets: true, behavior: true });
      for (const t of names(reg)) {
        expect(reachable.has(t), `${t} belongs to no capability`).toBe(true);
        // Scene shapes are listed under scene in the map: asking for scenes brings them all.
        if (!sceneElements(reg).includes(t) || t === "scene") expect(map, `${t} isn't named in the map`).toMatch(new RegExp(`[ ,]${t}(,|\\n|$)`));
      }
    });
  }

  it("every category belongs to a capability, so a new category can't go unlisted", () => {
    for (const cat of CATEGORIES) expect(CAPABILITIES.some((c) => c.categories?.includes(cat)), cat).toBe(true);
  });

  it("an element registered tomorrow joins its category's capability with no change here", () => {
    const fresh: ComponentDef = { ...coreComponents.find((c) => c.type === "badge")!, type: "sparkle-badge" };
    const reg = new Registry([...coreComponents, fresh]);
    expect(capabilityElements(reg, "content")).toContain("sparkle-badge");
    expect(assembleGuide(reg, ["content"]).text).toContain("- sparkle-badge ");
    expect(assembleGuide(reg, ["sparkle-badge"]).elements).toEqual(["sparkle-badge"]);
  });
});

describe("the map", () => {
  it("offers only what this app draws", () => {
    const plain = languageMap(core);
    expect(plain).not.toMatch(/^- (report|scenes|behavior|look|motion|pictures):/m);
    expect(plain).not.toContain("scene");
    expect(plain).toMatch(/^- forms: /m);
    const rich = languageMap(everything, { presets: true, behavior: true, look: true });
    expect(rich).toMatch(/^- report: /m);
    expect(rich).toMatch(/^- scenes: /m);
    expect(rich).toMatch(/^- behavior: /m);
    expect(rich).toMatch(/^- look: /m);
    expect(rich).not.toMatch(/^- motion: /m);
    expect(availableCapabilities(core).map((c) => c.name)).toEqual(["lists", "calculations", "forms", "actions", "layout", "content", "data", "navigation", "feedback"]);
  });

  it("carries the report syntax where reports are drawn, so a report needs no second step", () => {
    const map = languageMap(core, { presets: true });
    expect(map).toContain("A REPORT, ready to write");
    expect(map).toContain('report "Sales review"');
    expect(languageMap(core, { presets: true, reportSyntax: false })).not.toContain("A REPORT");
    expect(languageMap(core)).not.toContain("A REPORT");
  });

  it("explains how the pieces connect, and how to ask", () => {
    const map = languageMap(everything, { behavior: true });
    for (const piece of ["state holds values", "derive works a value out", "bind=", "on= actions", "emit", "each repeats", "scene draws shapes", "every rules"]) expect(map).toContain(piece);
    expect(map.trim().split("\n").at(-1)).toMatch(/^For anything else, answer only one line .*USE: forms, calculations, slider$/);
    expect(languageMap(core, { ask: "Call sayshape_docs." }).trim().endsWith("Call sayshape_docs.")).toBe(true);
  });

  it("is a fraction of the full guide", () => {
    expect(languageMap(withMap, { presets: true }).length * 5).toBeLessThan(languageGuide(withMap).length);
  });
});

describe("assembling a guide", () => {
  it("is the same text whatever order or case the names come in", () => {
    const a = assembleGuide(withMap, ["forms", "calculations", "slider"]);
    const b = assembleGuide(withMap, ["Slider", "calculation", "FORMS", "forms"]);
    expect(b.text).toBe(a.text);
    expect(a.capabilities).toEqual(["calculations", "forms"]);
    expect(a.elements).toEqual(["slider"]);
    expect(assembleGuide(withMap, ["forms", "calculations", "slider"]).text).toBe(a.text);
  });

  it("reads an element's own name as the element, even when a capability is its plural", () => {
    const g = assembleGuide(core, ["list"]);
    expect(g.elements).toEqual(["list"]);
    expect(g.capabilities).toEqual([]);
    expect(g.exposed).toEqual(expect.arrayContaining(["list", "list-item"]));
    expect(assembleGuide(core, ["lists"]).capabilities).toEqual(["lists"]);
  });

  it("puts the shared rules in once, and the elements' syntax from their definitions", () => {
    const g = assembleGuide(withMap, ["lists", "calculations", "forms"]);
    for (const head of ["FORMAT", "EXPRESSIONS", "RULES", "ELEMENTS"]) expect(g.text.split(`\n${head}`).length - 1 + (g.text.startsWith(head) ? 1 : 0)).toBe(1);
    expect(g.text).toContain("- each items=expr! as=name");
    expect(g.text).toContain("- input [\"text\"] bind=path!");
    expect(g.text).toContain("DATA AND LISTS");
    // Only what was asked for: no charts, maps or tabs.
    expect(g.exposed).not.toContain("chart");
    expect(g.exposed).not.toContain("map");
    expect(g.exposed).not.toContain("tabs");
  });

  it("gives full docs, with their example and what they hold, for elements asked for by name", () => {
    const g = assembleGuide(withMap, ["table"]);
    expect(g.text).toContain("DETAILS\n  table");
    expect(g.text).toContain("  table-column \"<text>\"");
    expect(g.exposed).toEqual(expect.arrayContaining(["table", "table-column"]));
  });

  it("shows an example only when the guide's own elements can build it", () => {
    const forms = assembleGuide(core, ["forms"]);
    expect(forms.sections.map((s) => s.name)).toContain("example-signup");
    const calc = assembleGuide(core, ["calculations"]);
    expect(calc.sections.map((s) => s.name)).toContain("example-calculator");
    // Lists alone can't build the to-do example (it needs check, input and button), so it shows orders instead,
    // and no control is added just to keep an example.
    const lists = assembleGuide(core, ["lists"]);
    expect(lists.sections.map((s) => s.name)).toEqual(expect.arrayContaining(["example-orders"]));
    expect(lists.exposed).not.toContain("check");
    for (const g of [forms, calc, lists, assembleGuide(core, ["lists", "calculations", "forms"]), assembleGuide(everything, ["scenes", "behavior"], { behavior: true })]) {
      const exposed = new Registry(ALL.filter((c) => g.exposed.includes(c.type)));
      for (const s of g.sections.filter((x) => x.name.startsWith("example-"))) {
        const spec = s.text.split("\n").slice(1).join("\n") + "\n";
        expect(parse(spec, exposed).diagnostics, s.name).toEqual([]);
      }
    }
  });

  it("is much smaller than the full guide", () => {
    const full = languageGuide(withMap).length;
    expect(assembleGuide(withMap, ["forms"]).text.length * 8).toBeLessThan(full);
    expect(assembleGuide(withMap, ["calculations"]).text.length * 8).toBeLessThan(full);
    expect(assembleGuide(withMap, ["lists", "calculations", "forms"]).text.length * 4).toBeLessThan(full);
  });

  it("follows the host's switches: drag= and timers only with behavior on", () => {
    const off = assembleGuide(everything, ["scenes"]);
    expect(off.text).not.toContain("drag=");
    expect(off.text).not.toContain("every 1s");
    const on = assembleGuide(everything, ["scenes", "behavior"], { behavior: true });
    expect(on.text).toContain("drag=true|false");
    expect(on.text).toContain("People can drag it");
    expect(on.text).toContain("every 1s");
  });
});

describe("what can't be had", () => {
  it("says a capability is off here, and what to ask for instead", () => {
    const g = assembleGuide(core, ["scenes", "forms"]);
    expect(g.capabilities).toEqual(["forms"]);
    expect(g.problems).toEqual([{ topic: "scenes", kind: "unavailable", instead: ["data", "content"], message: `"scenes" isn't available here: this app doesn't draw scenes. Ask for data or content instead.` }]);
    expect(assembleGuide(core, ["report"]).problems[0]!.message).toBe(`"report" isn't available here: this app doesn't draw reports. Ask for data or lists instead.`);
    expect(assembleGuide(core, ["behavior"]).problems[0]!.instead).toEqual(["actions"]);
  });

  it("says a name isn't known, with close elements and every capability", () => {
    const g = assembleGuide(core, ["steper", "forms"]);
    expect(g.problems[0]!.kind).toBe("unknown");
    expect(g.problems[0]!.instead).toContain("stepper");
    expect(problemsText(g.problems)).toMatch(/^- There's no capability or element called "steper"\. Close elements: .*stepper.*\. Capabilities: lists, calculations, forms, .*, or full for the whole guide\./);
  });

  it("falls back to the full compatible guide when asked, or when nothing usable is left", () => {
    expect(assembleGuide(withMap, ["full"]).text).toBe(languageGuide(withMap));
    expect(assembleGuide(withMap, ["full", "forms"]).full).toBe(true);
    const nothing = assembleGuide(core, ["wizard"]);
    expect(nothing.full).toBe(true);
    expect(nothing.text).toBe(languageGuide(core));
    expect(nothing.problems).toHaveLength(1);
    expect(languageGuide(withMap, { capabilities: ["full"] })).toBe(languageGuide(withMap));
  });
});

describe("compatibility: nothing changes unless asked", () => {
  it("the default guide is byte-for-byte the fixture", () => {
    const fixture = readFileSync(new URL("./fixtures/guide-full.txt", import.meta.url), "utf8");
    expect(languageGuide(withMap, { imageHosts: ["images.unsplash.com"] })).toBe(fixture);
    expect(languageGuide(withMap, { imageHosts: ["images.unsplash.com"], presets: true })).toBe(fixture);
  });

  it("capabilities in GuideOptions build the same guide as assembleGuide", () => {
    expect(languageGuide(withMap, { capabilities: ["forms"] })).toBe(assembleGuide(withMap, ["forms"]).text);
    expect(languageGuide(withMap, { presets: true })).toBe(languageGuide(withMap));
  });
});

// ---------------------------------------------------------------- the screens work when used

const pressPopup = (ui: Rendered, detail: string) => {
  const r = ui.popup?.regions.find((h) => h.detail === detail);
  expect(r, `the popup has ${detail}`).toBeDefined();
  ui.click(r!.box.x + r!.box.w / 2, r!.box.y + r!.box.h / 2);
};

describe("1. a sales report: filter, chart and total, on the host's data", () => {
  const SPEC = `report "Sales" data=sales filter=region
  sum amount
  bar month amount
`;
  const rows = [
    { month: "Jan", region: "West", amount: 1000 },
    { month: "Jan", region: "East", amount: 500 },
    { month: "Feb", region: "West", amount: 2000 },
  ];

  it("is written from the report capability alone", () => {
    const g = assembleGuide(core, ["report"], { presets: true });
    expect(g.sections.map((s) => s.name)).toEqual(["intro", "report"]);
    expect(g.text.length).toBeLessThan(2400);
  });

  it("shows the totals, follows the visible filter, then follows new host data", () => {
    const ui = render("", { presets: true });
    ui.set("sales", rows as unknown as Value);
    ui.setSpec(SPEC);
    ui.sayshape.renderNow();
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toContain("$3.5K");
    expect(ui.find("chart").node.props).toMatchObject({ kind: "bar", x: "month", y: "amount" });
    expect(ui.text()).toEqual(expect.arrayContaining(["Jan", "Feb"]));

    // The filter people see: choose East in the Region select.
    ui.press({ type: "select", text: "Region" });
    pressPopup(ui, "opt:s:East");
    ui.key("Escape");
    expect(ui.text()).toContain("$500");
    expect(ui.text()).not.toContain("$3.5K");
    expect(ui.text()).not.toContain("Feb");

    // The host sends new rows: the filter stays and the numbers follow.
    ui.set("sales", [...rows, { month: "Mar", region: "East", amount: 700 }] as unknown as Value);
    ui.sayshape.renderNow();
    expect(ui.text()).toContain("$1.2K");
    expect(ui.text()).toContain("Mar");
  });
});

describe("2. a custom form: validation and an action for the app", () => {
  const leave = (ui: Rendered) => ui.key("Escape");
  const SPEC = WORKED_EXAMPLES.signup + "\n";

  it("comes with the forms guide and parses with no problems", () => {
    expect(assembleGuide(core, ["forms"]).text).toContain(WORKED_EXAMPLES.signup);
    expect(parse(SPEC, core).diagnostics).toEqual([]);
  });

  it("can't be sent while invalid; once valid the message goes and the action is emitted", () => {
    const ui = render(SPEC);
    const send = () => ui.press({ type: "button", text: "Create account" });
    ui.type({ type: "input", text: "Name" }, "A");
    leave(ui);
    expect(ui.text()).toContain("At least 2 letters");
    ui.type({ type: "input", text: "Email" }, "ana@example");
    leave(ui);
    expect(send).toThrow(/isn't pressable right now/);
    expect(ui.emitted).toEqual([]);

    ui.type({ type: "input", text: "Name" }, "Ana", { replace: true });
    ui.type({ type: "input", text: "Email" }, "ana@example.com", { replace: true });
    leave(ui);
    expect(ui.text()).not.toContain("At least 2 letters");
    send();
    expect(ui.emitted).toEqual([{ name: "signup", value: "ana@example.com" }]);
  });
});

describe("3. a mixed screen: a budget, a filter, and a total that reads the filtered rows", () => {
  // A report's filter is its own state (reportCategory), which nothing outside it is told about, so a budget
  // that must follow the filter is written from lists, calculations and forms instead (docs/capabilities.md).
  const SPEC = `state expenses=[{item: "Rent", category: "Home", amount: 1200}, {item: "Groceries", category: "Food", amount: 300}, {item: "Dinner out", category: "Food", amount: 80}, {item: "Bus pass", category: "Travel", amount: 60}]
state categories=["All", "Home", "Food", "Travel"] category="All" budget=500
derive shown={category == 'All' ? expenses : filter(expenses, 'category', category)}
derive spent={sum(shown, 'amount')}
derive left={budget - spent}
card
  text "Budget check" style=title
  select "Category" items=categories bind=category
  stepper "Budget" bind=budget min=0 max=5000 step=50
  grid min=140
    stat label="Spent" value={money(spent)}
    stat label="Left" value={money(left)} tone={left < 0 ? 'bad' : 'good'}
  each items=shown as=e
    row
      text "{e.item}"
      text "{money(e.amount)}" align=right
`;

  it("its guide covers every piece it uses, and warns that a report can't share its filter", () => {
    const g = assembleGuide(core, ["lists", "calculations", "forms"]);
    for (const t of ["select", "stepper", "stat", "each", "grid"]) expect(g.exposed).toContain(t);
    expect(parse(SPEC, new Registry(coreComponents.filter((c) => g.exposed.includes(c.type)))).diagnostics).toEqual([]);
    expect(assembleGuide(core, ["report", "forms"], { presets: true }).text).toContain("A report's filters belong to it: nothing outside the report can read them.");
  });

  it("works out the total from the rows the filter leaves, and follows the budget", () => {
    const ui = render(SPEC);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toContain("$1,640.00");
    expect(ui.text()).toContain("-$1,140.00");
    ui.press({ type: "select", text: "Category" });
    pressPopup(ui, "opt:s:Food");
    expect(ui.state.category).toBe("Food");
    expect(ui.text()).toContain("$380.00");
    expect(ui.text()).toContain("$120.00");
    expect(ui.text()).not.toContain("Rent");
    ui.set("budget", 300);
    expect(ui.text()).toContain("-$80.00");
  });
});

describe("4. an unusual request: a draggable scene that can be paused, from building blocks", () => {
  const SPEC = `state bx=100 by=150 running=true
every 100ms if={running} do="set:bx:{bx >= 560 ? 40 : bx + 10}"
scene "A ball rolling across" w=600 h=300
  circle x={bx} y={by} r=20 fill=accent drag=true name="Ball"
button "{running ? 'Pause' : 'Play'}" on=toggle:running
`;
  const sceneAt = (ui: Rendered) => {
    const box = ui.find({ type: "scene" }).box as Box;
    return (x: number, y: number): [number, number] => [box.x + (x * box.w) / 600, box.y + (y * box.h) / 300];
  };
  const drag = (ui: Rendered, from: [number, number], to: [number, number]) => {
    const p = (type: string, [x, y]: [number, number]) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });
    p("pointermove", from); p("pointerdown", from); ui.sayshape.renderNow();
    p("pointermove", to); ui.sayshape.renderNow();
    p("pointerup", to); ui.sayshape.renderNow();
  };

  it("finds every piece in the scenes and behavior guides, with no guide made for it", () => {
    const g = assembleGuide(everything, ["scenes", "behavior"], { behavior: true });
    expect(g.text).toContain("every 1s if={running && left > 0} do=dec:left");
    expect(g.text).toContain('a button "Pause" on=toggle:running');
    expect(g.text).toContain("People can drag it (or use arrow keys). x={a} y={b} name the state it moves");
    expect(g.text).toMatch(/^- circle x=number y=number r=number .*drag=true\|false/m);
    expect(g.text).toContain("button [\"text\"] on=action");
    const exposed = new Registry(ALL.filter((c) => g.exposed.includes(c.type)));
    expect(parse(SPEC, exposed, { behavior: true }).diagnostics).toEqual([]);
  });

  it("moves by itself, stops on Pause, and goes where it's dragged", () => {
    const ui = render(SPEC, { components: ALL, behavior: true, width: 640 });
    expect(ui.diagnostics).toEqual([]);
    ui.clock.advance(500);
    const moved = Number(ui.state.bx);
    expect(moved).toBeGreaterThan(100);
    ui.press({ type: "button", text: "Pause" });
    ui.clock.advance(1000);
    expect(ui.state.bx).toBe(moved);
    const at = sceneAt(ui);
    drag(ui, at(moved, 150), at(300, 220));
    expect(ui.state.bx).toBe(300);
    expect(ui.state.by).toBe(220);
  });
});
