import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { tableValueTone, type TableGeometry } from "../src/components/table";
import { darkTheme, lightTheme, mixColors } from "../src/theme";

const themes = [lightTheme, darkTheme] as const;
const gradientFills = (ui: ReturnType<typeof render>) =>
  ui.drawOps.filter((op) => op.op === "fill" && op.gradientStops?.length === 2);

describe("premium card and table surfaces", () => {
  it.each(themes.map((t) => [t.name, t] as const))("uses theme-aware card gradients in %s", (_name, theme) => {
    const ui = render('card\n  text "Account overview" style=title\n  stat label="Revenue" value="$12,000"', { theme });
    const fills = gradientFills(ui);
    expect(fills.some((op) => op.gradientStops![0]!.color === theme.colors.raised &&
      op.gradientStops![1]!.color === (mixColors(theme.colors.raised, theme.colors.ink, 0.018) ?? theme.colors.raised))).toBe(true);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
  });

  it("gives explicit signed numeric data semantic colors without mislabeling ordinary numbers", () => {
    expect(tableValueTone("-$12.00", "money")).toBe("negative");
    expect(tableValueTone("−5.5", "number")).toBe("negative");
    expect(tableValueTone("+9", "number")).toBe("positive");
    expect(tableValueTone("$12.00", "money")).toBeNull();
    expect(tableValueTone("-17", "text")).toBeNull();
    expect(tableValueTone("—", "money")).toBeNull();
  });

  it("keeps table selection and sorting reactive with premium row accents", () => {
    const ui = render(
      'state positions=[{id:"a",name:"North",net:-24},{id:"b",name:"South",net:18}] pick="" by="name" dir="asc"\n' +
      'table items=positions key=id bind=pick sort=by direction=dir\n' +
      '  table-column "Region" field=name\n' +
      '  table-column "Net" field=net format=number',
    );
    const data = () => ui.find("table").box!.data as TableGeometry;
    expect(data().rows).toHaveLength(2);
    const selected = ui.hits.find((h) => h.detail === "row:s:b");
    expect(selected).toBeDefined();
    ui.click(selected!.box.x + selected!.box.w / 2, selected!.box.y + selected!.box.h / 2);
    expect(ui.state.pick).toBe("b");
    expect(data().rows.find((r) => r.key === "b")!.selected).toBe(true);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
  });
});

describe("premium controls and navigation", () => {
  it.each(themes.map((t) => [t.name, t] as const))("paints primary buttons with their own theme gradients in %s", (_n, theme) => {
    const ui = render('button "Save" on=emit:save', { theme });
    expect(gradientFills(ui).some((op) => op.gradientStops?.[0]?.color === theme.colors.accent &&
      op.gradientStops?.[1]?.color === (mixColors(theme.colors.accent, theme.colors.raised, 0.19) ?? theme.colors.accent))).toBe(true);
    ui.press({ type: "button", text: "Save" });
    expect(ui.emitted).toEqual([{ name: "save", value: undefined }]);
    ui.destroy();
  });

  it("keeps text inputs editable through the shared focus treatment", () => {
    const ui = render('state name=""\ninput "Name" bind=name placeholder="Your name"');
    expect(ui.diagnostics).toEqual([]);
    ui.type("input", "Ada");
    expect(ui.state.name).toBe("Ada");
    ui.destroy();
  });

  it("keeps segmented and tab values interactive", () => {
    const ui = render(
      'state period="Month" view="Overview"\n' +
      'segmented bind=period options="Month,Year"\n' +
      'tabs bind=view\n' +
      '  tab "Overview" value=Overview\n' +
      '    text "Overview content"\n' +
      '  tab "Details" value=Details\n' +
      '    text "Details content"',
    );
    const segmented = ui.hits.find((h) => h.box.node.type === "segmented" && h.detail === "Year");
    expect(segmented).toBeDefined();
    ui.click(segmented!.box.x + segmented!.box.w / 2, segmented!.box.y + segmented!.box.h / 2);
    expect(ui.state.period).toBe("Year");
    const tab = ui.hits.find((h) => h.box.node.type === "tabs" && h.detail === "Details");
    expect(tab).toBeDefined();
    ui.click(tab!.box.x + tab!.box.w / 2, tab!.box.y + tab!.box.h / 2);
    expect(ui.state.view).toBe("Details");
    expect(ui.text()).toContain("Details content");
    ui.destroy();
  });

  it("preserves select and date-picker parsing while using animated field focus", () => {
    const ui = render(
      'state picked="" due="" opts=["Basic","Premium"]\n' +
      'select "Plan" items=opts bind=picked\n' +
      'date-picker "Due" bind=due',
    );
    expect(ui.diagnostics).toEqual([]);
    expect(ui.find("select")).toBeDefined();
    expect(ui.find("date-picker")).toBeDefined();
    ui.destroy();
  });

  it("renders the premium components at narrow widths without invalid drawing alpha", () => {
    const spec =
      'state checked=false period="Week"\n' +
      'card\n' +
      '  text "Settings" style=title\n' +
      '  input "Search" bind=period\n' +
      '  check "Email" bind=checked\n' +
      '  button "Apply" on=emit:apply\n';
    for (const theme of themes) {
      const ui = render(spec, { width: 320, theme });
      expect(ui.diagnostics).toEqual([]);
      for (const op of ui.drawOps) expect(Number.isFinite(op.globalAlpha)).toBe(true);
      ui.destroy();
    }
  });
});
