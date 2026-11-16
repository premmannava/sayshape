/**
 * Follow-ups as edits (opt-in: `GenerateOptions.edits`). Instead of writing the
 * whole interface again, the model answers a change with line edits to the
 * current spec, addressed by the line numbers it was shown:
 *
 *   @replace 4-5        (or @replace 4) the lines after it replace lines 4 to 5
 *   @insert 7           the lines after it go after line 7 (0 = at the top)
 *   @delete 9-10        lines 9 to 10 go (or @delete 9)
 *
 * Numbers always mean the spec as sent, never shifted by earlier edits in the
 * same answer. Everything here is pure: no model, no parser.
 */
import { SpecFilter } from "./clean";
import { refineMessages, type ContextInfo, type ContextPolicy, type RefineContext } from "./context";
import type { ChatMessage } from "./stream";

export interface LineEdit {
  op: "replace" | "insert" | "delete";
  /** First line the edit covers; for insert, the line it goes after (0 = the top). */
  from: number;
  /** Last line the edit covers (equal to `from` for insert). */
  to: number;
  /** The new lines (none for delete). */
  lines: string[];
}

export type ParsedEdits = { ok: true; edits: LineEdit[] } | { ok: false; reason: string };
export type AppliedEdits = { ok: true; spec: string; applied: number } | { ok: false; reason: string };

const COMMAND = /^@(\w+)\s*(?:(\d+)(?:\s*-\s*(\d+))?)?\s*:?\s*$/;
const FENCE = /^\s*```/;
const GUTTER = /^\d+\|/;

/** A spec's lines, as the edits count them: line 1 is the first. A final newline doesn't make a line. */
export function specLines(spec: string): string[] {
  if (!spec) return [];
  const lines = spec.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The spec for the model to read: each line as `N|line` (the number, a bar, the line as it is). */
export function numberSpec(spec: string): string {
  return specLines(spec).map((l, i) => `${i + 1}|${l}`).join("\n");
}

/** Removes `<think>…</think>` from an answer, including a close with no open (thinking that began unmarked). */
export function stripThinking(text: string): string {
  let out = text;
  const orphan = out.indexOf("</think>");
  const open = out.indexOf("<think>");
  if (orphan >= 0 && (open < 0 || orphan < open)) out = out.slice(orphan + "</think>".length);
  out = out.replace(/<think>[\s\S]*?<\/think>/g, "");
  const unclosed = out.indexOf("<think>");
  return unclosed >= 0 ? out.slice(0, unclosed) : out;
}

/**
 * Reads edits from an answer. Code fences, blank lines around an edit's lines
 * and talk before the first command are ignored. No `@` command at all gives
 * `{ ok: true, edits: [] }` (not an edit answer); a bad command, or an edit
 * with nothing to write or something to write under a delete, gives `ok: false`.
 * Lines that carry the prompt's `N|` gutter are accepted with it removed, when
 * every line of that edit has it.
 */
export function parseEdits(text: string): ParsedEdits {
  const edits: LineEdit[] = [];
  let cur: LineEdit | undefined;
  const finish = (): string | undefined => {
    if (!cur) return undefined;
    const body = cur.lines;
    while (body.length && !body[0]!.trim()) body.shift();
    while (body.length && !body[body.length - 1]!.trim()) body.pop();
    if (body.length && body.every((l) => !l.trim() || GUTTER.test(l))) cur.lines = body.map((l) => l.replace(GUTTER, ""));
    const label = `@${cur.op} ${cur.from}${cur.to !== cur.from ? `-${cur.to}` : ""}`;
    const done = cur;
    cur = undefined;
    if (done.op === "delete" && done.lines.length) return `${label} has lines under it`;
    if (done.op !== "delete" && !done.lines.length) return `${label} has no lines`;
    edits.push(done);
    return undefined;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const t = line.trim();
    if (t.startsWith("@")) {
      const m = COMMAND.exec(t);
      const op = m?.[1];
      if (!m || (op !== "replace" && op !== "insert" && op !== "delete") || m[2] === undefined) return { ok: false, reason: `bad edit line "${t.slice(0, 40)}"` };
      const bad = finish();
      if (bad) return { ok: false, reason: bad };
      const from = Number(m[2]);
      const to = m[3] === undefined ? from : Number(m[3]);
      if (op === "insert" && m[3] !== undefined) return { ok: false, reason: `@insert takes one line number, got "${t}"` };
      cur = { op, from, to, lines: [] };
      continue;
    }
    if (FENCE.test(line)) continue;
    if (cur) cur.lines.push(line);
  }
  const bad = finish();
  if (bad) return { ok: false, reason: bad };
  return { ok: true, edits };
}

/**
 * Applies edits to a spec. Numbers refer to the spec as it is. Out of range, a
 * range that runs backwards, two edits covering the same line, or an insert
 * inside a replaced or deleted range all fail the whole set. Two inserts after
 * the same line keep the order they were written in.
 */
export function applyEdits(spec: string, edits: readonly LineEdit[]): AppliedEdits {
  const lines = specLines(spec);
  const n = lines.length;
  const label = (e: LineEdit) => `@${e.op} ${e.from}${e.to !== e.from ? `-${e.to}` : ""}`;
  for (const e of edits) {
    if (e.op === "insert") {
      if (e.from < 0 || e.from > n) return { ok: false, reason: `${label(e)} is out of range (the spec has ${n} lines)` };
    } else if (e.from < 1 || e.to > n) return { ok: false, reason: `${label(e)} is out of range (the spec has ${n} lines)` };
    else if (e.to < e.from) return { ok: false, reason: `${label(e)} runs backwards` };
  }
  const covered = new Array<number>(n + 1).fill(-1); // which edit covers a line
  for (const [i, e] of edits.entries()) {
    if (e.op === "insert") continue;
    for (let l = e.from; l <= e.to; l++) {
      if (covered[l]! >= 0) return { ok: false, reason: `${label(e)} overlaps ${label(edits[covered[l]!]!)}` };
      covered[l] = i;
    }
  }
  const after = new Map<number, string[]>();
  for (const e of edits) {
    if (e.op !== "insert") continue;
    // After line k, between lines k and k+1: inside a range if both are covered by the same edit.
    if (e.from >= 1 && e.from < n && covered[e.from]! >= 0 && covered[e.from] === covered[e.from + 1]) {
      return { ok: false, reason: `${label(e)} falls inside ${label(edits[covered[e.from]!]!)}` };
    }
    after.set(e.from, [...(after.get(e.from) ?? []), ...e.lines]);
  }
  const out: string[] = [...(after.get(0) ?? [])];
  for (let l = 1; l <= n; l++) {
    const i = covered[l]!;
    if (i < 0) out.push(lines[l - 1]!);
    else if (edits[i]!.op === "replace" && edits[i]!.from === l) out.push(...edits[i]!.lines);
    out.push(...(after.get(l) ?? []));
  }
  return { ok: true, spec: out.join("\n") + (out.length && spec.endsWith("\n") ? "\n" : ""), applied: edits.length };
}

/**
 * A whole spec written instead of edits: the answer with thinking, fences and
 * talk before it removed, if it starts at the left edge with a line that looks
 * like SayShape. A fragment that starts indented isn't one (it would drop
 * everything it doesn't repeat). Undefined when the answer isn't a spec.
 */
export function wholeSpecFrom(text: string, isSayShapeLine: (line: string) => boolean): string | undefined {
  if (/^\s*@/m.test(text)) return undefined;
  const f = new SpecFilter(isSayShapeLine);
  const spec = f.push(stripThinking(text)).text + f.end().text;
  if (!spec.trim() || /^\s/.test(spec)) return undefined;
  return spec;
}

/** Errors in `now` that `before` didn't have, matched by message (line numbers move when lines are edited). */
export function newProblems<T extends { message: string; severity: string }>(before: readonly T[], now: readonly T[]): T[] {
  const left = new Map<string, number>();
  for (const d of before) if (d.severity === "error") left.set(d.message, (left.get(d.message) ?? 0) + 1);
  const fresh: T[] = [];
  for (const d of now) {
    if (d.severity !== "error") continue;
    const k = left.get(d.message) ?? 0;
    if (k > 0) left.set(d.message, k - 1);
    else fresh.push(d);
  }
  return fresh;
}

/** The edit instructions sent with the change: short, since every follow-up pays for them. */
export function editInstructions(): string {
  return [
    `Its lines are numbered "N|" for reference; never write the numbers. Answer only with edits to those lines, numbered as shown (earlier edits don't shift them). New lines go under the command, indented as in the interface:`,
    `@replace 4-5`,
    `@insert 7   (after line 7; 0 = at the top)`,
    `@delete 9-10`,
    `Keep everything else as it is, including any edits made by hand. If most of the interface changes, write the whole interface instead.`,
  ].join("\n");
}

/**
 * Like refineMessages, for edits: the same first message, then the current spec
 * with line numbers, then the change with the edit instructions. Never
 * used unless the host asks for edits.
 */
export function refineEditMessages(ctx: RefineContext, request: string, policy: ContextPolicy = {}): { messages: ChatMessage[]; info: ContextInfo } {
  const plain = refineMessages(ctx, request, policy);
  // The plain request is the change, then the "Keep everything else…" paragraph, then any state.
  // Keep the state paragraph as it is; the change and the edit instructions replace the rest.
  const last = plain.messages[2]!.content;
  const keep = last.indexOf("\n\nKeep everything else as it is");
  const afterKeep = keep < 0 ? -1 : last.indexOf("\n\n", keep + 2);
  const state = afterKeep < 0 ? "" : last.slice(afterKeep);
  const messages: ChatMessage[] = [
    plain.messages[0]!,
    { role: "assistant", content: numberSpec(ctx.spec) },
    { role: "user", content: `Change the interface above: ${request.trim()}\n${editInstructions()}${state}` },
  ];
  return { messages, info: { ...plain.info, chars: messages.reduce((n, m) => n + m.content.length, 0) } };
}
