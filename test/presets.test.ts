import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { asksForFullGuide, generateReport, generateSpec, sayShapeLineTest } from "../src/model";
import { parse } from "../src/parser";
import { expandPresets, humanize, REPORT_EXAMPLE } from "../src/presets/report";
import { guideSections, languageGuide, REPORT_FALLBACK } from "../src/prompt";
import { Registry } from "../src/registry";
import { render } from "../src/testing";
import type { Value } from "../src/types";
import { fakeModel } from "./fake-model";

const registry = new Registry(coreComponents);
const claims = [
  { id: "C-1", opened: "2025-01-04", line: "Auto", status: "Open", incurred: 1200, days: 4 },
  { id: "C-2", opened: "2025-02-11", line: "Marine", status: "Closed", incurred: 5300, days: 30 },
  { id: "C-3", opened: "2025-02-20", line: "Auto", status: "Open", incurred: 800, days: 12 },
];
const monthly = [{ month: "Jan", opened: 1, closed: 0 }, { month: "Feb", opened: 2, closed: 1 }];
const REPORT = `report "Claims review" subtitle="2025" data=claims filter=status
  count
  sum incurred
  avg days
  count status=Open
  bar monthly month opened
  line monthly month opened closed
  donut line
  table
`;
const withData = (spec: string, opts: { width?: number } = {}) => {
  const ui = render("", { presets: true, ...opts });
  ui.set("claims", claims as unknown as Value);
  ui.set("monthly", monthly as unknown as Value);
  ui.setSpec(spec);
  ui.sayshape.renderNow();
  return ui;
};

describe("report preset: expansion", () => {
  it("leaves a spec without a report exactly as it is", () => {
    const src = 'card\n  text "Hi"\n';
    const x = expandPresets(src, { value: () => undefined, known: () => false });
    expect(x.expanded).toBe(false);
    expect(x.text).toBe(src);
  });

  it("is off unless asked for: report stays an unknown element", () => {
    const r = parse(REPORT, registry, { knownNames: ["claims", "monthly"] });
    expect(r.diagnostics[0]!.message).toMatch(/Unknown element "report"/);
    expect(r.presets).toBeUndefined();
  });

  it("draws every part as ordinary elements, with no problems", () => {
    const ui = withData(REPORT);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.findAll("stat").filter((f) => f.box)).toHaveLength(4);
    expect(ui.findAll("chart").map((f) => f.node.props.kind)).toEqual(["bar", "line", "donut"]);
    expect(ui.findAll("table-column").map((f) => f.node.text)).toEqual(["ID", "Opened", "Line", "Status", "Incurred", "Days"]);
    expect(ui.findAll("table-column").find((f) => f.node.props.field === "incurred")!.node.props.format).toBe("money");
    const text = ui.copyText();
    expect(text).toContain("Claims: 3");
    expect(text).toContain("Total incurred: $7.3K");
    expect(text).toContain("Open: 2");
    expect(text).toContain("C-3");
  });

  it("filters the figures, grouped charts and table by the chosen values", () => {
    const ui = withData(REPORT);
    ui.set("reportStatus", ["Closed"] as unknown as Value);
    const text = ui.copyText();
    expect(text).toContain("Claims: 1");
    expect(text).not.toContain("C-1");
    expect(text).toContain("C-2");
  });

  it("can be read: the expansion is ordinary SayShape that parses cleanly on its own", () => {
    const ui = withData(REPORT);
    const expanded = ui.sayshape.expandedSpec;
    expect(expanded).toMatch(/^state reportStatus=\[\]/);
    expect(expanded).toContain('chart "Opened and closed by month" kind=line items=monthly x=month y=opened,closed');
    expect(expanded).toContain("items={group(reportRows, 'line')} x=line y=count");
    const plain = parse(expanded, registry, { knownNames: ["claims", "monthly"] });
    expect(plain.diagnostics).toEqual([]);
  });

  it("keeps the spec's own line numbers and stable ids for what a report makes", () => {
    const r = parse(REPORT + 'text "After"\nstate claims=[{id: "A", amount: 1}]\nstate monthly=[{month: "Jan", opened: 1, closed: 0}]\n', registry, { presets: true });
    const after = r.root.children.find((n) => n.text === "After")!;
    expect(after.line).toBe(10);
    expect(after.id).toBe("10:text");
    const ids = new Set<string>();
    const walk = (n: typeof r.root) => { expect(ids.has(n.id)).toBe(false); ids.add(n.id); n.children.forEach(walk); };
    walk(r.root);
    expect([...ids].some((id) => id.startsWith("1.") || id.startsWith("1:"))).toBe(true);
    expect(r.state.find((s) => s.key === "claims")!.line).toBe(11);
  });

  it("says what's wrong on the line that's wrong", () => {
    const r = parse(`report "X" data=claims\n  count\n  wiggle amount\n  sum nope\n`, registry, { presets: true, presetValue: (n) => (n === "claims" ? claims : undefined), knownNames: ["claims"] });
    expect(r.diagnostics.map((d) => [d.line, d.severity])).toEqual([[3, "warning"], [4, "warning"]]);
    expect(r.diagnostics[0]!.message).toMatch(/isn't a report part/);
    expect(r.diagnostics[1]!.message).toMatch(/no field "nope"\. Its fields: id, opened/);
    expect(parse(`report "X"\n`, registry, { presets: true }).diagnostics[0]!.message).toMatch(/needs data=/);
  });

  it("streams: every prefix cut at a line parses with no errors and draws more", () => {
    const spec = REPORT + `state claims=[{id: "C-1", line: "Auto", status: "Open", incurred: 1200, days: 4}]\nstate monthly=[{month: "Jan", opened: 1, closed: 0}]\n`;
    const ui = render("", { presets: true });
    ui.sayshape.beginStream();
    let drawn = 0;
    for (const line of spec.split(/(?<=\n)/)) {
      ui.sayshape.push(line);
      ui.sayshape.renderNow();
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const now = ui.findAll({}).filter((f) => f.box).length;
      expect(now).toBeGreaterThanOrEqual(drawn);
      drawn = now;
    }
    ui.sayshape.endStream();
    ui.sayshape.renderNow();
    expect(ui.diagnostics).toEqual([]);
    expect(ui.copyText()).toContain("C-1");
  });

  it("names a table's columns once the host's data arrives", () => {
    const ui = render("", { presets: true });
    ui.setSpec(`report "Late" data=claims\n  table\n`);
    ui.sayshape.renderNow();
    expect(ui.findAll("table")).toHaveLength(0);
    expect(ui.findAll("skeleton")).toHaveLength(1);
    ui.set("claims", claims as unknown as Value);
    ui.sayshape.renderNow();
    expect(ui.findAll("table-column").map((f) => f.node.text)).toEqual(["ID", "Opened", "Line", "Status", "Incurred", "Days"]);
  });

  it("lays out at phone width and keeps every part reachable to screen readers", () => {
    const ui = withData(REPORT, { width: 360 });
    expect(ui.warnings).toEqual([]);
    const tree = JSON.stringify(ui.accessibility());
    expect(tree).toContain("Claims review");
    expect(tree).toContain("Total incurred");
    expect(tree).toMatch(/"role":"table"/);
  });

  it("writes readable labels", () => {
    expect(humanize("incurred")).toBe("Incurred");
    expect(humanize("byLine")).toBe("By line");
    expect(humanize("yoy_change")).toBe("YoY change");
    expect(humanize("id")).toBe("ID");
  });
});

describe("report guide", () => {
  it("is small, teaches the preset, and says when to use the full language", () => {
    const g = languageGuide(registry, { mode: "report" });
    // Measured at 491 tokens with o200k_base (bench/tokens); characters keep it from growing unnoticed.
    expect(g.length).toBeLessThan(2600);
    expect(g).toContain(REPORT_EXAMPLE);
    expect(g).toContain(`write only ${REPORT_FALLBACK} and nothing else`);
    expect(guideSections(registry, { mode: "report", notes: "Prices in euros" }).map((s) => s.name)).toEqual(["report", "notes"]);
  });

  it("its example expands and draws with no problems", () => {
    const ui = render(REPORT_EXAMPLE + "\n", { presets: true });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.findAll("chart")).toHaveLength(3);
  });

  it("leaves the other guides as they were", () => {
    expect(languageGuide(registry, { mode: "compact" })).not.toContain("report");
  });
});

describe("report in sayshape/model", () => {
  const config = { url: "http://model.test/v1", model: "m" };

  it("keeps report lines in the answer and checks the spec with presets on", async () => {
    const isLine = sayShapeLineTest((n) => registry.has(n), { presets: true });
    expect(isLine('report "X" data=claims')).toBe(true);
    expect(isLine("  sum incurred")).toBe(true);
    expect(isLine("Sum it up")).toBe(false);
    const model = fakeModel([{ content: ["Here:\n", REPORT] }]);
    const r = await generateSpec({ config, registry, request: "claims", guide: { mode: "report" }, stateNames: ["claims", "monthly"], fetch: model.fetch });
    expect(r.spec).toBe(REPORT);
    expect(r.diagnostics).toEqual([]);
    expect(r.repair).toBeUndefined();
    expect(model.requests[0]!.body.messages[0]!.content).toContain("REPORT");
  });

  it("asks again with the compact guide when the model says a report can't do it", async () => {
    const model = fakeModel([
      { content: [REPORT_FALLBACK], usage: { prompt_tokens: 500, completion_tokens: 1 } },
      { content: ['input "Name" bind=name\nstate name=""\n'], usage: { prompt_tokens: 5500, completion_tokens: 12 } },
    ]);
    const r = await generateReport({ config, registry, request: "a contact form", fetch: model.fetch });
    expect(r.fellBack).toBe(true);
    expect(r.spec).toContain('input "Name"');
    expect(r.usage.promptTokens).toBe(6000);
    expect(model.requests[1]!.body.messages[0]!.content).toContain("ELEMENTS");
    expect(asksForFullGuide("FULL.")).toBe(true);
    expect(asksForFullGuide("FULL of data")).toBe(false);
  });

  it("doesn't ask again when the report answers", async () => {
    const model = fakeModel([{ content: [REPORT] }]);
    const r = await generateReport({ config, registry, request: "claims", stateNames: ["claims", "monthly"], fetch: model.fetch });
    expect(r.fellBack).toBe(false);
    expect(model.requests).toHaveLength(1);
  });
});

describe("a figure over only some rows", () => {
  it("filters any figure, an average included, and the guide says so", () => {
    const spec = `report "Claims" data=claims
  avg days status=Closed "Average days to close"
  avg days
state claims=[{status: "Closed", days: 10}, {status: "Closed", days: 20}, {status: "Open", days: 90}]`;
    const ui = render(spec, { presets: true });
    expect(ui.diagnostics).toEqual([]);
    const shown = ui.copyText();
    expect(shown).toContain("Average days to close: 15");
    expect(shown).toContain("40");
    expect(languageGuide(new Registry(coreComponents), { mode: "report" })).toContain("avg days status=Closed");
  });
});

