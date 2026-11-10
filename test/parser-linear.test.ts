import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { codeLineMessage, parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";

/** The regexes codeLineMessage used before, kept as the reference its linear checks must agree with. */
const OLD_CLOSING = /^[}\])](\s*[,;)\]}]*)?(\s*else\b.*)?$/;
const OLD_SENTENCE = /^[A-Z][a-z]*\s+\w+(\s+\w+)+[\s\w,.:;'!?-]*$/;
const BRACES = "SayShape has no braces around blocks: the lines under an if= or each line are indented under it instead, and nothing closes it";
const PROSE = "Only SayShape lines go in a spec. Leave explanations out, or start them with # as comments";

/** What the old code said about a line, for the two messages these checks decide. */
function oldVerdict(body: string): "braces" | "prose" | "other" {
  if (/^(\/\/|\/\*|\*\/|--\s)/.test(body)) return "other";
  if (OLD_CLOSING.test(body)) return "braces";
  if (OLD_SENTENCE.test(body) && !/[="]/.test(body)) return "prose";
  return "other";
}
function newVerdict(body: string): "braces" | "prose" | "other" {
  const m = codeLineMessage(body);
  return m === BRACES ? "braces" : m === PROSE ? "prose" : "other";
}

const PIECES = ["}", "]", ")", " ", "\t", ",", ";", "else", "elsewhere", "e", "x", "A", "Hello", "This", "a", "1", "_", "#", ".", "!", "?", "-", "'", "=", '"', "{"];

describe("codeLineMessage's checks", () => {
  it("say what the old regexes said, on random lines built from the characters that matter", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 12 }), (parts) => {
        const body = parts.join("");
        expect(newVerdict(body)).toBe(oldVerdict(body));
      }),
      { numRuns: 20_000 },
    );
  });

  it("say what the old regexes said on hand-picked lines", () => {
    for (const body of ["}", "});", "} else {", "}  else if (x) {", "]", ") ;", "} ; ;", "} x", "}else", "} elsewhere", "Hello world today.", "This is a chart", "Hello world", "Hi there, friend!", "Total revenue = 5", 'Say "hi" now', "Card a b #"]) {
      expect(newVerdict(body), body).toBe(oldVerdict(body));
    }
  });

  it("take time in proportion to the line, even on lines that made the old regexes backtrack", () => {
    // Each took 200 to 600 ms with the old regexes.
    for (const body of ["}" + " ".repeat(19_990) + "x", "Hello" + " a".repeat(9_990) + " #", "Hello a " + "a".repeat(19_990) + "#"]) {
      const t0 = performance.now();
      codeLineMessage(body);
      expect(performance.now() - t0, body.slice(0, 12)).toBeLessThan(25);
    }
  });

  it("keep a whole spec at the size limit quick to parse", () => {
    const registry = new Registry(coreComponents);
    const t0 = performance.now();
    const { diagnostics } = parse("}" + " ".repeat(19_990) + "x", registry);
    // Was about a second through the MCP server.
    expect(performance.now() - t0).toBeLessThan(100);
    // "} … x" isn't only a closing line, so it gets the ordinary message, as before.
    expect(diagnostics.map((d) => d.line)).toEqual([1]);
  });
});
