import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { sceneComponents } from "../src/components/scene";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { NESTED_CARD, reviewLayout } from "../src/review";
import { reference } from "../eval/compare/reference";
import { examples } from "../site/examples/catalog";
import { samples } from "../playground/samples";
import { sceneSamples } from "../playground/scene-samples";
import { slideSamples } from "../playground/slides-samples";
import { behaviorSamples, behaviorSceneSamples } from "../playground/behavior-samples";

const registry = new Registry([...coreComponents, ...mapComponents, ...sceneComponents]);
const review = (spec: string) => reviewLayout(parse(spec, registry, { behavior: true }).root);

const EXPENSES_NESTED = `state budget=1200
text "October expenses" style=title
card
  text "Budget" weight=semibold
  meter "Spent" value=860 max={budget}
  card variant=outline
    text "Groceries"
    text "$412" style=lead
list
  list-item "Rent" trailing="$1,450"`;

describe("reviewLayout", () => {
  it("flags a card inside a card, on the inner card's line", () => {
    expect(review(EXPENSES_NESTED)).toEqual([{ line: 6, severity: "warning", message: NESTED_CARD }]);
  });

  it("looks through rows, grids, each and if", () => {
    const spec = `state items=[1, 2] open=true
card
  grid
    each items=items as=i
      if {open}
        card
          text "{i}"`;
    expect(review(spec).map((d) => d.line)).toEqual([6]);
  });

  it("doesn't count cards side by side, or a card in a dialog over a card", () => {
    const spec = `state open=true
row
  card
    text "A"
  card
    text "B"
card
  dialog "Details" bind=open
    card
      text "Inside the dialog"`;
    expect(review(spec)).toEqual([]);
  });

  it("finds no nested cards in the repo's own examples", () => {
    const specs: Array<[string, string]> = [
      ...coreComponents.concat(mapComponents, sceneComponents).filter((d) => d.example).map((d): [string, string] => [`component ${d.type}`, d.example!]),
      ...Object.entries(reference).map(([k, v]): [string, string] => [`reference ${k}`, v.sayshape]),
      ...examples.map((e): [string, string] => [`site ${e.id}`, e.spec]),
      ...Object.entries({ ...samples, ...sceneSamples, ...slideSamples, ...behaviorSamples, ...behaviorSceneSamples }).map(([k, s]): [string, string] => [`playground ${k}`, s.spec]),
    ];
    expect(specs.length).toBeGreaterThan(80);
    const flagged = specs.filter(([, spec]) => review(spec).length).map(([name]) => name);
    expect(flagged).toEqual([]);
  });
});
