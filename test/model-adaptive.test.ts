/**
 * generateAdaptive (sayshape/model): who picks the guide and how many calls it
 * takes, against a scripted model. These check the mechanics only; a scripted
 * model's choices say nothing about what a real model would choose.
 */
import { describe, expect, it } from "vitest";
import { assembleGuide, languageMap } from "../src/capabilities";
import { coreComponents } from "../src/components";
import { generateAdaptive, readUseLine } from "../src/model";
import { WORKED_EXAMPLES } from "../src/prompt";
import { Registry } from "../src/registry";
import { fakeModel } from "./fake-model";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "m" };
const REPORT = `report "Sales" data=sales
  sum amount
  bar month amount
state sales=[{month: "Jan", amount: 1200}, {month: "Feb", amount: 800}]
`;
const system = (m: ReturnType<typeof fakeModel>, i: number) => m.requests[i]!.body.messages[0]!.content as string;

describe("reading the model's choice", () => {
  it("finds a USE line, ignoring thinking, fences, quotes and brackets", () => {
    expect(readUseLine("USE: forms, calculations, slider")).toEqual(["forms", "calculations", "slider"]);
    expect(readUseLine("<think>maybe USE: data</think>\n```\nuse: [\"lists\", \"forms\"].\n```")).toEqual(["lists", "forms"]);
    expect(readUseLine(REPORT)).toBeUndefined();
  });
});

describe("generateAdaptive", () => {
  it("with capabilities the app names: one call, with just their guide and no map or report first", async () => {
    const model = fakeModel([{ content: [WORKED_EXAMPLES.signup + "\n"], usage: { prompt_tokens: 900, completion_tokens: 120 } }]);
    const r = await generateAdaptive({ config, registry, request: "a sign-up form", capabilities: ["forms"], fetch: model.fetch });
    expect(model.requests).toHaveLength(1);
    expect(system(model, 0)).toBe(assembleGuide(registry, ["forms"]).text);
    expect(system(model, 0)).not.toContain("CAPABILITIES");
    expect(r.diagnostics).toEqual([]);
    expect(r.route).toEqual({ kind: "known", chosenBy: "app", capabilities: ["forms"], elements: [], problems: [], calls: 1 });
  });

  it("open-ended, a report: answered from the map in one call", async () => {
    const model = fakeModel([{ content: [REPORT] }]);
    const r = await generateAdaptive({ config, registry, request: "monthly sales", presets: true, fetch: model.fetch });
    expect(model.requests).toHaveLength(1);
    expect(system(model, 0)).toBe(languageMap(registry, { presets: true }));
    expect(r.spec).toBe(REPORT);
    expect(r.diagnostics).toEqual([]);
    expect(r.route.kind).toBe("map");
    expect(r.route.calls).toBe(1);
  });

  it("open-ended, something else: the model names what it needs, then writes it with that guide (two calls)", async () => {
    const model = fakeModel([
      { content: ["USE: forms, calculations"], usage: { prompt_tokens: 1100, completion_tokens: 6 } },
      { content: [WORKED_EXAMPLES.calculator + "\n"], usage: { prompt_tokens: 2400, completion_tokens: 150 } },
    ]);
    const r = await generateAdaptive({ config, registry, request: "a tip calculator", presets: true, fetch: model.fetch });
    expect(model.requests).toHaveLength(2);
    expect(system(model, 1)).toBe(assembleGuide(registry, ["forms", "calculations"], { presets: true }).text);
    // The request goes to both calls as the user wrote it: nothing tells the model which route to take.
    expect(model.requests.map((q) => q.body.messages.at(-1)!.content)).toEqual(["a tip calculator", "a tip calculator"]);
    expect(r.spec).toContain("Tip calculator");
    expect(r.route).toMatchObject({ kind: "chosen", chosenBy: "model", capabilities: ["calculations", "forms"], calls: 2 });
    expect(r.usage.promptTokens).toBe(3500);
    expect(r.usage.completionTokens).toBe(156);
    expect(r.discovery?.first.raw).toBe("USE: forms, calculations");
  });

  it("names it couldn't use come back in the route, and nothing usable means the full guide", async () => {
    const model = fakeModel([{ content: ["USE: hologram"] }, { content: ['text "Hi"\n'] }]);
    const r = await generateAdaptive({ config, registry, request: "a hologram", fetch: model.fetch });
    expect(r.route.kind).toBe("full");
    expect(r.route.problems.map((p) => p.topic)).toEqual(["hologram"]);
    expect(system(model, 1)).toContain("ELEMENTS AT A GLANCE");
  });

  it("an app's guide options carry through: notes and actions reach the assembled guide", async () => {
    const model = fakeModel([{ content: ['text "Hi"\n'] }]);
    await generateAdaptive({ config, registry, request: "x", capabilities: ["forms"], guide: { notes: "Prices in euros", actions: [{ name: "buy", description: "Buy it" }] }, fetch: model.fetch });
    expect(system(model, 0)).toContain("ABOUT THIS APP\nPrices in euros");
    expect(system(model, 0)).toContain("emit:buy");
  });
});
