import { describe, expect, it } from "vitest";
import { scroll, scrollHeight } from "../../src/components/scroll";
import { render } from "../../src/testing";
import { lightTheme } from "../../src/theme";

const ROWS = Array.from({ length: 30 }, (_, i) => `{id: ${i}, name: "Row ${i}"}`).join(", ");
const LIST = `state rows=[${ROWS}] picked=-1
card
  text "Orders" style=title
  scroll "Orders list" size=sm
    each items=rows as=r key={r.id}
      button "Pick {r.name}" variant=secondary on=set:picked:{r.id}
  text "Picked {picked}"
`;
const box = (ui: ReturnType<typeof render>) => ui.find("scroll").box!;

describe("scroll", () => {
  it("parses its example with no problems", () => {
    expect(render(scroll.example! + "\n").diagnostics).toEqual([]);
  });

  it("is as tall as its size from the theme, and only as tall as its content when that's less", () => {
    const ui = render(LIST, { width: 600 });
    expect(box(ui).h).toBe(scrollHeight(lightTheme.control.height, "sm"));
    const short = render(`scroll size=lg\n  text "One line"\n`, { width: 600 });
    expect(box(short).h).toBeLessThan(40);
    expect(short.hits.length).toBe(0);
  });

  it("puts what comes after it right below its box, not below all its content", () => {
    const ui = render(LIST, { width: 600 });
    const after = ui.find({ type: "text", text: "Picked {picked}" }).box!;
    expect(after.y).toBeLessThan(box(ui).y + box(ui).h + 30);
  });

  it("scrolls with the wheel, its children moving up, and stops at the end", () => {
    const ui = render(LIST, { width: 600 });
    const b = box(ui);
    const first = () => ui.findAll({ type: "button" })[0]!.box!.y;
    const top = first();
    ui.wheel(b.x + 10, b.y + 10, 120);
    expect(first()).toBeCloseTo(top - 120, 0);
    ui.wheel(b.x + 10, b.y + 10, 100000);
    const last = ui.findAll({ type: "button" }).at(-1)!.box!;
    expect(last.y + last.h).toBeCloseTo(box(ui).y + box(ui).h, 0);
  });

  it("only lets the pointer press what's in sight", () => {
    const ui = render(LIST, { width: 600 });
    const hiddenButton = ui.findAll({ type: "button" })[20]!.box!;
    ui.click(hiddenButton.x + 5, hiddenButton.y + 5);
    expect(ui.state.picked).toBe(-1);
    const shown = ui.findAll({ type: "button" })[1]!.box!;
    ui.click(shown.x + 5, shown.y + 5);
    expect(ui.state.picked).toBe(1);
  });

  it("scrolls with the keys when it has focus, and brings what the keyboard moves to into view", () => {
    const ui = render(LIST, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("scroll");
    const first = () => ui.findAll({ type: "button" })[0]!.box!.y;
    const top = first();
    ui.key("PageDown");
    expect(first()).toBeLessThan(top);
    ui.key("Home");
    expect(first()).toBeCloseTo(top, 0);
    // Tab through the buttons: each one is brought into sight.
    for (let i = 0; i < 12; i++) ui.tab();
    const f = ui.focused!;
    const fb = ui.findAll({ type: "button" }).find((n) => n.box!.node.id === f.id)!.box!;
    expect(fb.y).toBeGreaterThanOrEqual(box(ui).y - 1);
    expect(fb.y + fb.h).toBeLessThanOrEqual(box(ui).y + box(ui).h + 1);
  });

  it("is a region to screen readers, and keeps everything in Copy text", () => {
    const ui = render(`state rows=[${ROWS}]\nscroll "Rows" size=sm\n  each items=rows as=r\n    text "{r.name}"\n`, { width: 600 });
    expect(JSON.stringify(ui.accessibility())).toContain('"role":"region","name":"Rows"');
    expect(ui.copyText()).toContain("Row 29");
  });

  it("works nested, and every streamed prefix renders", () => {
    const nested = `state rows=[${ROWS}]\nscroll size=md\n  text "Outer"\n  scroll size=sm\n    each items=rows as=r\n      text "{r.name}"\n  text "After"\n`;
    expect(render(nested, { width: 400 }).diagnostics).toEqual([]);
    const lines = LIST.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("scroll, after review", () => {
  it("clips what's drawn inside it, and the focus ring of something scrolled away", () => {
    const ui = render(LIST, { width: 600 });
    const b = box(ui);
    const texts = ui.drawOps.filter((o) => o.op === "fillText" && String(o.args[0]).startsWith("Pick Row"));
    expect(texts.length).toBeGreaterThan(10);
    for (const o of texts) expect(o.clip).toEqual({ x: b.x, y: b.y, w: b.w, h: b.h });
  });

  it("brings a focused element into view through nested scrolls, top first when it's taller", () => {
    const nested = `state rows=[${ROWS}]\nscroll size=sm\n  text "Above"\n  scroll size=lg\n    each items=rows as=r key={r.id}\n      button "Pick {r.name}" on=emit:x\n`;
    const ui = render(nested, { width: 500 });
    const outer = () => ui.findAll("scroll")[0]!.box!;
    for (let i = 0; i < 6; i++) {
      ui.tab();
      const f = ui.focused!;
      if (f.type !== "button") continue;
      const fb = ui.findAll({ type: "button" }).find((n) => n.box!.node.id === f.id)!.box!;
      expect(fb.y).toBeGreaterThanOrEqual(outer().y - 1);
      expect(fb.y + fb.h).toBeLessThanOrEqual(outer().y + outer().h + 1);
    }
  });

  it("stops typing in a field scrolled out of sight", () => {
    const ui = render(`state name="" rows=[${ROWS}]\nscroll size=sm\n  input "Name" bind=name\n  each items=rows as=r\n    text "{r.name}"\n`, { width: 500 });
    ui.type("input", "Ada");
    expect(ui.editor).not.toBeNull();
    const b = box(ui);
    ui.wheel(b.x + 10, b.y + b.h - 10, 600);
    expect(ui.editor).toBeNull();
    expect(ui.state.name).toBe("Ada");
  });
});
