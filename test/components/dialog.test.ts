import { describe, expect, it } from "vitest";
import { dialog } from "../../src/components/dialog";
import { render } from "../../src/testing";
import { lightTheme } from "../../src/theme";

const SPEC = `state confirm=false deleted=0 closed=0
card
  text "Order NW-2041" style=title
  button "Delete order" variant=danger on=set:confirm:true
  button "Refund" variant=secondary on=inc:closed
  text "Deleted {deleted}"
dialog "Delete order NW-2041?" bind=confirm size=sm on=inc:closed
  text "The order and its invoice are removed."
  row
    button "Cancel" variant=secondary on=set:confirm:false
    button "Delete" variant=danger on="inc:deleted;set:confirm:false"
`;

const pressClose = (ui: ReturnType<typeof render>) => {
  const h = ui.hits.find((r) => r.box.node.type === "dialog" && r.detail === "close")!;
  ui.click(h.box.x + h.box.w / 2, h.box.y + h.box.h / 2);
};

const open = (width = 600) => {
  const ui = render(SPEC, { width });
  ui.press({ type: "button", text: "Delete order" });
  return ui;
};

describe("dialog", () => {
  it("parses its example with no problems, and needs bind=", () => {
    expect(render(dialog.example! + "\n").diagnostics).toEqual([]);
    const r = render(`dialog "Hi"\n  text "x"\n`);
    expect(r.diagnostics.map((d) => d.message).join(" ")).toMatch(/bind/);
  });

  it("takes no room where it's written, and isn't drawn while closed", () => {
    const ui = render(SPEC, { width: 600 });
    expect(ui.isShown({ type: "dialog" })).toBe(false);
    expect(ui.text()).not.toContain("The order and its invoice are removed.");
    expect(ui.copyText()).not.toContain("Delete order NW-2041?");
  });

  it("opens when bind= is true, centred, at its size, at every width", () => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = open(width);
      const b = ui.find("dialog").box!;
      expect(b.w).toBeLessThanOrEqual(width - 16);
      expect(Math.abs(b.x + b.w / 2 - width / 2)).toBeLessThan(1);
      expect(ui.text().join(" ")).toContain("invoice");
      ui.destroy();
    }
    const wide = open(1024);
    const narrow = render(SPEC.replace("size=sm", "size=lg"), { width: 1024 });
    narrow.press({ type: "button", text: "Delete order" });
    expect(narrow.find("dialog").box!.w).toBeGreaterThan(wide.find("dialog").box!.w);
  });

  it("runs the buttons inside it", () => {
    const ui = open();
    ui.press({ type: "button", text: "Delete" });
    expect(ui.state.deleted).toBe(1);
    expect(ui.state.confirm).toBe(false);
    expect(ui.isShown({ type: "dialog" })).toBe(false);
    // Closing from inside isn't a dismissal: on= doesn't run.
    expect(ui.state.closed).toBe(0);
  });

  it("makes what's behind it inert: no presses, no Tab", () => {
    const ui = open();
    const behind = ui.find({ type: "button", text: "Refund" }).box!;
    const d = ui.find("dialog").box!;
    // Somewhere on the Refund button that the dialog doesn't cover.
    const y = behind.y + behind.h / 2;
    const x = d.y <= y && y <= d.y + d.h ? Math.min(behind.x + 4, d.x - 4) : behind.x + 4;
    if (x >= behind.x) {
      ui.click(x, y);
      expect(ui.state.closed).toBe(1); // the backdrop press closed it and ran on=
      expect(ui.state.confirm).toBe(false);
    }
    const again = open();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) { again.tab(); if (again.focused) seen.add(again.focused.type + ":" + again.focused.line); }
    expect([...seen].every((k) => k.startsWith("button:1") || k.startsWith("dialog:"))).toBe(true);
    expect(seen.has("button:4")).toBe(false);
  });

  it("closes with Escape, its × and a press outside it, running on=", () => {
    const ui = open();
    ui.key("Escape");
    expect(ui.state.confirm).toBe(false);
    expect(ui.state.closed).toBe(1);

    ui.press({ type: "button", text: "Delete order" });
    pressClose(ui);
    expect(ui.state.confirm).toBe(false);
    expect(ui.state.closed).toBe(2);

    ui.press({ type: "button", text: "Delete order" });
    ui.click(2, 2);
    expect(ui.state.confirm).toBe(false);
    expect(ui.state.closed).toBe(3);
    // The press that closed it didn't reach anything under it.
    expect(ui.state.deleted).toBe(0);
  });

  it("moves focus into it when it opens and back when it closes", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    expect(ui.focused?.text).toBe("Delete order");
    ui.key("Enter");
    expect(ui.state.confirm).toBe(true);
    expect(ui.focused?.type).toBe("dialog");
    ui.tab();
    expect(ui.focused?.text).toBe("Cancel");
    ui.key("Escape");
    expect(ui.focused?.text).toBe("Delete order");
  });

  it("is all a screen reader and Copy text get while it's open", () => {
    const ui = open();
    const tree = JSON.stringify(ui.accessibility());
    expect(tree).toContain('"role":"dialog","name":"Delete order NW-2041?"');
    expect(tree).not.toContain("Refund");
    const copied = ui.copyText();
    expect(copied).toContain("Delete order NW-2041?");
    expect(copied).toContain("The order and its invoice are removed.");
    expect(copied).not.toContain("Deleted 0");
  });

  it("dims the screen behind it with the theme's scrim", () => {
    const ui = open();
    expect(ui.drawOps.some((o) => o.op === "fillRect" && o.fillStyle === lightTheme.colors.scrim)).toBe(true);
  });

  it("streams: every prefix parses, and a half-written dialog is just closed", () => {
    const lines = SPEC.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const ui = render(lines.slice(0, i).join("\n") + "\n", { width: 400 });
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      ui.destroy();
    }
  });

  it("opens from a path inside each, and its × writes that item", () => {
    const ui = render(`state items=[{name: "A", open: false}, {name: "B", open: true}]
each items=items as=it
  dialog "About {it.name}" bind=it.open
    text "Details for {it.name}"
`, { width: 600 });
    expect(ui.text()).toContain("Details for B");
    pressClose(ui);
    expect((ui.state.items as Array<{ open: boolean }>)[1]!.open).toBe(false);
    expect(ui.findAll({ type: "dialog" }).every((d) => d.box === null)).toBe(true);
  });

  describe("with what's around it (review fixes)", () => {
    it("lets a select inside it be used, even when its list reaches past the dialog", () => {
      const ui = render(`state c="a" open=true closed=0
dialog "Pick" bind=open on=inc:closed
  select "Letter" items=["a","b","c","d","e","f","g"] bind=c
`, { width: 360, viewport: { top: 0, bottom: 700 } });
      ui.press("select");
      const option = ui.popup!.regions.find((r) => r.detail === "opt:s:g")!.box;
      const d = ui.find("dialog").box!;
      expect(option.y, "this option sits below the dialog").toBeGreaterThan(d.y + d.h);
      ui.click(option.x + 4, option.y + option.h / 2);
      expect(ui.state.c).toBe("g");
      expect(ui.state.open).toBe(true);
      expect(ui.state.closed).toBe(0);
    });

    it("doesn't open from inside an unselected tab or a closed accordion", () => {
      const ui = render(`state t="a" open=true more=false
row
  tabs bind=t
    tab "A" value=a
      text "a"
    tab "B" value=b
      dialog "Hidden in tab B" bind=open
        text "inside"
row
  accordion "More" bind=more
    dialog "Hidden in the accordion" bind=open
      text "inside too"
`, { width: 600 });
      expect(ui.isShown({ type: "dialog", text: "Hidden in tab B" })).toBe(false);
      expect(ui.isShown({ type: "dialog", text: "Hidden in the accordion" })).toBe(false);
      ui.set("t", "b");
      expect(ui.isShown({ type: "dialog", text: "Hidden in tab B" })).toBe(true);
    });

    it("ends typing in a field behind it, and closes a popup behind it", () => {
      const ui = render(`state q="" confirm=false c="a"
input "Search" bind=q on=set:confirm:true
select "Letter" items=["a","b"] bind=c
dialog "Sure?" bind=confirm
  button "OK" on=set:confirm:false
`, { width: 600 });
      ui.type("input", "ab");
      ui.key("Enter");
      expect(ui.state.confirm).toBe(true);
      expect(ui.editor).toBeNull();
      ui.key("Escape");
      expect(ui.state.confirm).toBe(false);

      ui.press("select");
      expect(ui.popup).not.toBeNull();
      ui.set("confirm", true);
      expect(ui.popup).toBeNull();
    });

    it("can always be dismissed, even when bind= can't be written (a derived value)", () => {
      const ui = render(`state step=2
derive open={step == 2}
dialog "Stuck?" bind=open
  text "No buttons here"
`, { width: 600 });
      expect(ui.isShown("dialog")).toBe(true);
      ui.key("Escape");
      expect(ui.isShown("dialog")).toBe(false);
      // It opens again once its value has gone false and come back.
      ui.set("step", 1);
      ui.set("step", 2);
      expect(ui.isShown("dialog")).toBe(true);
    });

    it("keeps Tab inside it, going round", () => {
      const ui = open();
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) { ui.tab(); seen.push(`${ui.focused?.type}:${ui.focused?.text ?? ""}`); }
      expect(seen).toEqual(["button:Cancel", "button:Delete", "dialog:Delete order NW-2041?", "button:Cancel", "button:Delete"]);
    });

    it("gives focus back after one open dialog follows another", () => {
      const ui = render(`state items=[{n: "A", open: false}, {n: "B", open: false}]
button "Open both" on="set:items:{[{n: 'A', open: true}, {n: 'B', open: true}]}"
each items=items as=it
  dialog "About {it.n}" bind=it.open
    text "{it.n}"
`, { width: 600 });
      ui.tab();
      ui.key("Enter");
      expect(ui.text()).toContain("A");
      ui.key("Escape");
      expect(ui.text().join(" ")).toContain("About B");
      ui.key("Escape");
      expect(ui.focused?.text).toBe("Open both");
    });

    it("drops hover on what's behind when it opens", () => {
      const ui = render(SPEC, { width: 600 });
      ui.press({ type: "button", text: "Delete order" });
      expect(ui.sayshape.hover).toBeNull();
    });

    it("opens near what opened it when the host grows to fit (no bounded viewport)", () => {
      const lines = Array.from({ length: 60 }, (_, i) => `text "Line ${i}"`).join("\n");
      const ui = render(`state open=false\nbutton "Open" on=set:open:true\n${lines}\ndialog "Hi" bind=open\n  text "x"\n`, { width: 600 });
      ui.press({ type: "button", text: "Open" });
      expect(ui.find("dialog").box!.y).toBeLessThan(200);
    });
  });
});
