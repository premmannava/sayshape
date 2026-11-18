/**
 * Parallel sections (experimental, opt-in): one call plans the screen (shared
 * state and a one-line brief per section), several calls write the sections at
 * the same time, and the parts are put together in order, checked and repaired
 * once, as generateSpec does. It costs extra input (the guide and the request
 * are sent once per call) and may finish sooner on a long screen. With it off,
 * nothing changes: generateSpec doesn't know about this file. Delete the file
 * and its one export line in index.ts to remove it.
 */
import { parse } from "../parser";
import { languageGuide, type GuideMode, type GuideOptions } from "../prompt";
import { resolveProfile } from "../profiles";
import type { Diagnostic } from "../types";
import { sayShapeLineTest, SpecFilter } from "./clean";
import { sumUsage, type UsageTotals } from "./context";
import { generateSpec, repairPrompt, type Attempt, type GenerateOptions, type GenerateResult, type Phase } from "./generate";
import { streamChat, type ChatMessage, type Usage } from "./stream";

export const DEFAULT_MAX_SECTIONS = 6;
/** Whatever maxSections says, never more calls than this at once. */
export const MAX_SECTIONS_LIMIT = 12;
const MAX_SHARED_LINES = 12;
const MAX_BRIEF_CHARS = 300;

/** What the planning call decided: the lines every section shares, and what each section is for. */
export interface Plan {
  /** `state` and `derive` lines, checked on their own, in the order the planner wrote them. */
  shared: string[];
  /** Names the app supplies that the plan says sections read (only names the app listed in stateNames). */
  data: string[];
  /** One line per section, in screen order. */
  sections: string[];
  /** Sections past maxSections were folded into the last one's brief: how many. */
  folded: number;
}

export interface SectionsOptions extends GenerateOptions {
  /** At most this many sections (and so this many parallel calls). Default 6, never more than 12. */
  maxSections?: number;
  /**
   * Each section as it finishes, in whatever order that happens (index from 0,
   * the section's SayShape text). onText still gets the assembled spec in order.
   */
  onSection?: (index: number, text: string) => void;
}

export type CallRole = "plan" | "section" | "repair" | "single" | "single-repair";

export interface SectionCall {
  role: CallRole;
  /** The section's index, for role "section". */
  section?: number;
  /** For role "plan", spec is the plan text; for a section, the lines it wrote (diagnostics are checked on the assembled spec, so empty here). */
  attempt: Attempt;
}

export interface SectionsCost {
  /** Number of model calls, repair included. */
  calls: number;
  /** Characters sent in each call, in the order of `calls` on the result, and their sum. */
  perCall: number[];
  inputChars: number;
  /** What one generateSpec call would send first: the guide and the request. */
  singleCallInputChars: number;
  /** inputChars - singleCallInputChars: the extra input this cost compared with one call (a repair counts, as it would for one call too). */
  overheadChars: number;
  /** overheadChars / 4: an estimate, not a token count. */
  overheadEstimatedTokens: number;
}

export interface SectionsResult {
  spec: string;
  diagnostics: Diagnostic[];
  /** "sections" when the plan was used; "fallback" when one generateSpec call wrote the screen instead. */
  mode: "sections" | "fallback";
  fallbackReason?: string;
  plan?: Plan;
  /** The planning call (undefined only when no planner ran: refine and history go straight to one call). */
  planner?: Attempt;
  /** The section calls, in screen order (empty on a fallback). */
  sections: Attempt[];
  /** Sections that came back with no SayShape. */
  emptySections: number[];
  /** The one full-spec repair, when it ran (in a fallback, it's single.repair). */
  repair?: Attempt;
  /** The generateSpec result on a fallback. */
  single?: GenerateResult;
  /** Every call, in the order they started. */
  calls: SectionCall[];
  usage: UsageTotals;
  cost: SectionsCost;
  timings: {
    /** Until any call sent anything at all. */
    firstTokenMs?: number;
    /** Until the planning call finished (the fallback's one call starts after it). */
    planMs: number;
    /** Until the first text was shown (shared lines count, so this is usually the plan's end). */
    firstLineMs?: number;
    /** Until the first line of a section was shown. */
    firstSectionLineMs?: number;
    totalMs: number;
  };
  /** The highest number of section calls in flight at once. */
  maxInFlight: number;
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- the plan

/**
 * The planner's plain-text format, one item per line:
 *
 *   state status="All" query=""
 *   derive shown={count(orders)}
 *   data orders products
 *   section: A header with the title and the status filter
 *   section: A table of orders, filtered by status
 *
 * Reading it is tolerant: fences, thinking, bullets, bold marks, "Section 2 -",
 * and bare numbered lines are all fine; anything else is ignored.
 */
export function plannerInstructions(maxSections: number, stateNames?: readonly string[]): string {
  const data = stateNames?.length
    ? `The app supplies these names, readable by name and never declared: ${stateNames.join(", ")}.\n`
    : "";
  return [
    "Do not write the interface yet. Plan it so several writers can each write one part at the same time, then stop.",
    "Answer in plain text, in exactly this format and nothing else:",
    "",
    'state status="All" query=""',
    "derive shown={count(orders)}",
    ...(stateNames?.length ? [`data ${stateNames.slice(0, 2).join(" ")}`] : []),
    "section: what the first block shows, and which shared names it uses",
    "section: what the next block shows",
    "",
    "Rules:",
    '- "state" lines: only state that two or more sections read or write, each with a small starting value (a word, a number, an empty text). Leave them out if there is none. "derive" lines: only values several sections show.',
    ...(stateNames?.length ? ['- One "data" line naming the supplied names the screen uses. Leave it out if none.'] : []),
    `- "section" lines: 2 to ${maxSections}, in screen order from top to bottom, one line each. A section must make sense using only the shared names, never another section's elements.`,
    "- If the screen is too small to split, write a single section line.",
    data.trimEnd(),
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").trimEnd();
}

const FENCE = /^\s*(```|~~~)/;

function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Thinking that only closes: the answer is what follows.
  const close = t.lastIndexOf("</think>");
  if (close >= 0) t = t.slice(close + "</think>".length);
  return t.replace(/<think>[\s\S]*$/, "");
}

function stateNamesIn(line: string): string[] {
  const noText = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const m = /^(?:state|derive)\s+(.*)$/.exec(noText.trim());
  return m ? [...m[1]!.matchAll(/([A-Za-z_][\w]*)\s*=/g)].map((x) => x[1]!) : [];
}

/** Reads the planner's answer. Never throws; a plan with fewer than two sections is for the caller to refuse. */
export function parsePlan(text: string, opts: { maxSections?: number; stateNames?: readonly string[]; check?: Parameters<typeof parse>[1] } = {}): Plan {
  const max = Math.max(1, Math.min(opts.maxSections ?? DEFAULT_MAX_SECTIONS, MAX_SECTIONS_LIMIT));
  const shared: string[] = [], data: string[] = [], briefs: string[] = [];
  const seen = new Set<string>();
  let inList = false;
  for (const raw of stripThinking(text).split("\n")) {
    if (FENCE.test(raw)) continue;
    // Bullets and bold marks the model adds around a line.
    const line = raw.replace(/\*\*/g, "").replace(/^\s*[-*•]\s+/, "").trim();
    if (!line) continue;
    if (/^(state|derive)\s+\S+\s*=/.test(line)) {
      const names = stateNamesIn(line);
      if (!names.length || names.some((n) => seen.has(n)) || shared.length >= MAX_SHARED_LINES) continue;
      names.forEach((n) => seen.add(n));
      shared.push(line.replace(/\s+/g, " "));
      continue;
    }
    const d = /^data\b\s*[:=]?\s*(.*)$/i.exec(line);
    if (d) {
      for (const n of d[1]!.split(/[\s,]+/)) if (/^[A-Za-z_]\w*$/.test(n) && opts.stateNames?.includes(n) && !data.includes(n)) data.push(n);
      continue;
    }
    const s = /^sections?\s*(?:#?\d+)?\s*[:.)\-–—]\s*(.+)$/i.exec(line);
    if (s) { briefs.push(s[1]!.trim()); inList = true; continue; }
    if (/^sections?\s*:?$/i.test(line)) { inList = true; continue; }
    const n = /^\d+\s*[.):\-–—]\s+(.+)$/.exec(line) ?? (inList ? /^[-*•]\s*(.+)$/.exec(line) : null);
    if (n) briefs.push(n[1]!.trim());
  }
  const trimmed = briefs.filter(Boolean).map((b) => b.slice(0, MAX_BRIEF_CHARS));
  let folded = 0;
  if (trimmed.length > max) {
    folded = trimmed.length - max;
    // Nothing is dropped: the overflow becomes part of the last kept section.
    const rest = trimmed.splice(max - 1);
    trimmed.push(rest.join("; also: ").slice(0, MAX_BRIEF_CHARS * 2));
  }
  return { shared: checkShared(shared, opts), data, sections: trimmed, folded };
}

/** Drops shared lines the parser has anything to say about (even a warning: the parser only warns on a bad derive) when read on their own (a derive reading an undeclared name, a bad value). */
function checkShared(lines: string[], opts: { stateNames?: readonly string[]; check?: Parameters<typeof parse>[1] }): string[] {
  if (!lines.length || !opts.check) return lines;
  const bad = new Set(parse(lines.join("\n") + "\n", opts.check, { knownNames: opts.stateNames }).diagnostics.map((d) => d.line));
  return lines.filter((_, i) => !bad.has(i + 1));
}

/** The plan as every section writer sees it, the same text for all of them (so it stays a shared prefix). */
export function planText(plan: Plan): string {
  return [
    "Another writer is writing each of the other parts of this screen at the same time. Everyone follows this plan.",
    "",
    plan.shared.length
      ? `Shared state, already declared at the top of the screen. Use these names exactly, and never declare them again:\n${plan.shared.join("\n")}`
      : "Shared state: none.",
    ...(plan.data.length ? ["", `App data you can read by name: ${plan.data.join(", ")}`] : []),
    "",
    "Sections, in screen order:",
    ...plan.sections.map((b, i) => `${i + 1}. ${b}`),
  ].join("\n");
}

export function sectionInstructions(plan: Plan, index: number): string {
  return `Write only section ${index + 1} of ${plan.sections.length}: ${plan.sections[index]}\nOutput only SayShape for this section, starting at the left edge, as one top-level container (a card or column, say) or as top-level lines. Don't write state or derive lines for the shared names, and don't write the other sections.`;
}

// ---------------------------------------------------------------- the run

export async function generateSections(o: SectionsOptions): Promise<SectionsResult> {
  const now = o.now ?? clock;
  const start = now();
  const guideOpts = typeof o.guide === "string" ? undefined : o.guide ?? {};
  const guide = typeof o.guide === "string" ? o.guide : languageGuide(o.registry, guideOpts);
  const profile = resolveProfile(o.registry, guideOpts?.profile);
  const guideInfo = (mode: GuideMode | "custom") => ({ mode, profile: profile.name });
  const guideLabel = guideInfo(guideOpts ? guideOpts.mode ?? "full" : "custom");
  const checkWith = o.enforceProfile ? profile.registry : o.registry;
  const behavior = !!guideOpts?.behavior;
  const isSayShapeLine = sayShapeLineTest((name) => o.registry.has(name), { behavior });
  const maxSections = Math.max(2, Math.min(Math.floor(o.maxSections ?? DEFAULT_MAX_SECTIONS), MAX_SECTIONS_LIMIT));

  const timings: SectionsResult["timings"] = { planMs: 0, totalMs: 0 };
  const calls: SectionCall[] = [];
  let inFlight = 0, maxInFlight = 0;

  const request = o.request + (o.userSuffix ? `\n\n${o.userSuffix}` : "");
  const singleCallInputChars = guide.length + request.length;
  const finish = (r: Omit<SectionsResult, "usage" | "cost" | "calls" | "maxInFlight" | "timings">, baseline: number): SectionsResult => {
    timings.totalMs = now() - start;
    const perCall = calls.map((c) => c.attempt.inputChars);
    const inputChars = perCall.reduce((a, b) => a + b, 0);
    return {
      ...r, calls, timings, maxInFlight,
      usage: sumUsage(calls.map((c) => c.attempt.usage)),
      cost: { calls: calls.length, perCall, inputChars, singleCallInputChars: baseline, overheadChars: inputChars - baseline, overheadEstimatedTokens: Math.round((inputChars - baseline) / 4) },
    };
  };

  // Changing a screen or continuing a conversation isn't a job for sections: one call, as before (the full
  // guide unless one was given, as the sections themselves use).
  if (o.refine || o.history?.length) {
    const single = await generateSpec({ ...o, guide: o.guide ?? {} });
    calls.push({ role: "single", attempt: single.first });
    if (single.repair) calls.push({ role: "single-repair", attempt: single.repair });
    timings.firstTokenMs = single.timings.firstTokenMs;
    timings.firstLineMs = single.timings.firstLineMs;
    return finish({ spec: single.spec, diagnostics: single.diagnostics, mode: "fallback", fallbackReason: "refine and history use one call", sections: [], emptySections: [], single, repair: single.repair }, single.first.inputChars);
  }

  // One abort for every call: the caller's signal, or the first call to fail.
  const control = new AbortController();
  const onAbort = () => control.abort();
  if (o.signal?.aborted) control.abort(); else o.signal?.addEventListener("abort", onAbort, { once: true });

  let phase: Phase = "waiting";
  const setPhase = (p: Phase) => { if (p !== phase) { phase = p; o.onPhase?.(p); } };
  o.onPhase?.("waiting");

  /** One streamed call. `clean` keeps only SayShape lines (a section, a repair); otherwise the text as it is (the plan). */
  const run = async (msgs: ChatMessage[], clean: boolean, onDelta?: (text: string) => void, onReset?: () => void): Promise<Attempt> => {
    const began = now();
    const filter = new SpecFilter(isSayShapeLine);
    const usage: Usage = {};
    let raw = "", spec = "", thinking = "";
    let firstTokenMs: number | undefined;
    const give = (out: { text: string; reset: boolean }) => {
      if (out.reset) { spec = ""; onReset?.(); }
      if (!out.text) return;
      spec += out.text;
      onDelta?.(out.text);
    };
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      for await (const part of streamChat(o.config, msgs, { signal: control.signal, fetch: o.fetch, usage })) {
        if (firstTokenMs === undefined) firstTokenMs = now() - began;
        if (timings.firstTokenMs === undefined) timings.firstTokenMs = now() - start;
        if (part.kind === "reasoning") { thinking += part.text; continue; }
        raw += part.text;
        if (clean) give(filter.push(part.text));
      }
    } finally { inFlight--; }
    if (clean) {
      give(filter.end());
      // Nothing but thinking: look for the lines inside it, as generateSpec does.
      if (!spec.trim()) {
        const again = new SpecFilter(isSayShapeLine);
        const found = again.push(`${thinking}\n${raw}`.replace(/<\/?think>/g, "\n")).text + again.end().text;
        if (found.trim()) give({ text: found.trimEnd() + "\n", reset: false });
      }
    } else spec = stripThinking(raw).trim();
    const inputChars = msgs.reduce((n, m) => n + m.content.length, 0);
    const thinkingChars = thinking.length + filter.thinkingChars;
    return {
      spec, diagnostics: [], raw, usage, thinkingChars, thinking, recovered: false, guide: guideLabel,
      inputChars, estimatedInputTokens: Math.round(inputChars / 4), estimatedThinkingTokens: Math.round(thinkingChars / 4),
      ms: now() - began, firstTokenMs,
    };
  };

  try {
    // 1. Plan. The guide and the request come first and are the same in every call, so servers with prefix caching reuse them.
    const system: ChatMessage = { role: "system", content: guide };
    const planCall = await run([system, { role: "user", content: `${request}\n\n${plannerInstructions(maxSections, o.stateNames)}` }], false);
    calls.push({ role: "plan", attempt: planCall });
    timings.planMs = now() - start;
    const plan = parsePlan(planCall.spec, { maxSections, stateNames: o.stateNames, check: checkWith });

    if (plan.sections.length < 2) {
      const reason = plan.sections.length === 0 ? "the plan couldn't be read" : "the plan has one section";
      const single = await generateSpec({ ...o, guide: o.guide ?? {}, signal: control.signal });
      calls.push({ role: "single", attempt: single.first });
      if (single.repair) calls.push({ role: "single-repair", attempt: single.repair });
      timings.firstLineMs = single.timings.firstLineMs === undefined ? undefined : timings.planMs + single.timings.firstLineMs;
      return finish({ spec: single.spec, diagnostics: single.diagnostics, mode: "fallback", fallbackReason: reason, plan: plan.sections.length ? plan : undefined, planner: planCall, sections: [], emptySections: [], single, repair: single.repair }, singleCallInputChars);
    }

    // 2. Stream order. Shared lines go first: they're tiny, known the moment the plan is, and a prefix then never
    // reads a name that isn't declared yet. Sections are shown in order: the section whose turn it is streams live,
    // later ones are held and flushed whole when their turn comes.
    const declared = new Set(plan.shared.flatMap(stateNamesIn));
    const n = plan.sections.length;
    const held: string[] = Array(n).fill("");
    const finished: boolean[] = Array(n).fill(false);
    let assembled = "", cursor = 0, shown = 0;
    const show = (text: string, section: boolean) => {
      if (!text) return;
      if (timings.firstLineMs === undefined) timings.firstLineMs = now() - start;
      if (section && timings.firstSectionLineMs === undefined) timings.firstSectionLineMs = now() - start;
      assembled += text;
      setPhase("writing");
      o.onText?.(text);
    };
    if (plan.shared.length) show(plan.shared.join("\n") + "\n", false);

    // A section that declares a shared name again would be a duplicate: those lines are dropped.
    const keep = (text: string) => text.split("\n").filter((l, i, a) => (i === a.length - 1 && l === "") || !(/^(state|derive)\s/.test(l) && stateNamesIn(l).length > 0 && stateNamesIn(l).every((x) => declared.has(x)))).join("\n");
    const advance = () => {
      while (cursor < n && finished[cursor]) {
        cursor++;
        shown = 0;
        if (cursor < n) { show(held[cursor]!, true); shown = held[cursor]!.length; }
      }
    };

    // 3. Write the sections at the same time.
    const base: ChatMessage = { role: "user", content: `${request}\n\n${planText(plan)}\n\n` };
    const attempts = await Promise.all(plan.sections.map(async (_, i) => {
      calls.push({ role: "section", section: i, attempt: undefined as unknown as Attempt });
      const slot = calls.length - 1;
      const a = await run([system, { ...base, content: base.content + sectionInstructions(plan, i) }], true, (text) => {
        const kept = keep(text);
        held[i] += kept;
        if (i === cursor) { show(kept, true); shown = held[i]!.length; }
      });
      finished[i] = true;
      a.spec = held[i]!;
      calls[slot]!.attempt = a;
      o.onSection?.(i, a.spec);
      advance();
      return a;
    }));
    const emptySections = attempts.flatMap((a, i) => (a.spec.trim() ? [] : [i]));
    let spec = attempts.map((a) => (a.spec && !a.spec.endsWith("\n") ? a.spec + "\n" : a.spec)).join("");
    spec = (plan.shared.length ? plan.shared.join("\n") + "\n" : "") + spec;

    // 4. Check the whole and repair once, the way generateSpec does.
    const check = (text: string): Diagnostic[] => [...parse(text, checkWith, { knownNames: o.stateNames, ...(behavior ? { behavior } : {}) }).diagnostics, ...(text.trim() ? o.check?.(text) ?? [] : [])];
    const diagnostics = check(spec);
    const repairOn = o.repairOn ?? "any";
    const needsRepair = repairOn === "any" ? diagnostics.length > 0 : repairOn === "errors" ? diagnostics.some((d) => d.severity === "error") : false;
    let repair: Attempt | undefined;
    if (needsRepair && spec.trim()) {
      o.onReset?.("repair");
      setPhase("repairing");
      const fallbackGuide = o.repairGuide === "full" && guideOpts && (guideOpts.mode ?? "full") !== "full";
      const msgs: ChatMessage[] = [
        fallbackGuide ? { role: "system", content: languageGuide(o.registry, { ...guideOpts, mode: "full" }) } : system,
        { role: "user", content: request },
        { role: "assistant", content: spec },
        { role: "user", content: repairPrompt(diagnostics) },
      ];
      repair = await run(msgs, true, (text) => show(text, true));
      repair.diagnostics = check(repair.spec);
      if (fallbackGuide) repair.guide = guideInfo("full");
      calls.push({ role: "repair", attempt: repair });
    }
    setPhase("done");
    const useRepair = repair && repair.spec.trim() && repair.diagnostics.length <= diagnostics.length;
    return finish({
      spec: useRepair ? repair!.spec : spec,
      diagnostics: useRepair ? repair!.diagnostics : diagnostics,
      mode: "sections", plan, planner: planCall, sections: attempts, emptySections, repair,
    }, singleCallInputChars);
  } catch (e) {
    control.abort();
    throw e;
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
}
