/**
 * Mistakes GPT-4.1 made through the MCP server, retrying three times on one
 * laptop picker: handler blocks, action names built from data, a button in a
 * list, and a weight written as a style. Each now gets one message that says
 * what to write instead, or is accepted without costing a retry.
 */
import { describe, expect, it } from "vitest";
import { parse, ON_BLOCK_MESSAGE } from "../src/parser";
import { parseActions } from "../src/actions";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { render } from "../src/testing";

const registry = new Registry();
for (const c of coreComponents) registry.register(c);
const diags = (spec: string) => parse(spec, registry).diagnostics;

describe("slips models make", () => {
  it("explains once that there are no on blocks, without knock-on messages", () => {
    const d = diags(`button "Choose A" on=emit:choose_a
on choose_a
  set chosen "A"
on choose_b
  set chosen "B"
`);
    expect(d.map((x) => [x.line, x.severity])).toEqual([[2, "error"], [4, "error"]]);
    expect(d[0]!.message).toBe(ON_BLOCK_MESSAGE);
    expect(d[0]!.message).toMatch(/on=emit:choose:\{item\.name\}/);
    expect(d[1]!.message).toBe(`Another "on" block, skipped; see line 2`);
  });

  it("says to put the value after the name when an action name is built from data", () => {
    const r = parseActions("emit:choose_{laptop.name}");
    expect(r).toEqual({ error: "Action names can't contain {…}. Keep the name a plain word and put the value after it: emit:choose:{laptop.name}" });
    expect(parseActions("emit:{x}")).toEqual({ error: "Action names can't contain {…}. Keep the name a plain word and put the value after it: emit:choose:{x}" });
    expect("actions" in parseActions("emit:choose:{laptop.name}")).toBe(true);
  });

  it("says what a list holds and how to make its rows pressable", () => {
    const d = diags(`state xs=[{name: "A"}]
list
  each items=xs as=x
    button "Choose"
`);
    expect(d[0]!.message).toMatch(/"list" \(line 2\) can't contain "button"; it holds list-item\. Make the row itself pressable/);
  });

  it("uses a weight written as a style, with a note", () => {
    const r = parse(`text "Hi" style=semibold\n`, registry);
    expect(r.diagnostics).toEqual([{ line: 1, severity: "warning", message: "semibold is a weight, not a style, so it was used as weight=semibold" }]);
    expect(r.root.children[0]!.props).toEqual({ weight: "semibold" });
    // A real style or an explicit weight is left alone.
    expect(diags(`text "Hi" style=title weight=bold\n`)).toEqual([]);
    expect(diags(`text "Hi" style=fancy\n`)[0]!.message).toMatch(/style should be one of/);
  });

  it("the way the messages suggest works: change the screen and tell the assistant", () => {
    const spec = `state laptops=[{name: "Air", price: 999}, {name: "XPS", price: 1299}]
state chosen=""
card
  each items=laptops as=laptop
    row
      text "{laptop.name}"
      button "Choose" on=set:chosen:{laptop.name};emit:choose:{laptop.name}
  text "You chose {chosen}" weight=semibold if={chosen}
`;
    expect(diags(spec)).toEqual([]);
    const ui = render(spec, { width: 600 });
    ui.press({ id: "7:button#1" });
    expect(ui.state.chosen).toBe("XPS");
    expect(ui.emitted).toEqual([{ name: "choose", value: "XPS" }]);
    expect(ui.text()).toContain("You chose XPS");
    ui.destroy();
  });
});
