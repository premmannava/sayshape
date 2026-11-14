/**
 * Scoring for `npm run colors-eval`: what a model sent in show_interface's `colors` argument, set
 * against what the conversation says it should have sent. No model, no network, no MCP packages.
 *
 * A call's colors are read the way the server reads them (mcp/src/server.ts): a list is its string
 * entries, a string is comma-separated colors, anything else is none; then only hex colors count,
 * written with or without the #, in 3 or 6 digits, at most six, normalized to lower case #rrggbb.
 * "Sent" means the model put something in the argument; "usable" means the server would draw with it.
 */
import { colorList } from "../../playground/appearance/color";

/** What a model put in the colors argument, as the server reads it. */
export interface SentColors {
  /** The argument was there with at least one entry (an empty list or no argument is not sent). */
  sent: boolean;
  /** The entries that are hex colors, normalized, in order. What the server draws with. */
  colors: string[];
}

/** The server's reading of the argument (colorEntries in mcp/src/ui/view-options.ts), then its hex filter. */
export function readColors(raw: unknown): SentColors {
  const entries = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
  const real = entries.filter((e) => e.trim() !== "");
  return { sent: real.length > 0, colors: colorList(entries) };
}

/** A list of colors the way a person gave them, normalized the same way, for comparing. */
export function normalizeColors(colors: readonly string[]): string[] {
  return colorList(colors);
}

/** What phase of the conversation a call belongs to, which says what it should have sent. */
export type Phase =
  /** The person names the colors. */
  | "ask"
  /** Later, with no mention of colors: the colors should still be sent. */
  | "later"
  /** The person asks to go back to normal: none should be sent. */
  | "reset"
  /** Conversation B: no colors were ever asked for: none should be sent. */
  | "plain";

/** How a call's colors compare with the ones the person named. */
export type Match =
  /** The same list in the same order. */
  | "same"
  /** The same colors in another order (the first is the accent, so this changes the look). */
  | "reordered"
  /** Some of the colors, none others. */
  | "subset"
  /** All of the colors and more. */
  | "superset"
  /** Other colors, or nothing the server could use. */
  | "different"
  /** Nothing sent. */
  | "none";

export function compareColors(sent: SentColors, wanted: readonly string[]): Match {
  if (!sent.sent) return "none";
  const want = normalizeColors(wanted);
  const got = sent.colors;
  if (got.length === want.length && got.every((c, i) => c === want[i])) return "same";
  if (!got.length) return "different";
  const sameSet = got.length === want.length && want.every((c) => got.includes(c));
  if (sameSet) return "reordered";
  if (got.every((c) => want.includes(c))) return "subset";
  if (want.every((c) => got.includes(c))) return "superset";
  return "different";
}

/** One show_interface call, scored. */
export interface CallScore {
  /** Which user message (0-based) it answered. */
  turn: number;
  phase: Phase;
  /** What the person named; empty when they named none (reset, plain). */
  wanted: string[];
  sent: SentColors;
  match: Match;
  /** Whether the call did what the phase asks: see judge(). */
  ok: boolean;
}

/**
 * Phases ask and later want the named colors, unchanged. Phases reset and plain want none, so any
 * colors in the argument count against the model (an invented color list, or one kept after "go back
 * to normal").
 */
export function judge(phase: Phase, sent: SentColors, wanted: readonly string[]): { match: Match; ok: boolean } {
  if (phase === "reset" || phase === "plain") return { match: sent.sent ? "different" : "none", ok: !sent.sent };
  const match = compareColors(sent, wanted);
  return { match, ok: match === "same" };
}

export function scoreCall(turn: number, phase: Phase, rawColors: unknown, wanted: readonly string[]): CallScore {
  const sent = readColors(rawColors);
  const w = phase === "ask" || phase === "later" ? normalizeColors(wanted) : [];
  const { match, ok } = judge(phase, sent, w);
  return { turn, phase, wanted: w, sent, match, ok };
}

/** What happened in one user turn that asked for an interface. */
export interface TurnRecord {
  turn: number;
  phase: Phase;
  /** show_interface calls the model made in the turn. */
  calls: number;
  /** The model answered without showing anything. */
  noInterface: boolean;
}

/** The counts one model earns over its conversations, as the report shows them. */
export interface Tally {
  /** Conversations A and B started, and how many ended early (a cap, or the server failed). */
  conversationsA: number;
  conversationsB: number;
  stopped: number;
  /** Phase ask: calls, and calls that sent exactly the named colors. */
  askCalls: number;
  askSame: number;
  /** Phase later: calls, with colors sent at all, exactly the same, and each kind of change. */
  laterCalls: number;
  laterSent: number;
  laterSame: number;
  laterDropped: number;
  laterChanged: number;
  laterKinds: Record<"reordered" | "subset" | "superset" | "different", number>;
  /** Phase reset: calls, and calls that sent none. */
  resetCalls: number;
  resetNone: number;
  /** Conversation B: calls, and calls that sent colors nobody asked for. */
  plainCalls: number;
  plainInvented: number;
  /** User turns in which the model showed no interface, by phase (they're in no percentage above). */
  noInterface: Record<Phase, number>;
  turns: Record<Phase, number>;
}

export function emptyTally(): Tally {
  return {
    conversationsA: 0, conversationsB: 0, stopped: 0,
    askCalls: 0, askSame: 0,
    laterCalls: 0, laterSent: 0, laterSame: 0, laterDropped: 0, laterChanged: 0,
    laterKinds: { reordered: 0, subset: 0, superset: 0, different: 0 },
    resetCalls: 0, resetNone: 0,
    plainCalls: 0, plainInvented: 0,
    noInterface: { ask: 0, later: 0, reset: 0, plain: 0 },
    turns: { ask: 0, later: 0, reset: 0, plain: 0 },
  };
}

export interface ScoredConversation {
  kind: "A" | "B";
  /** Ended before its last turn: a cap, or an error. */
  stopped: boolean;
  calls: CallScore[];
  turns: TurnRecord[];
}

/** Adds a conversation's scores into a tally. */
export function addToTally(t: Tally, c: ScoredConversation): void {
  if (c.kind === "A") t.conversationsA++; else t.conversationsB++;
  if (c.stopped) t.stopped++;
  for (const turn of c.turns) {
    t.turns[turn.phase]++;
    if (turn.noInterface) t.noInterface[turn.phase]++;
  }
  for (const s of c.calls) {
    if (s.phase === "ask") {
      t.askCalls++;
      if (s.match === "same") t.askSame++;
    } else if (s.phase === "later") {
      t.laterCalls++;
      if (s.sent.sent) t.laterSent++; else t.laterDropped++;
      if (s.match === "same") t.laterSame++;
      else if (s.match !== "none") {
        t.laterChanged++;
        t.laterKinds[s.match]++;
      }
    } else if (s.phase === "reset") {
      t.resetCalls++;
      if (!s.sent.sent) t.resetNone++;
    } else {
      t.plainCalls++;
      if (s.sent.sent) t.plainInvented++;
    }
  }
}
