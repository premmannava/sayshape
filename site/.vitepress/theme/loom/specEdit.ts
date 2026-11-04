/**
 * Small, text-only edits to one element's line in a spec, for the element
 * pages' prop controls. They never parse expressions or run anything: they
 * find `name=value` tokens on a line and replace them, the way a person
 * would edit the text. The engine then parses the result as usual, so a bad
 * edit shows up as an ordinary diagnostic.
 */

/** A prop value as written: "quoted", {expression} or a bare word. */
const VALUE = String.raw`("(?:[^"\\]|\\.)*"|\{[^}]*\}|[^\s"{]+)`;

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const propPattern = (name: string) => new RegExp(String.raw`(^|\s)${escapeName(name)}=${VALUE}`);

/** The index of the first line that starts (after indentation) with this element's name, or -1. */
export function findElementLine(spec: string, type: string): number {
  const re = new RegExp(String.raw`^\s*${escapeName(type)}(\s|$)`);
  return spec.split("\n").findIndex((l) => re.test(l));
}

/** The prop's value as written on the line, without quotes, or null when it isn't there. */
export function readProp(line: string, name: string): string | null {
  const m = propPattern(name).exec(line);
  if (!m) return null;
  const raw = m[2]!;
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
}

/** Quote a value for a spec line: numbers, true/false and single words stay bare, everything else is quoted. */
export function formatValue(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  if (/^[\w.:-]+$/.test(value) && value !== "") return value;
  return `"${value.replace(/"/g, "")}"`;
}

/** The line with the prop set to a value, added at the end if it wasn't there, or removed when value is null. */
export function writeProp(line: string, name: string, value: string | number | boolean | null): string {
  const re = propPattern(name);
  if (value === null) return line.replace(re, "").replace(/\s+$/, "");
  const token = `${name}=${formatValue(value)}`;
  if (re.test(line)) return line.replace(re, (_m, lead: string) => `${lead}${token}`);
  return `${line.replace(/\s+$/, "")} ${token}`;
}

/** The quoted text right after the element's name, or null. */
export function readText(line: string, type: string): string | null {
  const m = new RegExp(String.raw`^\s*${escapeName(type)}\s+"((?:[^"\\]|\\.)*)"`).exec(line);
  return m ? m[1]!.replace(/\\"/g, '"') : null;
}

/** The line with its quoted text replaced, or inserted after the element's name. */
export function writeText(line: string, type: string, text: string): string {
  const clean = text.replace(/"/g, "");
  const quoted = new RegExp(String.raw`^(\s*${escapeName(type)}\s+)"(?:[^"\\]|\\.)*"`);
  if (quoted.test(line)) return line.replace(quoted, (_m, head: string) => `${head}"${clean}"`);
  return line.replace(new RegExp(String.raw`^(\s*${escapeName(type)})`), `$1 "${clean}"`);
}

/** Apply an edit to one line of a spec. */
export function editLine(spec: string, index: number, edit: (line: string) => string): string {
  if (index < 0) return spec;
  const lines = spec.split("\n");
  lines[index] = edit(lines[index]!);
  return lines.join("\n");
}

/** A deliberate mistake for the "try a typo" button: a misspelled prop the parser will name. */
export const TYPO = { name: "colour", value: "red" } as const;
