/**
 * npm run colors-eval against the real server: the tools a model is given are the ones the server advertises
 * to a chat app that draws views, the results it gets back are the server's own, and a scripted model
 * (eval/colors/stub.ts) is scored on what it does with them. No model, no network.
 */
import { describe, expect, it } from "vitest";
import { connectView } from "../../eval/colors/connect";
import { conversationA, conversationB, PROMPT_SETS } from "../../eval/colors/prompts";
import { runConversation, runEval, tallyOf, withVariant } from "../../eval/colors/run";
import { stubMessage, type StubBehavior } from "../../eval/colors/stub";
import { NOTE_VARIANTS } from "../../eval/colors/variants";
import type { ChatFn } from "../../eval/colors/chat";
import { colorsNote, COLORS_DESCRIPTION, quickStart } from "../src/server";

const scripted = (behavior: StubBehavior): ChatFn => async (messages) => ({ message: stubMessage(behavior, messages), usage: {}, ms: 0 });
const COFFEE = PROMPT_SETS[0]!;
const NAMED = ["#0b6e4f", "#f4b942"];

describe("the colors check against the real server", () => {
  it("hands the model the tools of a client that draws views", async () => {
    const backend = await connectView();
    try {
      expect(backend.tools.map((t) => t.name).sort()).toEqual(["sayshape_docs", "show_interface"]);
      const show = backend.tools.find((t) => t.name === "show_interface")!;
      // The view client's description, not the text-only one: it ends with the quick start the server writes.
      expect(show.description).toContain(quickStart(false, false, false));
      const colors = (show.inputSchema as { properties: { colors: { description: string; type: string } } }).properties.colors;
      expect(colors.description).toBe(COLORS_DESCRIPTION);
      expect(colors.type).toBe("array");
      expect(Object.keys((show.inputSchema as { properties: object }).properties)).toEqual(["colors", "spec", "title"]);
      expect(backend.instructions).toContain("show_interface");
    } finally {
      await backend.close();
    }
  });

  it("gives the real note after an interface drawn in colors, and none without", async () => {
    const backend = await connectView();
    try {
      const spec = 'card\n  text "Hello" style=title\n';
      const withColors = await backend.call("show_interface", { colors: ["#0B6E4F", "f4b942", "nope"], spec });
      expect(withColors.endsWith(colorsNote(NAMED))).toBe(true);
      const plain = await backend.call("show_interface", { spec: 'card\n  text "Plain" style=title\n' });
      expect(plain).not.toContain("Colors:");
      // A sloppy list is ignored, never an error for the model to answer.
      const sloppy = await backend.call("show_interface", { colors: ["red"], spec: 'card\n  text "Other" style=title\n' });
      expect(sloppy).not.toContain("Colors:");
      expect(sloppy).not.toMatch(/error/i);
      expect(await backend.call("sayshape_docs", { elements: ["chart"] })).toContain("chart");
    } finally {
      await backend.close();
    }
  });

  it("runs a whole conversation and scores a model that keeps the colors", async () => {
    const backend = await connectView();
    try {
      const r = await runConversation(conversationA(COFFEE), { model: "keeper", run: 1, chat: scripted("keeper"), backend });
      expect(r.stopped).toBeUndefined();
      expect(r.calls.map((c) => [c.phase, c.match])).toEqual([["ask", "same"], ["later", "same"], ["later", "same"], ["later", "same"], ["reset", "none"]]);
      // What the model was told after each interface is the server's, word for word.
      for (const c of r.calls.slice(0, 4)) expect(c.result.endsWith(colorsNote(NAMED))).toBe(true);
      expect(r.calls[4]!.result).not.toContain("Colors:");
      // Docs came from the server too.
      expect(r.messages.some((m) => m.role === "tool" && m.content.includes("chart"))).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("scores a model that forgets, one that invents, and one that mixes", async () => {
    const run = (kind: "A" | "B", b: StubBehavior) => runEval({ models: [b], conversations: [kind === "A" ? conversationA(COFFEE) : conversationB(COFFEE)], runs: 1, chatFor: () => scripted(b), connect: connectView });
    expect(tallyOf(await run("A", "forgetter"))).toMatchObject({ askSame: 1, laterCalls: 3, laterDropped: 3, resetNone: 1 });
    expect(tallyOf(await run("B", "inventor"))).toMatchObject({ plainCalls: 4, plainInvented: 4 });
    expect(tallyOf(await run("B", "plain"))).toMatchObject({ plainCalls: 4, plainInvented: 0 });
    expect(tallyOf(await run("A", "mixed"))).toMatchObject({ laterSame: 1, laterChanged: 1, laterDropped: 1 });
  });

  it("swaps the note and description for the model only, and leaves the server's text alone", async () => {
    const real = await connectView();
    const backend = withVariant(await connectView(), { note: NOTE_VARIANTS.short, description: "Send these every time." });
    try {
      const show = backend.tools.find((t) => t.name === "show_interface")!;
      expect(JSON.stringify(show.inputSchema)).toContain("Send these every time.");
      expect(JSON.stringify(real.tools.find((t) => t.name === "show_interface")!.inputSchema)).toContain(JSON.stringify(COLORS_DESCRIPTION).slice(1, -1));
      const swapped = await backend.call("show_interface", { colors: NAMED, spec: 'card\n  text "Hello" style=title\n' });
      expect(swapped.endsWith('Keep sending colors=["#0b6e4f","#f4b942"] on show_interface until the person says otherwise.')).toBe(true);
      expect(swapped).not.toContain("Pass the same colors");
      // Another conversation's server is untouched.
      expect((await real.call("show_interface", { colors: NAMED, spec: 'card\n  text "Hello" style=title\n' })).endsWith(colorsNote(NAMED))).toBe(true);
    } finally {
      await backend.close();
      await real.close();
    }
  });
});
