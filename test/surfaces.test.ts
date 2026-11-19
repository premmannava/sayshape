// Hairline surfaces (theme.surfaces "lines", the default in chats and host pages): plain cards,
// lists and tables are a 1px line with no fill or shadow; popups and dialogs keep both.
import { describe, expect, it } from "vitest";
import { render, type Rendered } from "../src/testing";
import type { DrawOp } from "../src/testing/canvas";
import { forcedColorsTheme, lightTheme } from "../src/theme";
import type { Box } from "../src/types";
import { textOverflows } from "./overflow";

const CARD = 'card\n  text "Weekend plan"\n  text "Two days" tone=muted';
const LIST = 'list\n  list-item "Rain shell" trailing="$129"\n  list-item "Socks" trailing="$24"';

const shadows = (ui: Rendered): DrawOp[] => ui.drawOps.filter((op) => op.shadow);

describe("Hairline cards", () => {
  it("a chat card draws no shadow, no fill and one full line stroke", () => {
    const ui = render(CARD, { context: "chat", width: 375 });
    const t = ui.sayshape.theme;
    expect(t.surfaces).toBe("lines");
    expect(shadows(ui)).toHaveLength(0);
    expect(ui.drawOps.some((op) => op.op === "fill")).toBe(false);
    expect(ui.drawOps.some((op) => op.gradientStops?.length)).toBe(false);
    const strokes = ui.drawOps.filter((op) => op.op === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.strokeStyle).toBe(t.colors.line);
    expect(strokes[0]!.globalAlpha).toBe(1);
    ui.destroy();
  });

  it("a default host's card keeps its fill and shadow", () => {
    const ui = render(CARD, { width: 375 });
    expect(ui.sayshape.theme.surfaces).toBeUndefined();
    expect(shadows(ui).length).toBeGreaterThan(0);
    expect(ui.drawOps.some((op) => op.op === "fill" && op.gradientStops?.length)).toBe(true);
    ui.destroy();
  });

  it.each(["hero", "tinted"])("a %s card in a chat still fills", (variant) => {
    const ui = render(`card variant=${variant}\n  text "Lead"`, { context: "chat", width: 375 });
    expect(ui.drawOps.some((op) => op.op === "fill")).toBe(true);
    ui.destroy();
  });

  it("a card with fill= in a chat still draws its gradient", () => {
    const ui = render('card fill=sky\n  text "Sunny"', { context: "chat", width: 375 });
    expect(ui.drawOps.some((op) => op.op === "fill" && op.gradientStops?.length)).toBe(true);
    ui.destroy();
  });

  it("a pressable chat card keeps its hit area and tone stripe", () => {
    const ui = render('card on=emit:open tone=good\n  text "Order"', { context: "chat", width: 375 });
    const t = ui.sayshape.theme;
    expect(ui.drawOps.some((op) => op.op === "fillRect" && op.fillStyle === t.colors.good)).toBe(true);
    ui.press("card");
    expect(ui.emitted.map((e) => e.name)).toEqual(["open"]);
    ui.destroy();
  });

  it("in a forced-colors mode a chat card's line is the system text color", () => {
    const system: Record<string, string> = { Canvas: "#000000", CanvasText: "#ffff00", Highlight: "#00ffff", HighlightText: "#000000", GrayText: "#808080" };
    const theme = forcedColorsTheme(lightTheme, (n) => system[n]!);
    const ui = render(`${CARD}\n${LIST}`, { context: "chat", width: 375, theme });
    const strokes = ui.drawOps.filter((op) => op.op === "stroke");
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    for (const s of strokes) expect(s.strokeStyle).toBe("#ffff00");
    expect(shadows(ui)).toHaveLength(0);
    ui.destroy();
  });
});

describe("Hairline lists and tables", () => {
  it("a chat list has no fill: a full line frame and its row lines", () => {
    const ui = render(LIST, { context: "chat", width: 375 });
    const t = ui.sayshape.theme;
    expect(ui.drawOps.some((op) => op.op === "fill")).toBe(false);
    const strokes = ui.drawOps.filter((op) => op.op === "stroke");
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.strokeStyle).toBe(t.colors.line);
    expect(strokes[0]!.globalAlpha).toBe(1);
    // The separator between the two rows is still drawn.
    expect(ui.drawOps.filter((op) => op.op === "fillRect" && op.fillStyle === t.colors.line)).toHaveLength(1);
    ui.destroy();
  });

  it("a default host's list keeps its panel", () => {
    const ui = render(LIST, { width: 375 });
    expect(ui.drawOps.some((op) => op.op === "fill" && op.fillStyle === lightTheme.colors.raised)).toBe(true);
    ui.destroy();
  });

  it("a chat table keeps an opaque fill in the page color under a full line frame", () => {
    const ui = render('state rows=[{n:"A",v:1},{n:"B",v:2}]\ntable items=rows\n  table-column "Name" field=n\n  table-column "Value" field=v', { context: "chat", width: 375 });
    const t = ui.sayshape.theme;
    const frame = ui.drawOps.find((op) => op.op === "fill" && op.fillStyle === t.colors.surface);
    expect(frame?.globalAlpha).toBe(1);
    const stroke = ui.drawOps.find((op) => op.op === "stroke" && op.strokeStyle === t.colors.line);
    expect(stroke?.globalAlpha).toBe(1);
    ui.destroy();
  });
});

describe("popups and dialogs are unaffected", () => {
  it("a dialog in a chat draws its shadow and fill", () => {
    const ui = render('state open=true\ndialog "Delete?" bind=open\n  text "This cannot be undone."', { context: "chat", width: 375 });
    expect(shadows(ui).length).toBeGreaterThan(0);
    expect(shadows(ui).some((op) => op.op === "fill")).toBe(true);
    ui.destroy();
  });

  it("an open select in a chat draws its list with a shadow and fill", () => {
    const ui = render('state sizes=["S","M","L"] pick=""\nselect "Size" items=sizes bind=pick', { context: "chat", width: 375 });
    expect(shadows(ui)).toHaveLength(0);
    ui.press("select");
    expect(shadows(ui).length).toBeGreaterThan(0);
    expect(shadows(ui).some((op) => op.op === "fill")).toBe(true);
    ui.destroy();
  });
});

describe("list rows on phones", () => {
  const ROWS = 'list\n  list-item "Rain shell" on=emit:a\n  list-item "Socks"';

  it("a pressable row is at least 44 tall at 375 in a chat, with its title in the middle", () => {
    const ui = render(ROWS, { context: "chat", width: 375 });
    const row = ui.find({ type: "list-item", text: "Rain shell" }).box!;
    expect(row.h).toBeGreaterThanOrEqual(44);
    const title = ui.drawOps.find((op) => op.op === "fillText" && op.args[0] === "Rain shell")!;
    expect(Math.abs(Number(title.args[2]) - (row.y + row.h / 2))).toBeLessThanOrEqual(1);
    // A row that can't be pressed keeps its own height.
    expect(ui.find({ type: "list-item", text: "Socks" }).box!.h).toBeLessThan(44);
    ui.destroy();
  });

  it("a pressable row keeps its compact height at 1024", () => {
    const ui = render(ROWS, { context: "chat", width: 1024 });
    const row = ui.find({ type: "list-item", text: "Rain shell" }).box!;
    expect(row.h).toBeLessThan(44);
    expect(row.h).toBeGreaterThanOrEqual(34);
    ui.destroy();
  });

  it("a row's icon and padding come from the theme's sizes", () => {
    const ui = render('list\n  list-item "Box" icon=package', { context: "chat", width: 1024 });
    const s = ui.sayshape.theme.sizes!;
    const row = ui.find("list-item").box!;
    const title = ui.drawOps.find((op) => op.op === "fillText" && op.args[0] === "Box")!;
    expect(Number(title.args[1])).toBe(row.x + s.listPadX! + s.listIcon! + s.listIconGap!);
    ui.destroy();
  });
});

describe("accordion and grid", () => {
  it("an accordion header is the theme's accordionHeader tall", () => {
    const ui = render('state a=false\naccordion "Returns" bind=a\n  text "Free"', { context: "chat", width: 1024 });
    expect(ui.find("accordion").box!.h).toBe(ui.sayshape.theme.sizes!.accordionHeader);
    ui.destroy();
    // On a phone, the phone size (44 in a chat).
    const phone = render('state a=false\naccordion "Returns" bind=a\n  text "Free"', { context: "chat", width: 375 });
    expect(phone.find("accordion").box!.h).toBe(phone.sayshape.theme.sizes!.accordionHeader);
    expect(phone.find("accordion").box!.h).toBeGreaterThanOrEqual(44);
    phone.destroy();
    // A default host keeps 48.
    const host = render('state a=false\naccordion "Returns" bind=a\n  text "Free"', { width: 1024 });
    expect(host.find("accordion").box!.h).toBe(48);
    host.destroy();
  });

  it("three stats in a plain grid at 375 in a chat: two columns (three need 466 px at min 150)", () => {
    const ui = render('grid\n  stat label="Orders" value=12\n  stat label="Returns" value=1\n  stat label="Rating" value=4.8', { context: "chat", width: 375 });
    const ys = ui.findAll("stat").map((f) => f.box!.y);
    expect(new Set(ys).size).toBe(2);
    expect(ys[0]).toBe(ys[1]);
    ui.destroy();
    const wide = render('grid\n  stat label="Orders" value=12\n  stat label="Returns" value=1\n  stat label="Rating" value=4.8', { context: "chat", width: 600 });
    expect(new Set(wide.findAll("stat").map((f) => f.box!.y)).size).toBe(1);
    wide.destroy();
  });
});

describe("in a chat, nothing overlaps or spills", () => {
  const SPEC = `state open=true rows=[{n:"Trail runner socks",q:2,p:"$24"},{n:"Rain shell with a long name",q:1,p:"$129"}]
card
  text "Your order" style=title
  list
    list-item "Rain shell" detail="Packs into its pocket" trailing="$129" icon=package on=emit:shell
    list-item "Socks" detail="Merino blend" trailing="2" tone=good
    list-item "Gloves" detail="Pressable" on=emit:gloves
      badge "New"
  table items=rows
    table-column "Item" field=n
    table-column "Qty" field=q
    table-column "Price" field=p
list
  list-item "Shipping" detail="Two business days" trailing="Free" on=emit:ship
accordion "Returns and refunds" bind=open detail="Within 30 days"
  text "Free returns within 30 days, unworn."
grid
  stat label="Orders" value=12
  stat label="Returns" value=1
  stat label="Rating" value=4.8`;

  it.each([320, 375, 600, 1024])("at %ipx", (width) => {
    const ui = render(SPEC, { context: "chat", width });
    expect(ui.diagnostics).toEqual([]);
    const check = (b: Box, parent: Box | null) => {
      const where = `${b.node.type} (line ${b.node.line}) at ${width}px`;
      if (parent) {
        expect(b.x, `${where} starts left of its parent`).toBeGreaterThanOrEqual(parent.x - 0.01);
        expect(b.y, `${where} starts above its parent`).toBeGreaterThanOrEqual(parent.y - 0.01);
        expect(b.x + b.w, `${where} runs past its parent's right`).toBeLessThanOrEqual(parent.x + parent.w + 0.01);
        expect(b.y + b.h, `${where} runs past its parent's bottom`).toBeLessThanOrEqual(parent.y + parent.h + 0.01);
      }
      // Siblings, stacked or side by side, never overlap.
      b.children.forEach((k, i) => b.children.slice(i + 1).forEach((o) => {
        const apart = k.x + k.w <= o.x + 0.01 || o.x + o.w <= k.x + 0.01 || k.y + k.h <= o.y + 0.01 || o.y + o.h <= k.y + 0.01;
        expect(apart, `${k.node.type} (line ${k.node.line}) and ${o.node.type} (line ${o.node.line}) overlap at ${width}px`).toBe(true);
      }));
      for (const k of b.children) check(k, b);
    };
    check(ui.sayshape.boxes!, null);
    expect(textOverflows(ui.sayshape.boxes!, ui.drawOps)).toEqual([]);
    ui.destroy();
  });
});
