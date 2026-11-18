/**
 * Guides sized to the request (opt-in, src/capabilities.ts), in sayshape/model.
 *
 * Two ways in, both through the same assembler the MCP server uses:
 *
 * - The app knows what the screen needs (a form, a calculator, a scene): pass
 *   `capabilities` and the model is asked once, with a guide for just those.
 * - It doesn't (an open-ended request): the model gets the map first, which
 *   has the report syntax in it. A report comes back as the answer, in one
 *   call. For anything else the model answers a single `USE: …` line naming
 *   the capabilities and elements it needs, and is asked again with their
 *   guide: two calls, the first with a short answer. The same model that
 *   handles the request does the choosing; nothing else classifies it.
 *
 * The host must draw with the engine's `presets` on for reports.
 */
import { assembleGuide, languageMap, USE_PREFIX, type TopicProblem } from "../capabilities";
import type { GuideOptions } from "../prompt";
import { sumUsage } from "./context";
import { stripThinking } from "./edits";
import { generateSpec, type GenerateOptions, type GenerateResult } from "./generate";

export interface AdaptiveOptions extends Omit<GenerateOptions, "guide"> {
  /** Options every guide is built with (notes, actions, imageHosts, behavior…). Capabilities and mode are set here. */
  guide?: GuideOptions;
  /**
   * What the screen needs, when the app knows: capabilities ("forms",
   * "calculations"), element names, or both. One call with their guide.
   * Left out, the model chooses from the map (one call for a report, two otherwise).
   */
  capabilities?: readonly string[];
}

export interface AdaptiveRoute {
  /**
   * known: the app named the capabilities. map: the model answered from the map
   * (a report, or a spec it could write from the map alone). chosen: the model
   * named capabilities and was asked again with their guide. full: what it named
   * couldn't be used, or it asked for the whole guide.
   */
  kind: "known" | "map" | "chosen" | "full";
  /** Who picked the guide: the app, or the model answering the request. */
  chosenBy: "app" | "model";
  /** What the guide was built for (empty for the map and the full guide). */
  capabilities: string[];
  elements: string[];
  /** Names the model or app asked for that couldn't be used. */
  problems: TopicProblem[];
  /** Model calls made, repairs included. */
  calls: number;
}

export interface AdaptiveResult extends GenerateResult {
  route: AdaptiveRoute;
  /** The map call, when the model then asked for a guide (its usage is included in `usage`). */
  discovery?: GenerateResult;
}

/** The names on a `USE:` line in a model's answer, or undefined when it wrote no such line. */
export function readUseLine(raw: string): string[] | undefined {
  const text = stripThinking(raw).replace(/```\w*/g, "");
  const m = new RegExp(`^\\s*${USE_PREFIX}\\s*(.*)$`, "mi").exec(text);
  if (!m) return undefined;
  return m[1]!.split(/[,\s]+/).map((s) => s.replace(/[."'`\[\]]/g, "").trim()).filter(Boolean);
}

const callsOf = (r: GenerateResult) => 1 + (r.repair ? 1 : 0) + (r.edit && r.edit.attempt !== r.first ? 1 : 0);

export async function generateAdaptive(o: AdaptiveOptions): Promise<AdaptiveResult> {
  const { capabilities, guide: base = {}, ...rest } = o;
  const presets = !!o.presets || !!base.presets;
  const guideOpts: GuideOptions = { ...base, presets };

  if (capabilities) {
    const g = assembleGuide(o.registry, capabilities, guideOpts);
    const r = await generateSpec({ ...rest, presets, guide: g.text });
    return { ...r, route: { kind: g.full ? "full" : "known", chosenBy: "app", capabilities: g.capabilities, elements: g.elements, problems: g.problems, calls: callsOf(r) } };
  }

  const first = await generateSpec({ ...rest, presets, guide: languageMap(o.registry, guideOpts) });
  const asked = readUseLine(first.first.raw);
  if (!asked) return { ...first, route: { kind: "map", chosenBy: "model", capabilities: [], elements: [], problems: [], calls: callsOf(first) } };

  const g = assembleGuide(o.registry, asked, guideOpts);
  const second = await generateSpec({ ...rest, presets, guide: g.text });
  const attempts = [first.first, ...(first.repair ? [first.repair] : []), second.first, ...(second.repair ? [second.repair] : [])];
  return {
    ...second,
    usage: sumUsage(attempts.map((a) => a.usage)),
    timings: { ...second.timings, totalMs: first.timings.totalMs + second.timings.totalMs },
    discovery: first,
    route: { kind: g.full ? "full" : "chosen", chosenBy: "model", capabilities: g.capabilities, elements: g.elements, problems: g.problems, calls: callsOf(first) + callsOf(second) },
  };
}
