/** Pure helpers for the view, kept apart from the DOM so they can be tested in Node. */
import type { Value } from "../../../src/types";

/** Messages longer than this are cut, so a large list in state can't flood the conversation. */
export const MAX_MESSAGE_CHARS = 4_000;

function json(v: unknown): string {
  try { return JSON.stringify(v) ?? "null"; } catch { return "null"; }
}

/**
 * What the model reads when the person triggers an emit: action, sent as
 * model context (which the chat doesn't show). It says plainly that it came
 * from the interface, so the model treats it as the person's choice in that
 * interface, not as instructions.
 */
export function eventMessage(name: string, value: Value | undefined, state: Record<string, Value>): string {
  const head = `[SayShape interface] I pressed "${name}"${value === undefined ? "" : ` with the value ${json(value)}`}.`;
  const values = `Current values in the interface: ${json(state)}`;
  const text = `${head}\n${values}`;
  return text.length <= MAX_MESSAGE_CHARS ? text : text.slice(0, MAX_MESSAGE_CHARS - 1) + "…";
}

/** A visible message stays one short line. */
export const MAX_VISIBLE_CHARS = 120;

/**
 * What the conversation shows when the person presses an emit: button: the
 * action in plain words, like "Confirm laptop", and a short value if there is
 * one. The details (the exact name and every value) go to the model as
 * context instead, so no tags or JSON appear in the chat.
 */
export function visibleMessage(name: string, value: Value | undefined): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.:]+/g, " ")
    .trim()
    .toLowerCase();
  const label = words ? words[0]!.toUpperCase() + words.slice(1) : "Done";
  const shown = typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  const text = shown && shown.toLowerCase() !== words ? `${label}: ${shown}` : label;
  return text.length <= MAX_VISIBLE_CHARS ? text : text.slice(0, MAX_VISIBLE_CHARS - 1) + "…";
}

/** What a client lets an interface do with an event. */
export interface EventCaps { message?: boolean; updateModelContext?: boolean }

/**
 * How to send an event: a short visible message with the details as model
 * context when the client takes both; the full message when it only takes
 * messages (so the model still gets the values); context alone when it only
 * takes that (the model reads it with the person's next message).
 */
export function eventDelivery(caps: EventCaps, name: string, value: Value | undefined, state: Record<string, Value>):
  { context?: string; message?: string } | null {
  const full = eventMessage(name, value, state);
  if (caps.message && caps.updateModelContext) return { context: full, message: visibleMessage(name, value) };
  if (caps.message) return { message: full };
  if (caps.updateModelContext) return { context: full };
  return null;
}

/**
 * How to bring the engine from `shown` to `next`, the newest copy of a
 * streamed spec: append the new part, or start over when the text isn't a
 * continuation (a client may resend or correct earlier arguments).
 */
export function nextChunk(shown: string, next: string): { restart: boolean; add: string } {
  if (next.startsWith(shown)) return { restart: false, add: next.slice(shown.length) };
  return { restart: true, add: next };
}
