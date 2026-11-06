import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { render } from "../src/testing";

const textOf = (spec: string) => { const ui = render(spec, { components: coreComponents }); const t = ui.text(); const d = ui.diagnostics.map((x) => x.message); ui.destroy(); return { t, d }; };

describe("a screen without a name", () => {
  it("still shows when it's the only one, and the model is still told to name it", () => {
    const { t, d } = textOf(`screen title="Team hours"\n  text "Ana 32"`);
    expect(t).toEqual(expect.arrayContaining(["Team hours", "Ana 32"]));
    expect(d.join(" ")).toMatch(/needs name=/);
  });

  it("shows with a bare word where its name should be (screen budget)", () => {
    const { t } = textOf(`screen budget title="Budget tracker"\n  text "74% used"`);
    expect(t).toContain("74% used");
  });

  it("doesn't change screens that have names: only the first shows", () => {
    const { t } = textOf(`screen name=list title="Orders"\n  text "A1"\nscreen name=detail title="Order"\n  text "Shipped"`);
    expect(t).toContain("A1");
    expect(t).not.toContain("Shipped");
  });
});
