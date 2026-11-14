import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { DESIGN_H, DESIGN_W, MIN_FIT, slideComponents } from "../src/components/slides";
import { render } from "../src/testing";
import type { Box, HitRegion } from "../src/types";
import { walkBoxes } from "../src/layout";
import { lightTheme } from "../src/theme";
import { Q3_REVIEW } from "../playground/slides-samples";

const ALL = [...coreComponents, ...slideComponents];
const on = (spec: string, width = 600) => render(spec, { components: ALL, width });

const boxesOf = (root: Box, type: string): Box[] => {
  const out: Box[] = [];
  walkBoxes(root, (b) => { if (b.node.type === type) out.push(b); });
  return out;
};
const slideBox = (ui: ReturnType<typeof on>) => boxesOf(ui.sayshape.boxes!, "slide")[0]!;
const region = (ui: ReturnType<typeof on>, detail: string): HitRegion => {
  const r = ui.hits.find((h) => h.box.node.type === "deck" && h.detail === detail);
  if (!r) throw new Error(`no deck region ${detail}`);
  return r;
};
const clickPart = (ui: ReturnType<typeof on>, detail: string) => {
  const b = region(ui, detail).box;
  ui.click(b.x + b.w / 2, b.y + b.h / 2);
};
const errors = (ui: ReturnType<typeof on>) => ui.diagnostics.filter((d) => d.severity === "error");

const items = (n: number) => Array.from({ length: n }, (_, i) => `      list-item "Item ${i + 1}" detail="Something about it"`).join("\n");
const deckOf = (body: string) => `state page=0\ndeck bind=page\n${body}`;

describe("slides behind their flag", () => {
  it("leaves deck and slide unknown when slideComponents aren't registered", () => {
    const ui = render(Q3_REVIEW, { components: coreComponents });
    const unknown = ui.diagnostics.filter((d) => /unknown element/i.test(d.message));
    expect(unknown.some((d) => d.message.includes('"deck"'))).toBe(true);
    ui.destroy();
  });

  it("parses a deck with no diagnostics", () => {
    const ui = on(Q3_REVIEW);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
  });

  it("refuses a slide outside a deck", () => {
    const ui = on(`slide "Lonely"\n  text "Hi"`);
    expect(ui.diagnostics.some((d) => d.line === 1)).toBe(true);
    ui.destroy();
  });
});

describe("streaming a deck", () => {
  it("parses and draws every line-boundary prefix of the sample deck", () => {
    const lines = Q3_REVIEW.split("\n");
    for (let n = 1; n <= lines.length; n++) {
      const ui = on(lines.slice(0, n).join("\n"));
      expect(errors(ui), `prefix of ${n} lines`).toEqual([]);
      expect(ui.sayshape.boxes, `prefix of ${n} lines`).not.toBeNull();
      ui.destroy();
    }
  });

  it("shows a finished slide and a half-written one as two slides", () => {
    const lines = Q3_REVIEW.split("\n");
    const second = lines.findIndex((l) => l.includes('slide "Three numbers'));
    // The first slide in full, then the second's title and only part of its grid.
    const ui = on(lines.slice(0, second + 4).join("\n"));
    expect(errors(ui)).toEqual([]);
    expect(ui.accessibility({ full: true }).children.length).toBeGreaterThan(0);
    expect(ui.isShown({ text: "Q3 business review" })).toBe(true);
    ui.set("page", 1);
    expect(ui.isShown({ text: "Three numbers that sum up the quarter" })).toBe(true);
    expect(ui.isShown({ type: "stat" })).toBe(true);
    ui.destroy();
  });
});

describe("a slide's frame", () => {
  it.each([360, 600, 960])("is 16:9 at %ipx", (width) => {
    const ui = on(Q3_REVIEW, width);
    const b = slideBox(ui);
    expect(b.w).toBeGreaterThan(0);
    expect(b.w / b.h).toBeCloseTo(16 / 9, 5);
    ui.destroy();
  });

  it("looks the same at every size: its children scale with its width", () => {
    const at = (width: number) => {
      const ui = on(deckOf(`  slide "Numbers"\n    stat label="Revenue" value="$4.82M"`), width);
      const s = slideBox(ui), st = boxesOf(ui.sayshape.boxes!, "stat")[0]!;
      const rel = [(st.x - s.x) / s.w, (st.y - s.y) / s.h, st.w / s.w, st.h / s.h];
      ui.destroy();
      return rel;
    };
    const small = at(360), large = at(960);
    small.forEach((v, i) => expect(v).toBeCloseTo(large[i]!, 3));
  });
});

describe("fitting content", () => {
  it("centres short content in the space under the title", () => {
    const ui = on(deckOf(`  slide "Short"\n    text "Just one line"`), 960);
    const s = slideBox(ui);
    const pad = (lightTheme.slide!.space.xl) * (s.w / DESIGN_W);
    const title = boxesOf(ui.sayshape.boxes!, "text")[0]!;
    const d = s.data as { title: { lines: string[]; lineHeight: number; top: number }; scale: number; fit: number };
    expect(d.fit).toBe(1);
    const titleBottom = s.y + (d.title.top + d.title.lines.length * d.title.lineHeight + lightTheme.slide!.space.lg) * d.scale;
    const above = title.y - titleBottom;
    const below = s.y + s.h - pad - (title.y + title.h);
    expect(above).toBeGreaterThan(10);
    expect(above).toBeCloseTo(below, 3);
    ui.destroy();
  });

  it("scales tall content down to fit, without a warning", () => {
    const ui = on(deckOf(`  slide "Tall"\n    list\n${items(6)}`), 960);
    const s = slideBox(ui);
    const d = s.data as { fit: number; clipped: boolean };
    expect(d.fit).toBeLessThan(1);
    expect(d.fit).toBeGreaterThanOrEqual(MIN_FIT);
    expect(d.clipped).toBe(false);
    const list = boxesOf(ui.sayshape.boxes!, "list")[0]!;
    expect(list.y + list.h).toBeLessThanOrEqual(s.y + s.h + 0.5);
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("cuts off content too tall for 60% and warns once to split the slide", () => {
    const ui = on(deckOf(`  slide "Far too much"\n    list\n${items(30)}\n  slide "Next"`), 600);
    const d = slideBox(ui).data as { fit: number; clipped: boolean };
    expect(d.fit).toBe(MIN_FIT);
    expect(d.clipped).toBe(true);
    clickPart(ui, "next");
    clickPart(ui, "prev");
    ui.set("other", 1);
    const split = ui.warnings.filter((w) => /Split it into two slides/.test(w));
    expect(split).toHaveLength(1);
    expect(split[0]).toContain("Far too much");
    ui.destroy();
  });
});

describe("moving between slides", () => {
  const three = deckOf(`  slide "One"\n    text "a"\n  slide "Two"\n    text "b"\n  slide "Three"\n    text "c"`);

  it("goes next and back with the arrows, and stops at the ends", () => {
    const ui = on(three);
    clickPart(ui, "prev");
    expect(ui.state.page).toBe(0);
    clickPart(ui, "next");
    expect(ui.state.page).toBe(1);
    clickPart(ui, "next");
    clickPart(ui, "next");
    expect(ui.state.page).toBe(2);
    clickPart(ui, "prev");
    expect(ui.state.page).toBe(1);
    clickPart(ui, "slide:0");
    expect(ui.state.page).toBe(0);
    ui.destroy();
  });

  it("moves with Left, Right, Home and End while it has focus, and stops at the ends", () => {
    const ui = on(three);
    ui.tab();
    expect(ui.focused?.type).toBe("deck");
    ui.key("ArrowLeft");
    expect(ui.state.page).toBe(0);
    ui.key("ArrowRight");
    expect(ui.state.page).toBe(1);
    ui.key("End");
    expect(ui.state.page).toBe(2);
    ui.key("ArrowRight");
    expect(ui.state.page).toBe(2);
    ui.key("Home");
    expect(ui.state.page).toBe(0);
    ui.destroy();
  });

  it("names the current slide and where it is to screen readers", () => {
    const ui = on(three);
    ui.set("page", 1);
    const deck = JSON.stringify(ui.accessibility({ full: true }));
    expect(deck).toContain("Two");
    expect(deck).toContain("Slide 2 of 3");
    expect(deck).toContain("Previous slide");
    expect(deck).toContain("Next slide");
    ui.destroy();
  });

  it("keeps the slide in a path, like settings.page", () => {
    const ui = on(`state settings={page: 0}\ndeck bind=settings.page\n  slide "One"\n  slide "Two"`);
    clickPart(ui, "next");
    expect(ui.state.settings).toMatchObject({ page: 1 });
    expect(ui.isShown({ text: "Two" })).toBe(true);
    ui.destroy();
  });

  it("runs on= after the slide changes", () => {
    const ui = on(`state page=0 moves=0\ndeck bind=page on=inc:moves\n  slide "One"\n  slide "Two"`);
    clickPart(ui, "next");
    expect(ui.state).toMatchObject({ page: 1, moves: 1 });
    ui.destroy();
  });

  it("numbers slides in their corner unless numbers=false", () => {
    const drawn = (spec: string) => {
      const ui = on(spec);
      const texts = ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
      ui.destroy();
      return texts;
    };
    expect(drawn(three)).toContain("1 / 3");
    expect(drawn(three.replace("deck bind=page", "deck bind=page numbers=false"))).not.toContain("1 / 3");
  });
});

describe("controls inside a scaled slide", () => {
  const spec = `state page=0 count=0\ndeck bind=page\n  slide "Counter"\n    button "Add one" on=inc:count`;

  it("are pressed where they're drawn", () => {
    const ui = on(spec, 360);
    const s = slideBox(ui);
    expect((s.data as { scale: number }).scale).toBeLessThan(0.5);
    const button = boxesOf(ui.sayshape.boxes!, "button")[0]!;
    // Its region is where it's drawn: inside the slide, scaled with it.
    const hit = ui.hits.find((h) => h.box.node.type === "button")!;
    expect(hit.box.x).toBeCloseTo(button.x, 3);
    expect(hit.box.x + hit.box.w).toBeLessThanOrEqual(s.x + s.w);
    ui.press({ type: "button" });
    expect(ui.state.count).toBe(1);
    // Handlers still get the button as it was laid out, at design size.
    expect(hit.local!.box.w).toBeGreaterThan(hit.box.w * 2);
    ui.destroy();
  });

  it("are reached with Tab and pressed with Enter", () => {
    const ui = on(spec, 360);
    for (let i = 0; i < 6 && ui.focused?.type !== "button"; i++) ui.tab();
    expect(ui.focused?.type).toBe("button");
    ui.key("Enter");
    expect(ui.state.count).toBe(1);
    ui.destroy();
  });

  it("put the screen reader's node for a control where it's drawn", () => {
    const ui = on(spec, 360);
    const s = slideBox(ui);
    const tree = ui.accessibility({ full: true });
    const find = (n: typeof tree): typeof tree | undefined => n.role === "button" && n.name === "Add one" ? n : n.children.map(find).find(Boolean);
    const node = find(tree)!;
    expect(node.rect.x).toBeGreaterThanOrEqual(s.x);
    expect(node.rect.x + node.rect.w).toBeLessThanOrEqual(s.x + s.w + 0.5);
    ui.destroy();
  });

  it("open a select's options by the select, as it's drawn", () => {
    const ui = on(`state page=0 pick="" teams=[{id: "eng", name: "Engineering"}, {id: "sales", name: "Sales"}]\ndeck bind=page\n  slide "Pick"\n    select "Team" items=teams value=id label=name bind=pick`, 360);
    ui.press({ type: "select" });
    const area = ui.popup?.area;
    const sel = boxesOf(ui.sayshape.boxes!, "select")[0]!;
    expect(area).toBeTruthy();
    expect(Math.abs(area!.x - sel.x)).toBeLessThan(2);
    expect(area!.y).toBeGreaterThanOrEqual(sel.y + sel.h - 2);
    ui.destroy();
  });

  it("lay out at the design width whatever the real width", () => {
    const ui = on(spec, 360);
    const hit = ui.hits.find((h) => h.box.node.type === "button")!;
    const laidSlide = hit.local!.transform;
    expect(laidSlide.scale).toBeCloseTo(360 / DESIGN_W, 1);
    expect(DESIGN_H / DESIGN_W).toBeCloseTo(9 / 16, 5);
    ui.destroy();
  });
});
