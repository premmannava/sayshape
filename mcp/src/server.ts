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
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { DEFAULT_VIEW_OPTIONS, withViewOptions, type ViewOptions } from "./ui/view-options";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { sceneComponents, reviewScenes } from "../../src/components/scene";
import type { ComponentDef } from "../../src/component";
import { elementGuide, elementIndex, guideSections, languageGuide, pickList, PICKS_HEADING, PICKS_HEADING_SHORT } from "../../src/prompt";
import type { Diagnostic } from "../../src/types";
import { tidySpec } from "../../src/model/clean";
import { EXPRESSION_FUNCTIONS } from "../../src/expr";
import { QueryError, summarize, type DataSource } from "./data";
import { listMcpDatasets, type McpResultStore } from "./mcp-results";

export const VERSION = "0.1.0";
export const UI_URI = "ui://sayshape/interface.html";
/** Longer specs are refused: they're slow to stream and nobody reads them in a chat. */
export const MAX_SPEC_CHARS = 20_000;
/** How many problems go back to the model; the first few are what it needs to fix. */
const MAX_REPORTED = 12;

let components: ComponentDef[] = [...coreComponents, ...mapComponents];
let registry = new Registry(components);
let scenesOn = false;

/**
 * --scene: turn the experimental scene elements on (off by default). With them
 * off, "scene" is an unknown element and models aren't told about it. Call
 * before createServer; main.ts does, from the command line.
 */
export function setScenes(on: boolean): void {
  components = [...coreComponents, ...mapComponents, ...(on ? sceneComponents : [])];
  registry = new Registry(components);
  scenesOn = on;
}

/** Extra rules for a model writing into a chat, on top of the generated guide. */
const CHAT_NOTES = `You are writing an interface that appears inside a chat conversation, in a narrow column about 600 pixels wide.
Keep it to one focused screen: a card or column with a title, then the content. Prefer row and grid for side-by-side numbers; avoid more than three columns.
Put the data you know straight into state (lists of records for tables, charts and each). Never claim data is live: if numbers come from your own knowledge, say so in a caption.
When the person should be able to send something back to you (a choice, a form, an approval), give it a button with on=emit:name, for example on=emit:submit_order. The chat shows a short line like "Submit order", and you also receive the exact action name, its value and every state value; reply to it, or call show_interface again with an updated spec.
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
  return languageGuide(registry, { mode: "full", imageHosts: [], notes: withData ? `${CHAT_NOTES}\n\n${DATA_NOTES}` : CHAT_NOTES });
}

const sectionText = (mode: "full" | "compact", name: string) =>
  guideSections(registry, { mode, imageHosts: [] }).find((sec) => sec.name === name)?.text ?? "";

/** Parts of the guide a model can ask for by name, all generated (DATA_NOTES only with a database). */
function topics(withData: boolean, withMcp = false): Record<string, string> {
  return {
    expressions: sectionText("full", "expressions"),
    actions: sectionText("full", "actions"),
    lists: sectionText("full", "data"),
    rules: sectionText("full", "rules"),
    examples: sectionText("full", "example"),
    chat: CHAT_NOTES.split("\n").slice(1).join("\n"),
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
export function quickStart(withData = false, withMcp = false): string {
  return [
    "QUICK START",
    // The guide's "not JavaScript" line is left out to keep this short: show_interface returns
    // each code line's diagnostic, which says what to write instead.
    // Comments are left out too: an answer in a chat has no use for them, and the guide still explains them.
    sectionText("compact", "format").replace(/^FORMAT\n/, "").replace(/^- Not JavaScript:.*\n/m, "").replace(/\n- # starts a comment\.$/m, ""),
    "- Text and props show state: text \"Total: {money(total)}\"; actions run on press: button \"Add\" on=inc:count",
    "- on=emit:pick:{x.name} sends a choice to you; no handler blocks. Also update the screen: on=set:sel:{x.name};emit:pick:{x.name}",
    `- Functions (only these): ${EXPRESSION_FUNCTIONS.join(", ")}. The best row: first(sort(rows, 'revenue', 'desc')).month; a total: sum(rows, 'revenue')`,
    `ELEMENTS\n${elementIndex(components.filter((c) => !arrivesWithParent(c)))}`,
    // The same heading as the guides', in fewer words: this text goes out with every call.
    // Picks without their "such as …" examples or their "(…)" notes, except notes that teach a
    // prop (kind=org): the guides and sayshape_docs keep them all, and this text goes out with
    // every call, so each new element's pick fits.
    `${PICKS_HEADING_SHORT}\n${pickList(components).replace(/, such as [^:\n]*(?=: )/g, "").replace(/ \((?![^)\n]*=)[^)\n]*\)(?=: )/g, "")}`,
    "IN A CHAT: one card with a title; about 600px wide. Use grid min=140 for side-by-side figures; caption estimated numbers.",
    `BEFORE YOU USE AN ELEMENT the first time, get its props and an example from sayshape_docs (elements: ["chart", "table"]). Topics: ${Object.keys(topics(withData, withMcp)).join(", ")}.`,
    ...(withMcp ? ["Imported results: call list_datasets for available ids and fields. Pass data={\"rows\":\"m1\"} to show_interface; don't put dataset rows in spec."] : []),
  ].join("\n");
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
export function docsText(elements: readonly string[], topicNames: readonly string[], withData = false, withMcp = false): string {
  const parts: string[] = [];
  const t = topics(withData, withMcp);
  if (elements.length) {
    const { text, unknown } = elementGuide(registry, elements);
    if (text) parts.push(`ELEMENTS\n${text}`);
    if (unknown.length) parts.push(`No element called ${unknown.join(", ")}. The elements are:\n${elementIndex(components)}`);
  }
  for (const name of topicNames) {
    const body = t[name];
    parts.push(body ? body : `No topic called ${name}. Topics: ${Object.keys(t).join(", ")}.`);
  }
  return parts.length ? parts.join("\n\n") : quickStart(withData, withMcp);
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

export interface SpecCheck {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  /**
   * Problems a person can see in a scene's drawing (a label cut off, a line
   * hidden under a box). The interface still shows, so these never count as
   * problems to fix before it appears; the model is asked to tidy them.
   */
  drawing: Diagnostic[];
}

/** Parse a spec with the engine's own parser and components. Never throws. hostNames: state the interface fills in (datasets). */
export function checkSpec(spec: string, hostNames: readonly string[] = []): SpecCheck {
  const parsed = parse(spec, registry, { knownNames: hostNames });
  const { diagnostics } = parsed;
  return {
    errors: diagnostics.filter((d) => d.severity === "error"),
    warnings: diagnostics.filter((d) => d.severity !== "error"),
    drawing: scenesOn ? reviewScenes(parsed) : [],
  };
}

/**
 * Warnings that change nothing on screen: the parser ignored a prop or some text.
 * Every other warning (a bad expression, a value outside a prop's choices, a
 * name nothing defines) leaves part of the interface wrong, so it needs a fix.
 */
const HARMLESS = /has no prop "|is a weight, not a style|doesn't take quoted text; it was ignored/;
export const isHarmless = (d: Diagnostic) => d.severity !== "error" && HARMLESS.test(d.message);

function describeCheck(c: SpecCheck): string {
  const all = [...c.errors, ...c.warnings];
  const drawing = c.drawing.map((d) => `line ${d.line}: ${d.message.replace(/^Drawing: /, "")}`);
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
  /** The view's own settings: --theme-picker, --theme, --no-save-image, --no-copy-text (main.ts). Default: no picker, teal, Save image and Copy text on. */
  view?: ViewOptions;
  /** A read-only database the model may query (main.ts --data). */
  data?: DataSource;
  /** In-memory MCP results ingested by a trusted host (one store per user/session). */
  mcpResults?: McpResultStore;
  /** The clock, for tests of how long a repeat counts as one. */
  now?: () => number;
}

/** How long after a good interface the same spec again counts as a repeat, not a new request. */
export const REPEAT_WINDOW_MS = 10 * 60_000;

/** What makes two calls the same interface: the spec without blank lines or trailing spaces, and the datasets it shows. */
export function interfaceKey(spec: string, data: Record<string, string>): string {
  const lines = spec.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  const sets = Object.keys(data).sort().map((k) => `${k}=${data[k]}`);
  return `${lines.join("\n")}\n--\n${sets.join(",")}`;
}

/** What the model is told when it sends an interface that is already showing. */
export const REPEAT_TEXT =
  "This exact interface is already showing in the conversation, just above, so this copy is hidden. " +
  "Don't call show_interface again unless the person asks for a change; answer them in text if they need more.";

/** Names a dataset can be shown under: plain state names. */
const DATA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function createServer(opts: ServerOptions): McpServer {
  const data = opts.data;
  const mcpResults = opts.mcpResults;
  const hasDatasets = !!data || !!mcpResults;
  const findDataset = (id: string) => id.startsWith("m") ? mcpResults?.get(id) : data?.get(id);
  const now = opts.now ?? Date.now;
  // The last interface shown with nothing to fix. Smaller models often send the same one again
  // to "confirm" it, which would leave a second copy in the chat. Kept per server, so per
  // conversation over stdio; the stateless HTTP mode makes a server per request and never repeats.
  let lastGood: { key: string; at: number } | null = null;
  const server = new McpServer(
    { name: "sayshape", title: "SayShape", version: VERSION },
    {
      instructions:
        "The person installed SayShape so that visual answers appear as interactive SayShape interfaces inside the chat. " +
        "Whenever they ask for a chart, graph, table, dashboard, scorecard, stat card, form, calculator, tracker, checklist or any other visual or interactive answer, " +
        "use show_interface rather than writing HTML, React, SVG or chart code, or making an artifact. Its description has a quick start; " +
        "choose elements from its PICK BY WHAT YOU'RE SHOWING list, then call sayshape_docs only for the elements you're about to use." +
        (data
          ? " A database is connected: answer questions about it with describe_data and query_data, then show the result with show_interface, " +
            "passing the dataset in its data argument instead of typing the numbers."
          : mcpResults
            ? " Imported MCP result datasets are available: call list_datasets, then show_interface with data ids."
            : ""),
    },
  );

  server.registerTool(
    "sayshape_docs",
    {
      title: "SayShape docs",
      description:
        "Returns the props and an example for the SayShape elements you name, and any topics you ask for. " +
        "Ask only for what you're about to use, e.g. elements: [\"chart\", \"table\"]. With nothing named, returns the quick start.",
      inputSchema: {
        elements: z.array(z.string().max(40)).max(12).optional().describe("Element names, e.g. [\"chart\", \"table\", \"stepper\"]."),
        topics: z.array(z.string().max(40)).max(6).optional().describe(`Topics: ${Object.keys(topics(!!data, !!mcpResults)).join(", ")}.`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ elements, topics: names }) => text(docsText(elements ?? [], names ?? [], !!data, !!mcpResults)),
  );

  registerAppTool(
    server,
    "show_interface",
    {
      title: "Show an interface",
      description:
        "Shows an interactive interface inside the conversation, drawn by the SayShape engine from a spec you write. " +
        "Use it for every visual or interactive answer (charts, tables, dashboards, stat cards, forms, calculators, trackers) " +
        "rather than writing HTML, React, SVG or chart code, or making an artifact. Specs can't run code or choose colors. " +
        "The result lists lines the parser skipped, with the docs for those elements, so you can fix them." +
        (data ? " To show rows from the database, pass data={\"name\": \"d1\"} with a dataset id from query_data and use that name in the spec (items=name)." : "") +
        (mcpResults ? " For imported MCP results, call list_datasets then pass the selected id in data. The model never needs the full rows." : "") +
        "\n\n" +
        quickStart(!!data, !!mcpResults),
      inputSchema: {
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
      const check = checkSpec(spec, names);
      // A state line would replace the rows the interface loads, so point it out.
      const declared = names.filter((n) => new RegExp(`^state\\b[^\\n]*\\b${n}=`, "m").test(spec));
      const notes = [
        ...(names.length ? [`Loaded into the interface: ${names.map((n) => `${n} (${datasets[n]!.id}, ${datasets[n]!.rows} rows)`).join(", ")}.`] : []),
        ...(declared.length ? [`Remove ${declared.join(", ")} from the state line: the interface fills ${declared.length === 1 ? "it" : "them"} in from the dataset.`] : []),
      ];
      // A wrong guess comes back with the docs it needed, instead of the model reading every element up front.
      const toFix = [...check.errors, ...check.warnings].filter((d) => !isHarmless(d)).length;
      const key = interfaceKey(spec, wanted);
      const repeat = toFix === 0 && lastGood !== null && lastGood.key === key && now() - lastGood.at < REPEAT_WINDOW_MS;
      if (toFix === 0) lastGood = { key, at: now() };
      if (repeat) {
        return {
          content: [{ type: "text", text: REPEAT_TEXT }],
          structuredContent: { datasets, title: title ?? null, errors: 0, warnings: check.warnings.length, toFix: 0, repeat: true, diagnostics: [] },
        };
      }
      const failing = elementsOnLines(spec, [...check.errors, ...check.warnings].filter((d) => !isHarmless(d)));
      if (failing.length) notes.push(`\nDocs for ${failing.join(", ")}:\n${elementGuide(registry, failing).text}`);
      return {
        content: [{ type: "text", text: [describeCheck(check), ...notes].join("\n") }],
        structuredContent: {
          datasets,
          title: title ?? null,
          errors: check.errors.length,
          warnings: check.warnings.length,
          toFix,
          repeat: false,
          diagnostics: [...check.errors, ...check.warnings].slice(0, MAX_REPORTED).map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
        },
      };
    },
  );

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

  registerAppResource(server, "SayShape interface", UI_URI, { mimeType: RESOURCE_MIME_TYPE, description: "Draws a SayShape spec with the SayShape engine." }, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: withViewOptions(await opts.uiHtml(), opts.view ?? DEFAULT_VIEW_OPTIONS),
        // Everything is inline: no scripts, styles, fonts or images from anywhere else.
        // Clipboard write is asked for so Copy text works; chat apps may still say no, and the view falls back.
        _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } },
      },
    ],
  }));

  return server;
}
