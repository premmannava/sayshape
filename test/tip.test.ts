import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";
import type { AccessibleNode } from "../src/a11y/semantics";

const SPEC = `state open=3
card
  row
    stat label="Open orders" value={open} tip="Paid, not yet shipped. Updated every 5 minutes."
    icon name=info tip="Refunds count from the day they're approved"
  button "Ship all" on=set:open:0 tip="Marks every open order shipped"
  text "No tip here"
`;

type UI = ReturnType<typeof render>;
const center = (ui: UI, q: Parameters<UI["find"]>[0]) => { const b = ui.find(q).box!; return [b.x + b.w / 2, b.y + b.h / 2] as const; };
const move = (ui: UI, x: number, y: number) => { ui.canvas.dispatch("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 }); ui.sayshape.renderNow(); };
/** The tip bubble's words in the last frame: drawn in the theme's surface color on ink. */
const isTip = (o: UI["drawOps"][number]) => o.op === "fillText" && o.fillStyle === lightTheme.colors.surface && /^500 13px/.test(o.font ?? "");
const tipText = (ui: UI) => ui.drawOps.filter(isTip).map((o) => String(o.args[0])).join(" ");

describe("tip=", () => {
  it("is a prop every element takes, with no problems", () => {
    expect(render(SPEC).diagnostics).toEqual([]);
  });

  it("shows on hover, over what's around it, and hides when the pointer leaves", () => {
    const ui = render(SPEC, { width: 600 });
    expect(tipText(ui)).toBe("");
    const [x, y] = center(ui, "stat");
    move(ui, x, y);
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
    move(ui, 2, 2);
    expect(tipText(ui)).toBe("");
  });

  it("stays while the pointer moves onto the tip itself", () => {
    const ui = render(SPEC, { width: 600 });
    const b = ui.find("stat").box!;
    move(ui, b.x + b.w / 2, b.y + 4);
    const tip = ui.drawOps.find(isTip)!;
    // Just above the stat, on the bubble's text.
    move(ui, Number(tip.args[1]) + 4, Number(tip.args[2]));
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
  });

  it("makes an element that isn't pressable a Tab stop, and shows on keyboard focus", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    expect(ui.focused?.type).toBe("stat");
    expect(tipText(ui)).toContain("Paid, not yet shipped.");
    ui.tab();
    expect(ui.focused?.type).toBe("icon");
    expect(tipText(ui)).toContain("Refunds count");
    ui.tab();
    expect(ui.focused?.type).toBe("button");
    expect(tipText(ui)).toContain("Marks every open order shipped");
    ui.tab();
    expect(ui.focused).toBeNull(); // the text without a tip isn't a stop
  });

  it("hides with Escape without moving focus, and shows again on the next element", () => {
    const ui = render(SPEC, { width: 600 });
    ui.tab();
    ui.key("Escape");
    expect(tipText(ui)).toBe("");
    expect(ui.focused?.type).toBe("stat");
    ui.tab();
    expect(tipText(ui)).toContain("Refunds count");
  });

  it("shows on a tap (touch has no hover), and a second tap or a press elsewhere hides it", () => {
    const ui = render(SPEC, { width: 600 });
    const [x, y] = center(ui, "icon");
    ui.click(x, y);
    move(ui, 2, 2); // a touch leaves no pointer behind; the pinned tip stays
    expect(tipText(ui)).toContain("Refunds count");
    ui.click(2, 2);
    expect(tipText(ui)).toBe("");
  });

  it("doesn't take presses from a pressable element: its own on= still runs", () => {
    const ui = render(SPEC, { width: 600 });
    ui.press({ type: "button" });
    expect(ui.state.open).toBe(0);
  });

  it("doesn't take presses from the children of an element with a tip", () => {
    const ui = render(`state n=0\ncard tip="All orders"\n  button "Add" on=inc:n\n`, { width: 600 });
    ui.press("button");
    expect(ui.state.n).toBe(1);
  });

  it("is read after the element's name, and the Tab stop is a named node", () => {
    const ui = render(SPEC, { width: 600 });
    const tree = ui.accessibility({ full: true });
    const all: Array<{ name?: string; description?: string; focusable: boolean; role: string }> = [];
    const walk = (n: typeof tree) => { all.push(n); n.children.forEach(walk); };
    walk(tree);
    const button = all.find((n) => n.role === "button")!;
    expect(button.description).toBe("Marks every open order shipped");
    const icon = all.find((n) => n.name?.startsWith("Refunds count"))!;
    expect(icon.focusable).toBe(true);
    expect(icon.name?.trim()).toBeTruthy();
  });

  it("fills in state, and an empty tip is no tip", () => {
    const ui = render(`state n=2\ntext "Orders" tip="{n} waiting"\ntext "Other" tip="{''}"\n`, { width: 600 });
    ui.tab();
    expect(tipText(ui)).toBe("2 waiting");
    ui.tab();
    expect(ui.focused).toBeNull();
  });

  it("stays inside the canvas at 240px, wrapping long tips", () => {
    const long = "This number counts every order that has been paid for but not yet handed to the carrier, across all stores";
    const ui = render(`text "Open" tip="${long}"\n`, { width: 240 });
    ui.tab();
    const ops = ui.drawOps.filter(isTip);
    expect(ops.length).toBeGreaterThan(2);
    for (const o of ops) expect(Number(o.args[1])).toBeGreaterThanOrEqual(0);
  });

  describe("review fixes", () => {
    it("lets go of a tip pinned with Enter when focus moves on", () => {
      const ui = render(`text "A" tip="tipA"\nbutton "B" on=emit:b tip="tipB"\n`, { width: 600 });
      ui.tab();
      ui.key("Enter");
      ui.tab();
      expect(tipText(ui)).toBe("tipB");
    });

    it("keeps the tip on the canvas when there's no room above or below", () => {
      const ui = render(`text "Top" tip="Explain the top line"\n`, { width: 300 });
      ui.tab();
      const op = ui.drawOps.find(isTip)!;
      expect(Number(op.args[2])).toBeLessThan(ui.sayshape.metrics.height);
    });

    it("shows no tip while a popup is open", () => {
      const ui = render(`state s="a"\nselect "Size" bind=s items={["a","b","c","d"]} tip="Pick a size"\n`, { width: 600 });
      ui.tab();
      expect(tipText(ui)).toBe("Pick a size");
      ui.key("ArrowDown");
      expect(ui.popup).not.toBeNull();
      expect(tipText(ui)).toBe("");
    });

    it("hides on a second tap", () => {
      const ui = render(`text "Target" tip="Shown"\n`, { width: 600 });
      const [x, y] = center(ui, "text");
      ui.click(x, y);
      expect(tipText(ui)).toBe("Shown");
      ui.click(x, y);
      move(ui, 2, 300);
      expect(tipText(ui)).toBe("");
    });

    it("doesn't press what's under the bubble", () => {
      const ui = render(`state n=0\nbutton "Under" on=inc:n\ntext "Target" tip="A long explanation that sits over the button above it"\n`, { width: 600 });
      const [x, y] = center(ui, "text");
      move(ui, x, y);
      const op = ui.drawOps.find(isTip)!;
      ui.click(Number(op.args[1]) + 4, Number(op.args[2]));
      expect(ui.state.n).toBe(0);
    });

    it("shows again after Escape once focus has moved away and back", () => {
      const ui = render(`text "A" tip="tipA"\ntext "B" tip="tipB"\n`, { width: 600 });
      ui.tab();
      ui.key("Escape");
      expect(tipText(ui)).toBe("");
      ui.tab();
      ui.tab(true);
      expect(tipText(ui)).toBe("tipA");
    });

    it("warns that tip= on an element its parent draws isn't shown", () => {
      const r = render(`menu "Actions"\n  menu-item "Duplicate" on=emit:dup tip="Makes a copy"\n`);
      expect(r.diagnostics.map((d) => d.message).join(" ")).toMatch(/tip= on a menu-item isn't shown/);
    });

    it("shows anywhere over an element that has pressable parts of its own", () => {
      const ui = render(`text "See [the docs](https://northwind.example/docs) for every rule we follow here" rich=true tip="Rules as of June"\n`, { width: 600 });
      const b = ui.find("text").box!;
      move(ui, b.x + b.w - 10, b.y + b.h / 2);
      expect(tipText(ui)).toBe("Rules as of June");
    });

    it("drops a pinned tip when its element is scrolled out of sight", () => {
      const rows = Array.from({ length: 30 }, (_, i) => `  text "Row ${i}"${i === 0 ? ' tip="First row"' : ""}`).join("\n");
      const ui = render(`scroll "Rows" size=sm\n${rows}\n`, { width: 600 });
      const [x, y] = center(ui, { type: "text", text: "Row 0" });
      ui.click(x, y);
      expect(tipText(ui)).toBe("First row");
      const s = ui.find("scroll").box!;
      ui.wheel(s.x + 10, s.y + 10, 600);
      expect(tipText(ui)).toBe("");
    });

    it("forgets a pinned tip when the spec changes", () => {
      const ui = render(`text "A" tip="tipA"\n`, { width: 600 });
      const [x, y] = center(ui, "text");
      ui.click(x, y);
      expect(tipText(ui)).toBe("tipA");
      ui.setSpec(`text "A" tip="tipZ"\n`);
      move(ui, 590, 300);
      expect(tipText(ui)).toBe("");
    });
  });

  describe("on rows and headers their parent draws", () => {
    const COMPARE = `state plans=[{name: "Basic", up: "99.5%", seats: 5}, {name: "Pro", up: "99.99%", seats: 50}]
compare items=plans
  compare-row "Uptime" field=up tip="Share of the month the service is up"
  compare-row "Seats" field=seats format=number
`;
    const DETAILS = `details "Order 1042"
  detail "Status" value="Shipped" tone=good
  detail "ETA" value="Jun 3" tip="Estimated time of arrival"
`;
    const TABLE = `state rows=[{n: "Ada", r: 4}]
table items=rows
  table-column "Name" field=n tip="Their full name"
  table-column "Rank" field=r format=number
`;
    const SORTED = `state rows=[{n: "Ada"}, {n: "Bo"}] by="" dir="asc"
table items=rows sort=by direction=dir
  table-column "Name" field=n tip="Their full name"
`;
    /** Where a label was drawn, to point at it. */
    const at = (ui: UI, label: string) => {
      const op = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === label && !isTip(o))!;
      return [Number(op.args[1]) + 4, Number(op.args[2])] as const;
    };
    const all = (ui: UI) => {
      const out: AccessibleNode[] = [];
      const walk = (n: AccessibleNode) => { out.push(n); n.children.forEach(walk); };
      walk(ui.accessibility({ full: true }));
      return out;
    };

    for (const [name, spec, label, tip] of [
      ["compare-row", COMPARE, "Uptime", "Share of the month the service is up"],
      ["detail", DETAILS, "ETA", "Estimated time of arrival"],
      ["table-column", TABLE, "Name", "Their full name"],
    ] as const) {
      it(`a ${name}'s tip shows on hover over its label, on Tab and on a tap`, () => {
        const ui = render(spec, { width: 600 });
        expect(ui.diagnostics).toEqual([]);
        expect(tipText(ui)).toBe("");
        const [x, y] = at(ui, label);
        move(ui, x, y);
        expect(tipText(ui)).toBe(tip);
        move(ui, 598, 2);
        expect(tipText(ui)).toBe("");
        ui.tab();
        expect(tipText(ui)).toBe(tip);
        ui.key("Escape");
        expect(tipText(ui)).toBe("");
        const fresh = render(spec, { width: 600 });
        fresh.click(...at(fresh, label));
        move(fresh, 598, 2);
        expect(tipText(fresh)).toBe(tip);
        fresh.click(598, 2);
        expect(tipText(fresh)).toBe("");
      });

      it(`a ${name}'s tip is read after its label, on a node Tab reaches`, () => {
        const ui = render(spec, { width: 600 });
        const node = all(ui).find((n) => n.description === tip)!;
        expect(node).toBeTruthy();
        expect(node.name).toContain(label);
      });
    }

    it("only the row with a tip is a Tab stop", () => {
      const ui = render(COMPARE, { width: 600 });
      ui.tab();
      expect(tipText(ui)).toBe("Share of the month the service is up");
      ui.tab();
      expect(ui.focused).toBeNull();
    });

    it("a sortable header still sorts when pressed, and shows its tip on hover", () => {
      const ui = render(SORTED, { width: 600 });
      const [x, y] = at(ui, "Name");
      move(ui, x, y);
      expect(tipText(ui)).toBe("Their full name");
      ui.click(x, y);
      expect(ui.state.by).toBe("n");
    });
  });
});
