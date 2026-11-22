/**
 * Keeping the model's words: sentences before and after the spec come back
 * as `message`, for an app to show under the screen, instead of being
 * dropped (before) or read as spec lines (after). Only trailing prose is
 * taken; a line in the middle of a spec always stays in it.
 */
import { describe, expect, it } from "vitest";
import { coreComponents } from "../src/components";
import { generateAdaptive, generateSpec, sayShapeLineTest, SpecFilter } from "../src/model";
import { Registry } from "../src/registry";
import { fakeModel } from "./fake-model";

const registry = new Registry(coreComponents);
const config = { url: "http://model.test/v1", model: "test-model" };
const good = `card\n  text "Cabin" style=title\n  button "Book" on=emit:book\n`;
const isSayShape = sayShapeLineTest((n) => registry.has(n));

const filter = (raw: string, size = 1000) => {
  const f = new SpecFilter(isSayShape);
  let text = "";
  for (const c of raw.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? []) text += f.push(c).text;
  text += f.end().text;
  return { text, message: f.message };
};

describe("SpecFilter: the model's words", () => {
  it("collects sentences after the spec as the message, not spec lines", () => {
    for (const size of [1, 5, 1000]) {
      const r = filter(`${good}\nThe Book button sends the booking to your app.\nLet me know if you want dates too!\n`, size);
      expect(r.text, `chunks of ${size}`).toBe(good);
      expect(r.message).toBe("The Book button sends the booking to your app.\nLet me know if you want dates too!");
    }
  });

  it("collects sentences before the spec too, and keeps both", () => {
    const r = filter(`Here's a booking card:\n\n\`\`\`sayshape\n${good}\`\`\`\n\nPress Book to send it.\n`);
    expect(r.text).toBe(good);
    expect(r.message).toBe("Here's a booking card:\n\nPress Book to send it.");
  });

  it("never drops a line from the middle of a spec", () => {
    const raw = `card\n  text "A"\nThis line is a sentence in the middle.\ncard\n  text "B"\n`;
    const r = filter(raw);
    expect(r.text).toBe(raw);
    expect(r.message).toBe("");
  });

  it("keeps a trailing line it can't tell is prose as a spec line", () => {
    for (const tail of [`txet "Typo"`, `buton "Go now please"`, `stat label="Days" value=3`, `  something indented here.`, `sparkle`]) {
      const r = filter(`${good}${tail}\n`);
      expect(r.text, tail).toBe(`${good}${tail}\n`);
      expect(r.message, tail).toBe("");
    }
  });

  it("a reply with no spec at all is all message", () => {
    const r = filter("I can't draw a map of that, but Lisbon is lovely in May.\n");
    expect(r.text).toBe("");
    expect(r.message).toBe("I can't draw a map of that, but Lisbon is lovely in May.");
  });

  it("thinking is never part of the message", () => {
    expect(filter(`<think>\nplan the card.\n</think>\n${good}Done.\n`).message).toBe("Done.");
  });
});

describe("generateSpec: message", () => {
  it("returns trailing prose as message, and the spec without it, with no problems", async () => {
    const { fetch } = fakeModel([{ content: [`${good}\nThe button sends the booking.\n`] }]);
    const r = await generateSpec({ config, registry, request: "cabin", fetch, guide: { mode: "compact" } });
    expect(r.spec).toBe(good);
    expect(r.message).toBe("The button sends the booking.");
    expect(r.diagnostics).toEqual([]);
    expect(r.repair).toBeUndefined();
  });

  it("a words-only reply is an empty spec and the reply as message, with no error", async () => {
    const { fetch, requests } = fakeModel([{ content: ["That needs your calendar, which I can't see. Paste your events and I'll lay them out."] }]);
    const r = await generateSpec({ config, registry, request: "my week", fetch, guide: { mode: "compact" } });
    expect(r.spec).toBe("");
    expect(r.message).toBe("That needs your calendar, which I can't see. Paste your events and I'll lay them out.");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("refine carries message through", async () => {
    const { fetch } = fakeModel([{ content: [`${good}\nI added nothing else.\n`] }]);
    const r = await generateSpec({ config, registry, request: "same again", fetch, guide: { mode: "compact" }, refine: { spec: good, task: "cabin" } });
    expect(r.message).toBe("I added nothing else.");
  });

  it("generateAdaptive carries message through unchanged", async () => {
    const { fetch } = fakeModel([{ content: [`${good}\nA quick card.\n`] }]);
    const r = await generateAdaptive({ config, registry, request: "cabin", fetch });
    expect(r.spec).toBe(good);
    expect(r.message).toBe("A quick card.");
  });

  it("a spec with no prose has an empty message", async () => {
    const { fetch } = fakeModel([{ content: [good] }]);
    const r = await generateSpec({ config, registry, request: "cabin", fetch, guide: { mode: "compact" } });
    expect(r.message).toBe("");
  });
});
