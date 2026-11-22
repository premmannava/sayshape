/**
 * The SayShape MCP server: lets any MCP Apps client (Claude, ChatGPT, VS Code,
 * Goose…) show SayShape interfaces inside the conversation.
 *
 *   show_interface   takes a spec, checks it with the real parser and
 *                    returns the problems; the client shows the ui:// view,
 *                    which draws the spec with the real engine. Its
 *                    description carries a short quick start (the syntax and
 *                    every element's name), enough for simple interfaces
 *   sayshape_docs    the props and examples of just the elements (and topics)
 *                    the model asks for, so it never pays for the whole guide
 *
 * Everything the model reads is generated from the component definitions
 * (src/prompt.ts). When lines fail, show_interface's result carries the docs
 * for the elements on those lines, so a guess costs one retry, not a guide.
 *
 * With a database (main.ts --data), three more tools let the model look at the
 * data and query it, and the interface load the rows itself:
 *
 *   describe_data    tables, columns, row counts and joins
 *   query_data       one read-only SELECT; keeps the rows as a dataset and
 *                    tells the model only its columns, size and a sample
 *   fetch_dataset    for the interface only (visibility: app): a dataset's rows
 *
 * The model only ever sends text. The view (src/ui) parses and paints it, and
 * the only thing that leaves an interface is an emit: action, which the view
 * turns into a message in the conversation. So the client's iframe sandbox is
 * a second wall, not the first one.
 *
 * This file has no I/O of its own: main.ts connects it to stdio or HTTP, and
 * the tests connect it to an in-memory client.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { colorEntries, DEFAULT_VIEW_OPTIONS, withViewOptions, type ViewOptions } from "./ui/view-options";
import { colorList } from "../../playground/appearance/color";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { sceneComponents, reviewScenes } from "../../src/components/scene";
import type { ComponentDef } from "../../src/component";
import { elementGuide, elementIndex, guideSections, languageGuide, motionGuide, picturesGuide, pickList, PICKS_HEADING, PICKS_HEADING_SHORT } from "../../src/prompt";
import { lookGuide } from "../../src/look";
import { assembleGuide, availableCapabilities, FULL_GUIDE_TOPIC, languageMap, problemsText } from "../../src/capabilities";
import type { GuideOptions } from "../../src/prompt";
import { reviewLayout } from "../../src/review";
import { render } from "../../src/testing";
import type { Diagnostic } from "../../src/types";
import { tidySpec } from "../../src/model/clean";
import { EXPRESSION_FUNCTIONS } from "../../src/expr";
import { parseActions } from "../../src/actions";
import type { SayShapeNode } from "../../src/types";
import { QueryError, summarize, type DataSource } from "./data";
import { listMcpDatasets, type McpResultStore } from "./mcp-results";
import { fallbackPage, fenced, PAGE_DATASETS_TEXT, PAGE_REPEAT_TEXT, PAGE_TEXT, pageFixLead } from "./fallback";
import { PRESSES_SAVED, PRESSES_SAVED_RESULT, widgetFailedText, widgetFixLead, WIDGET_REPEAT_TEXT, widgetText, writeWidget } from "./widget-file";
import { adapterSource, type WidgetHostName } from "./widget-hosts";
import { loadPackedEngine, type PackedEngine } from "./widget-engine";

export const VERSION = "0.7.0";
export const UI_URI = "ui://sayshape/interface.html";
/** Longer specs are refused: they're slow to stream and nobody reads them in a chat. */
export const MAX_SPEC_CHARS = 20_000;
/** How many problems go back to the model; the first few are what it needs to fix. */
const MAX_REPORTED = 12;

let components: ComponentDef[] = [...coreComponents, ...mapComponents];
let registry = new Registry(components);
let scenesOn = false;
let behaviorOn = false;
let layoutFirstOn = false;
let adaptiveOn = true;
let imageHosts: readonly string[] = [];
/**
 * The guide's sections, worked out once per mode. They depend only on the
 * settings above, which are fixed at startup, and building them is most of
 * what createServer costs; the HTTP mode makes a server for every request.
 */
const sectionsCache = new Map<"full" | "compact", ReturnType<typeof guideSections>>();

/**
 * --scene: turn the experimental scene elements on (off by default). With them
 * off, "scene" is an unknown element and models aren't told about it. Call
 * before createServer; main.ts does, from the command line.
 */
export function setScenes(on: boolean): void {
  scenesOn = on;
  register();
}

/** The elements the flags leave on, for the parser, the docs and the quick start. */
function register(): void {
  components = [...coreComponents, ...mapComponents, ...(scenesOn ? sceneComponents : [])];
  registry = new Registry(components);
  sectionsCache.clear();
}

/**
 * Whether a client gets behavior (--behavior): the view always does; a text-only client's CDN page loads a
 * pinned engine from before it existed, so it doesn't; a widget file carries this server's own engine, so
 * it does (fileMode: --widget-dir).
 */
const behaviorFor = (textOnly: boolean, fileMode: boolean): boolean => behaviorOn && (!textOnly || fileMode);

/**
 * Whether a client draws with this server's own engine: the view and the widget file do; the CDN page for
 * text-only clients loads an older pinned engine (fallback.ts PAGE_ENGINE_VERSION) that has no look line,
 * entrance motion or content over images, so it isn't offered the topics for them.
 */
const ownEngine = (textOnly: boolean, fileMode: boolean): boolean => !textOnly || fileMode;

/**
 * Adaptive guides (src/capabilities.ts), on by default: show_interface's description carries the map of the
 * language (and the report syntax, where reports are drawn) in place of the quick start, and sayshape_docs
 * returns one guide for every capability and element asked for together. The view and widget files draw
 * reports (the engine's presets); the CDN page's pinned engine has no reports, so it's never offered them.
 * The command line always leaves it on (--adaptive-guides is still accepted); false, for tests and the
 * size comparison, gives the quick start and the per-element docs as they were. Call before createServer.
 */
export function setAdaptiveGuides(on: boolean): void {
  adaptiveOn = on;
}

/** Whether reports are offered and read: with --adaptive-guides, on a client drawing with this server's own engine. */
const reportsFor = (textOnly: boolean, fileMode: boolean): boolean => adaptiveOn && ownEngine(textOnly, fileMode);

/** The host's switches, as guide options, for the map and the guides sayshape_docs builds. */
function adaptiveOptions(textOnly: boolean, fileMode: boolean): GuideOptions {
  const own = ownEngine(textOnly, fileMode);
  return {
    imageHosts,
    presets: reportsFor(textOnly, fileMode),
    behavior: behaviorFor(textOnly, fileMode),
    look: own,
    motion: own,
    pictures: own,
    ...(layoutFirstOn ? { layoutFirst: true } : {}),
  };
}

/** What a text-only client is told in place of a page when the spec is a deck. */
const PAGE_DECK_TEXT = "The deck is written correctly, but this app can't show slide decks yet, so there is no page to open. Tell the person it needs a chat app that draws SayShape views.";
/** Whether a spec uses the deck element. */
const usesDeck = (spec: string): boolean => /^\s*deck\b/m.test(spec);

/**
 * --behavior: turn experimental behavior on (off by default): `every` rules
 * that change state on an interval, and drag= on scene shapes (with --scene).
 * Text-only clients never get it: their page loads a pinned engine from
 * before it existed. Call before createServer; main.ts does.
 */
export function setBehavior(on: boolean): void {
  behaviorOn = on;
  sectionsCache.clear();
}

/**
 * --layout-first: tell models to write the layout first and the data (state
 * lines, long lists) last, so the view draws from the first element while the
 * spec streams in (the view already shows placeholders for names not declared
 * yet). Off by default: the guide, quick start and docs are then exactly what
 * they were. Call before createServer; main.ts does.
 */
export function setLayoutFirst(on: boolean): void {
  layoutFirstOn = on;
  sectionsCache.clear();
}

/**
 * The hosts images may load from: main.ts passes --image-hosts, else the common
 * list, else none with --no-image-hosts (none until it's called). The model
 * is told them, and the view resource asks the chat app to allow them in its
 * CSP; the view's engine gets the same list through the view options. Call
 * before createServer; main.ts does, from the command line.
 */
export function setImageHosts(hosts: readonly string[]): void {
  imageHosts = [...hosts];
  sectionsCache.clear();
}

/** The view resource's CSP: images from the allowed hosts, nothing else (MCP Apps resourceDomains). */
export function imageCsp(hosts: readonly string[]): { resourceDomains: string[] } | undefined {
  return hosts.length ? { resourceDomains: hosts.map((h) => `https://${h}`) } : undefined;
}

/** What the chat notes say about emit: where the view sends it to the model as it happens (MCP Apps clients). */
const CHAT_EMIT =
  'When the person should be able to send something back to you (a choice, a form, an approval), give it a button with on=emit:name, for example on=emit:submit_order. The chat shows a short line like "Submit order", and you also receive the exact action name, its value and every state value (a password field reads "[hidden]"; emit:login:{pw} would send it, so avoid that); reply to it, or call show_interface again with an updated spec.';

/** Extra rules for a model writing into a chat, on top of the generated guide. */
const CHAT_NOTES = `You are writing an interface that appears inside a chat conversation, in a narrow column about 600 pixels wide.
Keep it to one focused screen: a title, any filters just under it, then the content. Use cards for panels, never a card inside a card or one card around everything. Prefer grid for side-by-side numbers; avoid more than three columns.
Put the data you know straight into state (lists of records for tables, charts and each). Never claim data is live: if numbers come from your own knowledge, say so in a caption ("Estimates").
${CHAT_EMIT}
Every word in the interface is for the person: never how you made or checked it (tool names, "computed in Python", test notes).
Output only the spec in show_interface's spec argument, with no Markdown fences.`;

/** How to show a database's rows, added to the guide when the server has one. */
const DATA_NOTES = `DATA FROM THE DATABASE
- Look at the tables with describe_data, then get exactly the rows you need with query_data (one SELECT). Do the work in SQL: GROUP BY, SUM, COUNT, ORDER BY, LIMIT. A query keeps at most 500 rows.
- query_data returns a dataset id (d1, d2…), its columns and a few sample rows. Never type the rows or their numbers into the spec.
- Show a dataset by naming it in show_interface's data argument and using that name in the spec: data={"sales": "d1"}, then chart "Sales by country" kind=bar items=sales x=Country y=Total, or table … items=sales with table-column field=… for each column. Each row is a record with the dataset's column names as fields.
- Don't declare a dataset's name with state: the interface fills it in. You can still derive from it: derive top={take(sort(sales, 'Total', 'desc'), 5)}.`;

const MCP_NOTES = `MCP RESULTS FROM A TRUSTED INTEGRATION
- The host can ingest structured MCP tool results without pasting rows into the model context.
- Call list_datasets to discover the available ids and columns, then show_interface with data={"name":"m1"} and items=name in the spec.
- A dataset id is an opaque reference to the rows, not a new state declaration. Do not copy the rows into the spec.
- Data ingestion is controlled by the host; the model cannot invoke tools on another MCP server through SayShape.`;

/** The whole guide in one piece (the guide modes' full text plus these notes); kept for measuring and for clients that want it all. */
export function guideText(withData = false): string {
  return languageGuide(registry, { mode: "full", imageHosts, notes: withData ? `${CHAT_NOTES}\n\n${DATA_NOTES}` : CHAT_NOTES, ...(behaviorOn ? { behavior: true } : {}), ...(layoutFirstOn ? { layoutFirst: true } : {}) });
}

function sectionsOf(mode: "full" | "compact"): ReturnType<typeof guideSections> {
  let sections = sectionsCache.get(mode);
  if (!sections) sectionsCache.set(mode, (sections = guideSections(registry, { mode, imageHosts, ...(behaviorOn ? { behavior: true } : {}), ...(layoutFirstOn ? { layoutFirst: true } : {}) })));
  return sections;
}

const sectionText = (mode: "full" | "compact", name: string) => sectionsOf(mode).find((sec) => sec.name === name)?.text ?? "";

/** Parts of the guide a model can ask for by name, all generated (DATA_NOTES only with a database). */
function topics(withData: boolean, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): Record<string, string> {
  // A client that can't draw views is told the truth about emit: here too, as in its quick start:
  // it is saved for the next turn with a host adapter, and can't be used without one.
  const emitLine = textOnly ? (pressesSaved ? PRESSES_SAVED : NO_EMIT) : CHAT_EMIT;
  return {
    expressions: sectionText("full", "expressions"),
    actions: sectionText("full", "actions"),
    ...(behaviorFor(textOnly, fileMode) ? { behavior: sectionText("full", "behavior") } : {}),
    lists: sectionText("full", "data"),
    rules: sectionText("full", "rules"),
    examples: sectionText("full", "example"),
    // On demand only, from the same generators as the guide's optional sections: the quick start and the
    // default guide never carry them, so a call costs no more input tokens unless a model asks.
    ...(ownEngine(textOnly, fileMode) ? { look: lookGuide("full"), motion: motionGuide("full"), pictures: picturesGuide("full") } : {}),
    chat: CHAT_NOTES.split("\n").slice(1).map((line) => (line === CHAT_EMIT ? emitLine : line)).join("\n"),
    ...(withData ? { database: DATA_NOTES } : {}),
    ...(withMcp ? { datasets: MCP_NOTES } : {}),
  };
}

/**
 * What every model gets up front, in show_interface's description: the
 * syntax, every element's name, which element suits which kind of answer
 * (so a model picks a bullet chart or details before it reads any docs), the
 * rules for writing into a chat, and how to ask for more. Simple interfaces
 * need nothing else.
 */
export function quickStart(withData = false, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): string {
  return [
    "QUICK START",
    // The guide's "not JavaScript" line is left out to keep this short: show_interface returns
    // each code line's diagnostic, which says what to write instead.
    // Comments are left out too: an answer in a chat has no use for them, and the guide still explains them.
    sectionText("compact", "format").replace(/^FORMAT\n/, "").replace(/^- Not JavaScript:.*\n/m, "").replace(/\n- # starts a comment\.$/m, ""),
    "- Text and props show state: text \"Total: {money(total)}\"; actions run on press: button \"Add\" on=inc:count",
    "- Any element takes tip=\"…\": a short explanation shown on hover, focus or a tap: for a term or a number some people won't know, instead of more words on screen.",
    textOnly
      ? `- ${pressesSaved ? PRESSES_SAVED : NO_EMIT}`
      : "- on=emit:pick:{x.name} sends a choice to you; no handler blocks. Also update the screen: on=set:sel:{x.name};emit:pick:{x.name}",
    `- Functions (no others exist): ${EXPRESSION_FUNCTIONS.join(", ")}. The best row: first(sort(rows, 'revenue', 'desc')).month; a total: sum(rows, 'revenue'); within a budget: filter(rows, 'price', {to: budget})`,
    "- Rows from a formula, not by hand: derive rows={map(range(1, n + 1), 'i', {n: i, total: i * price})} feeds a table or chart",
    ...(behaviorFor(textOnly, fileMode) ? [sectionText("compact", "behavior")] : []),
    `ELEMENTS\n${elementIndex(components.filter((c) => !arrivesWithParent(c)))}`,
    // The same heading as the guides', in fewer words: this text goes out with every call.
    // Picks without their "such as …" examples or their "(…)" notes, except notes that teach a
    // prop (kind=org): the guides and sayshape_docs keep them all, and this text goes out with
    // every call, so each new element's pick fits.
    `${PICKS_HEADING_SHORT}\n${pickList(components).replace(/, such as [^:\n]*(?=: )/g, "").replace(/ \((?![^)\n]*=)[^)\n]*\)(?=: )/g, "")}`,
    "IN A CHAT: under 600px. Title, filters, a few KPIs in grid min=140, one main chart; no nested cards. Caption estimates.",
    "A PRESENTATION: a deck at the top level, not inside a card; a slide per idea, its title in the slide's own text.",
    // Only where those topics exist (ownEngine), so a model that reads this knows when to ask for them.
    ...(ownEngine(textOnly, fileMode) ? ["Polished screens: sayshape_docs topics look (style), motion (entrances), pictures (over photos)."] : []),
    `BEFORE YOU USE AN ELEMENT the first time, get its props and an example from sayshape_docs (elements: ["chart", "table"]). Topics: ${Object.keys(topics(withData, withMcp, textOnly, fileMode)).join(", ")}.`,
    ...(withMcp ? ["Imported results: call list_datasets for available ids and fields. Pass data={\"rows\":\"m1\"} to show_interface; don't put dataset rows in spec."] : []),
  ].join("\n");
}

/** The topics sayshape_docs keeps beside the capabilities with --adaptive-guides: the ones that aren't capabilities. */
function extraTopics(withData: boolean, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): Record<string, string> {
  const caps = new Set(availableCapabilities(registry, adaptiveOptions(textOnly, fileMode)).map((c) => c.name));
  return Object.fromEntries(Object.entries(topics(withData, withMcp, textOnly, fileMode, pressesSaved)).filter(([n]) => !caps.has(n) && !CAPABILITY_TOPICS.has(n)));
}
/** Old topic names that are capabilities now, so they're asked for through the assembler even where a host has them off. */
const CAPABILITY_TOPICS = new Set(["actions", "lists", "behavior", "look", "motion", "pictures"]);

/** The one line in a chat about emit:, for every client, as in the quick start. */
function emitLine(textOnly: boolean, pressesSaved: boolean): string {
  return textOnly ? `- ${pressesSaved ? PRESSES_SAVED : NO_EMIT}` : "- on=emit:pick:{x.name} sends a choice to you; no handler blocks. Also update the screen: on=set:sel:{x.name};emit:pick:{x.name}";
}
const CHAT_LINE = "IN A CHAT: under 600px. Title, filters, a few KPIs in grid min=140, one main chart; no nested cards. Caption estimates.";

/**
 * With --adaptive-guides, what every model gets up front in show_interface's description, in place of the
 * quick start: the map (how the pieces connect, the capabilities and elements, the report syntax where
 * reports are drawn) and how to ask sayshape_docs for the rest, once.
 */
export function adaptiveStart(withData = false, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): string {
  const extra = Object.keys(extraTopics(withData, withMcp, textOnly, fileMode, pressesSaved));
  const ask = `For anything else, call sayshape_docs once with every capability and element the screen needs, such as topics: ["forms", "calculations"], elements: ["slider"], then write it. Other topics: ${extra.join(", ")}.`;
  return [
    // No line on commentary after the spec: here the spec is show_interface's argument, and the reply is where words go.
    languageMap(registry, { ...adaptiveOptions(textOnly, fileMode), ask, commentary: false }),
    `${CHAT_LINE}
${emitLine(textOnly, pressesSaved)}`,
    ...(withMcp ? ["Imported results: call list_datasets for available ids and fields. Pass data={\"rows\":\"m1\"} to show_interface; don't put dataset rows in spec."] : []),
  ].join("\n\n");
}

/**
 * With --adaptive-guides: one guide for every capability and element asked for, from the same assembler as
 * sayshape/model, plus any of the other topics; names that can't be used are listed with what to ask for
 * instead. Nothing usable and no "full": the problems and the map, never the whole guide by accident.
 */
export function adaptiveDocs(elements: readonly string[], topicNames: readonly string[], withData = false, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): string {
  const extra = extraTopics(withData, withMcp, textOnly, fileMode, pressesSaved);
  const others = topicNames.filter((n) => n in extra);
  const asked = [...topicNames.filter((n) => !(n in extra)), ...elements];
  if (!asked.length && !others.length) return adaptiveStart(withData, withMcp, textOnly, fileMode, pressesSaved);
  const parts: string[] = [];
  if (asked.length) {
    const g = assembleGuide(registry, asked, adaptiveOptions(textOnly, fileMode));
    const wantedFull = asked.some((n) => n.trim().toLowerCase() === FULL_GUIDE_TOPIC);
    if (g.full && !wantedFull) {
      parts.push(`NOT INCLUDED\n${problemsText(g.problems)}`);
      if (!others.length) parts.push(adaptiveStart(withData, withMcp, textOnly, fileMode, pressesSaved));
    } else {
      // The intro ("output only SayShape") is for a model writing its whole answer; here the spec goes in show_interface.
      parts.push(g.sections.filter((sec) => sec.name !== "intro").map((sec) => sec.text).join("\n\n"));
      if (g.problems.length) parts.push(`NOT INCLUDED\n${problemsText(g.problems)}`);
    }
  }
  // The chat line and the emit: line are in show_interface's description already, so they aren't repeated.
  for (const n of others) parts.push(extra[n]!);
  return parts.join("\n\n");
}

/**
 * A child element that only goes inside parents whose docs always bring it
 * along (table-column with table, tab with tabs): the quick start's element
 * list leaves it out, since asking sayshape_docs for the parent shows it.
 */
function arrivesWithParent(c: ComponentDef): boolean {
  return !!c.parents?.length && c.parents.every((p) => {
    const parent = components.find((d) => d.type === p);
    return Array.isArray(parent?.children) && parent.children.includes(c.type);
  });
}

/** Docs for exactly what was asked for, plus what it depends on. */
export function docsText(elements: readonly string[], topicNames: readonly string[], withData = false, withMcp = false, textOnly = false, fileMode = false, pressesSaved = false): string {
  if (adaptiveOn) return adaptiveDocs(elements, topicNames, withData, withMcp, textOnly, fileMode, pressesSaved);
  const parts: string[] = [];
  const t = topics(withData, withMcp, textOnly, fileMode, pressesSaved);
  if (elements.length) {
    const { text, unknown } = elementGuide(registry, elements, { behavior: behaviorFor(textOnly, fileMode) });
    if (text) parts.push(`ELEMENTS\n${text}`);
    // Which hosts work, so a model asking about image doesn't write URLs the view can't load.
    if (imageHosts.length && elements.includes("image")) parts.push(sectionText("compact", "images"));
    if (unknown.length) parts.push(`No element called ${unknown.join(", ")}. The elements are:\n${elementIndex(components)}`);
  }
  for (const name of topicNames) {
    const body = t[name];
    parts.push(body ? body : `No topic called ${name}. Topics: ${Object.keys(t).join(", ")}.`);
  }
  return parts.length ? parts.join("\n\n") : quickStart(withData, withMcp, textOnly, fileMode, pressesSaved);
}

/** The elements on the lines that went wrong, so their docs can go back with the problems. */
function elementsOnLines(spec: string, diagnostics: readonly Diagnostic[], max = 3): string[] {
  const lines = spec.split("\n");
  const out: string[] = [];
  for (const d of diagnostics) {
    const type = /^\s*([a-z][a-z-]*)/.exec(lines[d.line - 1] ?? "")?.[1];
    if (type && registry.get(type) && !out.includes(type)) out.push(type);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * For clients that can't draw views, where interfaces are shown as a page
 * outside the chat: emit: has no conversation to reach from there, so models
 * are told not to use it, and a spec that does gets it back to fix.
 */
export const NO_EMIT =
  "This chat app shows interfaces as a page outside the chat, so emit: can't reach you: don't use it. " +
  "Buttons can still change the page (set:, inc:, go:); ask the person to reply in the chat for anything you need back.";
const EMIT_PROBLEM =
  "emit: can't reach you from this chat app, which shows interfaces as a page outside the chat. " +
  "Remove the emit: part and keep any set:, go: or notify: so the button still does something on the page; ask the person to reply in the chat for anything you need back.";

/**
 * The lines whose on= sends an emit:, as problems to fix (text-only clients
 * only). A link pressed in rich text isn't one: the page opens it itself.
 */
export function emitProblems(spec: string, hostNames: readonly string[] = []): Diagnostic[] {
  const out: Diagnostic[] = [];
  const walk = (node: SayShapeNode) => {
    const on = node.props.on;
    if (on) {
      const parsed = parseActions(on);
      const emits = "actions" in parsed ? parsed.actions.some((a) => a.op === "emit") : /(^|;)\s*emit:/.test(on);
      if (emits) out.push({ line: node.line, severity: "error", message: EMIT_PROBLEM });
    }
    node.children.forEach(walk);
  };
  walk(parse(spec, registry, { knownNames: hostNames }).root);
  return out;
}

export interface SpecCheck {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  /**
   * Problems a person can see in a scene's drawing (a label cut off, a line
   * hidden under a box) or in the layout (a card inside a card, src/review.ts). The interface still shows, so these never count as
   * problems to fix before it appears; the model is asked to tidy them.
   */
  drawing: Diagnostic[];
  /**
   * What's wrong with the data the interface shows (a chart with no numbers, values a total couldn't
   * read), found by drawing it once here with the data it loads. The interface still shows, so these are
   * never problems to fix before it appears; they tell the model what the person will see.
   */
  data?: Diagnostic[];
}

/** The width the data check lays the interface out at: only what's read matters, not where it goes. */
const DATA_CHECK_WIDTH = 600;

/**
 * Draw a spec once, headless, with the rows it loads, and return the engine's warnings about its data
 * (src/engine.ts dataWarnings). Never throws: data that can't be loaded or drawn is no data warning.
 */
export function dataProblems(spec: string, rows: Record<string, unknown> = {}, textOnly = false, fileMode = false): Diagnostic[] {
  try {
    const behavior = behaviorFor(textOnly, fileMode);
    const presets = reportsFor(textOnly, fileMode);
    const ui = render("", { components, width: DATA_CHECK_WIDTH, ...(behavior ? { behavior } : {}), ...(presets ? { presets } : {}) });
    for (const [name, value] of Object.entries(rows)) ui.set(name, value as never);
    ui.setSpec(spec);
    ui.sayshape.renderNow();
    const out = [...ui.sayshape.dataWarnings];
    ui.sayshape.destroy();
    return out;
  } catch {
    return [];
  }
}

/** Parse a spec with the engine's own parser and components. Never throws. hostNames: state the interface fills in (datasets). */
export function checkSpec(spec: string, hostNames: readonly string[] = [], textOnly = false, fileMode = false): SpecCheck {
  const behavior = behaviorFor(textOnly, fileMode);
  const presets = reportsFor(textOnly, fileMode);
  const parsed = parse(spec, registry, { knownNames: hostNames, ...(behavior ? { behavior } : {}), ...(presets ? { presets } : {}) });
  const { diagnostics } = parsed;
  return {
    errors: diagnostics.filter((d) => d.severity === "error"),
    warnings: diagnostics.filter((d) => d.severity !== "error"),
    // Layout rules (a card inside a card) go with the drawing problems: the interface still shows.
    drawing: [...reviewLayout(parsed.root), ...(scenesOn ? reviewScenes(parsed, behavior ? { behavior } : {}) : [])].sort((x, y) => x.line - y.line),
  };
}

/**
 * Warnings that change nothing on screen: the parser ignored a prop or some text.
 * Every other warning (a bad expression, a value outside a prop's choices, a
 * name nothing defines) leaves part of the interface wrong, so it needs a fix.
 */
const HARMLESS = /has no prop "|is a weight, not a style|doesn't take quoted text; it was ignored/;
export const isHarmless = (d: Diagnostic) => d.severity !== "error" && HARMLESS.test(d.message);

/**
 * textOnly: the client can't draw MCP Apps views, so the wording says nothing
 * is showing and the page (added by the caller when there's nothing to fix)
 * is how the person sees it. Clients that draw views get the same text as
 * before the page existed (test/ui-results.test.ts).
 */
function describeCheck(c: SpecCheck, textOnly = false, fileMode = false, widget = ""): string {
  const said = describeSpecCheck(c, textOnly, fileMode, widget);
  const data = (c.data ?? []).slice(0, MAX_REPORTED).map((d) => `line ${d.line} (warning): ${d.message}`);
  return data.length ? `${said}\n${DATA_LEAD}\n${data.join("\n")}` : said;
}

/** Before the data warnings in a result: they don't hold the interface back. */
export const DATA_LEAD = "About the data it shows (the interface still shows; tell the person if it matters, or read values with num() or date()):";

function describeSpecCheck(c: SpecCheck, textOnly = false, fileMode = false, widget = ""): string {
  const all = [...c.errors, ...c.warnings];
  const drawing = c.drawing.map((d) => `line ${d.line}: ${d.message.replace(/^Drawing: /, "")}`);
  if (textOnly) {
    // fileMode: the app shows a widget made from a file (--widget-dir); widget is what it's told about the file, in place of the page's text.
    const fix = all.filter((d) => !isHarmless(d));
    if (fix.length) {
      const listed = [...fix, ...all.filter(isHarmless)].slice(0, MAX_REPORTED).map((d) => `line ${d.line} (${isHarmless(d) ? "ignored" : d.severity}): ${d.message}`);
      if (all.length > MAX_REPORTED) listed.push(`…and ${all.length - MAX_REPORTED} more.`);
      return `${fileMode ? widgetFixLead(fix.length) : pageFixLead(fix.length)}\n${listed.join("\n")}${drawing.length ? `\nAlso tidy the drawing:\n${drawing.join("\n")}` : ""}`;
    }
    const minor = all.map((d) => `line ${d.line} (ignored): ${d.message}`);
    return [
      fileMode ? widget : PAGE_TEXT,
      ...(minor.length ? [`The parser ignored these small things, which change nothing on the page:\n${minor.join("\n")}`] : []),
      // A scene's drawing problems don't hold the page back: some, like small text on a phone, may not be worth another call.
      ...(drawing.length ? [`Its drawing has problems the person can see. If you fix them, call show_interface again and use the new ${fileMode ? "file" : "page"} instead:\n${drawing.join("\n")}`] : []),
    ].join("\n");
  }
  if (!all.length && drawing.length) {
    return `The interface is showing, but its drawing has problems the person can see. Fix them and call show_interface again with the whole corrected spec:\n${drawing.join("\n")}`;
  }
  if (!all.length) return "The interface is showing in the conversation, with no problems. Don't call show_interface again unless the person asks for a change.";
  const fix = all.filter((d) => !isHarmless(d));
  const minor = all.filter(isHarmless);
  // The ones to fix come first, so they survive the cut.
  const listed = [...fix, ...minor].slice(0, MAX_REPORTED).map((d) => `line ${d.line} (${isHarmless(d) ? "ignored" : d.severity}): ${d.message}`);
  if (all.length > MAX_REPORTED) listed.push(`…and ${all.length - MAX_REPORTED} more.`);
  const lead = fix.length
    ? `${fix.length} problem${fix.length === 1 ? "" : "s"} leave${fix.length === 1 ? "s" : ""} part of this interface wrong or missing, so the person sees a short "being fixed" note in its place. Fix ${fix.length === 1 ? "it" : "them"} and call show_interface again with the whole corrected spec:`
    : "The interface is showing correctly. The parser ignored these small things, which change nothing on screen, so there's no need to call show_interface again:";
  return `${lead}\n${listed.join("\n")}${drawing.length ? `\nAlso tidy the drawing, which the person can see:\n${drawing.join("\n")}` : ""}`;
}

export interface ServerOptions {
  /** The view's HTML: dist/ui.html, built by `npm run build`. */
  uiHtml: () => string | Promise<string>;
  /** The view's own settings: --theme-picker, --theme, --accent, --colors, --no-model-colors, --no-save-image, --no-copy-text, --image-hosts (main.ts). Default: no picker, teal, Save image and Copy text on, no image hosts. */
  view?: ViewOptions;
  /** A read-only database the model may query (main.ts --data). */
  data?: DataSource;
  /** In-memory MCP results ingested by a trusted host (one store per user/session). */
  mcpResults?: McpResultStore;
  /** The clock, for tests of how long a repeat counts as one. */
  now?: () => number;
  /**
   * A folder to write widget files into (main.ts --widget-dir; stdio only). Clients that can't draw MCP Apps
   * views get a file there, made from the spec with this server's own engine, in place of the CDN page.
   * Without it, nothing changes.
   */
  widgetDir?: string;
  /** With widgetDir (main.ts --widget-inline): the engine as plain script text in each file, for apps that run no blob: script. */
  widgetInline?: boolean;
  /** The packed engine for those files; by default dist/widget-engine.json, read when first needed. */
  widgetEngine?: () => Promise<PackedEngine>;
  /**
   * With widgetDir (main.ts --widget-host): the chat app's adapter to hook into every file. Its presses are
   * saved for the model's next turn, so emit: is allowed there. ignoreAppColors: --theme, --accent or --colors was given.
   * Without it, emit: is handled as before.
   */
  widgetHost?: { name: WidgetHostName; ignoreAppColors?: boolean };
}

/** How long after a good interface the same spec again counts as a repeat, not a new request. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

/**
 * What makes two calls the same interface: the spec without blank lines or trailing spaces, the datasets it
 * shows, and the colors it's drawn in (show_interface's colors argument, already made usable by colorList),
 * so the same spec in new colors is a new interface.
 */
export function interfaceKey(spec: string, data: Record<string, string>, colors: readonly string[] = []): string {
  // trimEnd strips the same whitespace as /\s+$/, without its quadratic backtracking on a long run of spaces.
  const lines = spec.split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
  const sets = Object.keys(data).sort().map((k) => `${k}=${data[k]}`);
  return `${lines.join("\n")}\n--\n${sets.join(",")}${colors.length ? `\n--\n${colors.join(",")}` : ""}`;
}

/**
 * show_interface's colors argument, as the model reads it: the one thing it's told about colors. Without
 * --no-model-colors only; the quick start and sayshape_docs never mention it.
 */
export const COLORS_DESCRIPTION =
  'Brand colors as hex, most important first, such as ["#e4572e", "#2e86ab"]: send them only when the person, or the instructions you were given, named colors to use.';

/**
 * The colors argument's schema. Advertised as a list of strings, but it never refuses a call: whatever
 * arrives goes through colorEntries first (a string is read as comma-separated colors, anything else that
 * isn't a list is none, entries that aren't strings are dropped), and colorList then keeps the hex colors.
 * So a sloppy value is ignored, never a reason for the model to try again.
 */
const colorsArgument = z.preprocess((raw) => (raw === undefined ? undefined : colorEntries(raw)), z.array(z.string()).optional()).describe(COLORS_DESCRIPTION);

/**
 * The note that ends a result drawn in the conversation's colors, so the model keeps sending them: nothing
 * remembers them but the conversation (the stateless HTTP mode has nowhere to keep them, and each call is a new view).
 */
export function colorsNote(colors: readonly string[]): string {
  return `Colors: ${colors.join(", ")}. Pass the same colors on every later show_interface call in this conversation, unless the person asks to change them.`;
}

/** What the model is told when it sends an interface that is already showing. */
export const REPEAT_TEXT =
  "This exact interface is already showing in the conversation, just above, so this copy is hidden. " +
  "Don't call show_interface again unless the person asks for a change; answer them in text if they need more.";

/**
 * Whether the client said, when it connected, that it can't draw MCP Apps
 * views: it announced its capabilities without "io.modelcontextprotocol/ui".
 * Unknown capabilities (the stateless HTTP mode makes a new server for every
 * request, which never sees the client's initialize) count as able to, so
 * nothing changes for them.
 */
export function cannotDrawViews(server: McpServer): boolean {
  const caps = server.server.getClientCapabilities();
  return caps !== undefined && getUiCapability(caps) === undefined;
}

/** Names a dataset can be shown under: plain state names. */
const DATA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function createServer(opts: ServerOptions): McpServer {
  const data = opts.data;
  const mcpResults = opts.mcpResults;
  const hasDatasets = !!data || !!mcpResults;
  const findDataset = (id: string) => id.startsWith("m") ? mcpResults?.get(id) : data?.get(id);
  const now = opts.now ?? Date.now;
  const widgetDir = opts.widgetDir;
  const widgetEngine = opts.widgetEngine ?? loadPackedEngine;
  /** A client that can't draw views gets a file for a widget (--widget-dir) instead of the CDN page. HTTP never has one: main.ts refuses the pair. */
  const fileModeFor = (textOnly: boolean) => textOnly && widgetDir !== undefined;
  // A host adapter in the files saves presses (emit:) for the model's next turn, so they are no longer a problem.
  const hostSource = widgetDir !== undefined && opts.widgetHost ? adapterSource(opts.widgetHost.name, { ignoreAppColors: opts.widgetHost.ignoreAppColors === true }) : undefined;
  const pressesSavedFor = (textOnly: boolean) => fileModeFor(textOnly) && hostSource !== undefined;
  // The last interface shown with nothing to fix. Smaller models often send the same one again
  // to "confirm" it, which would leave a second copy in the chat. Kept per server, so per
  // conversation over stdio; the stateless HTTP mode makes a server per request and never repeats.
  let lastGood: { key: string; at: number } | null = null;
  // --no-model-colors: no colors argument and no note, so the tool is exactly what it was before it existed.
  const modelColors = opts.view?.modelColors !== false;
  const server = new McpServer(
    { name: "sayshape", title: "SayShape", version: VERSION },
    {
      instructions:
        "The person installed SayShape so that visual answers appear as interactive SayShape interfaces inside the chat. " +
        "Whenever they ask for a chart, graph, table, dashboard, scorecard, stat card, form, calculator, tracker, checklist or any other visual or interactive answer, " +
        "use show_interface rather than writing HTML, React, SVG or chart code, or making an artifact. " +
        (adaptiveOn
          ? "Its description has a map of SayShape: write a report straight away, or call sayshape_docs once with every capability and element the screen needs. "
          : "Its description has a quick start; choose elements from its PICK BY WHAT YOU'RE SHOWING list, then call sayshape_docs only for the elements you're about to use. ") +
        "Asked to restyle an interface (dark mode, bigger text)? Its theme and sizes follow the chat app: say so in a sentence instead of changing it, and never write the request into the interface." +
        (data
          ? " A database is connected: answer questions about it with describe_data and query_data, then show the result with show_interface, " +
            "passing the dataset in its data argument instead of typing the numbers."
          : mcpResults
            ? " Imported MCP result datasets are available: call list_datasets, then show_interface with data ids."
            : ""),
    },
  );

  // The topics a client may ask for: what its own way of showing interfaces can draw (a text-only client's
  // CDN page has no reports or behavior), so it's never offered a name the docs would then refuse.
  const docsShape = (textOnly: boolean) => {
    const fileMode = fileModeFor(textOnly), saved = pressesSavedFor(textOnly);
    return adaptiveOn
      ? {
          elements: z.array(z.string().max(40)).max(12).optional().describe("Element names, e.g. [\"slider\", \"table\"]."),
          topics: z.array(z.string().max(40)).max(12).optional().describe(`Capabilities: ${[...availableCapabilities(registry, adaptiveOptions(textOnly, fileMode)).map((c) => c.name), FULL_GUIDE_TOPIC].join(", ")}. Also: ${Object.keys(extraTopics(!!data, !!mcpResults, textOnly, fileMode, saved)).join(", ")}.`),
        }
      : {
          elements: z.array(z.string().max(40)).max(12).optional().describe("Element names, e.g. [\"chart\", \"table\", \"stepper\"]."),
          topics: z.array(z.string().max(40)).max(6).optional().describe(`Topics: ${Object.keys(topics(!!data, !!mcpResults, textOnly, fileMode, saved)).join(", ")}.`),
        };
  };
  const docsTool = server.registerTool(
    "sayshape_docs",
    {
      title: "SayShape docs",
      description: adaptiveOn
        ? "Returns one SayShape guide for every capability and element you name together: the syntax, how they connect, " +
          "and a short example. Ask once, for everything the screen needs, e.g. topics: [\"forms\", \"calculations\"], elements: [\"slider\"]. With nothing named, returns the map."
        : "Returns the props and an example for the SayShape elements you name, and any topics you ask for. " +
          "Ask only for what you're about to use, e.g. elements: [\"chart\", \"table\"]. With nothing named, returns the quick start.",
      inputSchema: docsShape(false),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ elements, topics: names }) => {
      const textOnly = cannotDrawViews(server);
      return text(docsText(elements ?? [], names ?? [], !!data, !!mcpResults, textOnly, fileModeFor(textOnly), pressesSavedFor(textOnly)));
    },
  );

  const showDescription = (textOnly: boolean) =>
    (textOnly
      ? "Draws an interactive interface from a spec you write, with the SayShape engine. This chat app can't show it in the conversation, " +
        (fileModeFor(textOnly)
          ? "so when the spec has nothing to fix the result gives you the path of a file that draws it, to create a widget from for the person. "
          : "so when the spec has nothing to fix the result gives you a small web page that draws it, to publish or save for the person. ") +
        "Use it for every visual or interactive answer (charts, tables, dashboards, stat cards, forms, calculators, trackers) " +
        "rather than writing HTML, React, SVG or chart code. Specs can't run code or choose colors. "
      : "Shows an interactive interface inside the conversation, drawn by the SayShape engine from a spec you write. " +
        "Use it for every visual or interactive answer (charts, tables, dashboards, stat cards, forms, calculators, trackers) " +
        "rather than writing HTML, React, SVG or chart code, or making an artifact. Specs can't run code or choose colors. ") +
    "The result lists lines the parser skipped, with the docs for those elements, so you can fix them." +
    (data ? " To show rows from the database, pass data={\"name\": \"d1\"} with a dataset id from query_data and use that name in the spec (items=name)." : "") +
    (mcpResults ? " For imported MCP results, call list_datasets then pass the selected id in data. The model never needs the full rows." : "") +
    "\n\n" +
    (adaptiveOn ? adaptiveStart : quickStart)(!!data, !!mcpResults, textOnly, fileModeFor(textOnly), pressesSavedFor(textOnly));

  const showTool = registerAppTool(
    server,
    "show_interface",
    {
      title: "Show an interface",
      description: showDescription(false),
      inputSchema: {
        // Before spec, so a client streaming the arguments in order sends the colors first and the first lines already draw in them.
        ...(modelColors ? { colors: colorsArgument } : {}),
        spec: z.string().min(1).max(MAX_SPEC_CHARS).describe("The SayShape spec: plain lines, no Markdown fences."),
        title: z.string().max(120).optional().describe("A short name for the interface, e.g. 'Paris 2024 medal table'."),
        ...(hasDatasets
          ? {
              data: z
                .record(z.string(), z.string())
                .optional()
                .describe('Datasets to load into the interface, by the name the spec uses: {"sales": "d1"}. Ids come from query_data.'),
            }
          : {}),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async (args) => {
      const { title } = args;
      // Fences and typographic quotes would otherwise cost a retry; the view tidies the same way.
      const spec = tidySpec(args.spec);
      const wanted = ((args as { data?: Record<string, string> }).data ?? {}) as Record<string, string>;
      const datasets: Record<string, { id: string; rows: number }> = {};
      for (const [name, id] of Object.entries(wanted)) {
        if (!DATA_NAME.test(name)) return text(`"${name}" can't be used as a name in a spec. Use letters, digits and _, starting with a letter, like sales or top_artists.`, true);
        const d = findDataset(id);
        if (!d) return text(`There's no dataset "${id}". ${mcpResults ? "Check list_datasets for imported MCP result ids (m1, m2…). " : ""}${data ? "Use query_data for SQL datasets (d1, d2…)." : ""}`, true);
        datasets[name] = { id, rows: d.rows.length };
      }
      const names = Object.keys(datasets);
      const textOnly = cannotDrawViews(server);
      const fileMode = fileModeFor(textOnly);
      const checked = checkSpec(spec, names, textOnly, fileMode);
      // Only a spec that parses cleanly is drawn to look at its data: one with errors gets those fixed first.
      const rows = Object.fromEntries(names.map((n) => [n, findDataset(datasets[n]!.id)!.rows]));
      const parsed = checked.errors.length ? checked : { ...checked, data: dataProblems(spec, rows, textOnly, fileMode) };
      // On a page outside the chat emit: goes nowhere, so text-only clients fix it first, unless a host adapter saves it.
      // Clients that draw views never see this.
      const saved = pressesSavedFor(textOnly);
      const emits = textOnly ? emitProblems(spec, names) : [];
      const check = textOnly && !saved ? { ...parsed, errors: [...parsed.errors, ...emits].sort((a, b) => a.line - b.line) } : parsed;
      // A state line would replace the rows the interface loads, so point it out.
      const declared = names.filter((n) => new RegExp(`^state\\b[^\\n]*\\b${n}=`, "m").test(spec));
      const notes = [
        ...(names.length ? [`Loaded into the interface: ${names.map((n) => `${n} (${datasets[n]!.id}, ${datasets[n]!.rows} rows)`).join(", ")}.`] : []),
        ...(declared.length ? [`Remove ${declared.join(", ")} from the state line: the interface fills ${declared.length === 1 ? "it" : "them"} in from the dataset.`] : []),
      ];
      // A wrong guess comes back with the docs it needed, instead of the model reading every element up front.
      const toFix = [...check.errors, ...check.warnings].filter((d) => !isHarmless(d)).length;
      // Sloppy entries are dropped and nothing usable counts as none sent: bad colors are never a problem to fix.
      const colors = modelColors ? colorList((args as { colors?: string[] }).colors) : [];
      const key = interfaceKey(spec, wanted, colors);
      const repeat = toFix === 0 && lastGood !== null && lastGood.key === key && now() - lastGood.at < REPEAT_WINDOW_MS;
      if (toFix === 0) lastGood = { key, at: now() };
      // The structured part is for the view. A client that can't draw one has no view to read it, and some
      // (Claude Code) hand their model the structured part in place of the text, which would lose the page
      // and the problems to fix. So text-only clients get the text alone.
      if (textOnly) {
        // Rows never go through the conversation, and a page outside the chat can't fetch them.
        if (names.length) return text(PAGE_DATASETS_TEXT);
      }
      // The view and the page draw in the colors the conversation sent, so their results say so and the model keeps
      // sending them. A widget file (--widget-dir) doesn't: it carries the operator's colors only, so no note there.
      const colorLine = colors.length && !fileMode ? `\n${colorsNote(colors)}` : "";
      if (textOnly && repeat) return text((fileMode ? WIDGET_REPEAT_TEXT : PAGE_REPEAT_TEXT) + colorLine);
      if (repeat) {
        return {
          content: [{ type: "text", text: REPEAT_TEXT + colorLine }],
          structuredContent: { datasets, title: title ?? null, errors: 0, warnings: check.warnings.length, toFix: 0, repeat: true, diagnostics: [] },
        };
      }
      // Docs for the lines that went wrong; an emit: line needs no element docs to fix.
      const failing = elementsOnLines(spec, [...parsed.errors, ...parsed.warnings].filter((d) => !isHarmless(d)));
      if (failing.length) notes.push(`\nDocs for ${failing.join(", ")}:\n${elementGuide(registry, failing).text}`);
      // The page's pinned engine (PAGE_ENGINE_VERSION, kept two weeks behind releases) has no slides, so a deck gets a plain
      // sentence instead of a page that can't draw it. Once that version has slides, this goes.
      // A widget file carries this server's own engine, slides included, so a deck is fine there.
      const deckOnly = textOnly && !fileMode && toFix === 0 && usesDeck(spec);
      const withPage = textOnly && !fileMode && toFix === 0 && !deckOnly;
      if (deckOnly) notes.push(PAGE_DECK_TEXT);
      // The conversation's colors, else the operator's (--colors, --accent); the page works out light and dark itself.
      if (withPage) notes.push(fenced(fallbackPage({ spec, title, scenes: scenesOn, colors: colors.length ? colors : (opts.view?.colors ?? null), imageHosts })));
      let widget = "";
      if (fileMode && toFix === 0) {
        try {
          const written = await writeWidget(widgetDir!, {
            spec,
            engine: await widgetEngine(),
            scenes: scenesOn,
            behavior: behaviorOn,
            ...(adaptiveOn ? { presets: true } : {}),
            ...(opts.view?.selectText === false ? { selectText: false } : {}),
            ...(opts.view?.selectTouch !== undefined ? { selectTouch: opts.view.selectTouch } : {}),
            imageHosts,
            ...(opts.widgetInline ? { inline: true } : {}),
            ...(hostSource !== undefined ? { host: hostSource } : {}),
            ...(opts.view?.theme ? { theme: opts.view.theme } : {}),
            ...(opts.view?.colors ? { colors: opts.view.colors } : {}),
            ...(opts.view?.logo ? { logo: opts.view.logo } : {}),
          });
          widget = written.ok ? widgetText(written.path, written.bytes) + (saved && emits.length ? ` ${PRESSES_SAVED_RESULT}` : "") : widgetFailedText(written.reason);
          // Nothing is showing, so a second call isn't a repeat.
          if (!written.ok) lastGood = null;
        } catch (e) {
          widget = widgetFailedText(e instanceof Error ? e.message : String(e));
          lastGood = null;
        }
      }
      const said = [describeCheck(check, textOnly, fileMode, widget), ...notes].join("\n");
      // A deck has no page to draw in colors, so there is nothing to keep up.
      if (textOnly) return text(deckOnly ? said : said + colorLine);
      return {
        content: [{ type: "text", text: said + colorLine }],
        structuredContent: {
          datasets,
          title: title ?? null,
          errors: check.errors.length,
          warnings: check.warnings.length + (check.data?.length ?? 0),
          toFix,
          repeat: false,
          diagnostics: [...check.errors, ...check.warnings, ...(check.data ?? [])].slice(0, MAX_REPORTED).map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
        },
      };
    },
  );

  // Clients ask for the tool list after they connect, so one that can't draw views gets the text-only description.
  const connected = server.server.oninitialized;
  server.server.oninitialized = () => {
    connected?.();
    if (cannotDrawViews(server)) {
      showTool.description = showDescription(true);
      docsTool.inputSchema = z.object(docsShape(true));
    }
  };

  if (data) {
    server.registerTool(
      "describe_data",
      {
        title: "Describe the database",
        description: "Lists the connected database's tables and views with their columns, row counts and how they join. Call it before writing a query.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => text(data.describe()),
    );

    server.registerTool(
      "query_data",
      {
        title: "Query the database",
        description:
          "Runs one read-only SQL SELECT on the connected SQLite database and keeps the result as a dataset (at most 500 rows). " +
          "Returns the dataset id, its columns and a few sample rows; show it with show_interface's data argument. Aggregate in SQL rather than fetching raw rows.",
        inputSchema: { sql: z.string().min(1).max(10_000).describe("One SELECT (or WITH … SELECT) statement in SQLite syntax.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ sql }) => {
        try {
          return text(summarize(data.query(sql)));
        } catch (e) {
          return text(e instanceof QueryError ? `The query didn't run: ${e.message}` : "The query didn't run.", true);
        }
      },
    );

  }

  if (mcpResults) {
    server.registerTool(
      "list_datasets",
      {
        title: "List imported MCP result datasets",
        description: "Lists ids, column names and types for tool results ingested by the trusted host. Never returns full rows.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => text(listMcpDatasets(mcpResults)),
    );
  }

  if (hasDatasets) {
    registerAppTool(
      server,
      "fetch_dataset",
      {
        title: "Fetch a dataset's rows",
        description: "Used by the SayShape interface to load a dataset's rows. Not for the model.",
        inputSchema: { id: z.string().max(20) },
        annotations: { readOnlyHint: true, openWorldHint: false },
        // Only the interface may call it: the rows go to the screen, not into the conversation.
        _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
      },
      async ({ id }) => {
        const d = findDataset(id);
        if (!d) return text(`No dataset ${id}.`, true);
        return {
          content: [{ type: "text", text: `${d.rows.length} rows of ${d.id}.` }],
          structuredContent: { id: d.id, columns: d.columns, rows: d.rows, truncated: d.truncated },
        };
      },
    );
  }

  const csp = imageCsp(opts.view?.imageHosts ?? []);
  // With --adaptive-guides the view draws reports: the model is told it may write them.
  const viewOpts: ViewOptions = adaptiveOn ? { ...(opts.view ?? DEFAULT_VIEW_OPTIONS), presets: true } : opts.view ?? DEFAULT_VIEW_OPTIONS;
  registerAppResource(server, "SayShape interface", UI_URI, { mimeType: RESOURCE_MIME_TYPE, description: "Draws a SayShape spec with the SayShape engine." }, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: withViewOptions(await opts.uiHtml(), viewOpts),
        // Everything is inline: no scripts, styles or fonts from anywhere else, and images only
        // from --image-hosts. Clipboard write is asked for so Copy text works; chat apps may
        // still say no, and the view falls back.
        _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} }, ...(csp ? { csp } : {}) } },
      },
    ],
  }));

  return server;
}
