/**
 * Data answers with the report preset (opt-in): ask with the small report
 * guide first; when the model says the request needs more than a report (it
 * answers REPORT_FALLBACK alone), ask once more with a full guide. The host
 * must draw with the engine's `presets` on.
 */
import { REPORT_FALLBACK, type GuideOptions } from "../prompt";
import { sumUsage } from "./context";
import { generateSpec, type GenerateOptions, type GenerateResult } from "./generate";

export interface ReportOptions extends GenerateOptions {
  /** The guide for requests a report can't answer. Default: the compact guide. */
  fallbackGuide?: string | GuideOptions;
}

export interface ReportResult extends GenerateResult {
  /** True when the model said a report couldn't do it and the full guide was used. */
  fellBack: boolean;
  /** The report-guide call, when it fell back (its usage is included in `usage`). */
  reportAttempt?: GenerateResult;
}

/** Whether an answer is the report guide's "needs the full language" word, alone. */
export function asksForFullGuide(raw: string): boolean {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```\w*/g, "").trim().replace(/[.!]$/, "") === REPORT_FALLBACK;
}

export async function generateReport(o: ReportOptions): Promise<ReportResult> {
  const base: GuideOptions = typeof o.guide === "object" ? o.guide : {};
  const first = await generateSpec({ ...o, guide: { ...base, mode: "report" }, presets: true });
  if (first.spec.trim() || !asksForFullGuide(first.first.raw)) return { ...first, fellBack: false };
  const second = await generateSpec({ ...o, guide: o.fallbackGuide ?? { ...base, mode: "compact" }, presets: true });
  const attempts = [first.first, ...(first.repair ? [first.repair] : []), second.first, ...(second.repair ? [second.repair] : [])];
  return { ...second, usage: sumUsage(attempts.map((a) => a.usage)), fellBack: true, reportAttempt: first };
}
