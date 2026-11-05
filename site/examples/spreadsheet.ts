/**
 * Turning a spreadsheet into SayShape data for the landing page: clean
 * column names, typed values, a description of each column for the model,
 * three sample rows, and questions worth asking. No browser APIs, so
 * test/spreadsheet.test.ts runs it in Node; reading the file itself is in
 * the theme's sayshape/readFile.ts.
 *
 * Only the description, the sample and the question ever leave the browser.
 * The rows go to the engine as host data.
 */

export type CellValue = string | number | boolean | null;
export type Row = Record<string, string | number | boolean>;
export type ColumnType = "number" | "text" | "date" | "yes/no" | "mixed";

export interface Column {
  /** The field name the engine and the model use: total_insured_value_usd. */
  name: string;
  /** The heading as the file has it: "Total Insured Value (USD)". */
  label: string;
  type: ColumnType;
  /** How many different values the column has. */
  distinct: number;
}

export interface Table {
  columns: Column[];
  rows: Row[];
  /** Things the person should know: rows left out, columns renamed or dropped. */
  notes: string[];
}

/** The engine holds at most this many values of host data (MAX_HOST_VALUES in src/data.ts). */
export const MAX_VALUES = 1_000_000;
/** Reading stops after this many rows, whatever the file holds. */
export const MAX_ROWS_READ = 100_000;
/** The proxy accepts at most this many columns (worker/src/answer.ts). */
export const MAX_COLUMNS = 40;
const MAX_NAME = 64;
/** The proxy cuts sample cells to this length; cutting here keeps the request small. */
export const MAX_CELL_CHARS = 100;
export const SAMPLE_ROWS = 3;

const group = (n: number) => n.toLocaleString("en-US");

/**
 * Field names the engine and the proxy accept: lower case, words joined with
 * _, starting with a letter. "Total Insured Value (USD)" becomes
 * total_insured_value_usd; a blank heading becomes column_4; repeats get _2.
 */
export function cleanNames(headings: readonly unknown[]): string[] {
  const used = new Set<string>();
  return headings.map((h, i) => {
    let base = String(h ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, MAX_NAME - 4);
    if (!base) base = `column_${i + 1}`;
    if (/^[0-9]/.test(base)) base = `c_${base}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return name;
  });
}

/** A number written for people: "1,250", "$1,250.50", "-84.10", "(84.10)" for negative, "12%" stays text. */
const NUMBER = /^\(?-?[$€£¥]?\s?-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\)?$/;
function asNumber(s: string): number | null {
  const t = s.trim();
  if (!NUMBER.test(t)) return null;
  const negative = t.startsWith("(") && t.endsWith(")") || t.includes("-");
  const n = Number(t.replace(/[()$€£¥,\s-]/g, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** A cell as the reader gives it: text, a number, true/false, a Date, or empty. */
type RawCell = string | number | boolean | Date | null | undefined;

/** A date as SayShape writes dates: YYYY-MM-DD text. Spreadsheet dates are read as UTC. */
function dateText(d: Date): string | null {
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function normalise(v: RawCell): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dateText(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

/** What a column holds, and its values converted to match: numbers written as text become numbers. */
function typeColumn(values: CellValue[]): { type: ColumnType; values: CellValue[] } {
  const present = values.filter((v) => v !== null);
  if (!present.length) return { type: "text", values };
  if (present.every((v) => typeof v === "boolean")) return { type: "yes/no", values };
  if (present.every((v) => typeof v === "number" || (typeof v === "string" && asNumber(v) !== null))) {
    return { type: "number", values: values.map((v) => (typeof v === "string" ? asNumber(v) : v)) };
  }
  if (present.every((v) => typeof v === "string" && ISO_DATE.test(v))) return { type: "date", values };
  if (present.some((v) => typeof v === "number") && present.some((v) => typeof v === "string")) return { type: "mixed", values };
  return { type: "text", values: values.map((v) => (typeof v === "boolean" ? (v ? "yes" : "no") : v)) };
}

const emptyRow = (r: readonly RawCell[]) => r.every((c) => c === null || c === undefined || (typeof c === "string" && c.trim() === ""));

/**
 * A grid of cells (the first non-empty row is the headings) as a table of
 * records. Fully empty rows and columns are dropped, columns past 40 too,
 * and rows past what the engine can hold, each with a note saying so.
 */
export function tableFromGrid(grid: readonly (readonly RawCell[])[], opts: { truncatedAt?: number } = {}): Table {
  const notes: string[] = [];
  const start = grid.findIndex((r) => !emptyRow(r));
  if (start < 0) return { columns: [], rows: [], notes: ["The sheet is empty."] };
  const headings = grid[start]!;
  const body = grid.slice(start + 1).filter((r) => !emptyRow(r));
  const width = Math.max(headings.length, ...body.slice(0, 1000).map((r) => r.length));

  // Columns with a heading or any value; the rest are spacer columns.
  let keep = Array.from({ length: width }, (_, c) => c).filter((c) => normalise(headings[c]) !== null || body.some((r) => normalise(r[c]) !== null));
  if (keep.length > MAX_COLUMNS) {
    notes.push(`Using the first ${MAX_COLUMNS} of ${keep.length} columns.`);
    keep = keep.slice(0, MAX_COLUMNS);
  }
  const labels = keep.map((c) => String(normalise(headings[c]) ?? ""));
  const names = cleanNames(labels);

  // Each row counts once, and each value in it once (MAX_HOST_VALUES in src/data.ts).
  const maxRows = Math.max(0, Math.floor((MAX_VALUES - 1) / (keep.length + 1)));
  let rowsUsed = body;
  if (body.length > maxRows) {
    notes.push(`Using the first ${group(maxRows)} of ${group(body.length)} rows: that's as much as the page holds with ${keep.length} columns.`);
    rowsUsed = body.slice(0, maxRows);
  } else if (opts.truncatedAt !== undefined) {
    notes.push(`Using the first ${group(opts.truncatedAt)} rows. The file has more.`);
  }

  const typed = keep.map((c) => typeColumn(rowsUsed.map((r) => normalise(r[c]))));
  const rows: Row[] = rowsUsed.map((_, i) => {
    const row: Row = {};
    typed.forEach((col, j) => {
      const v = col.values[i];
      if (v !== null && v !== undefined) row[names[j]!] = v;
    });
    return row;
  });
  const columns: Column[] = typed.map((col, j) => ({
    name: names[j]!,
    label: labels[j] || names[j]!,
    type: col.type,
    distinct: new Set(col.values.filter((v) => v !== null)).size,
  }));
  // Only worth a note when a name changed more than its case or spaces: "Region" as region isn't news.
  const renamed = columns.find((c) => c.label.trim().toLowerCase().replace(/\s+/g, "_") !== c.name);
  if (renamed) notes.push(`Column names are written as the AI reads them: "${renamed.label}" is ${renamed.name}.`);
  return { columns, rows, notes };
}

/** A table from records that are already clean (the sample spreadsheets). */
export function tableFromRows(rows: readonly Row[]): Table {
  const names = Object.keys(rows[0] ?? {});
  const grid: RawCell[][] = [names, ...rows.map((r) => names.map((n) => r[n] ?? null))];
  return tableFromGrid(grid);
}

/** What the proxy is sent: the question, the columns and three rows. Never the rest. */
export interface Payload {
  question: string;
  rows: number;
  columns: Array<{ name: string; type: ColumnType; distinct: number }>;
  sample: Array<Record<string, CellValue>>;
}

const cut = (v: string | number | boolean) => (typeof v === "string" && v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS - 1)}…` : v);

export function sampleRows(t: Table): Array<Record<string, CellValue>> {
  return t.rows.slice(0, SAMPLE_ROWS).map((r) => Object.fromEntries(t.columns.map((c) => [c.name, r[c.name] === undefined ? null : cut(r[c.name]!)])));
}

export function payload(t: Table, question: string): Payload {
  return {
    question,
    rows: t.rows.length,
    columns: t.columns.map(({ name, type, distinct }) => ({ name, type, distinct })),
    sample: sampleRows(t),
  };
}

const words = (name: string) => name.replace(/_/g, " ");
/** Columns that name each row (an id or a name) rather than measure anything. */
const isKey = (c: Column, rows: number) => /(^|_)(id|no|number|code|key)$/.test(c.name) || (c.type === "text" && c.distinct >= Math.max(10, rows * 0.9));

/**
 * Up to four questions worth asking about a table, from its columns alone:
 * a total per category, the top rows by an amount, a count per category and
 * an average. No model is asked.
 */
export function suggestQuestions(t: Table): string[] {
  const rows = t.rows.length;
  const amounts = t.columns.filter((c) => c.type === "number" && !isKey(c, rows) && c.distinct > 1);
  const categories = t.columns.filter((c) => (c.type === "text" || c.type === "yes/no") && c.distinct >= 2 && c.distinct <= 50).sort((a, b) => a.distinct - b.distinct);
  const labels = t.columns.filter((c) => c.type === "text" && isKey(c, rows));
  const out: string[] = [];
  const amount = amounts[amounts.length - 1] ?? amounts[0];
  const category = categories.find((c) => c.distinct >= 3) ?? categories[0];
  if (amount && category) out.push(`Total ${words(amount.name)} by ${words(category.name)}`);
  if (amount && labels[0]) out.push(`Top 10 ${words(labels[0].name)} by ${words(amount.name)}`);
  if (category) out.push(`How many rows per ${words(category.name)}?`);
  const other = categories.find((c) => c !== category);
  if (amount && other) out.push(`Average ${words(amount.name)} by ${words(other.name)}`);
  else if (amounts.length > 1 && category) out.push(`Average ${words(amounts[0]!.name)} by ${words(category.name)}`);
  if (!out.length) out.push("Summarize this spreadsheet");
  return out.slice(0, 4);
}
