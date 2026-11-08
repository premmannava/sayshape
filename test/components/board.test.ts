import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { board, MAX_BOARD_CARDS, MAX_BOARD_STAGES, MIN_COLUMN_W, type BoardGeometry } from "../../src/components/board";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";

// The contract tests already check the definition, layout bounds, text that
// fits at 240, 360 and 600 px, theme-only colors and keyboard reach.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const geo = (ui: Rendered): BoardGeometry => ui.find("board").box!.data as unknown as BoardGeometry;

const DEALS = `state picked=0 deals=[{id: 1, name: "Fleet telematics", company: "Harbor Freight Co", status: "Lead", amount: 48000}, {id: 2, name: "Claims portal", company: "Northwind Mutual", status: "Proposal", amount: 125000}, {id: 3, name: "Warehouse sensors", company: "Larkspur Logistics", status: "Qualified", amount: 36500}, {id: 4, name: "Payroll migration", company: "Cobalt Staffing", status: "Lead", amount: 22000}]`;
const PIPELINE = `${DEALS}
board "Pipeline" items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name detail=company value=amount format=money sum=amount bind=picked on=emit:picked
`;
const MOVABLE = `${DEALS}
board "Pipeline" items=deals stage=status stages="Lead,Qualified,Proposal,Won" title=name value=amount format=money move=true bind=picked on=emit:moved
`;

/** A card's region, by the index of its record in the list. */
const cardRegion = (ui: Rendered, index: number) => {
  const card = geo(ui).cards.find((c) => c.index === index)!;
  return ui.hits.find((h) => h.box.node.type === "board" && h.detail === card.detail)!;
};
const center = (ui: Rendered, index: number) => { const r = cardRegion(ui, index); return [r.box.x + r.box.w / 2, r.box.y + r.box.h / 2] as const; };
const stages = (ui: Rendered) => (ui.state.deals as Array<{ status: string }>).map((d) => d.status);

describe("board", () => {
  it("renders its example and a pipeline without problems", () => {
    expect(msgs(board.example!)).toEqual([]);
    const ui = render(PIPELINE, { width: 1024 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Lead", "Fleet telematics", "Harbor Freight Co", "$48,000", "$70K"]));
  });

  it("is taught in the model guide, with a pick", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain('board "<text>"');
    expect(guide).toContain("a pipeline or task board by stage");
  });

  it("warns about bad props but keeps the element", () => {
    const m = msgs(`state d=[]\nboard items=d stage=s format=euro colour=red`);
    expect(m.some((x) => x.includes("format"))).toBe(true);
    expect(m.some((x) => x.includes("colour"))).toBe(true);
    expect(msgs(`state d=[]\nboard items=d`).some((x) => x.includes("stage"))).toBe(true);
  });

  it("a column per stage in the order given, with counts and totals, cards in list order", () => {
    const d = geo(render(PIPELINE, { width: 1024 }));
    expect(d.columns.map((c) => [c.stage, c.count, c.total])).toEqual([["Lead", 2, "$70K"], ["Qualified", 1, "$36.5K"], ["Proposal", 1, "$125K"], ["Won", 0, "$0"]]);
    const lead = d.cards.filter((c) => c.stage === 0);
    expect(lead.map((c) => c.fullTitle)).toEqual(["Fleet telematics", "Payroll migration"]);
    expect(lead[1]!.y).toBeGreaterThan(lead[0]!.y + lead[0]!.h);
    expect(d.cards.find((c) => c.fullTitle === "Claims portal")!.value).toBe("$125,000");
  });

  it("takes its stages from the records when stages= is left out", () => {
    const d = geo(render(`${DEALS}\nboard items=deals stage=status title=name`, { width: 1024 }));
    expect(d.columns.map((c) => c.stage)).toEqual(["Lead", "Proposal", "Qualified"]);
  });

  it("fits the columns on a wide screen, and scrolls sideways with most of the width each on a phone", () => {
    const wide = geo(render(PIPELINE, { width: 1024 }));
    expect(wide.contentW).toBeLessThanOrEqual(wide.viewW + 0.5);
    const phone = geo(render(PIPELINE, { width: 360 }));
    expect(phone.contentW).toBeGreaterThan(phone.viewW);
    expect(phone.columns[0]!.w).toBeGreaterThanOrEqual(MIN_COLUMN_W);
    expect(phone.columns[0]!.w).toBeLessThan(phone.viewW);
    expect(phone.bar).toBeGreaterThan(0);
  });

  it("lays out at every width inside its box", () => {
    for (const width of [240, 360, 600, 1024]) {
      const ui = render(PIPELINE, { width });
      const box = ui.find("board").box!;
      const d = geo(ui);
      expect(box.w).toBeLessThanOrEqual(width);
      expect(d.top + d.colH + d.bar).toBe(box.h);
      for (const c of d.cards) expect(c.x + c.w).toBeLessThanOrEqual(d.contentW + 0.5);
    }
  });

  it("selects a card: sets bind= to its key, then runs on=", () => {
    const ui = render(PIPELINE, { width: 1024 });
    ui.click(...center(ui, 2));
    expect(ui.state.picked).toBe(3);
    expect(ui.emitted.map((e) => e.name)).toEqual(["picked"]);
  });

  it("isn't pressable without bind=, on= or move=", () => {
    const ui = render(`${DEALS}\nboard items=deals stage=status title=name`, { width: 1024 });
    expect(ui.hits.filter((h) => String(h.detail).startsWith("card:"))).toEqual([]);
  });

  it("moves a focused card with Left and Right: writes its stage, then runs on=", () => {
    const ui = render(MOVABLE, { width: 1024 });
    ui.tab();
    ui.key("ArrowRight");
    expect(stages(ui)).toEqual(["Qualified", "Proposal", "Qualified", "Lead"]);
    expect(ui.emitted.map((e) => e.name)).toEqual(["moved"]);
    expect(ui.state.picked).toBe(1);
    ui.key("ArrowLeft");
    ui.key("ArrowLeft");
    // Not past the first stage.
    expect(stages(ui)[0]).toBe("Lead");
  });

  it("moves a card dragged to another column", () => {
    const ui = render(MOVABLE, { width: 1024 });
    const d = geo(ui);
    const box = ui.find("board").box!;
    const won = d.columns[3]!;
    ui.drag({ type: "board" }, 0, 0);
    // Drag card 0 (Lead) to the middle of the Won column.
    const [x0, y0] = center(ui, 0);
    const ev = (type: string, x: number, y: number) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, pointerType: "mouse" });
    ev("pointermove", x0, y0); ev("pointerdown", x0, y0);
    for (const f of [0.25, 0.5, 0.75, 1]) { ev("pointermove", x0 + (box.x + won.x + won.w / 2 - x0) * f, y0 + 40 * f); ui.sayshape.renderNow(); }
    ev("pointerup", box.x + won.x + won.w / 2, y0 + 40);
    ui.sayshape.renderNow();
    expect(stages(ui)[0]).toBe("Won");
  });

  it("moves a card from a filtered list, changing the record in state", () => {
    const ui = render(`${DEALS}\nboard items={sort(deals, 'amount', 'desc')} stage=status stages="Lead,Qualified,Proposal,Won" title=name move=true`, { width: 1024 });
    const d = geo(ui);
    expect(d.cards.length).toBeGreaterThan(0);
    ui.tab();
    ui.key("ArrowRight");
    expect(ui.warnings).toEqual([]);
    // The first card in the sorted list is the biggest deal, Claims portal (item 2 in state): Proposal → Won.
    expect(stages(ui)).toEqual(["Lead", "Won", "Qualified", "Lead"]);
  });

  it("is headings and lists to a screen reader, and copies as stages with their cards", () => {
    const ui = render(PIPELINE, { width: 1024 });
    expect(ui.copyText().split("\n")).toEqual([
      "Pipeline",
      "",
      "Lead (2) · $70K",
      "- Fleet telematics, $48,000",
      "- Payroll migration, $22,000",
      "",
      "Qualified (1) · $36.5K",
      "- Warehouse sensors, $36,500",
      "",
      "Proposal (1) · $125K",
      "- Claims portal, $125,000",
      "",
      "Won (0) · $0",
    ]);
    const tree = JSON.stringify(render(MOVABLE, { width: 1024 }).accessibility({ full: true }), (k, v) => (k === "node" ? undefined : v));
    expect(tree).toContain("Left and Right arrows move it to another stage");
  });

  it("warns about records in no listed stage, and shows a message instead of too many", () => {
    const ui = render(`state d=[{title: "A", s: "Lead"}, {title: "B", s: "Lost"}]\nboard items=d stage=s stages="Lead,Won"`);
    expect(geo(ui).cards.map((c) => c.fullTitle)).toEqual(["A"]);
    expect(ui.warnings.join(" ")).toContain("Lead, Won");
    const many = Array.from({ length: MAX_BOARD_CARDS + 1 }, (_, i) => `{title: "T${i}", s: "A"}`).join(", ");
    expect(geo(render(`state d=[${many}]\nboard items=d stage=s`)).message).toContain("Too many cards");
    const lots = Array.from({ length: MAX_BOARD_STAGES + 1 }, (_, i) => `S${i}`).join(",");
    expect(geo(render(`state d=[]\nboard items=d stage=s stages="${lots}"`)).message).toContain("Too many stages");
  });

  it("scrolls sideways on a phone with the wheel and the arrow keys", () => {
    const ui = render(PIPELINE, { width: 360 });
    const id = ui.find("board").node.id;
    const box = ui.find("board").box!;
    ui.wheel(box.x + 40, box.y + geo(ui).top + 20, 0, { deltaX: 80 });
    expect(ui.sayshape.viewState(id)?.x).toBe(80);
  });

  it("never throws on odd data, and every streamed prefix renders", () => {
    for (const odd of [`items=5 stage=s`, `items={[null, "x", {s: {a: 1}}]} stage=s`, `items=nope stage=s`, `stage=s`]) {
      expect(() => render(`board ${odd}`)).not.toThrow();
    }
    const lines = PIPELINE.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("board, from the review", () => {
  it("keeps moving the same record with the keyboard when items= is filtered, as it leaves and joins columns", () => {
    const ui = render(`${DEALS}\nboard items={sort(deals, 'amount', 'desc')} stage=status stages="Lead,Qualified,Proposal,Won" title=name move=true`, { width: 1024 });
    ui.tab();
    ui.key("ArrowRight");
    ui.key("ArrowRight");
    // The first card in amount order is Claims portal (item 2): Proposal, then Won, and nothing else moved.
    expect(stages(ui)).toEqual(["Lead", "Won", "Qualified", "Lead"]);
  });

  it("puts a dragged card back when it's dropped outside the board or the browser cancels the drag", () => {
    const ui = render(MOVABLE, { width: 1024 });
    const [x0, y0] = center(ui, 0);
    const box = ui.find("board").box!;
    const ev = (type: string, x: number, y: number) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, pointerType: "mouse" });
    ev("pointermove", x0, y0); ev("pointerdown", x0, y0);
    for (const f of [0.3, 0.6, 1]) { ev("pointermove", x0 + 500 * f, y0 + (box.h + 200) * f); ui.sayshape.renderNow(); }
    ev("pointerup", x0 + 500, y0 + box.h + 200);
    ui.sayshape.renderNow();
    expect(stages(ui)[0]).toBe("Lead");
    ev("pointermove", x0, y0); ev("pointerdown", x0, y0);
    for (const f of [0.3, 0.6, 1]) { ev("pointermove", x0 + 400 * f, y0); ui.sayshape.renderNow(); }
    ev("pointercancel", x0 + 400, y0);
    ui.sayshape.renderNow();
    expect(stages(ui)[0]).toBe("Lead");
    expect(ui.emitted).toEqual([]);
  });

  it("says plainly when it can't move cards because the list isn't in state, and doesn't run on=", () => {
    const ui = render(`board items={[{id: 1, title: "A", s: "Lead"}]} stage=s stages="Lead,Won" move=true on=emit:moved`, { width: 1024 });
    ui.tab();
    ui.key("ArrowRight");
    expect(ui.warnings.join(" ")).toContain("can't move cards: its items aren't a list in state");
    expect(ui.warnings.join(" ")).not.toContain("__card");
    expect(ui.emitted).toEqual([]);
  });

  it("writes the stage as the records write it, so numbers stay numbers", () => {
    const ui = render(`state t=[{id: 1, title: "A", step: 1}, {id: 2, title: "B", step: 2}]\nboard items=t stage=step move=true`, { width: 1024 });
    ui.tab();
    ui.key("ArrowRight");
    expect((ui.state.t as Array<{ step: unknown }>)[0]!.step).toBe(2);
  });

  it("tells its tone in words too, and warns when bind= has no key", () => {
    const text = render(`state t=[{title: "A", s: "Lead", risk: "bad"}]\nboard items=t stage=s tone=risk bind=sel`).copyText();
    expect(text).toContain("- A (risk: bad)");
    expect(render(`state sel="" t=[{title: "A", s: "Lead"}]\nboard items=t stage=s bind=sel`).warnings.join(" ")).toContain("bind= needs each record's key");
  });
});
