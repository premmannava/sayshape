/**
 * Saved chat answers, for people who choose to help improve SayShape: the
 * chat page offers a switch, off unless the visitor turns it on, and only
 * then does a question carry `record`. The worker writes the row itself, from
 * what it already has: the visitor's question, the final spec, how it went and
 * how long it took. Never the visitor's IP address or browser, the model's
 * thinking, or a spreadsheet's rows (spreadsheet questions are never saved).
 *
 * Later, the page can add to a row it holds the id of (POST /feedback): a
 * thumb up or down, a short note, and how much the answer was used (state
 * changes, emitted actions, screens moved to). The id is random and only ever
 * sent to the page that asked, so nobody else can find or change a row.
 *
 * Rows are deleted after RETENTION_DAYS by the worker's daily cron
 * (deleteOld). Storage is Cloudflare D1, reached through the small
 * RecordStore interface so test/worker.test.ts can use a fake in Node.
 */

/** The part of a D1 prepared statement used here. */
export interface RecordStatement {
  bind(...values: Array<string | number | null>): RecordStatement;
  run(): Promise<{ meta?: { changes?: number } }>;
}

/** The part of a D1 database used here. */
export interface RecordStore {
  prepare(sql: string): RecordStatement;
}

/** How long a saved answer is kept. The chat page's switch says this number. */
export const RETENTION_DAYS = 30;
/** A note with a thumb down. */
export const MAX_NOTE_CHARS = 500;
/** A feedback request is a few small fields. */
export const MAX_FEEDBACK_BYTES = 2_000;
/** Usage counts are capped: past this it's "a lot", and a page can't inflate a row. */
export const MAX_USAGE = 1_000;
/** Turns in one chat. The page stops at 8; this only keeps the number sane. */
const MAX_TURN = 50;

/** What a question asks to be saved with, as the page sends it: `record: { chat, turn, width }`. */
export interface RecordRequest {
  /** A random id the page makes for each chat, so a chat's answers can be read in order. Not kept between chats or visits. */
  chat: string;
  /** Which answer in the chat this is, from 1. */
  turn: number;
  /** The answer's width in CSS pixels, rounded to 10, to tell phones from desktops. */
  width: number | null;
}

const CHAT_ID = /^[A-Za-z0-9-]{8,64}$/;
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The page's `record` field, or null when it didn't ask to be saved (or asked in a shape it never sends). */
export function readRecordRequest(v: unknown): RecordRequest | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.chat !== "string" || !CHAT_ID.test(r.chat)) return null;
  if (typeof r.turn !== "number" || !Number.isInteger(r.turn) || r.turn < 1 || r.turn > MAX_TURN) return null;
  const width = typeof r.width === "number" && Number.isFinite(r.width) && r.width > 0 && r.width <= 10_000 ? Math.round(r.width / 10) * 10 : null;
  return { chat: r.chat, turn: r.turn, width };
}

export type Outcome = "done" | "empty" | "failed";

/** One saved answer. */
export interface AnswerRow {
  id: string;
  chat: string;
  turn: number;
  /** When it was answered: an ISO timestamp. */
  at: string;
  /** Whether it followed up an earlier answer. */
  followup: boolean;
  question: string;
  outcome: Outcome;
  spec: string;
  /** Problems SayShape found in the final spec. */
  problems: number;
  repaired: boolean;
  ms: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string;
  width: number | null;
  /** For a failed answer: the message the visitor saw. */
  error: string | null;
}

export async function saveAnswer(store: RecordStore, row: AnswerRow): Promise<void> {
  await store
    .prepare(
      "INSERT INTO answers (id, chat, turn, at, followup, question, outcome, spec, problems, repaired, ms, tokens_in, tokens_out, model, width, error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.chat, row.turn, row.at, row.followup ? 1 : 0, row.question, row.outcome, row.spec, row.problems, row.repaired ? 1 : 0,
      row.ms, row.tokensIn, row.tokensOut, row.model, row.width, row.error)
    .run();
}

export interface Usage {
  /** State changes: a slider moved, a box ticked, a field typed in. */
  changes: number;
  /** emit: actions sent. */
  actions: number;
  /** Screens moved to with go: or back. */
  screens: number;
}

export interface Feedback {
  id: string;
  vote?: "up" | "down";
  note?: string;
  used?: Usage;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_USAGE) : null);

/** A feedback request, checked; a message when it's wrong. */
export function readFeedback(body: Record<string, unknown>): Feedback | { error: string } {
  if (typeof body.id !== "string" || !ROW_ID.test(body.id)) return { error: "Send the id of a saved answer." };
  const out: Feedback = { id: body.id };
  if (body.vote !== undefined) {
    if (body.vote !== "up" && body.vote !== "down") return { error: 'A vote is "up" or "down".' };
    out.vote = body.vote;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== "string") return { error: "A note is text." };
    const note = body.note.trim();
    if (note.length > MAX_NOTE_CHARS) return { error: `Keep a note under ${MAX_NOTE_CHARS} characters.` };
    if (note) out.note = note;
  }
  if (body.used !== undefined) {
    const u = body.used as Record<string, unknown> | null;
    const changes = count(u?.changes), actions = count(u?.actions), screens = count(u?.screens);
    if (!u || typeof u !== "object" || changes === null || actions === null || screens === null) return { error: "Usage is three counts: changes, actions and screens." };
    out.used = { changes, actions, screens };
  }
  if (!out.vote && !out.note && !out.used) return { error: "Send a vote, a note or usage." };
  return out;
}

/**
 * Add feedback to a saved answer, kept only while the answer is: an id older
 * than RETENTION_DAYS, or never saved, changes nothing. Usage only goes up
 * (the page sends running totals). False when no row was changed.
 */
export async function applyFeedback(store: RecordStore, f: Feedback, now: Date): Promise<boolean> {
  const res = await store
    .prepare(
      "UPDATE answers SET vote = COALESCE(?, vote), note = COALESCE(?, note), " +
        "changes = MAX(changes, ?), actions = MAX(actions, ?), screens = MAX(screens, ?) WHERE id = ? AND at >= ?",
    )
    .bind(f.vote ?? null, f.note ?? null, f.used?.changes ?? 0, f.used?.actions ?? 0, f.used?.screens ?? 0, f.id, cutoff(now))
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** The oldest moment a saved answer may be from. */
export const cutoff = (now: Date) => new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

/** Delete answers saved more than RETENTION_DAYS ago. Run daily by the worker's cron. */
export async function deleteOld(store: RecordStore, now: Date): Promise<void> {
  await store.prepare("DELETE FROM answers WHERE at < ?").bind(cutoff(now)).run();
}
