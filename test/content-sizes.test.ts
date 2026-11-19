import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import type { ChartGeometry } from "../src/components/chart-kit";
import { plotHeight } from "../src/components/chart-kit";
import { render } from "../src/testing";
import { DEFAULT_SIZES, lightTheme, sizesOf } from "../src/theme";
import { exampleSpec } from "./examples";
import { textOverflows } from "./overflow";

const ROWS = `state rows=[{m: "Jan", v: 4}, {m: "Feb", v: 9}, {m: "Mar", v: 6}]`;

const CONTENT = `${ROWS}
row
  stat label="Monthly recurring revenue across all regions" value="$1,234" change="+12%"
  stat label="Churn" value="2.1%" change="-0.4%" spark={[1, 3, 2, 5]} detail="Last 30 days"
badge "Shipped" tone=good
callout "Rock is 47% of revenue" detail="Up from 41% last year" icon=true action="See breakdown" on=emit:open
empty "No results" detail="Try a wider price range." action="Clear filters" on=emit:clear
chart kind=bar items=rows x=m y=v title="Sales"`;

/** Charts side by side: narrow enough that every plot is at its shortest. */
const narrowCharts = (n: number) => `${ROWS}
grid columns=${n} min=40
${Array.from({ length: n }, () => "  chart kind=bar items=rows x=m y=v").join("\n")}`;

const plotsOf = (ui: ReturnType<typeof render>): number[] =>
  ui.findAll("chart").map((f) => (f.box!.data as unknown as ChartGeometry).plot.h);

/** The size of the font a piece of text was drawn in. */
function fontSizeOf(ui: ReturnType<typeof render>, text: string): number {
  const op = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === text);
  if (!op) throw new Error(`"${text}" wasn't drawn`);
  return Number(/(\d+(?:\.\d+)?)px/.exec(op.font)![1]);
}

describe("content sizes in a chat", () => {
  it("are compact on a phone: stat label 12, badge 20, shortest plot 120", () => {
    const ui = render(CONTENT, { context: "chat", width: 375 });
    expect(sizesOf(ui.sayshape.theme)).toMatchObject({ statLabel: 12, pill: 18, badge: 20, calloutAction: 28, calloutIcon: 16, emptyIcon: 32, emptyButton: 34, emptyPad: 12, plotMin: 120 });
    expect(fontSizeOf(ui, "Churn")).toBe(12);
    expect(ui.find("badge").box!.h).toBe(20);
    expect(plotHeight(200, ui.sayshape.theme)).toBe(120);
    // A chart keeps 200 px across (a narrower row puts it on its own line), so a plot as short as it gets is on a 240 px phone.
    const narrow = render(narrowCharts(1), { context: "chat", width: 240 });
    expect(plotsOf(narrow)).toEqual([120]);
    ui.destroy();
    narrow.destroy();
  });

  it("keep the shortest plot at 144 on a desktop", () => {
    const ui = render(narrowCharts(4), { context: "chat", width: 1024 });
    expect(sizesOf(ui.sayshape.theme).plotMin).toBe(144);
    expect(plotsOf(ui)).toEqual([144, 144, 144, 144]);
    ui.destroy();
  });

  it("make a callout's action and an empty state's button their sizes", () => {
    const ui = render(CONTENT, { context: "chat", width: 375 });
    const action = ui.hits.find((h) => h.box.node.type === "callout" && h.detail === "action")!;
    expect(action.box.h).toBeGreaterThanOrEqual(28);
    const callout = ui.find("callout").box!;
    const desk = render(CONTENT, { width: 375 });
    expect(callout.h).toBeLessThan(desk.find("callout").box!.h);
    // The empty state: padding, tray, gap, words, gap, button, padding.
    for (const [r, s] of [[ui, { icon: 32, button: 34, pad: 12 }], [desk, { icon: 40, button: 36, pad: 24 }]] as const) {
      const box = r.find("empty").box!;
      const d = box.data as unknown as { title: string[]; detail: string[]; titleLH: number; detailLH: number };
      expect(box.h).toBe(s.pad + s.icon + 14 + d.title.length * d.titleLH + 4 + d.detail.length * d.detailLH + 18 + s.button + s.pad);
      expect(r.hits.find((h) => h.box.node.type === "empty" && h.detail === "action")!.box.h).toBeGreaterThanOrEqual(s.button);
    }
    ui.destroy();
    desk.destroy();
  });

  it.each([240, 320, 360, 375, 600, 1024])("keep their text and parts inside their boxes at %ipx", (width) => {
    for (const spec of [CONTENT, narrowCharts(2), ...["stat", "badge", "callout", "empty", "chart"].map((t) => exampleSpec(coreComponents.find((d) => d.type === t)!, coreComponents))]) {
      const ui = render(spec, { context: "chat", width });
      expect(textOverflows(ui.sayshape.boxes!, ui.drawOps), spec).toEqual([]);
      // Pressable parts (a callout's action, an empty state's button) stay inside their element.
      for (const h of ui.hits) {
        const owner = ui.findAll(h.box.node.type).find((f) => f.node.id === h.box.node.id)?.box;
        if (!owner || h.detail === "tip") continue;
        expect(h.box.y + h.box.h, `${h.box.node.type} part at ${width}px`).toBeLessThanOrEqual(owner.y + owner.h + 0.5);
        expect(h.box.x + h.box.w, `${h.box.node.type} part at ${width}px`).toBeLessThanOrEqual(owner.x + owner.w + 0.5);
      }
      ui.destroy();
    }
  });
});

describe("content sizes for a default host", () => {
  it("are today's", () => {
    const ui = render(CONTENT, { width: 375 });
    expect(sizesOf(ui.sayshape.theme)).toEqual(DEFAULT_SIZES);
    expect(DEFAULT_SIZES).toMatchObject({ statLabel: 13, pill: 20, badge: 22, calloutAction: 30, calloutIcon: 18, emptyIcon: 40, emptyButton: 36, emptyPad: 24, plotMin: 144 });
    expect(fontSizeOf(ui, "Churn")).toBe(13);
    expect(ui.find("badge").box!.h).toBe(22);
    expect(plotHeight(200, lightTheme)).toBe(144);
    const narrow = render(narrowCharts(1), { width: 240 });
    expect(plotsOf(narrow)).toEqual([144]);
    ui.destroy();
    narrow.destroy();
  });

  // Heights measured before the sizes became tokens: a default host's layouts mustn't move.
  it.each([
    [375, { stat: [97, 142], badge: 22, callout: 98, empty: 202, chart: 174 }],
    [1024, { stat: [54, 116], badge: 22, callout: 98, empty: 202, chart: 268 }],
  ] as const)("lay out as before at %ipx", (width, want) => {
    const ui = render(CONTENT, { width });
    const got = {
      stat: ui.findAll("stat").map((f) => f.box!.h),
      badge: ui.find("badge").box!.h,
      callout: ui.find("callout").box!.h,
      empty: ui.find("empty").box!.h,
      chart: ui.find("chart").box!.h,
    };
    expect(got).toEqual(want);
    ui.destroy();
  });
});
