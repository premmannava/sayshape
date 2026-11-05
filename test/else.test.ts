import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render } from "../src/testing";

const registry = new Registry(coreComponents);
const messages = (spec: string) => parse(spec, registry).diagnostics.map((d) => `${d.line}: ${d.message}`);

const VIEWS = `state view="Week"
if={view == 'Week'}
  text "week"
else if={view == 'Month'}
  text "month"
else
  text "year"
text "after"
`;

describe("else", () => {
  it("shows the first branch whose condition holds, and else when none does", () => {
    const ui = render(VIEWS);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["week", "after"]);
    ui.set("view", "Month");
    expect(ui.text()).toEqual(["month", "after"]);
    ui.set("view", "Year");
    expect(ui.text()).toEqual(["year", "after"]);
  });

  it("follows an element with if= as well as an if block", () => {
    const ui = render(`state n=0\ntext "some" if={n > 0}\nelse\n  text "none"\n`);
    expect(ui.text()).toEqual(["none"]);
    ui.set("n", 2);
    expect(ui.text()).toEqual(["some"]);
  });

  it("works inside each, read per item", () => {
    const ui = render(`state tasks=[{n: "A", done: true}, {n: "B", done: false}]
each items=tasks as=t
  text "{t.n} done" if={t.done}
  else
    text "{t.n} to do"
`);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toEqual(["A done", "B to do"]);
  });

  it("needs an if= line right before it, at the same indent", () => {
    expect(messages(`state n=1\nelse\n  text "x"\n`)).toEqual([
      "2: else goes right after a line with if={…}, at the same indent, with the lines it shows indented under it. Nothing came before it, so it and the lines under it were skipped",
    ]);
    // An else after a plain else has nothing left to follow.
    expect(messages(`state n=1\nif={n}\n  text "a"\nelse\n  text "b"\nelse\n  text "c"\n`)[0]).toMatch(/^6: else goes right after a line with if=/);
    // At a different indent, it doesn't follow the if.
    expect(messages(`state n=1\ncard\n  if={n}\n    text "a"\nelse\n  text "b"\n`)[0]).toMatch(/^5: else goes right after/);
    expect(messages(`state n=1\nif={n}\n  text "a"\nelse if=n > 2\n  text "b"\n`)[0]).toMatch(/^4: else if needs a condition in braces/);
  });

  it("keeps streaming: every prefix parses into a smaller tree with no errors", () => {
    const lines = VIEWS.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const prefix = lines.slice(0, i).join("\n") + "\n";
      expect(parse(prefix, registry).diagnostics.filter((d) => d.severity === "error"), prefix).toEqual([]);
    }
  });
});

describe("code and prose where SayShape goes", () => {
  const first = (line: string) => messages(`state n=1\n${line}\n`)[0];

  it("says what to write instead of each kind of code", () => {
    expect(first("let total = sum(items, 'price')")).toBe("2: SayShape has no variables. For a value worked out from state, write derive name={…} at the top level; for a value people change, write state name=value. This line and anything under it were skipped");
    expect(first("const x = 1")).toMatch(/^2: SayShape has no variables/);
    expect(first("function total() {")).toMatch(/^2: SayShape has no functions of your own/);
    expect(first("return card")).toMatch(/^2: SayShape has no functions or return/);
    expect(first("for t in tasks:")).toMatch(/^2: To repeat elements, write each items=list as=x/);
    expect(first("} else {")).toMatch(/^2: SayShape has no braces around blocks/);
    expect(first("})")).toMatch(/^2: SayShape has no braces around blocks/);
    expect(first("else {")).toMatch(/^2: Write else on its own line with nothing after it/);
    expect(first("elif={n > 2}")).toMatch(/^2: Write else if=\{…\} on its own line/);
    expect(first("if (n > 0) {")).toMatch(/^2: Write a line holding only if=\{…\}/);
    expect(first("// totals")).toBe("2: Comments start with #, like # Totals. This line and anything under it were skipped");
    expect(first("This shows the budget and what's left.")).toMatch(/^2: Only SayShape lines go in a spec/);
  });

  it("gives one message per line, without the tokenizer's complaints", () => {
    expect(messages(`let total = 5\n`)).toHaveLength(1);
  });

  it("skips the lines under it", () => {
    const r = parse(`state n=1\nfor t in tasks:\n  text "inside"\ntext "after"\n`, registry);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.root.children.map((c) => c.text)).toEqual(["after"]);
  });

  it("leaves real elements and unknown names alone", () => {
    expect(messages(`text "Let it be"\n`)).toEqual([]);
    expect(first("widget x=1")).toBe(`2: Unknown element "widget". It was skipped, along with anything inside it`);
  });
});
