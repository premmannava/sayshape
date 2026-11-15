/**
 * Saved chat answers (worker/src/records.ts, worker/src/handler.ts): nothing
 * is saved unless the page asks and the worker has a database; spreadsheet
 * questions never are; a row holds the visitor's words and how the answer
 * went, never their IP address; saving never holds up or breaks an answer;
 * feedback only changes a saved row by its id; rows go after 30 days.
 */
import { describe, expect, it } from "vitest";
import { handle, type Env } from "../worker/src/handler";
import worker from "../worker/src/index";
import {
  applyFeedback, deleteOld, MAX_NOTE_CHARS, MAX_USAGE, readFeedback, readRecordRequest, RETENTION_DAYS, type RecordStatement, type RecordStore,
} from "../worker/src/records";
import { fakeModel, type Reply } from "./fake-model";

const ORIGIN = "https://premmannava.github.io";
const IP = "203.0.113.7";
const env: Env = { MODEL_API_KEY: "test-key-not-real", MODEL: "vendor/model", MODEL_LABEL: "Test Model", ALLOWED_ORIGINS: ORIGIN };
const ID = "6f1c2a9e-3b4d-4e5f-8a6b-7c8d9e0f1a2b";
const NOW = new Date("2026-11-15T12:00:00.000Z");
const SPEC = `card\n  text "Phone plans" style=title\n  stepper "People" bind=people\nstate people=4\n`;
const RECORD = { chat: "chat-1234abcd", turn: 1, width: 724 };

type Row = Record<string, string | number | null>;

/** A D1 database in memory, for the three statements records.ts runs. */
function memoryStore(opts: { fail?: boolean } = {}): RecordStore & { rows: Row[] } {
  const rows: Row[] = [];
  const cols = ["id", "chat", "turn", "at", "followup", "question", "outcome", "spec", "problems", "repaired", "ms", "tokens_in", "tokens_out", "model", "width", "error"];
  return {
    rows,
    prepare(sql: string): RecordStatement {
      let args: Array<string | number | null> = [];
      const st: RecordStatement = {
        bind(...v) { args = v; return st; },
        async run() {
          if (opts.fail) throw new Error("D1 is down");
          if (sql.startsWith("INSERT")) {
            rows.push({ ...Object.fromEntries(cols.map((c, i) => [c, args[i] ?? null])), vote: null, note: null, changes: 0, actions: 0, screens: 0 });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE")) {
            const [vote, note, changes, actions, screens, id, since] = args as [string | null, string | null, number, number, number, string, string];
            const hit = rows.filter((r) => r.id === id && (r.at as string) >= since);
            for (const r of hit) {
              r.vote = vote ?? r.vote ?? null;
              r.note = note ?? r.note ?? null;
              r.changes = Math.max(r.changes as number, changes);
              r.actions = Math.max(r.actions as number, actions);
              r.screens = Math.max(r.screens as number, screens);
            }
            return { meta: { changes: hit.length } };
          }
          if (sql.startsWith("DELETE")) {
            const before = rows.length;
            const keep = rows.filter((r) => (r.at as string) >= (args[0] as string));
            rows.splice(0, rows.length, ...keep);
            return { meta: { changes: before - rows.length } };
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
      return st;
    },
  };
}

function post(body: unknown, path = "/answer", origin = ORIGIN) {
  return new Request(`https://proxy.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": IP },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Ask, wait for the answer and anything saved after it, and return its events. */
async function ask(body: unknown, e: Env, replies: Reply[] = [{ content: [SPEC], usage: { prompt_tokens: 4_000, completion_tokens: 90 } }]) {
  const model = fakeModel(replies);
  const pending: Promise<unknown>[] = [];
  const res = await handle(post(body), e, { fetch: model.fetch, waitUntil: (p) => pending.push(p), now: () => NOW, newId: () => ID });
  const text = await res.text();
  await Promise.all(pending);
  return { text, events: text.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe("saving chat answers", () => {
  it("saves nothing, and answers exactly as before, when the visitor didn't ask", async () => {
    const store = memoryStore();
    const before = await ask({ kind: "chat", message: "Compare phone plans" }, env);
    const after = await ask({ kind: "chat", message: "Compare phone plans" }, { ...env, RECORDS: store });
    // The same events, field for field; only the measured time can differ.
    const timeless = (t: string) => t.replace(/"ms":\d+/g, '"ms":0');
    expect(timeless(after.text)).toBe(timeless(before.text));
    expect(store.rows).toEqual([]);
  });

  it("saves nothing without a database, even when asked, and still answers", async () => {
    const { events } = await ask({ kind: "chat", message: "Compare phone plans", record: RECORD }, env);
    expect(events.at(-1)).toMatchObject({ t: "done", spec: SPEC });
    expect(events.at(-1)).not.toHaveProperty("record");
  });

  it("saves the question and how the answer went, and gives the page the row's id", async () => {
    const store = memoryStore();
    const { events } = await ask({ kind: "chat", message: "  Compare phone plans  ", record: RECORD }, { ...env, RECORDS: store });
    expect(events.at(-1)).toMatchObject({ t: "done", record: ID });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      id: ID, chat: "chat-1234abcd", turn: 1, at: NOW.toISOString(), followup: 0, question: "Compare phone plans", outcome: "done", spec: SPEC,
      problems: 0, repaired: 0, tokens_in: 4_000, tokens_out: 90, model: "Test Model", width: 720, error: null, vote: null, changes: 0,
    });
  });

  it("never saves the visitor's IP address or the model's thinking", async () => {
    const store = memoryStore();
    await ask({ kind: "chat", message: "Compare phone plans", record: RECORD }, { ...env, RECORDS: store }, [{ content: [SPEC], reasoning: ["Let me think about phone plans privately"] }]);
    const saved = JSON.stringify(store.rows);
    expect(saved).not.toContain(IP);
    expect(saved).not.toContain("privately");
  });

  it("marks a follow-up, saving only its own words", async () => {
    const store = memoryStore();
    const body = { kind: "chat", message: "Make it a donut", refine: { task: "Compare phone plans", changes: [], spec: SPEC }, record: { ...RECORD, turn: 2 } };
    await ask(body, { ...env, RECORDS: store });
    expect(store.rows[0]).toMatchObject({ turn: 2, followup: 1, question: "Make it a donut" });
  });

  it("never saves a spreadsheet question", async () => {
    const store = memoryStore();
    const question = {
      question: "Sum of TIV by country", rows: 3, record: RECORD,
      columns: [{ name: "country", type: "text", distinct: 2 }, { name: "tiv", type: "number", distinct: 3 }],
      sample: [{ country: "Germany", tiv: 1 }, { country: "India", tiv: 2 }, { country: "Germany", tiv: 3 }],
    };
    const spec = `chart "TIV" kind=bar items={group(data, 'country', 'tiv')} x=country y=tiv\n`;
    const { events } = await ask(question, { ...env, RECORDS: store }, [{ content: [spec] }]);
    expect(events.at(-1)).toMatchObject({ t: "done" });
    expect(events.at(-1)).not.toHaveProperty("record");
    expect(store.rows).toEqual([]);
  });

  it("saves answers that drew nothing or failed, with what the visitor saw", async () => {
    const store = memoryStore();
    await ask({ kind: "chat", message: "Hello", record: RECORD }, { ...env, RECORDS: store }, [{ content: ["Hi! How can I help?"] }, { content: ["Still just words."] }]);
    await ask({ kind: "chat", message: "Plans", record: { ...RECORD, turn: 2 } }, { ...env, RECORDS: store }, []);
    expect(store.rows.map((r) => r.outcome)).toEqual(["empty", "failed"]);
    expect(store.rows[0]!.error).toMatch(/didn't draw anything/);
    expect(store.rows[1]!.error).toMatch(/model service had a problem/);
  });

  it("still answers when saving fails", async () => {
    const { events } = await ask({ kind: "chat", message: "Compare phone plans", record: RECORD }, { ...env, RECORDS: memoryStore({ fail: true }) });
    expect(events.at(-1)).toMatchObject({ t: "done", spec: SPEC });
  });

  it("reads only the record field the page sends", () => {
    expect(readRecordRequest(RECORD)).toEqual({ chat: "chat-1234abcd", turn: 1, width: 720 });
    expect(readRecordRequest({ chat: "chat-1234abcd", turn: 3 })).toEqual({ chat: "chat-1234abcd", turn: 3, width: null });
    for (const bad of [undefined, null, true, "yes", [], { chat: "short", turn: 1 }, { chat: "has spaces in it", turn: 1 }, { chat: "chat-1234abcd", turn: 0 }, { chat: "chat-1234abcd", turn: 1.5 }, { chat: "chat-1234abcd", turn: 51 }, { chat: "x".repeat(65), turn: 1 }]) {
      expect(readRecordRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("says in /status whether answers can be saved", async () => {
    const status = async (e: Env) => (await handle(new Request("https://proxy.example/status", { headers: { Origin: ORIGIN } }), e)).json();
    expect(await status(env)).toEqual({ enabled: true, model: "Test Model" });
    expect(await status({ ...env, RECORDS: memoryStore() })).toEqual({ enabled: true, model: "Test Model", recording: true });
    expect(await status({ ...env, RECORDS: memoryStore(), GENERATION_ENABLED: "false" })).toEqual({ enabled: false, reason: "off" });
  });
});

describe("feedback on a saved answer", () => {
  async function saved() {
    const store = memoryStore();
    await ask({ kind: "chat", message: "Compare phone plans", record: RECORD }, { ...env, RECORDS: store });
    return store;
  }
  const send = (store: RecordStore | undefined, body: unknown, origin = ORIGIN) => handle(post(body, "/feedback", origin), { ...env, RECORDS: store }, { now: () => NOW });

  it("adds a thumb, a note and usage to the row, usage only going up", async () => {
    const store = await saved();
    expect((await send(store, { id: ID, vote: "down" })).status).toBe(204);
    expect((await send(store, { id: ID, note: "  The chart had no labels " })).status).toBe(204);
    expect((await send(store, { id: ID, used: { changes: 3, actions: 1, screens: 0 } })).status).toBe(204);
    expect((await send(store, { id: ID, used: { changes: 2, actions: 0, screens: 1 } })).status).toBe(204);
    expect(store.rows[0]).toMatchObject({ vote: "down", note: "The chart had no labels", changes: 3, actions: 1, screens: 1 });
    expect((await send(store, { id: ID, vote: "up" })).status).toBe(204);
    expect(store.rows[0]).toMatchObject({ vote: "up", note: "The chart had no labels" });
  });

  it("changes nothing for an id it never gave, or once the answer's past its days", async () => {
    const store = await saved();
    expect((await send(store, { id: "00000000-0000-4000-8000-000000000000", vote: "up" })).status).toBe(404);
    const later = new Date(NOW.getTime() + (RETENTION_DAYS + 1) * 86_400_000);
    expect(await applyFeedback(store, { id: ID, vote: "up" }, later)).toBe(false);
    expect(store.rows[0]!.vote).toBeNull();
  });

  it("refuses feedback it can't read, other origins, and pages with no database", async () => {
    const store = await saved();
    for (const bad of ["not json", [], { vote: "up" }, { id: "../etc", vote: "up" }, { id: ID }, { id: ID, vote: "meh" }, { id: ID, note: 4 }, { id: ID, note: "x".repeat(MAX_NOTE_CHARS + 1) }, { id: ID, used: { changes: -1, actions: 0, screens: 0 } }, { id: ID, used: { changes: 1 } }]) {
      expect((await send(store, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await send(store, { id: ID, note: "x".repeat(3_000) })).status).toBe(413);
    expect((await send(store, { id: ID, vote: "up" }, "https://evil.example")).status).toBe(403);
    expect((await send(undefined, { id: ID, vote: "up" })).status).toBe(404);
    expect(store.rows[0]!.vote).toBeNull();
  });

  it("caps usage counts", () => {
    expect(readFeedback({ id: ID, used: { changes: 1e9, actions: 0, screens: 0 } })).toEqual({ id: ID, used: { changes: MAX_USAGE, actions: 0, screens: 0 } });
  });

  it("says when feedback can't be saved", async () => {
    expect((await send(memoryStore({ fail: true }), { id: ID, vote: "up" })).status).toBe(503);
  });
});

describe("keeping saved answers for 30 days", () => {
  it("deletes answers older than RETENTION_DAYS, keeping newer ones", async () => {
    const store = memoryStore();
    const day = 86_400_000;
    for (const [i, age] of [[1, RETENTION_DAYS + 2], [2, RETENTION_DAYS - 1], [3, 0]] as const) {
      await ask({ kind: "chat", message: `Q${i}`, record: { ...RECORD, turn: i } }, { ...env, RECORDS: store });
      store.rows.at(-1)!.at = new Date(NOW.getTime() - age * day).toISOString();
    }
    await deleteOld(store, NOW);
    expect(store.rows.map((r) => r.question)).toEqual(["Q2", "Q3"]);
  });

  it("runs from the worker's daily cron, and does nothing without a database", async () => {
    const store = memoryStore();
    await ask({ kind: "chat", message: "Old", record: RECORD }, { ...env, RECORDS: store });
    store.rows[0]!.at = "2020-01-01T00:00:00.000Z";
    const waits: Promise<unknown>[] = [];
    worker.scheduled({}, { ...env, RECORDS: store }, { waitUntil: (p) => waits.push(p) });
    worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(waits).toHaveLength(1);
    expect(store.rows).toEqual([]);
  });
});
