/**
 * Draw small, hit big: on a phone, controls keep their compact drawn size
 * but a finger gets at least ICON_TAP (44 px) to press, trimmed where
 * neighbours are close (never under 40 in a form), and no grown region
 * covers what another control draws. On a desktop, regions are what's drawn.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "../src/testing";
import { SayShape } from "../src/engine";
import { ICON_TAP, paintField } from "../src/components/input";
import { PHONE_WIDTH, sizesOf } from "../src/theme";
import type { HitRegion, Rect } from "../src/types";

/** A form in a chat: labelled fields, one with a problem, a select, a date, a choice, buttons md and sm, and a stepper. */
const FORM = `state name="" email="nope" plans=["Free","Pro","Team"] plan="Pro" day="2026-11-20" view="Week" guests=2
card
  text "Book a trip" style=title
  input "Name" bind=name placeholder="Ada Lovelace"
  input "Email" bind=email kind=email
  select "Plan" bind=plan items=plans
  date-picker "Day" bind=day
  segmented bind=view options="Day,Week,Month" label="Period"
  stepper "Guests" bind=guests min=1 max=9
  row
    button "Book" on=notify:booked
    button "Cancel" variant=secondary on=notify:cancelled
  row
    button "Add a note" size=sm variant=secondary fit=true on=notify:note
    button "Remove" size=sm variant=danger fit=true on=notify:removed`;

/** The floor where neighbours force a grown region to give way (the user's decision: about 40, never less). */
const TRIMMED_FLOOR = 40;

const drawn = (h: HitRegion): Rect => h.ring ?? h.box;
const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const name = (h: HitRegion) => `${h.box.node.type}${h.detail === undefined ? "" : ` ${String(h.detail)}`} (line ${h.box.node.line})`;

/** Every region that reaches over a control it doesn't hold, as "a over b". */
function overreach(hits: readonly HitRegion[]): string[] {
  const out: string[] = [];
  for (const a of hits) {
    for (const b of hits) {
      if (a === b) continue;
      const da = drawn(a), db = drawn(b);
      // A region round another (the card, a tip over its own element) isn't a neighbour.
      if (within(da, db) || within(db, da) || meets(da, db)) continue;
      if (meets(a.box, db)) out.push(`${name(a)} over ${name(b)}`);
    }
  }
  return out;
}

describe("phone hit areas (draw small, hit big)", () => {
  it.each([320, 375])("at %i in a chat every focusable target is at least 44 tall, or 40 where neighbours trim it", (width) => {
    const ui = render(FORM, { width, context: "chat" });
    expect(ui.diagnostics).toEqual([]);
    const focusable = ui.hits.filter((h) => h.focusable);
    expect(focusable.length).toBeGreaterThanOrEqual(12);
    let least = { h: Infinity, at: "" };
    for (const h of focusable) {
      expect(h.ring, `${name(h)} is grown`).toBeDefined();
      expect(h.box.h, name(h)).toBeGreaterThanOrEqual(TRIMMED_FLOOR);
      expect(within(drawn(h), h.box), `${name(h)} still covers what it draws`).toBe(true);
      if (h.box.h < least.h) least = { h: h.box.h, at: name(h) };
    }
    // The measured least target, for the PR's notes.
    console.info(`phone-targets ${width}: least focusable target ${least.h.toFixed(1)} px tall, ${least.at}`);
  });

  it("gives a control the whole 44 where nothing is close", () => {
    const ui = render(`state a=""\ninput "Name" bind=a\nbutton "Save" on=notify:x\nbutton "Undo" size=sm on=notify:y`, { width: 375, context: "chat" });
    const targets = ui.hits.filter((h) => h.focusable);
    // The last button has nothing under it: what its top gives up goes below it.
    expect(targets.at(-1)!.box.h).toBe(ICON_TAP);
    for (const h of targets) expect(h.box.h, name(h)).toBeGreaterThanOrEqual(TRIMMED_FLOOR);
  });

  it.each([320, 375, 600, 1024])("at %i no region reaches over another control's drawn box", (width) => {
    expect(overreach(render(FORM, { width, context: "chat" }).hits)).toEqual([]);
  });

  it("small buttons stacked with no gap to spare share it evenly, and still never cover each other", () => {
    // Each gets its drawn height and half of each gap: below the 40 a form gets, but nothing is covered.
    const ui = render(`button "One" size=sm on=notify:1\nbutton "Two" size=sm on=notify:2\nbutton "Three" size=sm on=notify:3`, { width: 375, context: "chat" });
    expect(overreach(ui.hits)).toEqual([]);
    const [one, two, three] = ui.hits.filter((h) => h.focusable);
    const gap = drawn(two!).y - (drawn(one!).y + drawn(one!).h);
    expect(two!.box.h).toBeCloseTo(drawn(two!).h + gap, 5);
    expect(one!.box.h).toBe(ICON_TAP);
    expect(three!.box.h).toBe(ICON_TAP);
    console.info(`phone-targets: small buttons stacked ${gap} px apart get ${two!.box.h} px between their neighbours`);
  });

  it.each([320, 375])("at %i in a column's 6 px gaps, regular controls keep 40 and nothing is covered", (width) => {
    const ui = render(`state a="" plans=["Free","Pro"] plan="Pro" day="2026-11-20" view="Week" n=2
column
  input bind=a placeholder="Name"
  input bind=a placeholder="City"
  select bind=plan items=plans
  date-picker bind=day
  segmented bind=view options="Day,Week,Month" label="Period"
  stepper "Guests" bind=n min=1 max=9
  button "Book" on=notify:b
  button "Cancel" variant=secondary on=notify:c
  button "Note" size=sm on=notify:n
  button "Remove" size=sm on=notify:r`, { width, context: "chat" });
    expect(ui.diagnostics).toEqual([]);
    expect(overreach(ui.hits)).toEqual([]);
    const regular = ui.sayshape.theme.control.height;
    const lows: string[] = [];
    for (const h of ui.hits.filter((r) => r.focusable)) {
      // 34 px controls 6 apart: 34 + 3 + 3. Positions are fractional, so allow rounding.
      if (drawn(h).h >= regular) expect(h.box.h, name(h)).toBeGreaterThanOrEqual(TRIMMED_FLOOR - 1e-6);
      else if (h.box.h < TRIMMED_FLOOR) lows.push(`${name(h)} ${h.box.h.toFixed(1)}`);
    }
    // Below the floor, recorded for the PR: segmented options (drawn 28) and stacked small buttons (drawn 24).
    console.info(`phone-targets column ${width}: under 40 where 6 px gaps leave no room: ${lows.join(", ") || "none"}`);
  });

  it("presses from the grown area, and still from anywhere on the drawn box", () => {
    const ui = render(FORM, { width: 375, context: "chat" });
    const book = ui.find({ type: "button", text: "Book" }).box!;
    const region = ui.hits.find((h) => h.box.node.id === book.node.id)!;
    expect(region.ring).toBeDefined();
    expect(region.box.h).toBeGreaterThan(book.h);
    // Just above what's drawn, inside the grown area.
    ui.click(book.x + book.w / 2, region.box.y + 1);
    expect(ui.announcements.at(-1)?.text).toBe("booked");
    ui.click(book.x + 2, book.y + book.h - 1);
    expect(ui.announcements.at(-1)?.text).toBe("booked");
  });

  it("a stepper's buttons and a segmented control's options still press the right part", () => {
    const ui = render(FORM, { width: 375, context: "chat" });
    const inc = ui.hits.find((h) => h.detail === "inc")!;
    ui.click(inc.box.x + inc.box.w / 2, inc.box.y + 1);
    expect(ui.state.guests).toBe(3);
    const month = ui.hits.find((h) => h.detail === "Month")!;
    ui.click(month.box.x + month.box.w / 2, month.box.y + 1);
    expect(ui.state.view).toBe("Month");
  });

  it("at 600 and 1024 every region is what's drawn", () => {
    for (const width of [PHONE_WIDTH, 1024]) {
      const ui = render(FORM, { width, context: "chat" });
      for (const h of ui.hits) expect(h.ring, `${name(h)} at ${width}`).toBeUndefined();
      const book = ui.find({ type: "button", text: "Book" }).box!;
      const region = ui.hits.find((h) => h.box.node.id === book.node.id)!;
      expect({ x: region.box.x, y: region.box.y, w: region.box.w, h: region.box.h }).toEqual({ x: book.x, y: book.y, w: book.w, h: book.h });
    }
  });

  it("a default host (no context) measures as before: fields, buttons and segmented keep their sizes", () => {
    const ui = render(FORM, { width: 1024 });
    expect(ui.find({ type: "segmented" }).box!.h).toBe(36);
    expect(ui.find({ type: "button", text: "Book" }).box!.h).toBe(40);
    expect(ui.find({ type: "button", text: "Add a note" }).box!.h).toBe(32);
    // A label of 13 with 4 under it and a gap of 6, then a 40 px field.
    expect(ui.find({ type: "input", text: "Name" }).box!.h).toBe(13 + 4 + 6 + 40);
  });
});

const sameRect = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;

/** Records the boxes the engine's focus ring is drawn round, in place of drawing it. */
function ringsDrawn(): { boxes: Rect[]; stop(): void } {
  const proto = SayShape.prototype as unknown as { paintFocusRing(g: unknown, b: Rect): void };
  const boxes: Rect[] = [];
  const spy = vi.spyOn(proto, "paintFocusRing").mockImplementation((_g, b) => { boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h }); });
  return { boxes, stop: () => spy.mockRestore() };
}

describe("the focus ring", () => {
  it.each([375, 1024])("at %i goes round each control as drawn, not the larger area a finger can press", (width) => {
    const rings = ringsDrawn();
    try {
      const ui = render(FORM, { width, context: "chat" });
      const stops = ui.hits.filter((h) => h.focusable).length;
      for (let i = 0; i < stops; i++) {
        ui.tab();
        const last = rings.boxes.at(-1);
        expect(last, `a ring after ${i + 1} tabs`).toBeDefined();
        const focused = ui.hits.filter((h) => h.box.node.id === ui.focused?.id && h.focusable);
        expect(focused.some((h) => sameRect(drawn(h), last!)), `ring after ${i + 1} tabs, on ${focused.map(name).join(", ")}`).toBe(true);
      }
      const grown = ui.hits.filter((h) => h.ring);
      if (width < PHONE_WIDTH) {
        expect(grown.length).toBeGreaterThan(5);
        expect(rings.boxes.some((b) => grown.some((h) => sameRect(h.ring!, b)))).toBe(true);
        // Never round the grown area.
        expect(rings.boxes.some((b) => grown.some((h) => sameRect(h.box, b)))).toBe(false);
      } else {
        expect(grown).toEqual([]);
      }
    } finally {
      rings.stop();
    }
  });
});

/** A stand-in context that records each fill and stroke with its color, line width and alpha. */
function strokesOf(paint: (g: CanvasRenderingContext2D) => void): Array<{ op: string; color: string; width: number; alpha: number }> {
  const out: Array<{ op: string; color: string; width: number; alpha: number }> = [];
  let s = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1 };
  const stack: Array<typeof s> = [];
  const g = {
    get fillStyle() { return s.fillStyle; }, set fillStyle(v: string) { s.fillStyle = v; },
    get strokeStyle() { return s.strokeStyle; }, set strokeStyle(v: string) { s.strokeStyle = v; },
    get lineWidth() { return s.lineWidth; }, set lineWidth(v: number) { s.lineWidth = v; },
    get globalAlpha() { return s.globalAlpha; }, set globalAlpha(v: number) { s.globalAlpha = v; },
    save() { stack.push({ ...s }); },
    restore() { s = stack.pop() ?? s; },
    fill() { out.push({ op: "fill", color: s.fillStyle, width: 0, alpha: s.globalAlpha }); },
    stroke() { out.push({ op: "stroke", color: s.strokeStyle, width: s.lineWidth, alpha: s.globalAlpha }); },
  };
  paint(g as unknown as CanvasRenderingContext2D);
  return out;
}

describe("Hairline fields (paintField on lines surfaces)", () => {
  const chat = render(`state a=""\ninput "Name" bind=a`, { width: 1024, context: "chat" }).sayshape.theme;
  const host = render(`state a=""\ninput "Name" bind=a`, { width: 1024 }).sayshape.theme;

  it("in a chat: no fill, a 1 px outline in exactly the control color at rest", () => {
    expect(chat.surfaces).toBe("lines");
    expect(strokesOf((g) => paintField(g, chat, 0, 0))).toEqual([{ op: "stroke", color: chat.colors.control, width: 1, alpha: 1 }]);
  });

  it("firms the outline toward ink under the pointer", () => {
    const [hover] = strokesOf((g) => paintField(g, chat, 0, 1));
    expect(hover!.color).not.toBe(chat.colors.control);
    expect(hover!.width).toBe(1);
  });

  it("shows focus as a 2 px accent outline, with no halo", () => {
    const ops = strokesOf((g) => paintField(g, chat, 1, 0));
    expect(ops.filter((o) => o.op === "fill")).toEqual([]);
    expect(ops.filter((o) => o.color === chat.colors.accent).map((o) => o.width)).toEqual([2]);
  });

  it("on a default host keeps its fill, and the soft halo in focus", () => {
    expect(host.surfaces).toBeUndefined();
    const ops = strokesOf((g) => paintField(g, host, 1, 0));
    expect(ops[0]).toEqual({ op: "fill", color: host.colors.surface, width: 0, alpha: 1 });
    expect(ops.filter((o) => o.color === host.colors.accent).map((o) => o.width)).toEqual([6, 1.35]);
  });

  it("an input, a select and a date-picker in a chat fill nothing on the page", () => {
    const ui = render(`state a="" b="x" xs=["x","y"] d="2026-11-20"\ninput "Name" bind=a\nselect "Plan" bind=b items=xs\ndate-picker "Day" bind=d`, { width: 375, context: "chat" });
    const t = ui.sayshape.theme;
    expect(ui.drawOps.filter((op) => op.op === "fill" && op.fillStyle === t.colors.surface)).toEqual([]);
    expect(ui.drawOps.filter((op) => op.op === "stroke" && op.strokeStyle === t.colors.control).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the native editor's font", () => {
  const editorFont = (width: number, context?: "chat") => {
    const ui = render(`state a=""\ninput "Name" bind=a`, { width, ...(context ? { context } : {}) });
    ui.press("input");
    return ui.editor?.font ?? "";
  };

  it("is 16 px on a phone and 14 px on a desktop in a chat, so iOS never zooms in", () => {
    expect(editorFont(375, "chat")).toMatch(/\b16px\b/);
    expect(editorFont(1024, "chat")).toMatch(/\b14px\b/);
  });

  it("is 16 px on a default host at any width", () => {
    expect(editorFont(375)).toMatch(/\b16px\b/);
    expect(editorFont(1024)).toMatch(/\b16px\b/);
  });

  it("matches the field text drawn while it's closed", () => {
    for (const [width, size] of [[375, 16], [1024, 14]] as const) {
      const ui = render(`state a=""\ninput "Name" bind=a placeholder="Ada"`, { width, context: "chat" });
      expect(sizesOf(ui.sayshape.theme).fieldText).toBe(size);
      expect(ui.drawOps.find((op) => op.op === "fillText" && op.args[0] === "Ada")?.font).toMatch(new RegExp(`\\b${size}px\\b`));
    }
  });
});
