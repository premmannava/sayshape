/**
 * The landing page's live demos (site/examples/home.ts): every spec parses
 * and draws with no problems at phone, tablet and desktop widths, streams
 * line by line, and its controls and numbers do what the page says.
 */
import { describe, expect, it } from "vitest";
import { render, type Rendered } from "../src/testing";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { heroDrags, heroSpec, lookSpec, mortgageSpec, showcases } from "../site/examples/home";

const components = [...coreComponents, ...mapComponents];
const show = (spec: string, width = 900) => render(spec, { width, components });
const spec = (id: string) => showcases.find((s) => s.id === id)!.spec;
const all = [["hero", heroSpec], ...showcases.map((s) => [s.id, s.spec]), ["mortgage", mortgageSpec], ["look", lookSpec]] as const;

/** Drag a slider's handle to a value through the real pointer path, the way the hero's cursor does. */
function slideTo(r: Rendered, bind: string, value: number) {
  const found = r.findAll("slider").find((f) => f.node.props.bind === bind);
  if (!found?.box) throw new Error(`no slider bound to ${bind}`);
  const hit = r.hits.find((h) => h.box.node.id === found.node.id)!;
  const { min, max } = { min: Number(found.node.props.min ?? 0), max: Number(found.node.props.max ?? 100) };
  // The handle travels between the track's ends, inset by its radius (9 px).
  const x = hit.box.x + 9 + ((value - min) / (max - min)) * (hit.box.w - 18);
  r.drag({ line: found.node.line }, x, hit.box.y + hit.box.h / 2);
}

/** Press a segmented control's option by its label. */
function choose(r: Rendered, option: string) {
  const hits = r.hits.filter((h) => h.box.node.type === "segmented");
  const i = String(hits[0]!.box.node.props.options).split(",").indexOf(option);
  const hit = hits.find((h) => h.detail === i) ?? hits[i]!;
  r.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe("landing page demos", () => {
  for (const [id, text] of all) {
    for (const width of [340, 600, 960]) {
      it(`${id} parses and draws cleanly at ${width}px`, () => {
        const r = show(text, width);
        expect(r.diagnostics).toEqual([]);
        expect(r.warnings).toEqual([]);
        r.destroy();
      });
    }
    it(`${id} streams: every prefix cut at a line parses`, () => {
      const lines = text.split("\n");
      for (let n = 1; n <= lines.length; n++) {
        const r = show(lines.slice(0, n).join("\n"), 600);
        expect(r.diagnostics.filter((d) => d.severity === "error"), `after line ${n}`).toEqual([]);
        r.destroy();
      }
    });
  }

  it("four showcases with different looks and different element mixes", () => {
    expect(showcases.map((s) => s.id)).toEqual(["insurance", "latency", "trip", "orders"]);
    expect(new Set(showcases.map((s) => s.look.preset)).size).toBe(4);
    const kinds = showcases.map((s) => new Set(s.spec.split("\n").map((l) => l.trim().split(/\s/)[0])));
    for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) expect(kinds[i]).not.toEqual(kinds[j]);
  });
});

describe("hero: launch budget planner", () => {
  it("starts on budget with 797 signups", () => {
    const r = show(heroSpec);
    expect(r.copyText()).toContain("Projected signups: 797");
    expect(r.copyText()).toContain("Cost per signup: $50.19");
    expect(r.copyText()).toContain("Search brings the cheapest signups");
  });

  it("the cursor's drags go over budget, then back, and every number follows", () => {
    for (const width of [340, 960]) {
      const r = show(heroSpec, width);
      slideTo(r, heroDrags[0].bind, heroDrags[0].to);
      expect(r.state.search).toBe(22000);
      expect(r.copyText()).toContain("Over budget by $6,000.00");
      expect(r.copyText()).toContain("Projected signups: 947");
      slideTo(r, heroDrags[1].bind, heroDrags[1].to);
      expect(r.state.creators).toBe(4000);
      expect(r.copyText()).not.toContain("Over budget");
      // 22000 / 40 + 14000 / 55 + 4000 / 70 = 861.6
      expect(r.copyText()).toContain("Projected signups: 862");
      expect(r.copyText()).toContain("Cost per signup: $46.40");
      expect(r.copyText()).toContain("Search ads\t$22,000");
      r.destroy();
    }
  });

  it("the arrow keys move a slider as well as dragging does", () => {
    const r = show(heroSpec);
    r.press({ type: "slider", text: /Search ads/ });
    const before = r.state.search as number;
    r.key("ArrowRight");
    expect(r.state.search).toBe(before + 1000);
    r.key("End");
    expect(r.state.search).toBe(30000);
  });

  it("“Share the plan” sends a named action the page can answer", () => {
    const r = show(heroSpec);
    r.press({ type: "button", text: /Share the plan/ });
    expect(r.emitted).toEqual([{ name: "share", value: undefined }]);
  });
});

describe("every demo button", () => {
  it("sends a named action, so the page can show what happened", () => {
    const specs = [heroSpec, ...showcases.map((s) => s.spec), mortgageSpec, lookSpec];
    for (const s of specs) {
      for (const line of s.split("\n").filter((l) => l.trim().startsWith("button "))) {
        expect(line, line).toMatch(/on=emit:\w+/);
      }
    }
  });
});

describe("showcases", () => {
  it("insurance: the recommendation follows how much care you expect", () => {
    const r = show(spec("insurance"));
    expect(r.copyText()).toContain("Gold costs least in a medium year");
    expect(r.copyText()).toContain("$6,846.00 for the year");
    choose(r, "Low");
    expect(r.copyText()).toContain("Bronze costs least in a low year");
    expect(r.copyText()).toContain("$3,648.00 for the year");
    choose(r, "High");
    expect(r.copyText()).toContain("Gold costs least in a high year");
    expect(r.copyText()).toContain("$6,951.00 for the year");
    r.press({ type: "button" });
    expect(r.emitted).toEqual([{ name: "choose", value: undefined }]);
  });

  it("latency: the range switch changes the charts", () => {
    const r = show(spec("latency"));
    expect(r.copyText()).toContain("Nov 8\t476\t300");
    choose(r, "30 days");
    expect(r.state.range).toBe("30 days");
    expect(r.copyText()).toContain("Oct 13\t205\t300");
    expect(r.copyText()).not.toContain("Nov 8\t476");
  });

  it("trip: nights, people and activities change the totals", () => {
    const r = show(spec("trip"));
    // 2 × $245 hotel + 2 × 4 × $60 food + 4 × ($95 jeep tour + $30 observatory)
    expect(r.copyText()).toContain("Trip total: $1,470.00");
    expect(r.copyText()).toContain("Per person: $367.50");
    r.press({ type: "check", text: /Lowell Observatory/ });
    expect(r.copyText()).toContain(`Trip total: ${money(1470 - 4 * 30)}`);
    r.press({ type: "check", text: /Lowell Observatory/ });
    r.set("people", 2);
    expect(r.copyText()).toContain(`Trip total: ${money(490 + 2 * 2 * 60 + 2 * (95 + 30))}`);
    const sunday = r.hits.find((h) => h.box.node.type === "tabs" && h.detail === "sun")!;
    r.click(sunday.box.x + sunday.box.w / 2, sunday.box.y + sunday.box.h / 2);
    expect(r.state.day).toBe("sun");
    expect(r.copyText()).toContain("Lowell Observatory, Flagstaff");
  });

  it("orders: the filter narrows the list, and a row shows its order", () => {
    const r = show(spec("orders"));
    expect(r.copyText()).toContain("Open orders: 6");
    expect(r.copyText()).toContain("Delayed: 3");
    expect(r.copyText()).toContain("On time: 50%");
    choose(r, "Delayed");
    expect(r.findAll("list-item").filter((f) => f.box).length).toBe(3);
    r.press({ type: "list-item", text: /A-1052/ });
    expect(r.state.sel).toBe("A-1052");
    expect(r.copyText()).toContain("Status: Delayed");
    expect(r.copyText()).toContain("Out for delivery, current");
    r.press({ type: "button", text: /Email the delayed customers/ });
    expect(r.emitted).toEqual([{ name: "email", value: undefined }]);
  });
});

describe("mortgage calculator", () => {
  /** The standard amortized monthly payment, worked out independently of the spec. */
  const payment = (p: number, ratePct: number, years: number) => {
    const r = ratePct / 100 / 12, n = years * 12;
    return (p * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  };

  it("starts at the standard payment for $300,000 at 6.5% over 30 years", () => {
    const r = show(mortgageSpec);
    expect(money(payment(300000, 6.5, 30))).toBe("$1,896.20");
    expect(r.text()).toContain("$1,896.20 a month");
    expect(r.copyText()).toContain("Taxes, insurance and fees aren't included");
  });

  it("each control updates the payment on the spot", () => {
    const r = show(mortgageSpec, 340);
    slideTo(r, "amount", 400000);
    expect(r.state.amount).toBe(400000);
    expect(r.text()).toContain(`${money(payment(400000, 6.5, 30))} a month`);
    slideTo(r, "rate", 6.3);
    expect(r.state.rate).toBe(6.3);
    r.key("ArrowLeft");
    expect(r.state.rate).toBe(6.2);
    r.key("ArrowRight");
    choose(r, "15 years");
    expect(r.text()).toContain(`${money(payment(400000, 6.3, 15))} a month`);
  });
});

describe("the look demo", () => {
  it("its button sends a named action and nothing else", () => {
    const r = show(lookSpec);
    r.press({ type: "button" });
    expect(r.emitted).toEqual([{ name: "book", value: undefined }]);
  });
});
