import { describe, expect, it } from "vitest";
import { PropReader } from "../src/component";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { SayShapeNode } from "../src/types";

const registry = new Registry(coreComponents);
const stateOf = (spec: string) => Object.fromEntries(parse(spec, registry).state.map((s) => [s.key, s.value]));

describe("quoted values stay text", () => {
  it("in state: a quoted number is text, a bare one is a number", () => {
    expect(stateOf(`state zip="02139" code='56' n=56 on=true label="true"`)).toEqual({ zip: "02139", code: "56", n: 56, on: true, label: "true" });
  });

  it("a radio's quoted value matches the same text in an expression", () => {
    const ui = render(`state q=""
radio "54" bind=q value="54"
radio "56" bind=q value="56"
text "{q == '56' ? 'Right' : 'Not yet'}"`, { components: coreComponents });
    expect(ui.text()).toContain("Not yet");
    const hit = ui.hits.find((h) => ui.findAll({ id: h.box.node.id })[0]?.shownText === "56")!;
    ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
    ui.sayshape.renderNow();
    expect(ui.text()).toContain("Right");
    ui.destroy();
  });

  it("a radio's bare value is still a number", () => {
    const ui = render(`state q=0
radio "56" bind=q value=56
text "{q == 56 ? 'Number' : 'Other'}"`, { components: coreComponents });
    const hit = ui.hits[0]!;
    ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
    ui.sayshape.renderNow();
    expect(ui.text()).toContain("Number");
    ui.destroy();
  });

  it("booleans still read the same quoted or not", () => {
    const node = (props: Record<string, string>, quoted: string[]): SayShapeNode => ({ id: "1:row", type: "row", props, quoted, children: [], line: 1, indent: 0 });
    const read = (v: string, quoted: boolean) => new PropReader(node({ wrap: v }, quoted ? ["wrap"] : []), {} as never).bool("wrap", true);
    expect([read("false", true), read("false", false), read("true", true), read("true", false), read("0", true), read("yes", true)]).toEqual([false, false, true, true, false, true]);
  });
});
