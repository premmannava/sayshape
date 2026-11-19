/**
 * segmented over a number: options are text, but options="15,20,30" over years=30 shows 30 as
 * chosen and writes 15, not "15", so formulas like range(1, years + 1) keep working.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";

type UI = ReturnType<typeof render>;

/** Press one option of the nth segmented control by its text. */
function choose(ui: UI, which: number, option: string): void {
  const nodes = [...new Set(ui.hits.filter((h) => h.box.node.type === "segmented").map((h) => h.box.node))];
  const node = nodes[which]!;
  const hits = ui.hits.filter((h) => h.box.node === node);
  const i = String(node.props.options).split(",").indexOf(option);
  const hit = hits.find((h) => h.detail === i) ?? hits[i]!;
  ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
}

/** The option a segmented control tells screen readers is checked. */
function checked(ui: UI): string | undefined {
  type A = ReturnType<UI["accessibility"]>;
  const find = (n: A): A | undefined => (n.role === "radiogroup" ? n : n.children.map(find).find(Boolean));
  const group = find(ui.accessibility({ full: true }));
  return group?.children.find((c) => c.checked)?.name;
}

const SPEC = `state years=30 view="Week"
derive plan={range(1, years + 1)}
segmented bind=years label="Term" options="15,20,30"
segmented bind=view label="View" options="Week,Month"
text "n={len(plan)}"`;

const drawn = (ui: UI, text: string) => ui.drawOps.some((o) => o.op === "fillText" && o.args[0] === text);

describe("segmented over a number", () => {
  it("shows the bound number as chosen, not the first option", () => {
    const ui = render(`state years=30\nsegmented bind=years label="Term" options="15,20,30"`, { width: 400 });
    expect(checked(ui)).toBe("30");
  });

  it("writes a number when it holds a number, and text when it holds text", () => {
    const ui = render(SPEC, { width: 500 });
    choose(ui, 0, "15");
    choose(ui, 1, "Month");
    expect(ui.state.years).toBe(15);
    expect(ui.state.view).toBe("Month");
    expect(drawn(ui, "n=15")).toBe(true);
  });

  it("keeps working after several picks, back to the first value", () => {
    const ui = render(SPEC, { width: 500 });
    for (const pick of ["20", "15", "30"]) choose(ui, 0, pick);
    expect(ui.state.years).toBe(30);
    expect(drawn(ui, "n=30")).toBe(true);
  });

  it("keeps text for a text value that looks like a number", () => {
    const ui = render(`state code="10"\nsegmented bind=code label="Code" options="10,20"`, { width: 400 });
    choose(ui, 0, "20");
    expect(ui.state.code).toBe("20");
  });
});
