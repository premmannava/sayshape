import { describe, expect, it } from "vitest";
import { MAX_RUNS, parseRich, plainOf, wrapRich } from "../src/rich";
import { render } from "../src/testing";
import { darkTheme } from "../src/theme";

const runs = (s: string) => parseRich(s).map((r) => [r.text, [r.bold && "b", r.italic && "i", r.code && "c", r.href && "a"].filter(Boolean).join("")]);
// A measurer where every character is 10 wide, so wrapping is easy to check.
const fixed = { width: (s: string) => s.length * 10 };

describe("rich text markers", () => {
  it("reads bold, italic, both, code and https links", () => {
    expect(runs("a **b** *c* ***d*** `e` [f](https://x.example/p)")).toEqual([
      ["a ", ""], ["b", "b"], [" ", ""], ["c", "i"], [" ", ""], ["d", "bi"], [" ", ""], ["e", "c"], [" ", ""], ["f", "a"],
    ]);
  });

  it("leaves markers with nothing to close them as written, so a line cut short never swallows the rest", () => {
    for (const s of ["**unclosed", "*open", "`code", "[words](https://x.example", "[words]", "5 * 3 * 2 = 30", "a ** b", "* not a list"]) {
      expect(plainOf(parseRich(s))).toBe(s);
    }
  });

  it("never makes a link out of anything but https, and keeps backslash escapes", () => {
    expect(runs("[x](http://plain.example)")).toEqual([["x", ""]]);
    expect(runs("[x](javascript:alert)")).toEqual([["x", ""]]);
    expect(runs("[x](mailto:a@b.c)")).toEqual([["x", ""]]);
    expect(plainOf(parseRich("\\*not italic\\* and \\`not code\\`"))).toBe("*not italic* and `not code`");
  });

  it("doesn't read markers inside code", () => {
    expect(runs("`**x**`")).toEqual([["**x**", "c"]]);
  });

  it("gives plain words with each link's address in brackets", () => {
    expect(plainOf(parseRich("Read **the** [policy terms](https://x.example/terms) today"))).toBe("Read the policy terms (https://x.example/terms) today");
  });

  it("stops splitting after MAX_RUNS and never throws on odd input", () => {
    const many = Array.from({ length: MAX_RUNS + 50 }, () => "**a** b").join(" ");
    expect(parseRich(many).length).toBeLessThanOrEqual(MAX_RUNS);
    for (const s of ["", "*", "**", "***", "`", "[", "](", "\\", "*`[](**"]) expect(() => parseRich(s)).not.toThrow();
  });
});

describe("wrapping styled runs", () => {
  it("wraps at spaces across styles, measuring each word in its own font, and keeps a styled word whole", () => {
    const lines = wrapRich(parseRich("one **two three** four"), 100, (s) => (s.bold ? "bold" : "plain"), fixed);
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual(["one two", "three four"]);
    expect(lines[0]!.pieces.map((p) => [p.text, !!p.bold])).toEqual([["one ", false], ["two", true]]);
  });

  it("breaks a word longer than the line by letters", () => {
    const lines = wrapRich(parseRich("abcdefghijkl"), 50, () => "f", fixed);
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual(["abcde", "fghij", "kl"]);
  });
});

describe("text rich=true", () => {
  const spec = `text "Claims under **$5,000** are paid *within 5 days*; see [the claims policy](https://example.com/policy)." rich=true\n`;

  it("draws the words without markers, wrapping across styles, inside its box at every width", () => {
    for (const width of [240, 360, 600]) {
      const ui = render(spec, { width });
      const shown = ui.text().join(" ");
      expect(shown).not.toContain("**");
      expect(shown).toContain("$5,000");
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
    }
  });

  it("emits a pressed link to the host, and never opens it", () => {
    const ui = render(spec, { width: 600 });
    const link = ui.hits.find((h) => h.detail === "link:0")!;
    ui.click(link.box.x + 2, link.box.y + link.box.h / 2);
    expect(ui.emitted).toEqual([{ name: "link", value: "https://example.com/policy" }]);
  });

  it("is reachable by keyboard, a link to a screen reader, and copies as plain words with the address", () => {
    const ui = render(spec, { width: 600 });
    ui.tab();
    ui.key("Enter");
    expect(ui.emitted.map((e) => e.name)).toEqual(["link"]);
    expect(ui.copyText()).toBe("Claims under $5,000 are paid within 5 days; see the claims policy (https://example.com/policy).");
    expect(JSON.stringify(ui.accessibility())).toContain("the claims policy");
  });

  it("keeps a link wrapped over two lines one Tab stop", () => {
    const ui = render(`text "Read [the whole very long claims handling policy for this year](https://example.com/p)" rich=true\n`, { width: 240 });
    const regions = ui.hits.filter((h) => h.detail === "link:0");
    expect(regions.length).toBeGreaterThan(1);
    expect(regions.filter((h) => h.focusable !== false).length).toBe(1);
  });

  it("leaves text without rich=true as written, and suggests rich=true when it has markers", () => {
    const ui = render(`text "Total **$40**"\n`);
    expect(ui.text()).toContain("Total **$40**");
    expect(ui.warnings.join(" ")).toContain("rich=true");
    expect(render(`text "5 * 3 = 15"\n`).warnings).toEqual([]);
  });

  it("renders every streamed prefix of a rich line", () => {
    const line = spec.trim();
    for (let i = 1; i <= line.length; i++) {
      // A line cut anywhere (not just at the end) still renders: markers left open show as written.
      expect(() => render(line.slice(0, i) + (line.slice(0, i).split('"').length % 2 === 0 ? '"' : "") + "\n")).not.toThrow();
    }
  });
});

describe("rich text, after review", () => {
  const all = (s: string) => parseRich(s).map((r) => r.text).join("");

  it("reads a sentence with links as words and links in order, with no addresses spoken", () => {
    const ui = render(`text "Read [terms](https://a.example/t) and [privacy](https://a.example/p) before you pay." rich=true\n`, { width: 600 });
    type N = { role: string; name?: string; children?: N[] };
    const find = (n: N): N | undefined => (n.children?.some((c) => c.role === "link") ? n : n.children?.map(find).find(Boolean));
    const node = find(ui.accessibility() as unknown as N)!;
    expect(node.name).toBeUndefined();
    expect(node.children!.map((c) => [c.role, c.name])).toEqual([["text", "Read"], ["link", "terms"], ["text", "and"], ["link", "privacy"], ["text", "before you pay."]]);
    expect(ui.copyText()).toBe("Read terms (https://a.example/t) and privacy (https://a.example/p) before you pay.");
  });

  it("never turns values from state into formatting or links, but fills a link's words and address from them", () => {
    const ui = render(`state name="Ann [Claim refund](https://evil.example/x) **URGENT**"\ntext "Hello {name}" rich=true\n`, { width: 600 });
    expect(ui.hits.some((h) => String(h.detail).startsWith("link:"))).toBe(false);
    expect(ui.copyText()).toBe("Hello Ann [Claim refund](https://evil.example/x) **URGENT**");
    const each = render(`state docs=[{t: "Policy", u: "https://n.example/p"}]\neach items=docs as=d\n  text "See [{d.t}]({d.u}) *now*" rich=true\n`, { width: 600 });
    expect(each.copyText()).toBe("See Policy (https://n.example/p) now");
    // A value that fills an address in as something other than https isn't a link.
    expect(render(`state u="javascript:x"\ntext "[a]({u})" rich=true\n`).copyText()).toBe("a");
    // A * inside a value's expression is never a marker.
    expect(render(`state a=2 b=3\ntext "*{a * b}* items" rich=true\n`).copyText()).toBe("6 items");
  });

  it("never starts a line with the punctuation after a styled word", () => {
    const text = parseRich("Claims under **$5,000** are paid *automatically*, usually within 2 days. See [the claims policy](https://n.example/p).");
    for (let w = 150; w <= 600; w += 7) {
      for (const line of wrapRich(text, w, () => "f", fixed)) expect(line.pieces[0]?.text ?? "").not.toMatch(/^[.,;:]/);
    }
    // "**pre**release" is one word.
    const lines = wrapRich(parseRich("aaaa **pre**release"), 100, () => "f", fixed);
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual(["aaaa", "prerelease"]);
  });

  it("honours escapes inside formatting, and reads either order of *** nesting", () => {
    expect(runs("*a \\* b*")).toEqual([["a * b", "i"]]);
    expect(runs("**a \\** b**")).toEqual([["a ** b", "b"]]);
    expect(runs("***bold** italic*")).toEqual([["bold", "bi"], [" italic", "i"]]);
    expect(runs("***italic* bold**")).toEqual([["italic", "bi"], [" bold", "b"]]);
  });

  it("leaves arithmetic and words with a * inside them plain", () => {
    for (const s of ["2*x + 3*y", "5*3*2", "3*4=12", "a*b*c"]) expect(runs(s)).toEqual([[s, ""]]);
    expect(runs("say *this* 3*4")).toEqual([["say ", ""], ["this", "i"], [" 3*4", ""]]);
  });

  it("stays quick on very long text, reading markers in the first part only", () => {
    const long = "**a ".repeat(6000);
    const t = performance.now();
    expect(all(long)).toBe(long);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("puts text past MAX_RUNS in one plain run, never the last run's style", () => {
    const s = "x " + Array.from({ length: MAX_RUNS }, () => "[a](https://l.example) x").join(" ") + " and the rest is plain";
    const r = parseRich(s);
    const last = r[r.length - 1]!;
    expect(last.text.endsWith("and the rest is plain")).toBe(true);
    expect(last.href).toBeUndefined();
    expect(last.bold).toBeUndefined();
  });

  it("makes no link from words that are only spaces, and keeps backslashes before other characters", () => {
    expect(runs("[ ](https://x.example)")).toEqual([["[ ](https://x.example)", ""]]);
    expect(all("C:\\_dir")).toBe("C:\\_dir");
  });

  it("aligns centre and right inside its box, with an icon, at 1024 and in the dark theme", () => {
    for (const align of ["center", "right"]) {
      for (const width of [240, 1024]) {
        const ui = render(`text "A **bold** word and [a link](https://x.example)" rich=true align=${align} icon=info\n`, { width, theme: darkTheme });
        const box = ui.find("text").box!;
        for (const h of ui.hits) {
          expect(h.box.x).toBeGreaterThanOrEqual(box.x - 0.5);
          expect(h.box.x + h.box.w).toBeLessThanOrEqual(box.x + box.w + 0.5);
        }
      }
    }
  });
});
