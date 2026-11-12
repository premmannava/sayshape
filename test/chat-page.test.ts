/**
 * The website's chat page logic (site/.vitepress/theme/sayshape/chat.ts):
 * what each question sends, how the context moves on, how the worker's stream
 * fills an answer, what each refusal tells the visitor, and that the colors
 * taken from a brand color stay readable in light and dark.
 */
import { describe, expect, it } from "vitest";
import {
  advance, applyEvent, canAsk, chatTheme, duration, failure, frameColors, isBusy, MAX_ANSWERS, newTurn, readableOn, readEvents, refusal, requestBody,
  restart, stages, suggestionsIn, SUGGESTIONS, summary, type ChatEvent,
} from "../site/.vitepress/theme/sayshape/chat";
import { readChat } from "../worker/src/chat";
import { contrast } from "../playground/appearance/color";
import { coreComponents } from "../src/components";
import { Registry } from "../src/registry";
import { parse } from "../src/parser";

const FIRST = `card\n  text "Pipeline" style=title\n`;
const SECOND = `card\n  text "Pipeline by stage" style=title\n`;
const THIRD = `card\n  text "Pipeline by stage, this quarter" style=title\n`;
const LIGHT = { bg: "#f9f7f2", card: "#ffffff" };
const DARK = { bg: "#11131c", card: "#191c28" };

describe("what a question sends", () => {
  it("sends a first question alone, and a follow-up with the first question, the follow-ups since and only the latest answer", () => {
    expect(requestBody(null, "  How is the pipeline? ")).toEqual({ kind: "chat", message: "How is the pipeline?" });

    let ctx = advance(null, "How is the pipeline?", FIRST);
    ctx = advance(ctx, "By stage", SECOND);
    ctx = advance(ctx, "This quarter only", THIRD);
    const body = requestBody(ctx, "As a funnel");
    expect(body).toEqual({ kind: "chat", message: "As a funnel", refine: { task: "How is the pipeline?", changes: ["By stage", "This quarter only"], spec: THIRD } });
    // Older answers never leave the page.
    expect(JSON.stringify(body)).not.toContain('"Pipeline by stage"');
  });

  it("keeps the last good answer as the context when an answer fails or is stopped", () => {
    const ctx = advance(null, "How is the pipeline?", FIRST);
    expect(advance(ctx, "By stage", "")).toBe(ctx);
    expect(advance(ctx, "By stage", "  \n")).toBe(ctx);
    expect(advance(null, "Hello", "")).toBeNull();
  });

  it("sends what the worker accepts, at every length a chat can reach", () => {
    const registry = new Registry(coreComponents);
    let ctx = null;
    for (let i = 0; i < MAX_ANSWERS; i++) {
      const body = requestBody(ctx, `Question ${i}`);
      const read = readChat(body as unknown as Record<string, unknown>, registry);
      expect("error" in read ? read.error : "ok").toBe("ok");
      ctx = advance(ctx, `Question ${i}`, FIRST);
    }
  });

  it("stops a chat at its last answer", () => {
    const turns = Array.from({ length: MAX_ANSWERS }, (_, i) => newTurn(`q${i}`));
    expect(canAsk(turns.slice(0, -1))).toBe(true);
    expect(canAsk(turns)).toBe(false);
  });
});

describe("filling an answer from the stream", () => {
  async function stream(chunks: string[]): Promise<ChatEvent[]> {
    const bytes = new TextEncoder().encode(chunks.join(""));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Odd-sized pieces, so events and characters are split across reads.
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
        c.close();
      },
    });
    const out: ChatEvent[] = [];
    await readEvents(body, (e) => out.push(e));
    return out;
  }

  it("reads newline-delimited events split anywhere, skipping broken lines", async () => {
    const ev = await stream(['{"t":"phase","v":"writing"}\n', '{"t":"text","v":"card\\n  text \\"Café\\"\\n"}\n', "not json\n", '{"no":"type"}\n', '{"t":"done","spec":"card\\n","problems":0,"repaired":false,"ms":900}']);
    expect(ev.map((e) => e.t)).toEqual(["phase", "text", "done"]);
    expect(ev[1]).toEqual({ t: "text", v: 'card\n  text "Café"\n' });
  });

  it("streams, throws away a repaired attempt and ends with the final spec and its numbers", () => {
    const t = newTurn("How is the pipeline?");
    expect(isBusy(t)).toBe(true);
    applyEvent(t, { t: "phase", v: "thinking" });
    expect(t.status).toBe("waiting");
    applyEvent(t, { t: "text", v: "card\n" });
    expect(t.status).toBe("writing");
    applyEvent(t, { t: "reset" });
    expect(t).toMatchObject({ text: "", resets: 1, status: "repairing" });
    applyEvent(t, { t: "phase", v: "writing" });
    expect(t.status).toBe("repairing");
    applyEvent(t, { t: "text", v: FIRST });
    const spec = applyEvent(t, { t: "done", spec: FIRST, problems: 1, repaired: true, ms: 3140, model: "DeepSeek", tokens: { in: 4012, out: 180 } });
    expect(spec).toBe(FIRST);
    expect(t).toMatchObject({ status: "done", spec: FIRST, problems: 1 });
    expect(isBusy(t)).toBe(false);
    expect(summary(t)).toBe("DeepSeek · 4,012 tokens in · 180 out");
  });

  it("keeps the thinking apart from the answer, and times each stage from pressing send", () => {
    const t = newTurn("How is the pipeline?", 1000);
    applyEvent(t, { t: "phase", v: "waiting" }, 1100);
    applyEvent(t, { t: "phase", v: "thinking" }, 1900);
    applyEvent(t, { t: "thought", v: "Stages: lead, qualified… " }, 1950);
    applyEvent(t, { t: "thought", v: "a funnel fits." }, 6000);
    expect(t.thought).toBe("Stages: lead, qualified… a funnel fits.");
    expect(t.text).toBe("");
    applyEvent(t, { t: "text", v: FIRST }, 9200);
    applyEvent(t, { t: "done", spec: FIRST, problems: 0, repaired: false, ms: 8000 }, 15_100);
    t.drawMs = 38;
    expect(stages(t)).toEqual([
      { label: "Waited", ms: 900 },
      { label: "Thought", ms: 7300 },
      { label: "Wrote", ms: 5900 },
      { label: "Drew", ms: 38 },
      { label: "Total", ms: 14_100 },
    ]);
    expect(stages(t).map((s) => duration(s.ms))).toEqual(["900 ms", "7.3 s", "5.9 s", "38 ms", "14.1 s"]);
  });

  it("times an answer without thinking, says when it was fixed, and starts the clock again on Try again", () => {
    const t = newTurn("x", 0);
    applyEvent(t, { t: "text", v: "card\n" }, 1200);
    applyEvent(t, { t: "reset" }, 2000);
    applyEvent(t, { t: "text", v: FIRST }, 2500);
    applyEvent(t, { t: "done", spec: FIRST, problems: 0, repaired: true, ms: 3000 }, 4000);
    expect(stages(t).map((s) => s.label)).toEqual(["Waited", "Wrote (fixed once)", "Total"]);
    expect(stages(newTurn("not done"))).toEqual([]);
    restart(t, 9000);
    expect(t).toMatchObject({ status: "waiting", text: "", thought: "", spec: "", marks: { sent: 9000 }, drawMs: 0, failure: undefined });
    expect(t.resets).toBe(2);
  });

  it("turns an error or an empty answer into a failure that can be tried again", () => {
    const a = newTurn("x");
    expect(applyEvent(a, { t: "error", message: "The model service had a problem. Try again in a minute." })).toBeNull();
    expect(a.failure).toMatchObject({ kind: "model", retry: true, message: "The model service had a problem. Try again in a minute." });
    const b = newTurn("x");
    expect(applyEvent(b, { t: "done", spec: "", problems: 0, repaired: false, ms: 1 })).toBeNull();
    expect(b).toMatchObject({ status: "failed", failure: { kind: "empty", retry: true } });
  });
});

describe("when it can't answer", () => {
  it("words every refusal for the visitor and says whether the chat can go on", () => {
    expect(refusal(503, "off")).toMatchObject({ kind: "off", blocksChat: true, retry: false });
    expect(refusal(503, "unconfigured")).toMatchObject({ kind: "unconfigured", blocksChat: true });
    expect(refusal(429, "daily")).toMatchObject({ kind: "daily", blocksChat: true, message: expect.stringMatching(/tomorrow/) });
    expect(refusal(429, "rate")).toMatchObject({ kind: "rate", blocksChat: false, retry: true });
    expect(refusal(403, "check")).toMatchObject({ kind: "check", retry: false });
    expect(refusal(413, "too-big")).toMatchObject({ kind: "restart", message: expect.stringMatching(/new chat/) });
    // An older worker, or a proxy in front of it, without reasons.
    expect(refusal(503, undefined).kind).toBe("off");
    expect(refusal(429, undefined).kind).toBe("rate");
    expect(refusal(403, undefined).kind).toBe("unconfigured");
    expect(refusal(500, undefined).kind).toBe("model");
  });

  it("says what to do next in every message", () => {
    for (const kind of ["unconfigured", "off", "daily", "rate", "check", "restart", "model", "empty", "network"] as const) {
      expect(failure(kind).message, kind).toMatch(/\.$/);
      expect(failure(kind).message, kind).not.toMatch(/\b(4\d\d|5\d\d|error code|undefined)\b/i);
    }
  });
});

describe("colors", () => {
  const ACCENTS = ["#ffd400", "#00ff00", "#ffffff", "#000000", "#e94f3a", "#1d4ed8", "#7dd3fc", "#6d28d9"];

  it("draws answers on the site's paper, with text, controls and the brand color readable on paper and cards", () => {
    for (const [scheme, page] of [["light", LIGHT], ["dark", DARK]] as const) {
      for (const accent of [null, ...ACCENTS]) {
        const c = chatTheme(scheme, accent, page).colors;
        expect(c.surface).toBe(page.bg);
        expect(c.raised).toBe(page.card);
        for (const on of [page.bg, page.card]) {
          const where = `${scheme} ${accent} on ${on}`;
          expect(contrast(c.ink, on), `ink ${where}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(c.muted, on), `muted ${where}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(c.accent, on), `accent ${where}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(c.control, on), `control ${where}`).toBeGreaterThanOrEqual(3);
          expect(contrast(c.focus, on), `focus ${where}`).toBeGreaterThanOrEqual(3);
        }
        expect(contrast(c.onAccent, c.accent), `button text ${scheme} ${accent}`).toBeGreaterThanOrEqual(4.5);
        // Charts follow the brand color.
        expect(c.series1).toBe(c.accent);
      }
    }
  });

  it("keeps a brand color that's already readable, and only nudges one that isn't", () => {
    expect(chatTheme("light", "#1d4ed8", LIGHT).colors.accent).toBe("#1d4ed8");
    const yellow = chatTheme("light", "#ffd400", LIGHT).colors.accent;
    expect(yellow).not.toBe("#ffd400");
    expect(readableOn("#1d4ed8", [LIGHT.bg], 4.5)).toBe("#1d4ed8");
  });

  it("gives the chat frame the brand color only once one is picked, with readable bubble text", () => {
    expect(frameColors(null, LIGHT.bg)).toBeNull();
    expect(frameColors("not a color", LIGHT.bg)).toBeNull();
    for (const bg of [LIGHT.bg, DARK.bg]) {
      for (const accent of ACCENTS) {
        const f = frameColors(accent, bg)!;
        expect(contrast(f.fill, bg), `${accent} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(f.onFill, f.fill), `text on ${accent}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("the empty thread", () => {
  it("suggests questions short enough to send", () => {
    expect(SUGGESTIONS.length).toBe(30);
    for (const s of SUGGESTIONS) expect(s.question.length).toBeLessThan(120);
    expect(new Set(SUGGESTIONS.map((s) => s.question)).size).toBe(30);
    expect(suggestionsIn("personal")).toHaveLength(14);
    expect(suggestionsIn("work")).toHaveLength(14);
    // The two drawings come last.
    expect(SUGGESTIONS.slice(-2).map((s) => s.group)).toEqual(["drawing", "drawing"]);
    // A spec in this file's own tests parses, so the fixtures above are real answers.
    expect(parse(FIRST, new Registry(coreComponents)).diagnostics).toEqual([]);
  });
});
