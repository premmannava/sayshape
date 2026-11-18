/**
 * The `report` preset: one high-level element for data answers. The model
 * names the data and what to show; this file writes the layout, as ordinary
 * SayShape lines the parser then reads like any other. Nothing new is drawn:
 * the screen is made of text, select, grid, stat, card, chart and table, so
 * accessibility, Copy text and every other feature work as they always do.
 *
 *   report "Claims review" subtitle="2025" data=claims filter=status
 *     count
 *     sum incurred
 *     count status=Open
 *     bar monthly month opened
 *     line monthly month opened closed
 *     donut line
 *     table
 *
 * Each line under a report is one part:
 *   figure  count|sum|avg|min|max [field] [field=value ...] ["Label"]
 *   chart   bar|hbar|line|area|pie|donut|stacked [list] x [y ...] ["Title"]
 *   table   table [list] [field ...]
 *
 * A figure or chart on the report's own data (data=) works on the rows the
 * filter leaves; a chart with no y, or one y, on that data adds the rows up per
 * x with group(). Another list is drawn as it is. Labels, titles, column
 * headers and number formats come from the field names and, when the data is
 * known (written in the spec or set by the host), from the values.
 *
 * Off unless a host turns presets on (parse's `presets`, the engine's
 * `presets`). expandPresets() is exported, so the expansion can be read.
 */
import type { Diagnostic } from "../types";

/** What the expansion may know about the data before the screen is drawn. */
export interface PresetData {
  /** A name's value: a list written in a state line of the spec, or data the host set. Undefined when not known (yet). */
  value(name: string): unknown;
  /** Whether a name is state the spec declares or the host supplies, even without its value. */
  known(name: string): boolean;
}

export interface Expansion {
  /** The spec with every report replaced by ordinary SayShape. */
  text: string;
  /** For each line of `text` (index 0 is line 1), the line of the original spec it came from. */
  lines: number[];
  /** For each line of `text`, its index among the lines made from the same original line (0 for lines copied as they are). */
  part: number[];
  /** Whether any report was expanded. */
  expanded: boolean;
  /** The data names reports read, so a host can expand again when their values arrive. */
  reads: string[];
  /** Problems in report lines, on the original spec's line numbers. */
  diagnostics: Diagnostic[];
}

export const FIGURE_OPS = ["count", "sum", "avg", "min", "max"] as const;
export const CHART_KINDS = ["bar", "hbar", "line", "area", "pie", "donut", "stacked"] as const;
type FigureOp = (typeof FIGURE_OPS)[number];
type ChartKind = (typeof CHART_KINDS)[number];

const REPORT_LINE = /^(\s*)report(?=\s|$)/;
const NAME = /^[A-Za-z_]\w*$/;
/** Fields that hold amounts of money, by name. */
const MONEY = /(amount|price|cost|revenue|incurred|paid|salary|sales|spend|budget|income|fee|mrr|arr|value|balance|profit|total)/i;
/** Fields that hold counts or measures, by name, when the values aren't known. */
const NUMBERISH = /(count|days|qty|quantity|units|users|age|score|hours|rate|pct|percent|change|growth|yoy|rank|level|size|views|visits|clicks|signups|orders)/i;
const ACRONYMS: Record<string, string> = { id: "ID", yoy: "YoY", mrr: "MRR", arr: "ARR", mau: "MAU", dau: "DAU", kpi: "KPI", url: "URL", nps: "NPS", roi: "ROI", ytd: "YTD", sku: "SKU" };

/** A field or list name as words people read: incurred → Incurred, byLine → By line, yoy → YoY. */
export function humanize(name: string): string {
  const words = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/).filter(Boolean);
  const out = words.map((w) => ACRONYMS[w] ?? w).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;
/** A value in an expression: a number or true/false as it is, anything else as quoted text. */
const literal = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) || v === "true" || v === "false" ? v : `'${v.replace(/'/g, "")}'`);

interface Token { kind: "word" | "text" | "pair"; value: string; key?: string }

/** Words, "quoted text" and key=value (value maybe quoted) on one report line. */
function tokens(body: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:"([^"]*)"|([A-Za-z_][\w.]*)=(?:"([^"]*)"|(\S+))|(\S+))/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && m[0].trim()) {
    if (m[1] !== undefined) out.push({ kind: "text", value: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "pair", key: m[2], value: m[3] ?? m[4] ?? "" });
    else out.push({ kind: "word", value: m[5]! });
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const firstRow = (v: unknown): Record<string, unknown> | undefined => (Array.isArray(v) ? v.find(isRecord) : undefined);

type FieldKind = "money" | "number" | "text";
function fieldKind(field: string, rows: unknown): FieldKind {
  const row = firstRow(rows);
  if (row && field in row) {
    if (typeof row[field] !== "number") return "text";
    return MONEY.test(field) ? "money" : "number";
  }
  return MONEY.test(field) ? "money" : NUMBERISH.test(field) ? "number" : "text";
}

interface Out {
  /** The original line this output line comes from. */
  from: number;
  text: string;
}

/** Expand every report in a spec. A spec with none comes back as it is. */
export function expandPresets(src: string, data: PresetData): Expansion {
  const srcLines = src.split("\n");
  // A final newline leaves an empty last piece; it isn't a line.
  const trailing = srcLines.length > 0 && srcLines[srcLines.length - 1] === "";
  if (trailing) srcLines.pop();
  const identity = (): Expansion => ({ text: src, lines: srcLines.map((_, i) => i + 1), part: srcLines.map(() => 0), expanded: false, reads: [], diagnostics: [] });
  if (!srcLines.some((l) => REPORT_LINE.test(l))) return identity();

  const head: Out[] = [];
  const body: Out[] = [];
  const diagnostics: Diagnostic[] = [];
  const reads = new Set<string>();
  let reportNo = 0;

  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i]!;
    const m = REPORT_LINE.exec(line);
    if (!m) { body.push({ from: i + 1, text: line }); continue; }
    const indent = m[1]!.length;
    // The block: the lines after it indented deeper (blank lines inside it belong to it).
    let end = i + 1;
    while (end < srcLines.length) {
      const l = srcLines[end]!;
      if (l.trim() && l.length - l.trimStart().length <= indent) break;
      end++;
    }
    reportNo++;
    const children = srcLines.slice(i + 1, end).map((text, k) => ({ line: i + 2 + k, text: text.trim() })).filter((c) => c.text && !c.text.startsWith("#"));
    expandReport({ line: i + 1, body: line.slice(m[0].length), indent, children, no: reportNo }, data, head, body, diagnostics, reads);
    i = end - 1;
  }

  const all = [...head, ...body];
  // Number each output line among the lines made from the same original line, for stable element ids.
  const seen = new Map<number, number>();
  const part = all.map((o) => { const n = seen.get(o.from) ?? 0; seen.set(o.from, n + 1); return n; });
  return {
    text: all.map((o) => o.text).join("\n") + (trailing || all.length ? "\n" : ""),
    lines: all.map((o) => o.from),
    part,
    expanded: true,
    reads: [...reads],
    diagnostics,
  };
}

/**
 * Whether a part's first word names a list of its own: a list that's known, or,
 * when the report's rows are known, a word that isn't one of their fields
 * (a list whose state line hasn't arrived yet, written after the report).
 */
function ownList(words: string[], main: string | undefined, mainRows: unknown, data: PresetData, minWords: number): boolean {
  const w = words[0];
  if (w === undefined || w === main || !NAME.test(w)) return false;
  if (data.known(w)) return true;
  const row = firstRow(mainRows);
  return !!row && !(w in row) && words.length >= minWords;
}

interface ReportSource { line: number; body: string; indent: number; children: Array<{ line: number; text: string }>; no: number }

function expandReport(r: ReportSource, data: PresetData, head: Out[], body: Out[], diags: Diagnostic[], reads: Set<string>): void {
  const pad = " ".repeat(r.indent);
  const at = (from: number, depth: number, text: string) => body.push({ from, text: pad + "  ".repeat(depth) + text });
  const top = (from: number, text: string) => head.push({ from, text });
  const warn = (line: number, message: string) => diags.push({ line, severity: "warning", message });

  const toks = tokens(r.body);
  const title = toks.find((t) => t.kind === "text")?.value;
  const prop = (k: string) => toks.find((t) => t.kind === "pair" && t.key === k)?.value;
  for (const t of toks) {
    if (t.kind === "pair" && !["data", "subtitle", "filter"].includes(t.key!)) warn(r.line, `"report" has no "${t.key}". It takes a title in quotes, data=, subtitle= and filter=`);
    if (t.kind === "word") warn(r.line, `"${t.value}" isn't part of the report line. Write its title in quotes and props as name=value: report "Sales" data=sales filter=region`);
  }

  // The report's data: data=, or the one list the spec declares.
  let main = prop("data");
  if (main !== undefined && !NAME.test(main)) { warn(r.line, `data= takes the name of a list, like data=claims`); main = undefined; }
  if (main === undefined) warn(r.line, `"report" needs data=, the name of the list it shows, like data=claims`);
  else {
    reads.add(main);
    if (!data.known(main)) warn(r.line, `"${main}" isn't state or data from the app. Declare it, state ${main}=[…], or use the name the app gave`);
  }
  const mainRows = main !== undefined ? data.value(main) : undefined;
  const suffix = r.no > 1 ? String(r.no) : "";
  const filters = (prop("filter") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  /** Why a field can't be used: the rows are known and don't have it. Undefined when it's fine (or the rows aren't known yet). */
  const missingField = (list: string | undefined, rows: unknown, field: string): string | undefined => {
    const row = firstRow(rows);
    return row && !(field in row) ? `${list ?? "The data"} has no field "${field}". Its fields: ${Object.keys(row).join(", ")}` : undefined;
  };
  const checkField = (line: number, list: string | undefined, rows: unknown, field: string): boolean => {
    const problem = missingField(list, rows, field);
    if (problem) warn(line, problem);
    return !problem;
  };
  // A part line that makes nothing is an error, like any skipped line: the screen would look complete without
  // the chart, figure or table that was asked for, so the line is named and a model is sent back to fix it.
  const drop = (line: number, part: string, why: string) => diags.push({ line, severity: "error", message: `This ${part} isn't shown: ${why}` });
  const firstMissing = (list: string | undefined, rows: unknown, fields: readonly string[]) => fields.map((f) => missingField(list, rows, f)).find(Boolean);
  // The report's own list named first (line sales month amount on data=sales), as another list would be: it means the report's rows.
  // Only with words left after it that the part needs (a chart's x), so "bar sales" can still mean a field
  // called sales while the rows aren't known yet.
  const dropOwnName = (words: string[], needAfter: number) => {
    const row = firstRow(mainRows);
    if (main !== undefined && words[0] === main && words.length > needAfter && !(row && main in row)) words.shift();
  };

  // The rows parts work on: the data, narrowed by each filter that has something chosen.
  let rows = main ?? "[]";
  if (main && filters.length) {
    let expr = main;
    for (const f of filters) {
      if (!NAME.test(f)) { warn(r.line, `filter= takes field names, like filter=status or filter=status,site`); continue; }
      checkField(r.line, main, mainRows, f);
      const s = `report${suffix}${f.charAt(0).toUpperCase()}${f.slice(1)}`;
      top(r.line, `state ${s}=[]`);
      expr = `(len(${s}) ? filter(${expr}, '${f}', ${s}) : ${expr})`;
    }
    rows = `report${suffix}Rows`;
    top(r.line, `derive ${rows}={${expr.replace(/^\((.*)\)$/, "$1")}}`);
  }

  at(r.line, 0, "column gap=16");
  if (title !== undefined) at(r.line, 1, `text ${quote(title)} style=title`);
  const subtitle = prop("subtitle");
  if (subtitle) at(r.line, 1, `text ${quote(subtitle)} tone=muted`);
  if (main && filters.length) {
    at(r.line, 1, "row gap=12 wrap=true");
    for (const f of filters.filter((x) => NAME.test(x))) {
      const s = `report${suffix}${f.charAt(0).toUpperCase()}${f.slice(1)}`;
      at(r.line, 2, `select ${quote(humanize(f))} items={pluck(group(${main}, '${f}'), '${f}')} bind=${s} multiple=true placeholder="All"`);
    }
  }

  const dataLabel = main ? humanize(main) : "Items";
  let group: "figures" | "charts" | null = null;
  let tables = 0;

  for (const c of r.children) {
    const parts = tokens(c.text);
    const op = parts[0]?.kind === "word" ? parts[0].value : "";
    const words = parts.slice(1).filter((t) => t.kind === "word").map((t) => t.value);
    const label = parts.slice(1).find((t) => t.kind === "text")?.value;
    const where = parts.filter((t) => t.kind === "pair");

    if ((FIGURE_OPS as readonly string[]).includes(op)) {
      if (group !== "figures") { at(c.line, 1, "grid min=170 gap=12"); group = "figures"; }
      const field = words[0];
      if (op !== "count" && !field) { drop(c.line, `${op} figure`, `${op} needs a field: ${op} amount`); continue; }
      const noField = field ? missingField(main, mainRows, field) : undefined;
      if (noField) { drop(c.line, `${op} figure`, noField); continue; }
      let list = rows;
      for (const w of where) list = `filter(${list}, '${w.key}', ${literal(w.value)})`;
      const cond = where.map((w) => w.value).join(", ");
      let value: string, name: string;
      if (op === "count") {
        value = field ? `{number(count(${list}, '${field}'))}` : `{number(len(${list}))}`;
        name = label ?? (cond ? cond : field ? humanize(field) : dataLabel);
      } else {
        const kind = fieldKind(field!, mainRows);
        const calc = `${op}(${list}, '${field}')`;
        value = kind === "money" ? `{compact(${calc}, 'USD')}` : op === "sum" ? `{compact(${calc})}` : `{number(round(${calc}, 1))}`;
        const word = { sum: "Total", avg: "Average", min: "Lowest", max: "Highest" }[op as Exclude<FigureOp, "count">];
        name = label ?? `${word} ${humanize(field!).toLowerCase()}${cond ? `, ${cond}` : ""}`;
      }
      at(c.line, 2, "card pad=18 gap=10");
      at(c.line, 3, `stat label=${quote(name)} value=${value}`);
      continue;
    }

    if ((CHART_KINDS as readonly string[]).includes(op)) {
      if (group !== "charts") { at(c.line, 1, "grid min=300 gap=12"); group = "charts"; }
      // A first word that names a list other than the report's data is the chart's own list.
      dropOwnName(words, 1);
      const own = ownList(words, main, mainRows, data, 2) ? words.shift() : undefined;
      if (own) reads.add(own);
      const [x, ...ys] = words;
      const chartPart = `${op} chart`;
      if (!x) { drop(c.line, chartPart, `${op} needs the field to go along: ${op} month revenue, or ${op} region for a count per region`); continue; }
      const listRows = own ? data.value(own) : mainRows;
      const noField = firstMissing(own ?? main, listRows, [x, ...ys]);
      if (noField) { drop(c.line, chartPart, noField); continue; }
      let items: string, y: string;
      if (own) {
        items = own;
        let picked = ys;
        if (!picked.length) {
          const row = firstRow(listRows);
          const num = row && Object.keys(row).find((k) => k !== x && typeof row[k] === "number");
          if (!num) { drop(c.line, chartPart, `say which field of ${own} to show: ${op} ${own} ${x} amount`); continue; }
          picked = [num];
        }
        y = picked.join(",");
      } else if (ys.length > 1) {
        items = rows; y = ys.join(",");
      } else {
        items = `{group(${rows}, '${x}'${ys[0] ? `, '${ys[0]}'` : ""})}`;
        y = ys[0] ?? "count";
      }
      const yNames = y.split(",");
      const what = own && !ys.length ? humanize(yNames[0]!) : ys.length ? yNames.map((n, k) => (k ? humanize(n).toLowerCase() : humanize(n))).join(yNames.length > 2 ? ", " : " and ") : (own ? humanize(own) : dataLabel);
      const name = label ?? `${what} by ${humanize(x).toLowerCase()}`;
      const kind = fieldKind(yNames[0]!, listRows);
      at(c.line, 2, "card pad=18 gap=10");
      at(c.line, 3, `chart ${quote(name)} kind=${op as ChartKind} items=${items.startsWith("{") ? items : items} x=${x} y=${y}${kind === "money" ? " format=money" : ""}`);
      continue;
    }

    if (op === "table") {
      group = null;
      tables++;
      dropOwnName(words, 0);
      const own = ownList(words, main, mainRows, data, 1) ? words.shift() : undefined;
      if (own) reads.add(own);
      const listRows = own ? data.value(own) : mainRows;
      const row = firstRow(listRows);
      const fields = words.length ? words : row ? Object.keys(row) : [];
      const noField = firstMissing(own ?? main, listRows, fields);
      if (noField) { drop(c.line, "table", noField); continue; }
      if (!fields.length) {
        // The data isn't here yet: a placeholder until it is (a host expands again then).
        at(c.line, 1, `skeleton shape=block`);
        continue;
      }
      const s = `report${suffix}Sort${tables > 1 ? tables : ""}`, d = `report${suffix}Dir${tables > 1 ? tables : ""}`;
      top(c.line, `state ${s}="" ${d}="asc"`);
      const key = fields.includes("id") ? "id" : row && "id" in row ? "id" : fields[0]!;
      at(c.line, 1, "card pad=18 gap=10");
      at(c.line, 2, `table ${quote(label ?? (own ? humanize(own) : dataLabel))} items=${own ?? (rows.startsWith("[") ? "{[]}" : rows)} key=${key} sort=${s} direction=${d}`);
      for (const f of fields) {
        const kind = fieldKind(f, listRows);
        at(c.line, 3, `table-column ${quote(humanize(f))} field=${f}${kind !== "text" ? ` format=${kind}` : ""}`);
      }
      continue;
    }

    drop(c.line, "line", `"${op || c.text}" isn't a report part. Each line under a report is a figure (${FIGURE_OPS.join(", ")}), a chart (${CHART_KINDS.join(", ")}) or table`);
  }
}

/** The guide's example report, checked by tests to expand and draw with no problems. */
export const REPORT_EXAMPLE = `report "Sales review" subtitle="First half" data=sales filter=region
  count
  sum amount
  avg amount
  count status=Late
  bar month amount
  line targets month goal actual
  donut region
  table
state sales=[{id: 1, month: "Jan", region: "West", status: "Paid", amount: 1200}, {id: 2, month: "Feb", region: "East", status: "Late", amount: 800}]
state targets=[{month: "Jan", goal: 1000, actual: 1200}, {month: "Feb", goal: 1000, actual: 800}]`;

/** What the report guide says, besides the example: everything a model needs to write one. */
export function reportGuide(fallbackWord: string): string {
  return `You show data in SayShape with one report. Output only SayShape: no prose, no code fences.

${reportSyntax()}

ANYTHING ELSE
If the request needs what a report can't show (a form, inputs, buttons, tabs, settings, cards of text, steps), write only ${fallbackWord} and nothing else.`;
}

/**
 * How to write a report, with its example: the part of the report guide every guide that offers the
 * preset shares (the report guide, and the capability map and guides in src/capabilities.ts).
 */
export function reportSyntax(): string {
  return `EXAMPLE
${REPORT_EXAMPLE}

REPORT
- First line: report "Title" subtitle="One line" data=<list> filter=<field>[,<field>]. The screen is built from it.
- Then one indented line (2 spaces) per part, in screen order:
  - figures: ${FIGURE_OPS.join(", ")}, then a field (count needs none). Add field=value to any figure to use only matching rows: count status=Late, avg days status=Closed.
  - charts: ${CHART_KINDS.join(", ")}, then x, then y fields. With no y it counts rows per x (donut region). Name another list first to draw it as it is: line targets month goal actual.
  - table: every field of data=, or the fields you list: table id region amount.
- Labels, titles, column headers and money or number formats come from field names. To name a part yourself, end its line with "Text".
- filter= adds a filter per field. Figures, charts and the table on data= show only the rows it leaves.

DATA
- Data from the app: use its names in data= and charts; never copy its rows.
- Data in the request: after the report, one state line per list, every row on that line, numbers unquoted, short field names.`;
}
