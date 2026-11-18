/**
 * The report for `npm run colors-eval`: one row per model, with counts beside every percentage so a
 * small sample can't pass for a measurement.
 */
import type { Usage } from "../../src/model/stream";
import { tallyOf, type ConversationResult } from "./run";
import type { Tally } from "./score";

export interface ReportMeta {
  date: string;
  url: string;
  runs: number;
  sets: string[];
  /** "real" for the server's own text, else the variant's name or "custom". */
  descriptionVariant: string;
  noteVariant: string;
  cache?: true | "1h";
  /** Dollars per input token and per output token, by model (OpenRouter's list). */
  cost?: (model: string, usage: Usage) => number | undefined;
}

/** "92% (33/36)", or a dash when nothing was counted. */
export function rate(n: number, of: number): string {
  return of === 0 ? "–" : `${Math.round((n / of) * 100)}% (${n}/${of})`;
}

const num = (x: number | undefined) => (x === undefined ? "?" : Math.round(x).toLocaleString("en-US"));
const usd = (x: number | undefined) => (x === undefined ? "?" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const models = (results: readonly ConversationResult[]) => [...new Set(results.map((r) => r.model))];

/** Per-model usage added up; a figure no conversation reported stays unknown. */
export function usageTotal(rs: readonly ConversationResult[]): Usage {
  const total: Usage = {};
  for (const r of rs) for (const k of Object.keys(r.usage) as Array<keyof Usage>) { const v = r.usage[k]; if (v !== undefined) total[k] = (total[k] ?? 0) + v; }
  return total;
}

function rowA(model: string, t: Tally): string {
  const none = t.noInterface.later + t.noInterface.ask + t.noInterface.reset;
  const turns = t.turns.later + t.turns.ask + t.turns.reset;
  return `| ${model} | ${t.conversationsA} | ${rate(t.askSame, t.askCalls)} | ${t.laterCalls} | ${rate(t.laterSent, t.laterCalls)} | ${rate(t.laterSame, t.laterCalls)} | ${rate(t.laterChanged, t.laterCalls)} | ${rate(t.laterDropped, t.laterCalls)} | ${rate(t.resetNone, t.resetCalls)} | ${none} of ${turns} |`;
}

export function report(results: readonly ConversationResult[], meta: ReportMeta): string {
  const lines: string[] = [];
  const ms = models(results);
  const by = (m: string, kind: "A" | "B") => results.filter((r) => r.model === m && r.kind === kind);
  lines.push("# Do models keep the colors?", "");
  lines.push(`${meta.date} · ${meta.url} · ${meta.runs} run${meta.runs === 1 ? "" : "s"} of each conversation · sets: ${meta.sets.join(", ")}`);
  lines.push(`Tool text: colors description ${meta.descriptionVariant === "real" ? "as the server writes it" : `"${meta.descriptionVariant}" variant`}; result note ${meta.noteVariant === "real" ? "as the server writes it" : `"${meta.noteVariant}" variant`}. Prompt caching: ${meta.cache === "1h" ? "marked, 1 hour" : meta.cache ? "marked, about 5 minutes" : "not marked"}.`, "");

  lines.push("## A: colors named once, then three interfaces without them, then \"go back to normal\"", "");
  lines.push("Later calls are the three interfaces asked for after the colors were named; every show_interface call counts, so a retry counts again. \"Sent\" is any colors at all; \"unchanged\" is exactly the named list in the named order; \"changed\" is sent but not that. \"Reset honored\" is the call made when the person asks for the normal look, which should send none. \"No interface\" counts messages where the model showed nothing.", "");
  lines.push("| Model | Conversations | Named colors sent on the first call | Later calls | Sent | Unchanged | Changed | Dropped | Reset honored | No interface |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const m of ms) lines.push(rowA(m, tallyOf(by(m, "A"))));

  lines.push("", "## B: no colors asked for", "");
  lines.push("| Model | Conversations | Calls | Invented colors | No interface |");
  lines.push("|---|---|---|---|---|");
  for (const m of ms) {
    const t = tallyOf(by(m, "B"));
    lines.push(`| ${m} | ${t.conversationsB} | ${t.plainCalls} | ${rate(t.plainInvented, t.plainCalls)} | ${t.noInterface.plain} of ${t.turns.plain} |`);
  }

  lines.push("", "## How the changed colors differ", "");
  lines.push("| Model | Another order | Some of them | Them and more | Other colors |");
  lines.push("|---|---|---|---|---|");
  for (const m of ms) {
    const k = tallyOf(by(m, "A")).laterKinds;
    lines.push(`| ${m} | ${k.reordered} | ${k.subset} | ${k.superset} | ${k.different} |`);
  }

  lines.push("", "## By set", "");
  const sets = [...new Set(results.map((r) => r.set))];
  lines.push("| Model | " + sets.map((s) => `${s}: unchanged (A) | ${s}: invented (B)`).join(" | ") + " |");
  lines.push("|---|" + sets.map(() => "---|---").join("|") + "|");
  for (const m of ms) {
    const cells = sets.map((s) => {
      const a = tallyOf(results.filter((r) => r.model === m && r.kind === "A" && r.set === s));
      const b = tallyOf(results.filter((r) => r.model === m && r.kind === "B" && r.set === s));
      return `${rate(a.laterSame, a.laterCalls)} | ${rate(b.plainInvented, b.plainCalls)}`;
    });
    lines.push(`| ${m} | ${cells.join(" | ")} |`);
  }

  lines.push("", "## Cost and size", "");
  lines.push("| Model | Conversations | Model requests | Input tokens | From cache | Output tokens | Cost | Ended early |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const m of ms) {
    const rs = results.filter((r) => r.model === m);
    const u = usageTotal(rs);
    const est = rs.some((r) => r.estimated) ? " (some estimated by the script, not reported)" : "";
    const cost = meta.cost?.(m, u);
    const stopped = rs.filter((r) => r.stopped);
    lines.push(`| ${m} | ${rs.length} | ${rs.reduce((a, r) => a + r.requests, 0)} | ${num(u.promptTokens)} | ${u.promptTokens && u.cachedTokens !== undefined ? `${Math.round((u.cachedTokens / u.promptTokens) * 100)}%` : "?"} | ${num(u.completionTokens)}${est} | ${usd(cost)} | ${stopped.length} |`);
  }
  const stopped = results.filter((r) => r.stopped);
  if (stopped.length) {
    lines.push("", "Conversations that ended before their last message (their calls up to that point are counted above):", "");
    for (const r of stopped) lines.push(`- ${r.model}, ${r.id}, run ${r.run}: ${r.stopped}`);
  }
  const malformed = results.reduce((a, r) => a + r.malformed, 0);
  if (malformed) lines.push("", `${malformed} show_interface call${malformed === 1 ? "" : "s"} had arguments that were not a JSON object, so ${malformed === 1 ? "it was" : "they were"} not scored.`);
  lines.push("");
  return lines.join("\n");
}
