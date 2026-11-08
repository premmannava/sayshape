import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { tile, tileSize } from "../../src/components/tile";
import { ICON_NAMES } from "../../src/icons";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { render } from "../../src/testing";
import { lightTheme } from "../../src/theme";
import { samples } from "../../playground/samples";

// The contract tests already check the definition, layout bounds, text that
// fits at 240, 360 and 600 px, theme-only colors and keyboard reach.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const SEATS = `state seats=[{id: "A1", taken: false, picked: false}, {id: "A2", taken: true, picked: false}, {id: "A3", taken: false, picked: true}]
row gap=6
  each items=seats as=s key={s.id}
    tile "{s.id}" shape=square size=sm selected={s.picked} disabled={s.taken} on=toggle:s.picked label="Seat {s.id}"
`;

describe("tile", () => {
  it("has the suit icons, drawn as SayShape's own", () => {
    for (const suit of ["club", "spade", "heart", "diamond"]) expect(ICON_NAMES).toContain(suit);
  });

  it("parses its example and the blackjack sample with no problems", () => {
    expect(msgs(tile.example!)).toEqual([]);
    const ui = render(samples.blackjackDealer!.spec, { width: 1024 });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
  });

  it("warns about bad props and unknown icons but keeps the tile", () => {
    const m = msgs(`tile "4" icon=clover shape=round colour=red`);
    expect(m.some((x) => x.includes("clover") && x.includes("club"))).toBe(true);
    expect(m.some((x) => x.includes("shape"))).toBe(true);
    expect(m.some((x) => x.includes("colour"))).toBe(true);
  });

  it("keeps its size from the theme, never stretched, at every width", () => {
    for (const [shape, size] of [["card", "sm"], ["card", "md"], ["card", "lg"], ["square", "sm"], ["square", "md"], ["square", "lg"]] as const) {
      const full = tileSize(lightTheme, shape, size);
      for (const width of [360, 600, 1024]) {
        const b = render(`tile "7" icon=heart shape=${shape} size=${size}\n`, { width }).find("tile").box!;
        if (full.w <= width) {
          expect(b.w).toBe(full.w);
          expect(b.h).toBe(full.h);
        }
      }
    }
    const card = tileSize(lightTheme, "card", "md");
    expect(card.h / card.w).toBeCloseTo(1.4, 1);
  });

  it("shrinks, keeping its shape, only when its space is narrower than it", () => {
    const full = tileSize(lightTheme, "card", "lg");
    const b = render(`row gap=8 wrap=false\n  tile "A" size=lg\n  tile "K" size=lg\n  tile "Q" size=lg\n  tile "J" size=lg\n`, { width: 240 }).findAll("tile")[0]!.box!;
    expect(b.w).toBeLessThan(full.w);
    expect(b.h / b.w).toBeCloseTo(full.h / full.w, 2);
  });

  it("sits side by side in a row, in the middle, and wraps when they don't fit", () => {
    const ui = render(`row gap=8\n${Array.from({ length: 9 }, (_, i) => `  tile "${i + 1}" icon=diamond tone=bad`).join("\n")}\n`, { width: 390 });
    const boxes = ui.findAll("tile").map((n) => n.box!);
    const tops = [...new Set(boxes.map((b) => b.y))];
    expect(tops.length).toBeGreaterThan(1);
    const first = boxes.filter((b) => b.y === tops[0]);
    const left = first[0]!.x, right = first[first.length - 1]!.x + first[first.length - 1]!.w;
    // The first line is centred in the row.
    expect(Math.abs(left - (390 - right))).toBeLessThan(2);
    for (let i = 1; i < first.length; i++) expect(first[i]!.x - (first[i - 1]!.x + first[i - 1]!.w)).toBeCloseTo(8, 0);
  });

  it("runs on= when pressed, never when disabled, and shows selected=", () => {
    const ui = render(SEATS, { width: 600 });
    const at = (id: string) => ui.findAll("tile").find((n) => n.box!.node.id.endsWith(`#${id}`))!.box!;
    ui.click(at("A1").x + 5, at("A1").y + 5);
    expect((ui.state.seats as Array<{ picked: boolean }>)[0]!.picked).toBe(true);
    ui.click(at("A2").x + 5, at("A2").y + 5);
    expect((ui.state.seats as Array<{ picked: boolean }>)[1]!.picked).toBe(false);
    // Taken seats aren't Tab stops.
    expect(ui.hits.filter((h) => h.box.node.type === "tile").length).toBe(2);
  });

  it("is a toggle button to a screen reader when pressable, and words otherwise", () => {
    const ui = render(SEATS, { width: 600 });
    const json = JSON.stringify(ui.accessibility());
    expect(json).toContain(`"role":"button","name":"Seat A3"`);
    expect(json).toMatch(/"name":"Seat A2"[^}]*"disabled"/);
    const shown = render(`row\n  tile "4" icon=club label="4 of clubs"\n  tile "Q" icon=heart tone=bad\n  tile "Fe" shape=square detail="55.85" selected=true\n`);
    expect(shown.copyText().split("\n")).toEqual(["4 of clubs", "Q of hearts", "Fe, 55.85 (selected)"]);
  });

  it("never throws on odd values, and every streamed prefix renders", () => {
    for (const odd of [`tile`, `tile ""`, `tile "{nope}"`, `tile "A very long value that cannot fit" size=sm`, `tile icon=spade`, `tile "x" detail="a long detail line that will not fit at all" shape=square size=sm`]) {
      expect(() => render(odd + "\n", { width: 240 })).not.toThrow();
    }
    const lines = samples.blackjackDealer!.spec.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("tile, after review", () => {
  it("centres a line of tiles of mixed sizes together", () => {
    const ui = render(`row gap=8\n  tile "Fe" shape=square size=lg detail="55.85"\n  tile "B" shape=square\n  tile "C" shape=square size=sm\n`, { width: 390 });
    const boxes = ui.findAll("tile").map((n) => n.box!);
    const left = boxes[0]!.x, right = boxes[2]!.x + boxes[2]!.w;
    expect(Math.abs(left - (390 - right))).toBeLessThan(2);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x - (boxes[i - 1]!.x + boxes[i - 1]!.w)).toBeCloseTo(8, 0);
  });

  it("keeps a row of text then tiles as before: the tiles at the right", () => {
    const ui = render(`row\n  text "Your hand"\n  tile "A" icon=spade size=sm\n  tile "K" icon=heart tone=bad size=sm\n`, { width: 600 });
    const last = ui.findAll("tile")[1]!.box!, row = ui.find("row").box!;
    expect(last.x + last.w).toBeCloseTo(row.x + row.w, 0);
  });

  it("draws inside its face when squeezed small", () => {
    const ui = render(`row gap=8 wrap=false\n${Array.from({ length: 13 }, (_, i) => `  tile "${i + 1}" icon=heart detail="x"`).join("\n")}\n`, { width: 360 });
    for (const t of ui.findAll("tile")) {
      const b = t.box!;
      expect(b.h / b.w).toBeCloseTo(1.4, 1);
    }
    expect(ui.diagnostics).toEqual([]);
  });

  it("is never a Tab stop without a name, and says so", () => {
    const ui = render(`tile on=emit:x\n`);
    expect(ui.hits.length).toBe(0);
    expect(ui.warnings.join(" ")).toContain("nothing on its face");
  });

  it("names a suit card like a card, and presses with Enter as a toggle button", () => {
    expect(render(`tile "Q" icon=heart tone=bad\n`).copyText()).toBe("Q of hearts");
    const ui = render(`state on=false\ntile "B4" shape=square selected={on} on=toggle:on label="Seat B4"\n`);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.on).toBe(true);
    expect(JSON.stringify(ui.accessibility())).toMatch(/"name":"Seat B4"[^}]*pressed/);
  });
});
