/**
 * A plain chat message: what the browser may send, the request the model
 * gets, and the guide for it. The website's chat page sends one of these for
 * every question, with a refine context for follow-ups.
 *
 * Everything the model reads is still built here. The browser sends only
 * the visitor's own words (the question, earlier follow-ups) and, for a
 * follow-up, the latest answer's spec. That spec goes back to the model as
 * its own earlier turn, so it is checked to be SayShape and nothing else:
 * otherwise the assistant turn could carry any text, and the key could be
 * used for something other than drawing interfaces.
 *
 * Plain functions with no Cloudflare types, so test/worker.test.ts runs them
 * in Node.
 */
import { sayShapeLineTest, type RefineContext } from "../../src/model";
import type { GuideOptions } from "../../src/prompt";
import type { Registry } from "../../src/registry";

export const MAX_MESSAGE_CHARS = 400;
/** Follow-ups sent as text before the current one. The page stops a chat well before this. */
export const MAX_CHANGES = 10;
/** The latest answer's spec, as sent back for a follow-up. A screen is usually a tenth of this. */
export const MAX_SPEC_CHARS = 8_000;
export const MAX_SPEC_LINES = 300;
/** Big enough for a full refine context (the spec, ten follow-ups and the question), even in multi-byte text. */
export const MAX_CHAT_BODY_BYTES = 40_000;

export interface ChatQuestion {
  message: string;
  refine?: RefineContext;
}

/**
 * Elements the chat guide leaves out, to keep it small: the guide is most of
 * what each request costs. The engine still draws all of them; the model just
 * isn't taught them. Images need hosts this site doesn't allow, placeholders
 * and empty states are for apps waiting on data, and the rest are rarely the
 * best way to show a one-screen answer.
 */
export const CHAT_LEFT_OUT = ["image", "avatar", "skeleton", "empty", "screen", "breadcrumb", "pagination", "scroll", "dialog", "carousel", "spacer"] as const;

const text = (v: unknown, max: number, what: string): string | { error: string } => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return { error: `Send ${what}.` };
  if (s.length > max) return { error: `Keep ${what} under ${max} characters.` };
  return s;
};

/**
 * The spec of the latest answer, as the browser sends it back: only lines
 * the model client would have let through from a model (elements, state and
 * derive lines), never prose, and without comments, which a model may read
 * as instructions. Null when anything else is in it.
 */
export function readSpec(v: unknown, registry: Registry): string | null {
  if (typeof v !== "string") return null;
  if (!v.trim() || v.length > MAX_SPEC_CHARS) return null;
  const lines = v.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > MAX_SPEC_LINES) return null;
  const isSayShape = sayShapeLineTest((name) => registry.has(name));
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!isSayShape(line)) return null;
    kept.push(line.trimEnd());
  }
  return kept.length ? kept.join("\n") + "\n" : null;
}

/** A chat message from the browser, checked for shape and size; a message for the person when it's wrong. */
export function readChat(body: Record<string, unknown>, registry: Registry): ChatQuestion | { error: string } {
  const message = text(body.message, MAX_MESSAGE_CHARS, "a question");
  if (typeof message !== "string") return message;
  if (body.refine === undefined || body.refine === null) return { message };

  const r = body.refine;
  if (typeof r !== "object" || Array.isArray(r)) return { error: "A follow-up needs the first question, the follow-ups since and the latest answer." };
  const { task, changes, spec } = r as Record<string, unknown>;
  const first = text(task, MAX_MESSAGE_CHARS, "the first question");
  if (typeof first !== "string") return first;
  const earlier: string[] = [];
  if (changes !== undefined) {
    if (!Array.isArray(changes)) return { error: "Follow-ups must be a list." };
    if (changes.length > MAX_CHANGES) return { error: "This chat is too long. Start a new one." };
    for (const c of changes) {
      const t = text(c, MAX_MESSAGE_CHARS, "each follow-up");
      if (typeof t !== "string") return t;
      earlier.push(t);
    }
  }
  const latest = readSpec(spec, registry);
  if (!latest) return { error: "The latest answer couldn't be sent back. Start a new chat." };
  return { message, refine: { task: chatRequest(first), changes: earlier, spec: latest } };
}

/** The person's first message, as the model gets it. A follow-up is framed by refineMessages instead. */
export function chatRequest(message: string): string {
  return `Answer with a SayShape interface.\n\nQuestion: ${message}`;
}

/**
 * The guide for chat answers: compact, no worked examples, and the elements
 * that make one-screen answers, with notes for this page. Kept small on
 * purpose (see CHAT_LEFT_OUT).
 */
export function chatGuide(registry: Registry): GuideOptions {
  const leftOut = new Set<string>(CHAT_LEFT_OUT);
  return {
    imageHosts: [],
    mode: "compact",
    workedExamples: false,
    profile: registry.all().map((c) => c.type).filter((t) => !leftOut.has(t)),
    notes: `A demo chat on SayShape's website: people ask anything, as if this were their company's assistant.
Answer with one screen: the direct answer first (a stat, callout or title), then the detail in whatever shows it best, with controls that change what's shown.
You have no data or tools. When a question needs figures, make up realistic ones in state and add text "Example figures" style=caption. Never present them as real.
Output only the finished SayShape spec.`,
  };
}
