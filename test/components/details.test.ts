import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { NARROW } from "../../src/components/details";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";
import { lightTheme } from "../../src/theme";

// The contract tests (test/contract.test.ts) already check the definition,
// layout bounds at three widths, theme-only colors and keyboard reach.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
type Layout = {
  title: string[]; subtitle: string[]; labelW: number; stacked: boolean;
  rows: Array<{ label: string[]; value: string[]; tone?: string; y: number; h: number }>;
};
const geo = (ui: Rendered): Layout => ui.find("details").box!.data as unknown as Layout;

const CUSTOMER = `state c={name: "Ada Lovelace", company: "Analytical Engines Ltd", plan: "Enterprise", arr: 184000, owner: "Grace Hopper"}
details "{c.name}" subtitle="{c.company}"
  detail "Plan" value={c.plan}
  detail "Annual revenue" value={money(c.arr)}
  detail "Account owner" value={c.owner}
  detail "Status" value="At risk" tone=bad
`;

describe("details", () => {
  it("renders its example and a record without problems", () => {
    expect(msgs(`state renewal="Jan 14, 2027"\ndetails "Ada Lovelace" subtitle="London"\n  detail "Renewal" value={renewal}\n  detail "Status" value="At risk" tone=bad`)).toEqual([]);
    const ui = render(CUSTOMER);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(ui.text()).toEqual(expect.arrayContaining(["Ada Lovelace", "Analytical Engines Ltd", "Plan", "Enterprise", "Annual revenue", "$184,000.00", "At risk"]));
  });

  it("is taught in the model guide, with detail as its row", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain('details "<text>"');
    expect(guide).toContain('detail "<text>"');
    expect(guide).toContain("for many records use a table");
  });

  it("puts the labels in one column, as wide as the longest needs, and values beside them", () => {
    const d = geo(render(CUSTOMER, { width: 560 }));
    expect(d.stacked).toBe(false);
    expect(d.labelW).toBeGreaterThan(0);
    expect(d.labelW).toBeLessThanOrEqual(560 * 0.4);
    expect(d.rows.map((r) => r.label[0])).toEqual(["Plan", "Annual revenue", "Account owner", "Status"]);
    for (let i = 1; i < d.rows.length; i++) expect(d.rows[i]!.y).toBe(d.rows[i - 1]!.y + d.rows[i - 1]!.h);
  });

  it("stacks each label above its value on a narrow screen", () => {
    const d = geo(render(CUSTOMER, { width: NARROW - 20 + 40 }));
    expect(d.stacked).toBe(true);
    expect(d.labelW).toBe(0);
    const wide = geo(render(CUSTOMER, { width: 560 }));
    expect(d.rows[0]!.h).toBeGreaterThan(wide.rows[0]!.h);
  });

  it("draws a value with a tone as a badge, in that tone's color", () => {
    const ui = render(CUSTOMER);
    expect(geo(ui).rows[3]!.tone).toBe("bad");
    const badge = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "At risk")!;
    expect(badge.fillStyle).toBe(lightTheme.colors.bad);
  });

  it("shows — for an empty value, never nothing, and keeps the row", () => {
    const ui = render(`state c={plan: ""}\ndetails\n  detail "Plan" value={c.plan}\n  detail "Region" value={c.region}\n  detail "Status" value="" tone=good\n`);
    const d = geo(ui);
    expect(d.rows.map((r) => r.value)).toEqual([["—"], ["—"], ["—"]]);
    // An empty status is a dash, not an empty badge.
    expect(d.rows[2]!.tone).toBeUndefined();
  });

  it("wraps long values to three lines and cuts the rest", () => {
    const long = "Asked about volume pricing for the analytics add-on and wants a call before the renewal quote goes out, and again next week, and once more after that.";
    const d = geo(render(`details\n  detail "Notes" value="${long}"\n`, { width: 320 }));
    expect(d.rows[0]!.value.length).toBe(3);
    expect(d.rows[0]!.value[2]!.endsWith("…")).toBe(true);
  });

  it("works with each, if= and a title alone", () => {
    const ui = render(`state fields=[{k: "Plan", v: "Pro"}, {k: "Seats", v: "12"}] vip=false
details "Account"
  each items=fields as=f
    detail "{f.k}" value={f.v}
  detail "VIP" value="Yes" tone=accent if=vip
`);
    expect(geo(ui).rows.map((r) => r.label[0])).toEqual(["Plan", "Seats"]);
    expect(geo(render(`details "Only a title"\n`)).rows).toEqual([]);
  });

  it("follows state as it changes", () => {
    const ui = render(`state status="Open"\ndetails\n  detail "Status" value={status} tone=warn\nbutton "Close" on=set:status:'Closed'\n`);
    ui.press({ type: "button", text: "Close" });
    expect(geo(ui).rows[0]!.value).toEqual(["Closed"]);
  });

  it("keeps detail inside details, with a message that says so", () => {
    expect(msgs(`detail "Plan" value="Pro"`).join()).toMatch(/detail/);
    expect(msgs(`details\n  detail "Plan"`).join()).toMatch(/value/);
    expect(msgs(`details\n  detail "Status" value="x" tone=red`).join()).toMatch(/tone/);
  });
});
