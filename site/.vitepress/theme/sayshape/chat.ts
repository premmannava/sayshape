/**
 * The chat page's logic, apart from Vue and the network, so test/chat-page.test.ts
 * can run it in Node: what each follow-up sends, the answers in a thread,
 * what a refusal means to the visitor, and the colors the page and its
 * answers take from a brand color.
 *
 * What a follow-up sends is SayShape's bounded refinement (src/model/context.ts):
 * the first question, the follow-ups since and the latest answer's spec. Older
 * answers' specs are never sent, so a follow-up costs about the same however
 * many came before. The worker (worker/src/chat.ts) checks all of it again
 * and writes every message the model reads.
 */
import { nextRefineContext, type RefineContext } from "../../../../src/model/context";
import { darkTheme, extendTheme, lightTheme, type Theme } from "../../../../src/theme";
import { contrast, effectiveAccent, mix, normalizeHex, NEAR_BLACK, TEXT_CONTRAST, UI_CONTRAST, WHITE } from "../../../../playground/appearance/color";

/** Answers in one chat. Demo chats stay short: past this, the page offers a new chat. */
export const MAX_ANSWERS = 8;
export const MAX_MESSAGE_CHARS = 400;

export type Scheme = "light" | "dark";

// ---------------------------------------------------------------- what is sent

/** The request body for a question: the message alone, or with the context for a follow-up. */
export interface ChatBody {
  kind: "chat";
  message: string;
  refine?: { task: string; changes: string[]; spec: string };
}

export function requestBody(context: RefineContext | null, message: string): ChatBody {
  const m = message.trim();
  if (!context) return { kind: "chat", message: m };
  return { kind: "chat", message: m, refine: { task: context.task, changes: [...(context.changes ?? [])], spec: context.spec } };
}

/**
 * The context after an answer: the first answer starts it, a later one
 * replaces the spec and joins the follow-ups. An empty answer (a failure,
 * a stop) changes nothing, so the next follow-up builds on the last good one.
 */
export function advance(context: RefineContext | null, message: string, spec: string): RefineContext | null {
  if (!spec.trim()) return context;
  if (!context) return { task: message.trim(), changes: [], spec };
  return nextRefineContext(context, message, spec);
}

// ---------------------------------------------------------------- the thread

export type TurnStatus = "waiting" | "writing" | "repairing" | "done" | "stopped" | "failed";

export interface Turn {
  id: number;
  question: string;
  status: TurnStatus;
  /** What the model is doing, from the worker's phase events. */
  phase: string;
  /** The clean SayShape lines streamed so far for the current attempt. */
  text: string;
  /** Bumped when a repair throws away what was shown. */
  resets: number;
  /** The model's thinking, as the worker streams it (free text: shown as text, never drawn). */
  thought: string;
  /** When each stage began, by the page's clock (performance.now()), for the timing line. */
  marks: Marks;
  /** Time the engine spent drawing this answer (parse, layout and paint, every frame), filled in by the answer. */
  drawMs: number;
  /** The final spec, once done. */
  spec: string;
  /** Problems SayShape found in the final spec (lines it skipped or parts it ignored). */
  problems: number;
  model?: string;
  ms?: number;
  tokens?: { in: number; out: number };
  failure?: Failure;
}

let nextId = 0;
export interface Marks {
  sent: number;
  /** The first sign of the model: thinking or a line. */
  first?: number;
  /** The first thinking. */
  thinking?: number;
  /** The first SayShape line. */
  line?: number;
  done?: number;
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function newTurn(question: string, now = clock()): Turn {
  return { id: ++nextId, question: question.trim(), status: "waiting", phase: "waiting", text: "", resets: 0, thought: "", marks: { sent: now }, drawMs: 0, spec: "", problems: 0 };
}

/** Start a turn over for Try again: same question, a fresh attempt. */
export function restart(t: Turn, now = clock()): void {
  Object.assign(t, { status: "waiting", phase: "waiting", text: "", resets: t.resets + 1, thought: "", marks: { sent: now }, drawMs: 0, spec: "", problems: 0, failure: undefined, model: undefined, ms: undefined, tokens: undefined });
}

/** Whether another question fits in this chat. */
export const canAsk = (turns: readonly Turn[]) => turns.length < MAX_ANSWERS;

export const isBusy = (t: Turn | undefined) => !!t && (t.status === "waiting" || t.status === "writing" || t.status === "repairing");

export const PHASE_TEXT: Record<string, string> = {
  waiting: "Waiting for the model…",
  thinking: "Thinking…",
  writing: "Writing…",
  repairing: "Fixing a problem SayShape found…",
};

const group = (n: number) => n.toLocaleString("en-US");

/** A duration as people read it: "38 ms" under a second, "8.2 s" above. */
export function duration(ms: number): string {
  const v = Math.max(0, ms);
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

export interface Stage {
  label: string;
  ms: number;
}

/**
 * Where the time went, for the line under a finished answer: waiting for the
 * model, its thinking, its writing (a repair included), SayShape drawing it,
 * and the total from pressing send. Drawing overlaps writing, since lines are
 * drawn as they arrive, so it isn't part of the sum; it's there to show how
 * little of the wait is SayShape's.
 */
export function stages(t: Turn): Stage[] {
  const m = t.marks;
  if (m.done === undefined) return [];
  const out: Stage[] = [];
  const first = m.first ?? m.line ?? m.done;
  out.push({ label: "Waited", ms: first - m.sent });
  if (m.thinking !== undefined) out.push({ label: "Thought", ms: (m.line ?? m.done) - m.thinking });
  if (m.line !== undefined) out.push({ label: t.resets > 0 && t.status === "done" ? "Wrote (fixed once)" : "Wrote", ms: m.done - m.line });
  if (t.drawMs > 0) out.push({ label: "Drew", ms: t.drawMs });
  out.push({ label: "Total", ms: m.done - m.sent });
  return out;
}

/** The model and what it used, after the timings. */
export function summary(t: Turn): string {
  const parts: string[] = [];
  if (t.model) parts.push(t.model);
  if (t.tokens) parts.push(`${group(t.tokens.in)} tokens in · ${group(t.tokens.out)} out`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- when it can't answer

export type FailureKind = "unconfigured" | "off" | "daily" | "rate" | "check" | "restart" | "model" | "empty" | "network";

export interface Failure {
  kind: FailureKind;
  message: string;
  /** Whether asking the same question again could work. */
  retry: boolean;
  /** Whether no question can be answered until something outside the page changes. */
  blocksChat: boolean;
}

const COPY: Record<FailureKind, Omit<Failure, "kind">> = {
  unconfigured: { message: "Live answers aren't set up on this copy of the site.", retry: false, blocksChat: true },
  off: { message: "Live answers are switched off right now. The playground and examples still work.", retry: false, blocksChat: true },
  daily: { message: "Today's free answers are used up. Come back tomorrow, or try the playground.", retry: false, blocksChat: true },
  rate: { message: "That's a lot of questions at once. Wait a minute, then try again.", retry: true, blocksChat: false },
  check: { message: "The check that you're a person didn't pass. Reload the page and try again.", retry: false, blocksChat: false },
  restart: { message: "This chat can't go on from here. Start a new chat to keep asking.", retry: false, blocksChat: false },
  model: { message: "The model didn't answer as expected. Try again, or ask another way.", retry: true, blocksChat: false },
  empty: { message: "The model didn't draw anything for that. Try asking another way.", retry: true, blocksChat: false },
  network: { message: "Couldn't reach the model. Check your connection and try again.", retry: true, blocksChat: false },
};

export function failure(kind: FailureKind, message?: string): Failure {
  const c = COPY[kind];
  return { kind, ...c, message: message ?? c.message };
}

/**
 * What a refusal from the worker means, from its status and its reason. The
 * page words them itself: the worker's messages are written for any page.
 */
export function refusal(status: number, reason: string | undefined): Failure {
  switch (reason) {
    case "off": return failure("off");
    case "unconfigured": return failure("unconfigured");
    case "daily": return failure("daily");
    case "rate": return failure("rate");
    case "check": return failure("check");
    // The page keeps within the worker's limits, so these mean the chat itself can't be sent any more.
    case "too-big": return failure("restart");
    case "bad-request": return failure("restart");
  }
  if (status === 503) return failure("off");
  if (status === 429) return failure("rate");
  // 403 without a reason: the worker doesn't accept this site's address.
  if (status === 403 || status === 404) return failure("unconfigured");
  return failure("model");
}

// ---------------------------------------------------------------- the worker's stream

export type ChatEvent =
  | { t: "phase"; v: string }
  | { t: "text"; v: string }
  | { t: "reset" }
  | { t: "thought"; v: string }
  | { t: "done"; spec: string; problems: number; repaired: boolean; ms: number; model?: string; tokens?: { in: number; out: number } }
  | { t: "error"; message: string };

/** Read the worker's newline-delimited JSON, calling onEvent for each object. A broken line is skipped. */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: ChatEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let e: unknown;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && typeof e === "object" && typeof (e as { t?: unknown }).t === "string") onEvent(e as ChatEvent);
    }
    if (done) {
      const rest = buffer.trim();
      if (rest) { try { onEvent(JSON.parse(rest) as ChatEvent); } catch { /* an unfinished line */ } }
      return;
    }
  }
}

/** Apply one event to the turn it's for. Returns the spec once the answer is done. */
export function applyEvent(turn: Turn, e: ChatEvent, now = clock()): string | null {
  const m = turn.marks;
  switch (e.t) {
    case "phase":
      turn.phase = e.v;
      if (e.v === "thinking") { m.first ??= now; m.thinking ??= now; }
      if (turn.status !== "repairing" && e.v === "writing") turn.status = "writing";
      return null;
    case "thought":
      m.first ??= now;
      m.thinking ??= now;
      turn.thought += e.v;
      return null;
    case "text":
      m.first ??= now;
      m.line ??= now;
      turn.text += e.v;
      if (turn.status === "waiting") turn.status = "writing";
      return null;
    case "reset":
      turn.text = "";
      turn.resets++;
      turn.status = "repairing";
      turn.phase = "repairing";
      return null;
    case "done":
      m.done = now;
      turn.spec = e.spec;
      turn.text = e.spec;
      turn.problems = e.problems;
      turn.model = e.model;
      turn.ms = e.ms;
      turn.tokens = e.tokens;
      if (!e.spec.trim()) {
        turn.status = "failed";
        turn.failure = failure("empty");
        return null;
      }
      turn.status = "done";
      return e.spec;
    case "error":
      m.done = now;
      turn.status = "failed";
      turn.failure = failure("model", e.message);
      return null;
  }
}

// ---------------------------------------------------------------- colors

/** The page's own colors an answer sits on, read from the site's CSS. */
export interface PageColors {
  /** The paper: --vp-c-bg. */
  bg: string;
  /** Cards on it: --ss-card. */
  card: string;
}

/**
 * The least change to color, toward white or near-black, that reaches min
 * contrast against every background. Keeps the color when it already does.
 */
export function readableOn(color: string, backgrounds: readonly string[], min: number): string {
  const worst = (c: string) => Math.min(...backgrounds.map((b) => contrast(c, b)));
  if (worst(color) >= min) return color;
  const light = backgrounds.every((b) => contrast(b, NEAR_BLACK) >= contrast(b, WHITE));
  const toward = light ? NEAR_BLACK : WHITE;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    if (worst(mix(color, toward, t)) >= min) hi = t;
    else lo = t;
  }
  let out = mix(color, toward, hi);
  for (let t = hi; worst(out) < min && t < 1; t = Math.min(1, t + 0.01)) out = mix(color, toward, t);
  return out;
}

/**
 * The theme every answer is drawn in: SayShape's own light or dark theme,
 * sitting on the site's paper instead of its own white or charcoal (so an
 * answer is part of the page, not a box on it), with cards in the site's card
 * color, and the visitor's brand color when they picked one. Text, controls
 * and the accent are kept readable on both the paper and the cards.
 */
export function chatTheme(scheme: Scheme, accent: string | null, page: PageColors): Theme {
  const base = scheme === "dark" ? darkTheme : lightTheme;
  const bg = normalizeHex(page.bg) ?? base.colors.surface;
  const card = normalizeHex(page.card) ?? base.colors.raised;
  const on = [bg, card];
  const colors: Partial<Theme["colors"]> = {
    surface: bg,
    raised: card,
    ink: readableOn(base.colors.ink, on, TEXT_CONTRAST),
    muted: readableOn(base.colors.muted, on, TEXT_CONTRAST),
    control: readableOn(base.colors.control, on, UI_CONTRAST),
  };
  const brand = accent ? normalizeHex(accent) : null;
  if (brand) {
    const a = readableOn(effectiveAccent(brand, bg).accent, on, TEXT_CONTRAST);
    colors.accent = a;
    colors.onAccent = effectiveAccent(a, bg).onAccent;
    // The engine's focus ring follows the brand too, as the page's does.
    colors.focus = a;
    colors.landHighlight = mix(a, bg, scheme === "dark" ? 0.6 : 0.65);
  } else {
    colors.accent = readableOn(base.colors.accent, on, TEXT_CONTRAST);
  }
  return extendTheme(base, { colors });
}

/**
 * The chat frame's colors (the visitor's bubbles, the send button, focus
 * outlines): null until a brand color is picked, when the site's own ink and
 * teal are used. Picked, the color is made readable on the paper, and the
 * bubble's text is white or near-black, whichever reads better on it.
 */
export function frameColors(accent: string | null, pageBg: string): { fill: string; onFill: string } | null {
  const brand = accent ? normalizeHex(accent) : null;
  const bg = normalizeHex(pageBg);
  if (!brand || !bg) return null;
  const e = effectiveAccent(brand, bg);
  return { fill: e.accent, onFill: e.onAccent };
}

// ---------------------------------------------------------------- the empty thread

export interface Suggestion {
  label: string;
  question: string;
}

/**
 * Questions an enterprise assistant gets, and a couple anyone asks. The model
 * makes up example figures. Two lead to a drawing (a scene), the answer a
 * plain chat app can't give.
 */
export const SUGGESTIONS: readonly Suggestion[] = [
  { label: "Sales", question: "How is this quarter's pipeline looking, by stage?" },
  { label: "Support", question: "Which support queues are over their response-time target this week?" },
  { label: "Planning", question: "Plan a 3-day team offsite in Lisbon with a budget per day" },
  { label: "Money", question: "Compare three phone plans for a family of four" },
  { label: "Operations", question: "Draw our production line and let me click each machine to see how it's doing" },
  { label: "IT", question: "Draw our network and make the unhealthy servers stand out" },
];
