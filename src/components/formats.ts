/**
 * Value formats shared by data elements (table today; compare-row, detail,
 * board and tree can adopt them). One function turns a value into the text a
 * cell shows; nothing here draws or reads the theme.
 *
 * - text: text as is, numbers as 1,200.5, true/false as Yes/No.
 * - number: 1,200.5. money: $1,200.00 (US dollars).
 * - percent: the value is already a percentage (42 reads 42%), like charts.
 * - compact: 1,250,000 reads 1.25M.
 * - date: YYYY-MM-DD text reads Mar 3, 2026. Dates are text, never Date.
 * Number formats show only numbers and date only a real date; anything else
 * is EMPTY_CELL, flagged so the caller can warn once.
 */
import { MONTHS, parseDate } from "../dates";
import type { Value } from "../types";
import { formatter } from "./chart-kit";

export const FORMAT_NAMES = ["text", "number", "money", "percent", "date", "compact"] as const;
export type FormatName = (typeof FORMAT_NAMES)[number];
/** The placeholder for a missing or unusable value. */
export const EMPTY_CELL = "—";
/** Formats whose values are numbers (and so can be summed, barred and signed). */
export const NUMERIC_FORMATS: readonly FormatName[] = ["number", "money", "percent", "compact"];
export const isNumericFormat = (f: FormatName) => NUMERIC_FORMATS.includes(f);

/**
 * Whether a money column needs cents: only when one of its values has them.
 * Whole amounts ($48,200) read faster without a column of .00, and nothing is rounded.
 */
export function needsCents(values: ReadonlyArray<Value | undefined>): boolean {
  return values.some((v) => typeof v === "number" && Number.isFinite(v) && Math.round(v * 100) % 100 !== 0);
}

/** cents: false drops .00 from whole money amounts (see needsCents). */
export function formatNumber(v: number, format: "number" | "money" | "percent" | "compact", cents = true): string {
  const money = format === "money";
  const huge = Math.abs(v) >= 1e15, tiny = !money && v !== 0 && Math.abs(v) < 0.01;
  // Very large or small numbers in scientific form, so they're never cut or shown as 0.
  const opts: Intl.NumberFormatOptions =
    huge || tiny ? { notation: "scientific", maximumFractionDigits: 3 }
    : money ? (cents ? {} : { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : format === "compact" ? { notation: "compact", maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  // Say how many decimals money keeps in scientific form: engines resolve the
  // default differently (Node 22 gives -$1.00E300, Node 24 -$1E300).
  if (money && (huge || tiny)) opts.minimumFractionDigits = 2;
  if (format === "percent") return formatter("percent", opts).format(v);
  return formatter(money ? "money" : "number", opts).format(v);
}

export const dateText = (s: string): string | null => {
  const c = parseDate(s);
  return c ? `${MONTHS[c.m - 1]!.slice(0, 3)} ${c.d}, ${c.y}` : null;
};

/** A value's text in a format, and whether it didn't suit the format (for one warning). */
export function formatValue(v: Value | undefined, format: FormatName, cents = true): { text: string; incompatible: boolean } {
  if (v === undefined || v === null) return { text: EMPTY_CELL, incompatible: false };
  if (format === "text") {
    if (typeof v === "string") return { text: v, incompatible: false };
    if (typeof v === "number") return { text: formatNumber(v, "number"), incompatible: false };
    if (typeof v === "boolean") return { text: v ? "Yes" : "No", incompatible: false };
    return { text: EMPTY_CELL, incompatible: true };
  }
  if (format === "date") {
    const t = typeof v === "string" ? dateText(v) : null;
    return t ? { text: t, incompatible: false } : { text: EMPTY_CELL, incompatible: true };
  }
  // A number column never reads text like "12" as a number.
  if (typeof v === "number") return { text: formatNumber(v, format, cents), incompatible: false };
  return { text: EMPTY_CELL, incompatible: true };
}
