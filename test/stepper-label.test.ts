/**
 * "2 2 persons": a stepper draws its own number between its buttons, so a
 * label that also shows the bound value reads it twice. That comes from the
 * spec, not the component (the stepper never adds a unit or repeats its
 * label); the stepper warns so a repair pass can fix it.
 */
import { describe, expect, it } from "vitest";
import { labelShows } from "../src/components/input";
import { render } from "../src/testing";

describe("stepper labels", () => {
  it("draws the label as written and the number once", () => {
    const ui = render(`state guests=2\nstepper "Guests" bind=guests min=1\n`, { width: 360 });
    const texts = ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
    expect(texts.filter((t) => t === "2")).toHaveLength(1);
    expect(texts).toContain("Guests");
    expect(texts.some((t) => /2.*2/.test(t))).toBe(false);
    expect(ui.warnings).toEqual([]);
    ui.destroy();
  });

  it("warns when the label shows the value the stepper already shows", () => {
    const ui = render(`state guests=2\nstepper "{guests} persons" bind=guests\n`, { width: 360 });
    expect(ui.warnings.join("\n")).toMatch(/its label shows \{guests\}.*reads twice.*stepper "Guests" bind=guests/);
    ui.destroy();
  });

  it("matches the bound name only, inside expressions", () => {
    expect(labelShows("{guests} persons", "guests")).toBe(true);
    expect(labelShows("{plural(guests, 'person')}", "guests")).toBe(true);
    expect(labelShows("Guests", "guests")).toBe(false);
    expect(labelShows("{guests_max} at most", "guests")).toBe(false);
    expect(labelShows("{t.guests}", "guests")).toBe(false);
    expect(labelShows("{t.qty} left", "t.qty")).toBe(true);
  });
});
