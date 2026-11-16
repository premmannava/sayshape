/**
 * Selectable text: the invisible layer of real text over the canvas
 * (src/text-layer). The canvas stays the only renderer; these tests check the
 * lines the engine hands the layer, in Node, through sayshape/testing.
 */
import { describe, expect, it, vi } from "vitest";
import { monoWidth, render, type Rendered } from "../src/testing";

const equipment = `state equipment=[{id: "laptop", name: "Laptop", price: 1200, stock: 12}, {id: "monitor", name: "Monitor", price: 350, stock: 24}, {id: "keyboard", name: "Keyboard", price: 79, stock: 41}] selected=""`;
const TABLE = `${equipment}
table "Available equipment" items=equipment key=id bind=selected
  table-column "Equipment" field=name
  table-column "Price" field=price format=money
  table-column "In stock" field=stock format=number
`;

/** Render and build the layer, as it would be once drawing settles. */
const shown = (spec: string, opts: Parameters<typeof render>[1] = {}): Rendered => {
  const ui = render(spec, { width: 420, ...opts });
  ui.textLayer.settle();
  return ui;
};
const words = (ui: Rendered) => ui.textLayer.lines.map((l) => l.text);
/** Text drawn on the canvas in the last frame, with where and how. */
const drawn = (ui: Rendered) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => ({ text: String(o.args[0]), x: Number(o.args[1]), y: Number(o.args[2]), font: o.font, align: o.textAlign }));

describe("text layer: where the lines sit", () => {
  const SPEC = `card
  text "Weekend plan" style=title
  text "Left" align=left
  text "Right" align=right
  row
    stat label="Days" value="12"
${TABLE.split("\n").map((l) => (l ? "  " + l : l)).join("\n")}`;

  it("puts a node on every drawn line of text, stat and table cells, at the drawn place, font and size", () => {
    const ui = shown(SPEC.replace(/^state .*\n/m, "") .replace("  state", "state"));
    expect(ui.diagnostics).toEqual([]);
    const lines = ui.textLayer.lines;
    expect(lines.length).toBeGreaterThan(8);
    const ops = drawn(ui);
    for (const l of lines) {
      const op = ops.find((o) => o.text === l.text && o.font === l.font);
      expect(op, `a fillText for "${l.text}"`).toBeDefined();
      // The words' left edge, from the anchor the canvas was given and its alignment.
      const w = monoWidth(l.text, l.font);
      const left = op!.align === "center" ? op!.x - w / 2 : op!.align === "right" || op!.align === "end" ? op!.x - w : op!.x;
      expect(l.x).toBeCloseTo(left, 3);
      expect(l.w).toBeCloseTo(w, 3);
      // The line box holds the baseline the canvas drew on, and is as tall as a line of that size.
      expect(l.y).toBeLessThanOrEqual(op!.y);
      expect(l.y + l.h).toBeGreaterThanOrEqual(op!.y);
      expect(l.font).toMatch(/^\d+ \d+(\.\d+)?px /);
    }
    // Everything those elements drew is there: nothing left out, nothing added.
    for (const t of ["Weekend plan", "Left", "Right", "Days", "12", "Equipment", "Price", "In stock", "Laptop", "$1,200.00", "41"]) expect(words(ui)).toContain(t);
  });

  it("keeps text, a stat's label and value, and a table's header and cells at distinct places", () => {
    const ui = shown(`${TABLE}text "After"`);
    const at = (t: string) => ui.textLayer.lines.find((l) => l.text === t)!;
    expect(at("Laptop").y).toBeGreaterThan(at("Equipment").y);
    expect(at("$1,200.00").x).toBeGreaterThan(at("Laptop").x);
    expect(at("After").y).toBeGreaterThan(at("Keyboard").y);
  });
});

describe("text layer: wrapped text", () => {
  it("gives one node per drawn line", () => {
    const ui = shown(`text "A fairly long paragraph that has to wrap onto several lines in a narrow column of this canvas"`, { width: 200 });
    const box = ui.find("text").box!;
    const lines = (box.data as { lines: string[] }).lines;
    expect(lines.length).toBeGreaterThan(2);
    expect(words(ui)).toEqual(lines);
    // One below the next, at the element's line height.
    const ys = ui.textLayer.lines.map((l) => l.y);
    expect(new Set(ys).size).toBe(lines.length);
    expect(ui.textLayer.lines[1]!.y - ui.textLayer.lines[0]!.y).toBeCloseTo((box.data as { lineHeight: number }).lineHeight, 3);
  });

  it("copies a wrapped paragraph as running words, not as separate lines", () => {
    const ui = shown(`text "A fairly long paragraph that has to wrap onto several lines in a narrow column of this canvas"\ntext "Next"`, { width: 200 });
    const all = ui.textLayer.lines;
    ui.textLayer.select(all[0]!.text, all[all.length - 2]!.text);
    expect(ui.textLayer.selection).toBe("A fairly long paragraph that has to wrap onto several lines in a narrow column of this canvas");
    ui.textLayer.select(all[0]!.text, "Next");
    expect(ui.textLayer.selection).toMatch(/canvas\nNext$/);
  });
});

describe("text layer: copying a selection", () => {
  it("copies a table row as tab-separated cells, one row per line", () => {
    const ui = shown(TABLE);
    ui.textLayer.select("Laptop", "12");
    expect(ui.textLayer.selection).toBe("Laptop\t$1,200.00\t12");
    ui.textLayer.select("Equipment", "41");
    expect(ui.textLayer.selection).toBe("Equipment\tPrice\tIn stock\nLaptop\t$1,200.00\t12\nMonitor\t$350.00\t24\nKeyboard\t$79.00\t41");
  });

  it("selects by dragging across a row through the real pointer path", () => {
    const ui = shown(TABLE);
    ui.dragText("Laptop", "12");
    expect(ui.textLayer.selection).toBe("Laptop\t$1,200.00\t12");
  });

  it("copies the selection with Ctrl/Cmd+C, and the whole interface when nothing is selected", () => {
    const ui = shown(`text "Alone"\n${TABLE}`);
    expect(ui.textLayer.selection).toBeNull();
    expect(ui.textLayer.copy()).toBe(ui.copyText());
    ui.textLayer.select("Alone");
    expect(ui.textLayer.copy()).toBe("Alone");
    ui.textLayer.clear();
    expect(ui.textLayer.copy()).toBe(ui.copyText());
  });
});

describe("text layer: clicks and drags", () => {
  const CARD = `state n=0
card on=inc:n
  text "Press this card"
  text "Count {n}"
`;

  it("still presses an element when its text is clicked", () => {
    const ui = shown(CARD);
    const t = ui.textLayer.lines.find((l) => l.text === "Press this card")!;
    ui.click(t.x + t.w / 2, t.y + t.h / 2);
    expect(ui.state.n).toBe(1);
    expect(ui.textLayer.selection).toBeNull();
  });

  it("selects on a drag over the text and does not press", () => {
    const ui = shown(CARD);
    ui.dragText("Press this card");
    expect(ui.state.n).toBe(0);
    expect(ui.textLayer.selection).toBe("Press this card");
  });

  it("keeps a table row's press on a click, and selects on a drag", () => {
    const ui = shown(TABLE);
    const cell = ui.textLayer.lines.find((l) => l.text === "Monitor")!;
    ui.click(cell.x + 2, cell.y + cell.h / 2);
    expect(ui.state.selected).toBe("monitor");
    ui.dragText("Keyboard", "41");
    expect(ui.state.selected).toBe("monitor");
    expect(ui.textLayer.selection).toBe("Keyboard\t$79.00\t41");
  });

  it("still presses a button, and a click clears the selection", () => {
    const ui = shown(`state n=0\ntext "Words"\nbutton "Add" on=inc:n\n`);
    ui.dragText("Words");
    expect(ui.textLayer.selection).toBe("Words");
    ui.press({ type: "button" });
    expect(ui.state.n).toBe(1);
    expect(ui.textLayer.selection).toBeNull();
  });
});

describe("text layer: what is left out", () => {
  it("leaves out text hidden by if=, inactive tabs and inactive screens", () => {
    const ui = shown(`state on=false view=a
text "Always here"
if={on}
  text "Only when on"
tabs bind=view
  tab "First" value=a
    text "Panel one"
  tab "Second" value=b
    text "Panel two"
`);
    expect(words(ui)).toContain("Always here");
    expect(words(ui)).toContain("Panel one");
    expect(words(ui)).not.toContain("Only when on");
    expect(words(ui)).not.toContain("Panel two");
    ui.set("on", true);
    ui.set("view", "b");
    ui.textLayer.settle();
    expect(words(ui)).toContain("Only when on");
    expect(words(ui)).toContain("Panel two");
    expect(words(ui)).not.toContain("Panel one");
    const screens = shown(`screen name=home\n  text "Home words"\nscreen name=other\n  text "Other words"\n`);
    expect(words(screens)).toContain("Home words");
    expect(words(screens)).not.toContain("Other words");
  });

  it("leaves out what lies under an open dialog", () => {
    const ui = shown(`state confirm=false
text "Behind the dialog"
table "Behind table" items=[{a: "cellbehind"}]
  table-column "Col" field=a
dialog "Sure?" bind=confirm
  text "Inside the dialog"
`);
    expect(words(ui)).toContain("Behind the dialog");
    ui.set("confirm", true);
    ui.textLayer.settle();
    expect(words(ui)).toContain("Inside the dialog");
    expect(words(ui)).not.toContain("Behind the dialog");
    expect(words(ui)).not.toContain("cellbehind");
    ui.set("confirm", false);
    ui.textLayer.settle();
    expect(words(ui)).toContain("Behind the dialog");
  });

  it("leaves out what lies under an open popup", () => {
    const ui = shown(`state pick="" depts=[{id: "a", name: "Alpha"}, {id: "b", name: "Beta"}]
select "Pick one" items=depts value=id label=name bind=pick
text "Under the list one"
text "Under the list two"
text "Under the list three"
`);
    expect(words(ui)).toContain("Under the list one");
    const s = ui.hits.find((h) => h.box.node.type === "select")!;
    ui.click(s.box.x + s.box.w / 2, s.box.y + s.box.h / 2);
    ui.textLayer.settle();
    expect(ui.popup).not.toBeNull();
    const a = ui.sayshape.openPopupInfo!.area!;
    expect(a).toBeTruthy();
    for (const l of ui.textLayer.lines) {
      const hit = l.x < a.x + a.w && l.x + l.w > a.x && l.y < a.y + a.h && l.y + l.h > a.y;
      expect(hit, `"${l.text}" is under the popup`).toBe(false);
    }
    // Some of the words the list covers were left out of the layer.
    expect(words(ui).filter((w) => w.startsWith("Under the list")).length).toBeLessThan(3);
  });

  it("leaves out buttons, inputs, selects and switches", () => {
    const ui = shown(`state name="typed" on=true pick="b" agree=true opts=[{id: "a", name: "opt-a"}, {id: "b", name: "opt-b"}]
text "A heading"
button "Push button" on=inc:n
input "Name field" bind=name
select "Select label" items=opts value=id label=name bind=pick
switch "Switch label" bind=on
check "Check label" bind=agree
link "Link label" on=emit:go
`);
    expect(words(ui)).toEqual(["A heading"]);
  });

  it("leaves out text a scrolling element has cut off", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `    text "Scrolled row ${i}"`).join("\n");
    const ui = shown(`scroll size=sm\n  column\n${rows}\n`);
    const ws = words(ui);
    expect(ws).toContain("Scrolled row 0");
    expect(ws).not.toContain("Scrolled row 29");
    expect(ws.length).toBeLessThan(30);
  });
});

describe("text layer: the option", () => {
  it("creates nothing when off", () => {
    const ui = shown(`text "Words"\n${TABLE}`, { selectText: false });
    ui.textLayer.settle();
    expect(ui.textLayer.lines).toEqual([]);
    expect(ui.textLayer.builds).toBe(0);
    expect(ui.textLayer.selection).toBeNull();
    // The canvas still draws them.
    expect(drawn(ui).map((o) => o.text)).toContain("Words");
  });

  it("leaves the accessibility tree and Copy text exactly as they were", () => {
    const spec = `card\n  text "Heading" style=title\n  stat label="Days" value="12"\n  button "Go" on=inc:n\n${TABLE.replace(/^/gm, "  ")}`;
    const on = shown(spec);
    const off = shown(spec, { selectText: false });
    expect(on.diagnostics).toEqual([]);
    expect(on.textLayer.lines.length).toBeGreaterThan(0);
    expect(off.textLayer.lines.length).toBe(0);
    expect(on.accessibility()).toEqual(off.accessibility());
    expect(on.copyText()).toBe(off.copyText());
    expect(on.mirror.updates).toBe(off.mirror.updates);
    expect(on.announcements).toEqual(off.announcements);
  });
});

describe("text layer: when it is built", () => {
  it("builds once after a streamed spec settles, not once per line", () => {
    const ui = render("", { width: 420 });
    const lines = [`state n=1\n`, `card\n`, `  text "First line"\n`, `  text "Second line"\n`, `  stat label="Days" value="12"\n`, `  text "Last line"\n`];
    ui.stream(lines);
    expect(ui.textLayer.builds).toBe(0);
    ui.textLayer.settle();
    expect(ui.textLayer.builds).toBe(1);
    expect(words(ui)).toEqual(expect.arrayContaining(["First line", "Second line", "Last line"]));
    // Nothing changed since: settling again, or painting again, rebuilds nothing.
    ui.textLayer.settle();
    ui.sayshape.invalidate("paint");
    ui.sayshape.renderNow();
    ui.textLayer.settle();
    expect(ui.textLayer.builds).toBe(1);
  });

  it("does not rebuild for a repaint that draws the same text", () => {
    const ui = shown(`state n=1\ntext "Count {n}"\nbutton "Add" on=inc:n\n`);
    expect(ui.textLayer.builds).toBe(1);
    // Hover and focus repaint without touching the text.
    const b = ui.hits.find((h) => h.box.node.type === "button")!;
    ui.sayshape.pointer = { x: b.box.x + 2, y: b.box.y + 2 };
    ui.sayshape.invalidate("paint");
    ui.sayshape.renderNow();
    ui.textLayer.settle();
    expect(ui.textLayer.builds).toBe(1);
  });

  it("builds by itself once drawing has been still for a moment, however often it repaints", () => {
    vi.useFakeTimers();
    try {
      const ui = render(`state n=1\ntext "Count {n}"\n`, { width: 420 });
      for (let i = 0; i < 30; i++) {
        ui.sayshape.invalidate("paint");
        ui.sayshape.renderNow();
        vi.advanceTimersByTime(20);
      }
      expect(ui.textLayer.builds).toBe(1);
      expect(words(ui)).toEqual(["Count 1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still builds for text that never stops changing, after a longer wait", () => {
    vi.useFakeTimers();
    try {
      const ui = render(`state n=1\ntext "Count {n}"\n`, { width: 420 });
      for (let i = 0; i < 200; i++) {
        ui.set("n", i);
        vi.advanceTimersByTime(20);
      }
      // Four seconds of change: a few builds, not one per change.
      expect(ui.textLayer.builds).toBeGreaterThan(0);
      expect(ui.textLayer.builds).toBeLessThan(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows a state change", () => {
    const ui = shown(`state n=1\ntext "Count {n}"\nbutton "Add" on=inc:n\n`);
    expect(words(ui)).toEqual(["Count 1"]);
    ui.press({ type: "button" });
    ui.textLayer.settle();
    expect(words(ui)).toEqual(["Count 2"]);
  });
});

describe("text layer: long tables", () => {
  const rows = Array.from({ length: 200 }, (_, i) => `{id: "r${i}", name: "Row${i}", qty: ${i}}`).join(", ");
  const spec = `state rows=[${rows}]\ntable items=rows key=id\n  table-column "Name" field=name\n  table-column "Qty" field=qty\n`;

  it("creates nodes only for the rows in sight", () => {
    const ui = shown(spec, { viewport: { top: 0, bottom: 300 } });
    const ws = words(ui);
    expect(ws).toContain("Row0");
    expect(ws).not.toContain("Row100");
    expect(ws).not.toContain("Row199");
    // 200 rows of 2 cells would be 400 nodes; a screen of them is far fewer.
    expect(ui.textLayer.lines.length).toBeLessThan(100);
    expect(ui.textLayer.lines.length).toBeGreaterThan(6);
  });

  it("creates the rows near wherever the page is scrolled to", () => {
    const far = shown(spec, { viewport: { top: 3000, bottom: 3300 } });
    const ws = words(far);
    expect(ws).not.toContain("Row0");
    expect(ws.some((w) => /^Row\d+$/.test(w))).toBe(true);
    expect(ws.length).toBeLessThan(100);
  });

  it("creates every row when the whole table is in sight", () => {
    const ui = shown(spec);
    expect(words(ui)).toContain("Row199");
  });
});
