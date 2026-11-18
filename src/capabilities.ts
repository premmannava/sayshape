/**
 * Capabilities (opt-in): a small map of the language, and guides built for
 * just what a screen needs.
 *
 * The full guide tells a model about every element; most answers use a few.
 * Here a model, or an app that already knows what it's building, names the
 * building blocks it needs (capabilities such as forms or calculations,
 * element names, or both) and gets one guide with their syntax, the shared
 * rules once, and a short example where one teaches how the parts work
 * together. The model that's answering the request does the choosing, from
 * the map: there's no classifier, router or extra service.
 *
 * Nothing about an element is written here. Elements come from the registry
 * (a capability names categories or element types), syntax from their
 * ComponentDefs, sections and examples from prompt.ts, the report preset from
 * presets/report.ts. What this file keeps is the one line on when to use each
 * capability, and which elements, sections and examples it brings.
 */
import type { Category } from "./component";
import { parse } from "./parser";
import {
  elementGuide, elementIndex, guideSections, languageGuide, WORKED_EXAMPLES,
  type GuideOptions, type GuideSection, type WorkedExampleName,
} from "./prompt";
import { reportSyntax } from "./presets/report";
import { ALWAYS_EXPOSED, resolveProfile } from "./profiles";
import type { Registry } from "./registry";

/** What has to be on for a capability to be offered. */
type Requirement = "presets" | "scenes" | "behavior" | "look" | "motion" | "pictures";

export interface CapabilityDef {
  name: string;
  /** One line for the map: when to ask for it. */
  when: string;
  /** Element categories it brings (every registered element in them, scene elements aside). */
  categories?: readonly Category[];
  /** Elements of those categories it leaves to another capability. */
  except?: readonly string[];
  /** Element types it brings, where registered. */
  elements?: readonly string[];
  /** Elements whose full docs (props explained, example) it brings, not just their one-line signature. */
  details?: readonly string[];
  /** Guide sections (by name) it takes from the full guide in place of the compact one's shorter version. */
  fullSections?: readonly string[];
  /** Worked examples it can show, in order of preference: the first the guide's elements can build is shown. */
  examples?: readonly WorkedExampleName[];
  requires?: Requirement;
  /** What to ask for instead, when it isn't available here. */
  instead?: readonly string[];
}

/**
 * The capabilities, in the order the map lists them and guides put them together.
 * Element-holding ones mirror the registry's categories, so a newly registered
 * element is always in one (test/capabilities.test.ts checks).
 */
export const CAPABILITIES: readonly CapabilityDef[] = [
  { name: "report", requires: "presets", instead: ["data", "lists"], when: "figures, charts and a table over one list, with filters, and nothing else on screen reads those filters" },
  { name: "lists", elements: ["each"], fullSections: ["data"], examples: ["orders", "todo", "shopping"], when: "lists and records in state: repeat with each; filter, sort, group and total them" },
  { name: "calculations", elements: ["stat", "stepper", "slider"], examples: ["calculator"], when: "values worked out from other values with derive, updating as people change inputs" },
  { name: "forms", categories: ["input"], except: ["link", "menu", "menu-item"], examples: ["signup", "form"], when: "fields, choices and buttons people fill in: required=, error= and disabled= checks, and emit: to send it" },
  { name: "actions", elements: ["button", "link", "menu", "menu-item"], fullSections: ["actions"], when: "what presses do: change state (set, inc, add, remove), go between screens, notify, or tell the app (emit)" },
  { name: "layout", categories: ["layout"], when: "cards, rows, grids, columns, accordions, carousels, scroll areas, dialogs and slide decks" },
  { name: "content", categories: ["content"], when: "text, images, badges, avatars, callouts, icons and code" },
  { name: "data", categories: ["data"], when: "numbers and records: charts, tables, stats, meters, details, compare, boards, trees, flows, schedules, maps" },
  { name: "navigation", categories: ["navigation"], when: "several screens, tabs, breadcrumbs and pages" },
  { name: "feedback", categories: ["feedback"], when: "progress, loading placeholders and empty states" },
  // A scene repeats shapes with each items={range(n)}, as its example shows.
  { name: "scenes", requires: "scenes", elements: ["each"], details: ["scene"], instead: ["data", "content"], when: "pictures and animations drawn from shapes, which read state and the time t" },
  // Its guide says to give people a Pause button, so the button comes along.
  { name: "behavior", requires: "behavior", elements: ["button"], fullSections: ["behavior"], details: ["group"], instead: ["actions"], when: "things that change by themselves on a timer (countdowns, simulations), and shapes people drag" },
  { name: "look", requires: "look", when: "a screen's overall style: mood, type, shape and density" },
  { name: "motion", requires: "motion", when: "elements that come in with a fade, rise or scale" },
  { name: "pictures", requires: "pictures", when: "text and buttons laid over a photo; round or zooming images" },
];

/** The answer for "none of these fit": the whole compatible guide. */
export const FULL_GUIDE_TOPIC = "full";

/** Every screen is laid out with these, so guides always describe them (where registered). */
const BASE_ELEMENTS = ["column", "row", "grid", "card", "text"] as const;

/** A request the guide couldn't fill, with what to ask for instead. */
export interface TopicProblem {
  topic: string;
  kind: "unavailable" | "unknown";
  message: string;
  /** Names that can be asked for instead (capabilities or elements). */
  instead: string[];
}

export interface AssembledGuide {
  /** The guide to send the model. */
  text: string;
  sections: GuideSection[];
  /** The capabilities it covers, in CAPABILITIES order. */
  capabilities: string[];
  /** Elements asked for by name, in the registry's order. */
  elements: string[];
  /** Every element the guide describes, in the registry's order. */
  exposed: string[];
  /** Whether it's the whole guide (asked for, or nothing narrower could be built). */
  full: boolean;
  /** What couldn't be included, each with a message for the model. */
  problems: TopicProblem[];
}

/** The scene element and those that only go inside it, found from parents= so nothing is listed by hand. */
export function sceneElements(registry: Registry): string[] {
  if (!registry.has("scene")) return [];
  const family = new Set(["scene"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of registry.all()) {
      if (family.has(c.type) || !c.parents?.length) continue;
      // A group goes inside groups: its own type doesn't keep it out.
      if (c.parents.every((p) => family.has(p) || p === c.type)) { family.add(c.type); grew = true; }
    }
  }
  return registry.all().filter((c) => family.has(c.type)).map((c) => c.type);
}

function isOn(req: Requirement | undefined, registry: Registry, opts: GuideOptions): boolean {
  switch (req) {
    case undefined: return true;
    case "presets": return !!opts.presets;
    case "scenes": return registry.has("scene");
    default: return !!opts[req];
  }
}

const WHY_OFF: Record<Requirement, string> = {
  presets: "this app doesn't draw reports",
  scenes: "this app doesn't draw scenes",
  behavior: "this app doesn't run timers or dragging",
  look: "this app's theme decides the style",
  motion: "this app doesn't play entrance motion",
  pictures: "this app shows images as plain pictures",
};

/** The capabilities this registry and these options offer. */
export function availableCapabilities(registry: Registry, opts: GuideOptions = {}): CapabilityDef[] {
  return CAPABILITIES.filter((c) => isOn(c.requires, registry, opts));
}

/** The elements a capability brings, in the registry's order: what its categories hold, scene elements aside, and its own. */
export function capabilityElements(registry: Registry, name: string): string[] {
  const def = CAPABILITIES.find((c) => c.name === name);
  if (!def) return [];
  const scene = new Set(sceneElements(registry));
  const own = new Set([...(def.elements ?? []), ...(def.details ?? []), ...(def.name === "scenes" ? scene : [])]);
  return registry.all()
    .filter((c) => own.has(c.type) || (!!def.categories?.includes(c.category) && !scene.has(c.type) && !def.except?.includes(c.type)))
    .map((c) => c.type);
}

/**
 * A name as asked: lower case, and a plural or singular of a capability read as it (form → forms),
 * unless it's an element's own name (list is the element, lists the capability).
 */
function canonical(topic: string, names: readonly string[], registry: Registry): string {
  const t = topic.trim().toLowerCase();
  if (names.includes(t) || registry.has(t)) return t;
  if (names.includes(t + "s")) return t + "s";
  if (t.endsWith("s") && names.includes(t.slice(0, -1))) return t.slice(0, -1);
  return t;
}

/** Element names close to one that doesn't exist: the same start, or one containing the other. */
function closeNames(word: string, names: readonly string[]): string[] {
  const w = word.toLowerCase();
  return names.filter((n) => n.startsWith(w.slice(0, 3)) || n.includes(w) || (n.length > 3 && w.includes(n))).slice(0, 4);
}

/** The guide sections a resolved request needs, from prompt.ts's compact and full guides. */
function buildSections(registry: Registry, caps: readonly CapabilityDef[], named: readonly string[], opts: GuideOptions): { sections: GuideSection[]; exposed: string[] } {
  const has = (n: string) => caps.some((c) => c.name === n);
  const reportOnly = caps.length === 1 && has("report") && !named.length;
  const notes = opts.notes?.trim() ? [{ name: "notes", text: `ABOUT THIS APP\n${opts.notes.trim()}` }] : [];
  if (reportOnly) {
    // The report preset alone: its own syntax is the whole guide.
    return {
      sections: [{ name: "intro", text: "You show data in SayShape with one report. Output only SayShape: no prose, no code fences." }, { name: "report", text: reportSyntax() }, ...notes],
      exposed: [],
    };
  }

  const wanted = new Set<string>(BASE_ELEMENTS.filter((t) => registry.has(t)));
  for (const c of caps) capabilityElements(registry, c.name).forEach((t) => wanted.add(t));
  named.forEach((t) => wanted.add(t));
  const profile = resolveProfile(registry, [...wanted]);
  const valid = (spec: string) => parse(spec.endsWith("\n") ? spec : spec + "\n", profile.registry, opts.behavior && has("behavior") ? { behavior: true } : {}).diagnostics.length === 0;
  // One example per capability, the first its elements can build, so no control is added just to keep an example.
  const examples: WorkedExampleName[] = [];
  for (const c of caps) {
    const pick = c.examples?.find((n) => valid(WORKED_EXAMPLES[n]));
    if (pick && !examples.includes(pick)) examples.push(pick);
  }
  const base: GuideOptions = {
    ...opts,
    capabilities: undefined,
    mode: "compact",
    profile: profile.types,
    workedExamples: examples.length ? examples : false,
    behavior: !!opts.behavior && has("behavior"),
    look: !!opts.look && has("look"),
    motion: !!opts.motion && has("motion"),
    pictures: !!opts.pictures && has("pictures"),
  };
  const compact = guideSections(registry, base);
  const swaps = new Set(caps.flatMap((c) => c.fullSections ?? []));
  const full = swaps.size ? guideSections(registry, { ...base, mode: "full" }) : [];
  // Without lists in the guide, the expressions section's line on list functions has nothing to work on.
  const lists = profile.types.includes("each") || profile.types.some((t) => registry.get(t)?.category === "data");
  const sections = compact.map((s) => (swaps.has(s.name) ? full.find((f) => f.name === s.name) ?? s : s))
    .map((s) => (s.name === "expressions" && !lists ? { ...s, text: s.text.replace(/\n- On lists: [^\n]*/, "") } : s));

  // Full docs, example included, for what was asked for by name and what a capability details.
  const detailed = profile.types.filter((t) => named.includes(t) || caps.some((c) => c.details?.includes(t)));
  if (detailed.length) {
    const at = sections.findIndex((s) => s.name === "picks" || s.name === "rules");
    // Named elements bring what they hold (a table's table-column); a capability's details are just themselves.
    const byName = detailed.filter((t) => named.includes(t));
    const own = detailed.filter((t) => !named.includes(t));
    const docs = [
      ...(byName.length ? [elementGuide(profile.registry, byName, { behavior: base.behavior, pictures: base.pictures }).text] : []),
      ...(own.length ? [elementGuide(profile.registry, own, { behavior: base.behavior, pictures: base.pictures, alone: true }).text] : []),
    ];
    const block = { name: "details", text: `DETAILS\n${docs.join("\n\n")}` };
    sections.splice(at < 0 ? sections.length : at, 0, block);
  }
  if (has("report")) {
    // Its filters are state of its own that nothing outside the report reads (see docs/capabilities.md).
    const at = sections.findIndex((s) => s.name === "rules");
    sections.splice(at < 0 ? sections.length : at, 0, { name: "report", text: `${reportSyntax()}\n- A report's filters belong to it: nothing outside the report can read them. When an input or a total must follow a filter, build that screen from lists, charts and stats instead.` });
  }
  return { sections, exposed: [...profile.types] };
}

/**
 * One guide for several capabilities and elements, asked for together. Names
 * are matched case-blind (a singular or plural of a capability is that
 * capability); the order they come in doesn't matter, so the same set always
 * gives the same text. Names that can't be used are left out and reported in
 * `problems`; when nothing usable is left, or "full" is asked for, the guide
 * is the whole compatible one.
 */
export function assembleGuide(registry: Registry, topics: readonly string[], opts: GuideOptions = {}): AssembledGuide {
  const { capabilities: _ignored, ...rest } = opts;
  const offered = availableCapabilities(registry, rest);
  const allNames = CAPABILITIES.map((c) => c.name);
  const elements = registry.all().map((c) => c.type);
  const caps = new Set<string>();
  const named = new Set<string>();
  const problems: TopicProblem[] = [];
  let wantsFull = false;
  for (const raw of topics) {
    const t = canonical(raw, allNames, registry);
    if (!t) continue;
    if (t === FULL_GUIDE_TOPIC) { wantsFull = true; continue; }
    const def = CAPABILITIES.find((c) => c.name === t);
    if (def && offered.includes(def)) { caps.add(t); continue; }
    if (def) {
      const instead = (def.instead ?? []).filter((n) => offered.some((c) => c.name === n));
      problems.push({ topic: t, kind: "unavailable", instead, message: `"${t}" isn't available here: ${WHY_OFF[def.requires!]}.${instead.length ? ` Ask for ${instead.join(" or ")} instead.` : ""}` });
      continue;
    }
    if (registry.has(t)) { named.add(t); continue; }
    const instead = closeNames(t, elements);
    problems.push({
      topic: t,
      kind: "unknown",
      instead,
      message: `There's no capability or element called "${t}".${instead.length ? ` Close elements: ${instead.join(", ")}.` : ""} Capabilities: ${offered.map((c) => c.name).join(", ")}, or ${FULL_GUIDE_TOPIC} for the whole guide. Elements are listed by name in the map.`,
    });
  }
  problems.sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
  const capList = offered.filter((c) => caps.has(c.name));
  const namedList = elements.filter((t) => named.has(t));

  if (wantsFull || (!capList.length && !namedList.length)) {
    const sections = guideSections(registry, { ...rest, capabilities: undefined });
    return { text: sections.map((s) => s.text).join("\n\n"), sections, capabilities: [], elements: namedList, exposed: resolveProfile(registry, rest.profile).types.slice(), full: true, problems };
  }
  const { sections, exposed } = buildSections(registry, capList, namedList, rest);
  return { text: sections.map((s) => s.text).join("\n\n"), sections, capabilities: capList.map((c) => c.name), elements: namedList, exposed, full: false, problems };
}

/** What a model is told about names it asked for that couldn't be used, one line each; empty when there are none. */
export function problemsText(problems: readonly TopicProblem[]): string {
  return problems.map((p) => `- ${p.message}`).join("\n");
}

export interface MapOptions extends GuideOptions {
  /**
   * How the model asks for more, one line: the MCP server names its docs tool,
   * sayshape/model's discovery asks for a USE line. Default: the USE line.
   */
  ask?: string;
  /** Put the report syntax in the map, so a report needs no second step. Default true where reports are offered. */
  reportSyntax?: boolean;
}

/** The default way to ask, for an app that reads the model's answer (sayshape/model's generateAdaptive). */
export const USE_PREFIX = "USE:";
export const DEFAULT_ASK = `For anything else, answer only one line naming every capability and element the screen needs, such as: ${USE_PREFIX} forms, calculations, slider`;

/**
 * The map: how the pieces of the language connect, the capabilities this app
 * offers with when to use each, every element's name, and how to ask for a
 * guide. Built from the registry and the options, so it never offers what the
 * app can't draw.
 */
export function languageMap(registry: Registry, opts: MapOptions = {}): string {
  const offered = availableCapabilities(registry, opts);
  const scenes = new Set(sceneElements(registry));
  const report = offered.some((c) => c.name === "report") && opts.reportSyntax !== false;
  const how = [
    "HOW SAYSHAPE FITS TOGETHER (one element per line, children indented 2 spaces, no code)",
    "- state holds values: state budget=500 picked=\"All\". derive works a value out from others and updates by itself: derive left={budget - spent}",
    "- {…} reads them in text and props. Controls write them with bind=; on= actions change them (set, inc, add) or tell the app (emit)",
    "- each repeats elements for every item of a list; if= shows or hides an element",
    ...(scenes.size ? ["- a scene draws shapes whose props read state and the time t"] : []),
    ...(offered.some((c) => c.name === "behavior") ? ["- every rules change state on a timer; drag=true lets people move a scene's shape"] : []),
  ];
  const caps = [
    "CAPABILITIES (building blocks; name several together)",
    ...offered.map((c) => `- ${c.name}: ${c.when}${c.name === "report" && report ? " (written as below, nothing more to ask)" : ""}`),
    `- ${FULL_GUIDE_TOPIC}: the whole guide, when nothing narrower fits`,
  ];
  const comps = registry.all().filter((c) => !scenes.has(c.type) || c.type === "scene");
  const parts = [how.join("\n"), caps.join("\n"), `ELEMENTS (ask for one by name for its props and example)\n${elementIndex(comps)}`];
  if (report) parts.push(`A REPORT, ready to write\n${reportSyntax()}`);
  parts.push(opts.ask ?? DEFAULT_ASK);
  return parts.join("\n\n");
}

/** The compatible guide, for when a narrow one isn't enough: exactly languageGuide without capabilities. */
export function fullGuide(registry: Registry, opts: GuideOptions = {}): string {
  return languageGuide(registry, { ...opts, capabilities: undefined });
}

/** Every element name a capability guide can reach, for checks: ALWAYS_EXPOSED plus each capability's. */
export function reachableElements(registry: Registry): Set<string> {
  const out = new Set<string>(ALWAYS_EXPOSED.filter((t) => registry.has(t)));
  for (const c of CAPABILITIES) capabilityElements(registry, c.name).forEach((t) => out.add(t));
  return out;
}
