/**
 * Layout first, data last: a streamed spec draws from its first element, and
 * names it reads before their state line arrives draw as placeholders, with
 * no warnings, until the stream ends (SayShapeOptions.streamPlaceholders).
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { languageGuide, guideSections } from "../src/prompt";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";

const registry = new Registry(coreComponents);

const ROWS = Array.from({ length: 40 }, (_, i) => `{id: ${i + 1}, name: "Order ${i + 1}", region: "${["North", "South", "East"][i % 3]}", status: "${i % 2 ? "Open" : "Closed"}", amount: ${100 + i * 7}}`).join(", ");

/** A dashboard written layout first: small control values, the elements, derive lines, then the long list. */
export const LAYOUT_FIRST = `state status="All" query=""
card
  text "Orders" style=title
  select "Status" items=statuses bind=status
  input "Search" bind=query
  grid min=170 gap=12
    stat label="Revenue" value={money(sum(shown, 'amount'))}
    stat label="Orders" value={len(shown)}
  chart "Revenue by region" kind=bar items=byRegion x=region y=amount
  table "Orders" items=shown key=id
    table-column "Name" field=name
    table-column "Amount" field=amount format=money
  each items={take(shown, 3)} as=o
    row
      text "{o.name}"
      text "{money(o.amount)}"
derive shown={status == 'All' ? search(orders, 'name', query) : filter(orders, 'status', status)}
derive byRegion={group(orders, 'region', 'amount')}
state statuses=["All", "Open", "Closed"]
state orders=[${ROWS}]
`;

/** The same screen, data first: what the guide says today (state, then derive lines, then the elements). */
export const DATA_FIRST = (() => {
  const lines = LAYOUT_FIRST.trimEnd().split("\n");
  const data = [...lines.filter((l) => /^state /.test(l)), ...lines.filter((l) => /^derive /.test(l))];
  const rest = lines.filter((l) => !data.includes(l));
  return [...data, ...rest].join("\n") + "\n";
})();

const lines = (spec: string) => spec.trimEnd().split("\n").map((l) => l + "\n");
const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));

describe("a layout-first spec", () => {
  it("parses with no problems once it is complete, and both orders draw the same screen", () => {
    expect(parse(LAYOUT_FIRST, registry).diagnostics).toEqual([]);
    expect(parse(DATA_FIRST, registry).diagnostics).toEqual([]);
    const a = render(LAYOUT_FIRST);
    const b = render(DATA_FIRST);
    expect(texts(a)).toEqual(texts(b));
    expect(a.warnings).toEqual([]);
    expect(texts(a)).toEqual(expect.arrayContaining(["Orders", "Order 1", "Order 2"]));
    a.destroy();
    b.destroy();
  });
});

describe("streamPlaceholders", () => {
  it("every prefix cut at a line boundary parses, draws placeholders for names declared later, and warns of nothing", () => {
    const ui = render("", { streamPlaceholders: true });
    const seen: string[] = [];
    function* chunks() {
      for (const l of lines(LAYOUT_FIRST)) {
        yield l;
        seen.push(l);
        const shown = texts(ui);
        expect(ui.diagnostics, `after ${seen.length} lines`).toEqual([]);
        expect(ui.warnings, `after ${seen.length} lines`).toEqual([]);
        for (const empty of ["No data", "No data to chart", "—"]) expect(shown, `${empty} after ${seen.length} lines`).not.toContain(empty);
        // Whatever the prefix holds, it is a valid tree.
        expect(ui.sayshape.tree).not.toBeNull();
      }
    }
    ui.stream(chunks());
    expect(seen.length).toBe(lines(LAYOUT_FIRST).length);
    // And the finished screen is the normal one.
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    expect(texts(ui)).toEqual(expect.arrayContaining(["Orders", "Order 1", "Order 2", "Order 3"]));
    ui.destroy();
  });

  it("draws the title from the first element line, before any data is declared", () => {
    const ui = render("", { streamPlaceholders: true });
    ui.sayshape.beginStream();
    ui.sayshape.push(`state status="All"\ncard\n  text "Orders" style=title\n  stat label="Orders" value={len(orders)}\n  chart "By region" kind=bar items=byRegion x=region y=amount\n`);
    ui.sayshape.renderNow();
    expect(texts(ui)).toEqual(expect.arrayContaining(["Orders", "Orders", "By region"]));
    expect(texts(ui)).not.toContain("No data to chart");
    expect(ui.warnings).toEqual([]);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.sayshape.isStreaming).toBe(true);
    ui.sayshape.endStream();
    ui.destroy();
  });

  it("shows the real content as soon as the data line arrives, even mid-stream", () => {
    const ui = render("", { streamPlaceholders: true });
    ui.sayshape.beginStream();
    ui.sayshape.push(`card\n  each items=rows as=r\n    text "{r.name}"\n`);
    ui.sayshape.renderNow();
    expect(texts(ui)).not.toContain("Ada");
    ui.sayshape.push(`state rows=[{name: "Ada"}, {name: "Grace"}]\n`);
    ui.sayshape.renderNow();
    expect(texts(ui)).toEqual(expect.arrayContaining(["Ada", "Grace"]));
    ui.sayshape.endStream();
    ui.destroy();
  });

  it("still reports a name that is never declared, once the stream ends", () => {
    const ui = render("", { streamPlaceholders: true });
    const during: string[] = [];
    function* chunks() {
      for (const l of lines(`card\n  text "Hi {nobody}"\n  text "Fine"\n`)) {
        yield l;
        during.push(...ui.diagnostics.map((d) => d.message));
      }
    }
    ui.stream(chunks());
    expect(during).toEqual([]);
    expect(ui.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(`"nobody" isn't state or a loop variable`)]);
    ui.destroy();
  });

  it("still reports a loop variable used outside its each while streaming", () => {
    const ui = render("", { streamPlaceholders: true });
    ui.sayshape.beginStream();
    ui.sayshape.push(`state rows=[{name: "Ada"}]\neach items=rows as=r\n  text "{r.name}"\ntext "{r.name}"\n`);
    ui.sayshape.renderNow();
    expect(ui.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(`"r" only exists inside the each`)]);
    ui.sayshape.endStream();
    ui.destroy();
  });

  it("stops waiting when the stream ends or a whole spec replaces it", () => {
    const ui = render("", { streamPlaceholders: true });
    ui.sayshape.beginStream();
    ui.sayshape.push(`text "{late}"\n`);
    ui.sayshape.renderNow();
    expect(ui.sayshape.isStreaming).toBe(true);
    ui.sayshape.setSpec(`text "{late}"\n`);
    ui.sayshape.renderNow();
    expect(ui.sayshape.isStreaming).toBe(false);
    expect(ui.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining(`"late" isn't state`)]);
    ui.destroy();
  });

  it("is off by default: a streamed spec behaves as before, reporting names not declared yet", () => {
    const ui = render("");
    const during: string[] = [];
    function* chunks() {
      for (const l of lines(`card\n  text "{count}"\nstate count=1\n`)) {
        yield l;
        during.push(...ui.diagnostics.map((d) => d.message));
      }
    }
    ui.stream(chunks());
    expect(during.some((m) => m.includes(`"count" isn't state`))).toBe(true);
    expect(ui.diagnostics).toEqual([]);
    ui.destroy();
    // And a layout-first screen does warn while it streams, which is what the option is for.
    const plain = render("");
    const warned: string[] = [];
    function* more() {
      for (const l of lines(LAYOUT_FIRST)) {
        yield l;
        warned.push(...plain.warnings, ...plain.diagnostics.map((d) => d.message));
      }
    }
    plain.stream(more());
    expect(warned.length).toBeGreaterThan(0);
    expect(plain.diagnostics).toEqual([]);
    plain.destroy();
  });

  it("changes nothing for a data-first spec, where every name is declared before it is read: the same diagnostics and the same drawing at every step", () => {
    const run = (streamPlaceholders: boolean) => {
      const ui = render("", streamPlaceholders ? { streamPlaceholders } : {});
      const steps: unknown[] = [];
      function* chunks() {
        for (const l of lines(DATA_FIRST)) {
          yield l;
          steps.push([ui.diagnostics, texts(ui)]);
        }
      }
      ui.stream(chunks());
      steps.push([ui.diagnostics, texts(ui)]);
      ui.destroy();
      return steps;
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe("the layoutFirst guide option", () => {
  const all = new Registry(coreComponents);
  const OLD = /^- (Declare state first, at the top, unindented|State first, unindented, every value on one line):.*\n/m;
  const NEW = /^- (Write elements first|Elements first).*\n/m;

  for (const mode of ["full", "compact"] as const) {
    it(`${mode}: left out or false, the guide is exactly what it was`, () => {
      const plain = languageGuide(all, { mode });
      expect(languageGuide(all, { mode, layoutFirst: false })).toBe(plain);
      expect(plain).toMatch(OLD);
      expect(plain).not.toMatch(NEW);
      for (const profile of ["forms", "lists", "shop", "dashboard"]) {
        expect(languageGuide(all, { mode, profile, layoutFirst: false })).toBe(languageGuide(all, { mode, profile }));
      }
      expect(guideSections(all, { mode, layoutFirst: false })).toEqual(guideSections(all, { mode }));
    });

    it(`${mode}: on, swaps the one state line for layout-first wording and changes nothing else`, () => {
      for (const profile of [undefined, "forms", "lists", "shop", "dashboard"]) {
        const base = { mode, ...(profile ? { profile } : {}) };
        const plain = languageGuide(all, base);
        const on = languageGuide(all, { ...base, layoutFirst: true });
        expect(on).not.toMatch(OLD);
        expect(on).toMatch(NEW);
        expect(on.replace(NEW, "")).toBe(plain.replace(OLD, ""));
        // Short: it costs tokens on every request.
        expect(on.length - plain.length).toBeLessThan(160);
      }
    });
  }

  it("leaves every worked example exactly as it was, so the examples tests still hold", () => {
    for (const mode of ["full", "compact"] as const) {
      const on = guideSections(all, { mode, layoutFirst: true }).filter((sec) => sec.name.startsWith("example"));
      expect(on).toEqual(guideSections(all, { mode }).filter((sec) => sec.name.startsWith("example")));
    }
  });
});

describe("how much is written before the first element draws", () => {
  /** Characters of the spec written when its title first shows, streamed a line at a time. */
  function beforeFirstElement(spec: string): number {
    const ui = render("", { streamPlaceholders: true });
    let written = 0;
    let at = -1;
    function* chunks() {
      for (const l of lines(spec)) {
        yield l;
        written += l.length;
        if (at < 0 && texts(ui).includes("Orders")) at = written;
      }
    }
    ui.stream(chunks());
    ui.destroy();
    return at;
  }

  it("is far less with the layout first, for a dashboard with a 40-row list", () => {
    const first = beforeFirstElement(LAYOUT_FIRST);
    const last = beforeFirstElement(DATA_FIRST);
    const total = LAYOUT_FIRST.length;
    // Rough tokens: characters / 4.
    const row = (name: string, chars: number) => `${name.padEnd(12)} ${String(chars).padStart(5)} chars  ~${String(Math.round(chars / 4)).padStart(4)} tokens  (${Math.round((chars / total) * 100)}% of the ${total}-character spec)`;
    console.info(`Before the first element draws:\n  ${row("data first", last)}\n  ${row("layout first", first)}`);
    expect(last).toBeGreaterThan(ROWS.length);
    expect(first).toBeLessThan(120);
    expect(first).toBeLessThan(last / 10);
  });
});
