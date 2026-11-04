/**
 * Adapter from a trusted MCP tool response to a SayShape dataset.
 * The host forwards structuredContent (or JSON text) directly here;
 * the model only receives a schema and opaque id, never full result rows.
 * This module deliberately does not connect to arbitrary MCP servers.
 */
import { MAX_DATASETS, MAX_ROWS, MAX_VALUES, type Cell, type Column, type Dataset, type Row } from "./data";

export const MAX_MCP_COLUMNS = 32;
export const MAX_MCP_CELL_CHARS = 512;
const DEPTH = 12;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const WRAPPERS = new Set(["data", "result", "results", "records", "nodes", "edges", "items", "issues", "pull_requests", "pullRequests"]);
export interface ImportMcpOptions {
  /** Label shown to the model; never grants access to data. */
  label?: string;
  /** Optional dot-separated path within structuredContent, e.g. data.items. */
  path?: string;
}
export class McpResultError extends Error {}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function unbox(value: unknown): unknown {
  if (!obj(value)) return value;
  if (value.isError === true) throw new McpResultError("The upstream MCP tool returned an error.");
  if (value.structuredContent != null) return value.structuredContent;
  if (!Array.isArray(value.content)) return value;
  for (const part of value.content) {
    if (!obj(part) || part.type !== "text" || typeof part.text !== "string") continue;
    try { return JSON.parse(part.text); } catch { /* Try the next text block. */ }
  }
  throw new McpResultError("The MCP result has no structured data or JSON text.");
}

function getPath(v: unknown, path: string): unknown {
  const parts = path.split(".");
  if (parts.length > DEPTH || parts.some((p) => !/^[A-Za-z_][\w-]*$/.test(p) || FORBIDDEN.has(p))) {
    throw new McpResultError("Invalid path; use dot-separated property names such as data.items.");
  }
  for (const p of parts) {
    if (!obj(v) || !Object.prototype.hasOwnProperty.call(v, p))
      throw new McpResultError('No records at path "' + path + '".');
    v = v[p];
  }
  return v;
}

function locate(v: unknown, depth = 0): unknown[] {
  if (Array.isArray(v)) return v;
  if (!obj(v)) throw new McpResultError("Expected a list or a structured record.");
  if (depth >= DEPTH) throw new McpResultError("Too many nested result objects; specify path.");
  const arrays = Object.entries(v).filter(([k, item]) =>
    k !== "columns" && k !== "content" && Array.isArray(item));
  if (arrays.length > 1) throw new McpResultError("Multiple record lists (" + arrays.map(([k]) => k).join(", ") + "); specify path.");
  if (arrays.length === 1) return arrays[0]![1] as unknown[];
  const nested = Object.entries(v).filter(([k, item]) => WRAPPERS.has(k) && obj(item));
  if (nested.length > 1) throw new McpResultError("Multiple nested datasets; specify path.");
  if (nested.length === 1) return locate(nested[0]![1], depth + 1);
  return [v];
}

function scalar(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, MAX_MCP_CELL_CHARS);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (Array.isArray(v) && v.slice(0, 12).every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))) {
    return v.slice(0, 12).map((x) => String(x ?? "")).join(", ").slice(0, MAX_MCP_CELL_CHARS);
  }
  return null;
}

function flatten(value: unknown, prefix = "", depth = 0, row: Record<string, Cell> = {}): Record<string, Cell> {
  if (!obj(value)) { row[prefix || "value"] = scalar(value); return row; }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.has(k)) continue;
    const name = prefix ? prefix + "_" + k : k;
    if (obj(v) && Object.keys(v).length && depth < 2) flatten(v, name, depth + 1, row);
    else row[name] = scalar(v);
  }
  return row;
}

function fieldName(key: string): string {
  let s = key.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  if (!/^[A-Za-z_]/.test(s)) s = "field_" + s;
  if (FORBIDDEN.has(s)) s = "field_" + s;
  return (s || "value").slice(0, 64);
}

export function normalizeMcpResult(result: unknown, options: Pick<ImportMcpOptions, "path"> = {}):
  { rows: Row[]; columns: Column[]; truncated: boolean } {
  const root = unbox(result);
  const raw = locate(options.path ? getPath(root, options.path) : root);
  const named = new Map<string, string>(), used = new Set<string>();
  const prepared: Row[] = [];
  let truncated = raw.length > MAX_ROWS;
  for (const item of raw.slice(0, MAX_ROWS)) {
    const actual = obj(item) && obj(item.node) ? item.node : item; // GraphQL edges
    const fields = flatten(actual), row: Row = {};
    for (const [original, value] of Object.entries(fields)) {
      let name = named.get(original);
      if (!name) {
        if (named.size >= MAX_MCP_COLUMNS) { truncated = true; continue; }
        const base = fieldName(original);
        name = base;
        for (let n = 2; used.has(name); n++) name = base.slice(0, 59) + "_" + n;
        named.set(original, name);
        used.add(name);
      }
      row[name] = value;
      if (typeof value === "string" && value.length === MAX_MCP_CELL_CHARS) truncated = true;
    }
    prepared.push(row);
  }
  const fields = [...named.values()];
  const limit = Math.min(MAX_ROWS, Math.floor(MAX_VALUES / Math.max(1, fields.length)));
  if (prepared.length > limit) truncated = true;
  const rows: Row[] = prepared.slice(0, limit).map((source) => {
    const row: Row = {};
    for (const field of fields) row[field] = source[field] ?? null;
    return row;
  });
  const columns: Column[] = fields.map((name) => {
    const v = rows.map((r) => r[name]).find((x) => x !== null && x !== undefined);
    return { name, type: v === undefined ? "empty" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text" };
  });
  return { rows, columns, truncated };
}

/** Create one store per trusted session. IDs are NOT authentication secrets. */
export class McpResultStore {
  private datasets = new Map<string, Dataset>();
  private next = 0;
  ingest(value: unknown, options: ImportMcpOptions = {}): Dataset {
    const normalized = normalizeMcpResult(value, options);
    const d: Dataset = { id: "m" + ++this.next, sql: "", source: options.label?.trim().slice(0, 120) || "MCP tool result", ...normalized };
    this.datasets.set(d.id, d);
    while (this.datasets.size > MAX_DATASETS) this.datasets.delete(this.datasets.keys().next().value!);
    return d;
  }
  get(id: string): Dataset | undefined { return this.datasets.get(id); }
  list(): Dataset[] { return [...this.datasets.values()]; }
  clear(): void { this.datasets.clear(); }
}

/** Only names, types and counts are sent to the model; fetch_dataset is app-only. */
export function listMcpDatasets(store: McpResultStore): string {
  const sets = store.list();
  if (!sets.length) return "No MCP datasets loaded. The trusted integration must ingest a tool result first.";
  return [
    "Available MCP result datasets:",
    ...sets.slice(-20).map((d) => "- " + d.id + " (" + d.source + "): " +
      d.rows.length + " rows" + (d.truncated ? " (truncated)" : "") + "; columns: " +
      (d.columns.map((c) => c.name + " " + c.type).join(", ") || "none")),
    'Display with show_interface data={"<name>":"<dataset-id>"} and items=<name>. The interface fetches rows directly.',
  ].join("\n");
}
