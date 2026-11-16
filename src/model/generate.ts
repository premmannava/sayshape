/**
 * Asks a model for a SayShape spec, streams the clean lines out as they arrive,
 * checks the result with SayShape's own parser, and asks once for a fix if it has
 * problems. Used by the playground and the evaluation script; works in
 * browsers and Node.
 */
import { parse } from "../parser";
import { languageGuide, type GuideMode, type GuideOptions } from "../prompt";
import { resolveProfile } from "../profiles";
import type { Registry } from "../registry";
import type { Diagnostic } from "../types";
import { sayShapeLineTest, SpecFilter } from "./clean";
import { applyEdits, newProblems, parseEdits, refineEditMessages, stripThinking, wholeSpecFrom } from "./edits";
import { refineMessages, sumUsage, type ContextInfo, type ContextPolicy, type RefineContext, type UsageTotals } from "./context";
import { streamChat, type ChatMessage, type ModelConfig, type Usage } from "./stream";

export type Phase = "waiting" | "thinking" | "writing" | "repairing" | "done";

export interface Attempt {
  spec: string;
  diagnostics: Diagnostic[];
  /** Raw text the model sent, before thinking and fences were removed. */
  raw: string;
  usage: Usage;
  thinkingChars: number;
  /** Thinking the server sent separately (reasoning_content), kept for diagnosing empty answers. */
  thinking: string;
  /**
   * True when the answer was empty and the spec was recovered from the
   * thinking: some models write the spec inside a thinking block they never close.
   */
  recovered: boolean;
  /** The guide this attempt was sent: its mode ("custom" for a guide passed as text) and profile. */
  guide: { mode: GuideMode | "custom"; profile: string };
  /** Characters sent (every message), and that divided by 4: an estimate, not a token count. */
  inputChars: number;
  estimatedInputTokens: number;
  /** Thinking characters / 4: an estimate, kept apart from the server's reasoningTokens. */
  estimatedThinkingTokens: number;
  /** How long this attempt took, from its request to its last byte. */
  ms: number;
  /** From this attempt's start until its first content or reasoning chunk. */
  firstTokenMs?: number;
}

/** What happened to a request made with `edits: true`. */
export interface EditReport {
  /**
   * "edits": the answer was line edits and they were applied. "rewrite": the
   * model answered with a whole spec, accepted as it is. "fallback": the edits
   * couldn't be used, so one full-rewrite request was made (`result.first`).
   */
  mode: "edits" | "rewrite" | "fallback";
  /** Edits applied (0 unless mode is "edits"). */
  applied: number;
  /** Why the edits were not used (fallback only). */
  reason?: string;
  /** The edit-mode request's attempt (its `raw` is what the model wrote; `spec` is empty on a fallback). */
  attempt: Attempt;
  /** The exact messages sent for the edit-mode request. */
  messages: ChatMessage[];
}

export interface GenerateResult {
  /** The final spec: the repaired one if a repair ran, otherwise the first. */
  spec: string;
  diagnostics: Diagnostic[];
  first: Attempt;
  repair?: Attempt;
  timings: {
    /** Until the model sent anything at all (thinking included). */
    firstTokenMs?: number;
    /** Until the first SayShape line could be shown: what a user waits for. */
    firstLineMs?: number;
    totalMs: number;
  };
  /**
   * The conversation ending with the accepted spec: the guide, the context,
   * the request and the final spec. A rejected repair isn't in it, and a
   * kept repair replaces the first spec, so it can be sent as history.
   */
  messages: ChatMessage[];
  /** Everything that was sent and received, repair included, for debugging. */
  transcript: ChatMessage[];
  /** Usage over all attempts. A total stays undefined (unknown) when any attempt didn't report it. */
  usage: UsageTotals;
  /** The context sent with the request. */
  context: ContextInfo;
  /** Present only when `edits` was on and used (refine with a non-empty spec). */
  edit?: EditReport;
  /** The elements a spec was checked against: "renderer" (every registered one) or the profile's. */
  validatedAgainst: "renderer" | "profile";
}

export interface GenerateOptions {
  config: ModelConfig;
  registry: Registry;
  /** What the user asked for. */
  request: string;
  /** The guide, or options to build it from the registry. */
  guide?: string | GuideOptions;
  /**
   * Earlier turns, sent as they are, between the guide and the request. For
   * changing a screen, refine is usually better: it doesn't grow every turn.
   */
  history?: ChatMessage[];
  /**
   * Change an existing spec: sends the original task, lasting requirements,
   * earlier changes, the current spec and the change (request), instead of
   * the whole conversation. See context.ts. Can't be used with history.
   */
  refine?: RefineContext;
  /** Limits for refine. */
  contextPolicy?: ContextPolicy;
  /**
   * Opt-in, with `refine`: ask for line edits to the current spec instead of a
   * whole new one (see edits.ts and docs/model.md). Nothing is streamed while the
   * edits arrive; once they are applied onText gets the whole patched spec,
   * after onReset("edits"). Edits that fail, or leave errors the current spec
   * didn't have, fall back to one normal full-rewrite request. Ignored without
   * refine or when refine.spec is empty. Off by default; messages are then unchanged.
   */
  edits?: boolean;
  /**
   * The guide for the repair attempt: "same" (default) or "full", which
   * switches a compact guide to the full one for the repair, with the same
   * profile. Only works when guide is options, not text.
   */
  repairGuide?: "same" | "full";
  /**
   * Check specs against the profile's elements, not every registered one,
   * so an element outside the profile is sent back for repair. Default false.
   */
  enforceProfile?: boolean;
  /** Appended to the user's request, e.g. "/no_think" to turn off Qwen3's thinking. */
  userSuffix?: string;
  /**
   * Names of state the app supplies itself (sayshape.state.set), so a spec that
   * reads them isn't sent back for repair as using unknown names.
   */
  stateNames?: readonly string[];
  /**
   * The app's own checks on a spec, beyond the parser's: problems it returns
   * join the parser's diagnostics, so they're reported and an error one sends
   * the spec back for repair with its message. For rules only the app knows,
   * like "read the data by name, never copy its rows".
   */
  check?: (spec: string) => Diagnostic[];
  /** Repair when the first spec has: any diagnostic (default), only errors, or never. */
  repairOn?: "any" | "errors" | "never";
  /** Clean SayShape text as it streams. */
  onText?: (text: string) => void;
  /** Throw away what onText sent so far (a repair is starting, or it was thinking after all). */
  onReset?: (reason: "repair" | "thinking" | "edits") => void;
  onPhase?: (phase: Phase) => void;
  /**
   * Thinking the server sends in its own field (reasoning_content), as it
   * streams, for a host that shows it. Free text, never SayShape: never
   * draw it. Thinking written inside the answer (<think>…) isn't passed on.
   */
  onThinking?: (text: string) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => number;
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The message asking the model to fix its spec, listing what the parser found. */
export function repairPrompt(diagnostics: Diagnostic[]): string {
  const list = diagnostics.map((d) => `- Line ${d.line} (${d.severity}): ${d.message}`).join("\n");
  return `Your SayShape has these problems:\n${list}\n\nWrite the whole interface again with them fixed. Output only SayShape.`;
}

export async function generateSpec(o: GenerateOptions): Promise<GenerateResult> {
  if (o.history?.length && o.refine) throw new Error("generateSpec: pass history or refine, not both");
  const now = o.now ?? clock;
  const start = now();
  const guideOpts = typeof o.guide === "string" ? undefined : o.guide ?? {};
  const guide = typeof o.guide === "string" ? o.guide : languageGuide(o.registry, guideOpts);
  const profile = resolveProfile(o.registry, guideOpts?.profile);
  const guideInfo = (mode: GuideMode | "custom") => ({ mode, profile: profile.name });
  const firstGuide = guideInfo(guideOpts ? guideOpts.mode ?? "full" : "custom");
  const checkWith = o.enforceProfile ? profile.registry : o.registry;
  const behavior = !!guideOpts?.behavior;
  const isSayShapeLine = sayShapeLineTest((name) => o.registry.has(name), { behavior });
  const timings: GenerateResult["timings"] = { totalMs: 0 };

  // The guide first, then the context, then the request: the guide is the
  // same for every request with the same options, so it stays a shared
  // prefix that servers with prefix caching can reuse.
  const suffix = o.userSuffix ? `\n\n${o.userSuffix}` : "";
  let context: ChatMessage[], request: ChatMessage, info: ContextInfo;
  let editSent: ChatMessage[] | undefined;
  if (o.refine) {
    const r = refineMessages(o.refine, o.request, o.contextPolicy);
    context = r.messages.slice(0, -1);
    request = { ...r.messages[r.messages.length - 1]!, content: r.messages[r.messages.length - 1]!.content + suffix };
    info = r.info;
    if (o.edits && o.refine.spec.trim()) {
      const e = refineEditMessages(o.refine, o.request, o.contextPolicy);
      const lastMsg = e.messages[e.messages.length - 1]!;
      const editMsgs = [...e.messages.slice(0, -1), { ...lastMsg, content: lastMsg.content + suffix }];
      editSent = [{ role: "system", content: guide }, ...editMsgs];
      info = e.info;
    }
  } else {
    context = o.history ?? [];
    request = { role: "user", content: o.request + suffix };
    info = { policy: context.length ? "history" : "none", messages: context.length, chars: 0 };
  }
  info.chars = editSent ? editSent.slice(1).reduce((n, m) => n + m.content.length, 0) : [...context, request].reduce((n, m) => n + m.content.length, 0);
  const sent: ChatMessage[] = [{ role: "system", content: guide }, ...context, request];

  const diagnose = (spec: string): Diagnostic[] => [
    ...parse(spec, checkWith, { knownNames: o.stateNames, ...(behavior ? { behavior } : {}) }).diagnostics,
    ...(spec.trim() ? o.check?.(spec) ?? [] : []),
  ];

  const run = async (msgs: ChatMessage[], g: Attempt["guide"]): Promise<Attempt> => {
    const began = now();
    const filter = new SpecFilter(isSayShapeLine);
    const usage: Usage = {};
    let raw = "", spec = "", thinking = "", phase: Phase = "waiting";
    let firstTokenMs: number | undefined;
    const setPhase = (p: Phase) => { if (p !== phase) { phase = p; o.onPhase?.(p); } };
    const emit = (out: { text: string; reset: boolean }) => {
      if (out.reset) { spec = ""; o.onReset?.("thinking"); }
      if (!out.text) return;
      if (timings.firstLineMs === undefined) timings.firstLineMs = now() - start;
      spec += out.text;
      setPhase("writing");
      o.onText?.(out.text);
    };
    o.onPhase?.("waiting");
    for await (const part of streamChat(o.config, msgs, { signal: o.signal, fetch: o.fetch, usage })) {
      if (firstTokenMs === undefined) firstTokenMs = now() - began;
      if (timings.firstTokenMs === undefined) timings.firstTokenMs = now() - start;
      if (part.kind === "reasoning") { thinking += part.text; setPhase("thinking"); o.onThinking?.(part.text); continue; }
      raw += part.text;
      const before = filter.thinkingChars;
      emit(filter.push(part.text));
      if (filter.thinkingChars > before && phase === "waiting") setPhase("thinking");
    }
    emit(filter.end());
    // Nothing but thinking: look for the spec inside it before giving up.
    let recovered = false;
    if (!spec.trim()) {
      const again = new SpecFilter(isSayShapeLine);
      const text = `${thinking}\n${raw}`.replace(/<\/?think>/g, "\n");
      const found = again.push(text).text + again.end().text;
      if (found.trim()) { recovered = true; emit({ text: found.trimEnd() + "\n", reset: false }); }
    }
    const diagnostics = diagnose(spec);
    const inputChars = msgs.reduce((n, m) => n + m.content.length, 0);
    const thinkingChars = thinking.length + filter.thinkingChars;
    return {
      spec, diagnostics, raw, usage, thinkingChars, thinking, recovered,
      guide: g, inputChars, estimatedInputTokens: Math.round(inputChars / 4), estimatedThinkingTokens: Math.round(thinkingChars / 4),
      ms: now() - began, firstTokenMs,
    };
  };

  // Edit mode: one request for edits; on any trouble, fall back to the normal request below.
  let first: Attempt | undefined;
  let edit: EditReport | undefined;
  if (editSent) {
    const began = now();
    const usage: Usage = {};
    let raw = "", thinking = "", firstTokenMs: number | undefined, phase: Phase = "waiting";
    const setPhase = (p: Phase) => { if (p !== phase) { phase = p; o.onPhase?.(p); } };
    o.onPhase?.("waiting");
    for await (const part of streamChat(o.config, editSent, { signal: o.signal, fetch: o.fetch, usage })) {
      if (firstTokenMs === undefined) firstTokenMs = now() - began;
      if (timings.firstTokenMs === undefined) timings.firstTokenMs = now() - start;
      if (part.kind === "reasoning") { thinking += part.text; setPhase("thinking"); o.onThinking?.(part.text); continue; }
      raw += part.text;
      setPhase("writing");
    }
    const text = stripThinking(raw);
    const thinkingChars = thinking.length + raw.length - text.length;
    const inputChars = editSent.reduce((n, m) => n + m.content.length, 0);
    const attemptOf = (spec: string, diagnostics: Diagnostic[]): Attempt => ({
      spec, diagnostics, raw, usage, thinkingChars, thinking, recovered: false,
      guide: firstGuide, inputChars, estimatedInputTokens: Math.round(inputChars / 4), estimatedThinkingTokens: Math.round(thinkingChars / 4),
      ms: now() - began, firstTokenMs,
    });
    const current = o.refine!.spec;
    let spec: string | undefined, mode: EditReport["mode"] = "edits", applied = 0, reason: string | undefined;
    const parsed = parseEdits(text);
    if (!parsed.ok) reason = parsed.reason;
    else if (parsed.edits.length) {
      const done = applyEdits(current, parsed.edits);
      if (!done.ok) reason = done.reason;
      else if (!done.spec.trim()) reason = "the edits left nothing";
      else {
        const fresh = newProblems(diagnose(current), diagnose(done.spec));
        if (fresh.length) reason = `the edits caused ${fresh.length === 1 ? "an error" : `${fresh.length} errors`}: ${fresh[0]!.message}`;
        else { spec = done.spec; applied = done.applied; }
      }
    } else {
      spec = wholeSpecFrom(text, isSayShapeLine);
      mode = "rewrite";
      if (spec === undefined) reason = "the answer had neither edits nor a whole interface";
    }
    if (spec !== undefined) {
      if (mode === "edits") o.onReset?.("edits");
      if (timings.firstLineMs === undefined) timings.firstLineMs = now() - start;
      setPhase("writing");
      o.onText?.(spec);
      first = attemptOf(spec, diagnose(spec));
      edit = { mode, applied, attempt: first, messages: editSent };
    } else {
      edit = { mode: "fallback", applied: 0, reason, attempt: attemptOf("", []), messages: editSent };
    }
  }
  if (!first) first = await run(sent, firstGuide);
  const transcript: ChatMessage[] = [...sent, { role: "assistant", content: first.spec }];
  const repairOn = o.repairOn ?? "any";
  const needsRepair =
    repairOn === "any" ? first.diagnostics.length > 0 :
    repairOn === "errors" ? first.diagnostics.some((d) => d.severity === "error") : false;

  let repair: Attempt | undefined;
  if (needsRepair && first.spec.trim()) {
    o.onReset?.("repair");
    o.onPhase?.("repairing");
    // Optionally swap a compact guide for the full one, with the same profile.
    const fallback = o.repairGuide === "full" && guideOpts && (guideOpts.mode ?? "full") !== "full";
    const repairMsgs: ChatMessage[] = [
      fallback ? { role: "system", content: languageGuide(o.registry, { ...guideOpts, mode: "full" }) } : sent[0]!,
      ...transcript.slice(1),
      { role: "user", content: repairPrompt(first.diagnostics) },
    ];
    repair = await run(repairMsgs, fallback ? guideInfo("full") : firstGuide);
    transcript.length = 0;
    transcript.push(...repairMsgs, { role: "assistant", content: repair.spec });
  }

  timings.totalMs = now() - start;
  o.onPhase?.("done");
  // Keep the first spec if the repair came back empty or worse.
  const useRepair = repair && repair.spec.trim() && repair.diagnostics.length <= first.diagnostics.length;
  const final = useRepair ? repair! : first;
  return {
    spec: final.spec,
    diagnostics: final.diagnostics,
    first,
    repair,
    timings,
    messages: [...sent, { role: "assistant", content: final.spec }],
    transcript,
    usage: sumUsage([...(edit && edit.attempt !== first ? [edit.attempt.usage] : []), first.usage, ...(repair ? [repair.usage] : [])]),
    context: info,
    ...(edit ? { edit } : {}),
    validatedAgainst: o.enforceProfile ? "profile" : "renderer",
  };
}
