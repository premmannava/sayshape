/**
 * Reading values that arrive as text, for num() and date() in expressions and
 * for totals and charts. Data from an app often holds "$36,626", "USD 8309",
 * "45%" or "9 Jan 2026"; these read them without ever guessing: a decimal
 * comma ("12,5") is read only when asked, and a slash date whose first two
 * parts could both be the month ("03/04/2026") only with the order given.
 * Pure functions of strings: nothing here reaches anything but its argument.
 */
import { daysInMonth, MONTHS } from "./dates";

/** A currency mark (euro, pound, yen, rupee, won, ruble, cent; written as escapes so the packed engine stays ASCII) or code, before or after the number. */
const CURRENCY = String.raw`(?:[$\u20AC\u00A3\u00A5\u20B9\u20A9\u20BD\u00A2]|[A-Z]{3}\b|[A-Z]{1,2}\$)`;
/** Digits with a point for decimals and commas between thousands, or plain digits. */
const DOT_NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+`;
/** Digits with a comma for decimals and points or spaces between thousands (num(v, 'comma')). */
const COMMA_NUMBER = String.raw`(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:,\d+)?|,\d+`;
/** A unit after the number: 76 min, 53.2 km, 12 kg/m\u00B2. One word, no digits. */
const UNIT = String.raw`[A-Za-z\u00B5\u00B0][A-Za-z\u00B5\u00B0/\u00B2\u00B3]*\.?`;

function numberPattern(digits: string): RegExp {
  // sign, currency before, the number, then a percent sign, a currency code or a unit.
  return new RegExp(String.raw`^([-+])?\s*(?:${CURRENCY}\s*)?([-+])?\s*(${digits})\s*(%|${CURRENCY}|${UNIT})?$`);
}
const DOT = numberPattern(DOT_NUMBER);
const COMMA = numberPattern(COMMA_NUMBER);

/**
 * The number written in a text, or null. Accounting brackets mean minus:
 * "(1,200)" is -1200. "45%" is 45, the number as written.
 */
export function readNumber(text: string, decimalComma = false): number | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  const bracket = /^\((.*)\)$/.exec(s);
  if (bracket) { negative = true; s = bracket[1]!.trim(); }
  const m = (decimalComma ? COMMA : DOT).exec(s);
  if (!m) return null;
  const signs = [m[1], m[2]].filter(Boolean);
  if (signs.length > 1 || (negative && signs.length)) return null;
  const digits = decimalComma ? m[3]!.replace(/[. ]/g, "").replace(",", ".") : m[3]!.replace(/,/g, "");
  const n = Number(digits);
  if (!isFinite(n)) return null;
  return negative || signs[0] === "-" ? -n : n;
}

export type DateOrder = "mdy" | "dmy";

export interface ReadDate {
  /** YYYY-MM-DD, or null when the text isn't a date (or can't be read without an order). */
  iso: string | null;
  /** Set when a slash date could be read two ways and no order was given. */
  ambiguous?: true;
}

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

/** A month's number from its name or a short form of it (Jan, Sept, January), or 0. */
function monthNumber(name: string): number {
  const n = name.toLowerCase().replace(/\.$/, "");
  if (n.length < 3) return 0;
  const i = MONTHS.findIndex((m) => m.toLowerCase().startsWith(n));
  return i + 1;
}

/**
 * A date written in a text, as YYYY-MM-DD: 2026-08-11, 2026/8/11, 9 Jan 2026,
 * Jan 9, 2026, and a day/month or month/day date (01/14/2026) when only one
 * reading is possible or the order is given.
 */
export function readDate(text: string, order?: DateOrder): ReadDate {
  const s = text.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) return { iso: iso(+m[1]!, +m[2]!, +m[3]!) };
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]+\.?)[\s,-]+(\d{4})$/.exec(s);
  if (m) { const mo = monthNumber(m[2]!); return { iso: mo ? iso(+m[3]!, mo, +m[1]!) : null }; }
  m = /^([A-Za-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) { const mo = monthNumber(m[1]!); return { iso: mo ? iso(+m[3]!, mo, +m[2]!) : null }; }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    if (order) return { iso: order === "mdy" ? iso(y, a, b) : iso(y, b, a) };
    if (a > 12 && b <= 12) return { iso: iso(y, b, a) };
    if (b > 12 && a <= 12) return { iso: iso(y, a, b) };
    // Both readings are the same date (05/05/2026): nothing to guess.
    if (a === b) return { iso: iso(y, a, b) };
    if (a <= 12 && b <= 12) return { iso: null, ambiguous: true };
    return { iso: null };
  }
  return { iso: null };
}

/** Text with its spaces tidied and every word capitalized, so "liberty  mutual" and "Liberty Mutual" are the same name. */
export function tidyText(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("en-US") + w.slice(1).toLocaleLowerCase("en-US")).join(" ");
}
