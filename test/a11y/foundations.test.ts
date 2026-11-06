import { describe, expect, it } from "vitest";
import { coreComponents, type ComponentDef } from "../../src";
import { render } from "../../src/testing";

/** Two halves, each pressable on its own, describing itself with parts. */
const pair: ComponentDef = {
  type: "pair",
  category: "input",
  description: "Two halves, each pressable on its own.",
  props: { bind: { type: "state", required: true, description: "Receives the pressed half." } },
  layout(box) {
    box.h = 40;
  },
  paint(box, ctx) {
    const half = box.w / 2;
    for (const [i, name] of ["left", "right"].entries()) {
      ctx.addHit({ node: box.node, x: box.x + i * half, y: box.y, w: half, h: box.h, children: [] }, { detail: name });
    }
  },
  press(ctx) {
    ctx.set(ctx.props(ctx.target.node).raw("bind")!, String(ctx.target.detail));
  },
  semantics(_box, ctx) {
    const chosen = ctx.props(_box.node).bound();
    return {
      role: "radiogroup",
      name: "Side",
      parts: ["left", "right"].map((side) => ({ detail: side, role: "radio" as const, name: side, checked: chosen === side })),
    };
  },
};

/** Purely visual: a box that hides itself and anything inside it from screen readers. */
const decoration: ComponentDef = {
  type: "decoration",
  category: "layout",
  description: "A decorative frame.",
  props: {},
  children: "any",
  layout(box, ctx) {
    let y = box.y;
    box.children = box.node.children.map((c) => {
      const b = ctx.layout(c, box.x, y, box.w);
      y += b.h;
      return b;
    });
    box.h = y - box.y;
  },
  semantics: () => false,
};

const components = [...coreComponents, pair, decoration];

describe("announcements", () => {
  it("reads a notify: message politely", () => {
    const ui = render(`button "Save" on=notify:Saved`);
    ui.press({ type: "button", text: "Save" });
    expect(ui.announcements).toEqual([{ text: "Saved", politeness: "polite" }]);
  });

  it("reads the same message twice when it's shown twice", () => {
    const ui = render(`button "Save" on=notify:Saved`);
    ui.press({ type: "button", text: "Save" });
    ui.press({ type: "button", text: "Save" });
    expect(ui.announcements.map((a) => a.text)).toEqual(["Saved", "Saved"]);
  });

  it("reads a new screen by its title, going and coming back", () => {
    const ui = render(`screen name=catalog title="Shop"
  button "Socks" on=go:product
screen name=product title="Trail socks"
  button "Back" on=back`);
    ui.press({ type: "button", text: "Socks" });
    ui.press({ type: "button", text: "Back" });
    expect(ui.announcements.map((a) => a.text)).toEqual(["Trail socks", "Shop"]);
  });

  it("reads a screen's name when it has no title", () => {
    const ui = render(`screen name=start
  button "Next" on=go:done
screen name=done
  text "All set"`);
    ui.press({ type: "button", text: "Next" });
    expect(ui.announcements.map((a) => a.text)).toEqual(["done"]);
  });

  it("says nothing when the host shows the screen that's already showing", () => {
    const ui = render(`screen name=a\n  text "A"\nscreen name=b\n  text "B"`);
    ui.sayshape.go("a");
    expect(ui.announcements).toEqual([]);
  });
});

describe("the accessibility tree", () => {
  it("names the whole interface after the canvas's label", () => {
    const ui = render(`text "Hello"`);
    expect(ui.accessibility()).toMatchObject({ role: "group", name: "Generated interface" });
  });

  it("describes elements without semantics of their own as buttons and text", () => {
    const ui = render(`column
  text "Packing list"
  button "Add item" on=notify:Added`);
    expect(ui.accessibility().children).toEqual([
      { role: "text", name: "Packing list" },
      { role: "button", name: "Add item", state: ["focusable"] },
    ]);
  });

  it("fills in expressions in names", () => {
    const ui = render(`state n=2\nbutton "Add {n} more" on=inc:n`);
    expect(ui.accessibility().children).toEqual([{ role: "button", name: "Add 2 more", state: ["focusable"] }]);
    ui.press({ type: "button" });
    expect(ui.accessibility().children![0]!.name).toBe("Add 3 more");
  });

  it("gives each pressable part its own node, matched to its region", () => {
    const ui = render(`state side="right"\npair bind=side`, { components });
    expect(ui.accessibility().children).toEqual([
      {
        role: "radiogroup",
        name: "Side",
        children: [
          { role: "radio", name: "left", state: ["not checked", "focusable"] },
          { role: "radio", name: "right", state: ["checked", "focusable"] },
        ],
      },
    ]);
    const tree = ui.accessibility({ full: true });
    const [left, right] = tree.children[0]!.children;
    expect(left!.key).not.toBe(right!.key);
    expect(left!.detail).toBe("left");
    expect(right!.rect.x).toBeGreaterThan(left!.rect.x);
  });

  it("follows state changes", () => {
    const ui = render(`state side="right"\npair bind=side`, { components });
    ui.click(30, 40);
    const radios = ui.accessibility().children![0]!.children!;
    expect(radios.map((r) => r.state![0])).toEqual(["checked", "not checked"]);
  });

  it("hides an element that returns false, and everything inside it", () => {
    const ui = render(`column
  decoration
    text "Hidden"
    button "Hidden too" on=notify:x
  text "Shown"`, { components });
    expect(ui.accessibility().children).toEqual([{ role: "text", name: "Shown" }]);
  });

  it("leaves out elements hidden by if=", () => {
    const ui = render(`state open=false
button "Toggle" on=toggle:open
text "Details" if=open`);
    expect(ui.accessibility().children!.map((c) => c.name)).toEqual(["Toggle"]);
    ui.press({ type: "button" });
    expect(ui.accessibility().children!.map((c) => c.name)).toEqual(["Toggle", "Details"]);
  });

  it("keeps a focusable element found inside one named by its content", () => {
    const ui = render(`card on=notify:Opened
  text "Trail socks"
  button "Add" on=notify:Added`);
    const roles = ui.accessibility().children!.map((c) => `${c.role}:${c.name}`);
    expect(roles).toEqual(["button:Trail socks Add", "button:Add"]);
  });

  it("gives every node a key that stays the same across frames", () => {
    const ui = render(`state n=0\nbutton "Count {n}" on=inc:n`);
    const before = ui.accessibility({ full: true }).children[0]!.key;
    ui.press({ type: "button" });
    expect(ui.accessibility({ full: true }).children[0]!.key).toBe(before);
  });
});

describe("the accessibility option", () => {
  it("can be turned off", async () => {
    const { SayShape } = await import("../../src");
    const { FakeCanvas, ensurePath2D } = await import("../../src/testing/canvas");
    ensurePath2D();
    const s = new SayShape(new FakeCanvas() as unknown as HTMLCanvasElement, { components: coreComponents, accessibility: "off", width: 300 });
    s.setSpec(`button "Save" on=notify:Saved`);
    s.renderNow();
    expect(() => s.notify("Saved")).not.toThrow();
    s.destroy();
  });
});
