/**
 * Named checks on text, for has() and is() in expressions and for input kind=email. Specs pick a
 * check by name and never write a pattern: every regular expression here is fixed, reviewed code,
 * so a spec can't make one that runs for ever or matches something it shouldn't.
 */
import { parseDate } from "./dates";

/** An email address: something@something.something, with no spaces. input kind=email uses the same rule. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** has(text, kind): whether the text has at least one such character, in any script. */
export const TEXT_HAS: ReadonlyMap<string, RegExp> = new Map([
  ["digit", /\p{Nd}/u],
  ["upper", /[\p{Lu}\p{Lt}]/u],
  ["lower", /\p{Ll}/u],
  ["symbol", /[\p{P}\p{S}]/u],
  ["space", /\s/u],
]);

const URL_FORM = /^https?:\/\/[^\s/?#.:@]+(\.[^\s/?#.:@]+)+(:\d{1,5})?([/?#]\S*)?$/iu;
const PHONE_FORM = /^\+?[\p{Nd}\s().-]+$/u;
const ZIP_FORM = /^\d{5}(-\d{4})?$/;

/**
 * Postal codes by country (ISO 3166 two-letter code), for is(v, 'postcode', 'GB'). Each is the
 * country's written form, spaces and dashes where people usually put them optional.
 */
export const POSTCODES: Readonly<Record<string, RegExp>> = Object.freeze({
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/,
  IE: /^[A-Za-z]\d[\dWw] ?[A-Za-z\d]{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  NL: /^\d{4} ?[A-Za-z]{2}$/,
  IN: /^[1-9]\d{2} ?\d{3}$/,
  AU: /^\d{4}$/,
  JP: /^\d{3}-?\d{4}$/,
  CN: /^\d{6}$/,
  SG: /^\d{6}$/,
  BR: /^\d{5}-?\d{3}$/,
  MX: /^\d{5}$/,
});

/** Whether text is a postal code of this country (a two-letter code POSTCODES has), or of any of them. */
export function isPostcode(text: string, country?: string): boolean {
  if (country === undefined) return TEXT_IS.get("postcode")!(text);
  const re = POSTCODES[country.toUpperCase()];
  return !!re && re.test(text);
}

const GROUPED_DOT = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const GROUPED_COMMA = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/;
const DECIMAL_COMMA = /^[+-]?\d+,\d+$/;

/**
 * A number as people type it, or null: what Number() reads (12.5, -3, 1e3), grouped with commas
 * (1,234.5), with a decimal comma (12,5), or grouped with dots and a decimal comma (1.234,5).
 * One comma before exactly three digits (1,234) is a thousands separator, as in English.
 */
export function numberFromText(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  if (isFinite(Number(t))) return Number(t);
  if (GROUPED_DOT.test(t)) return Number(t.replace(/,/g, ""));
  if (GROUPED_COMMA.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (DECIMAL_COMMA.test(t)) return Number(t.replace(",", "."));
  return null;
}

/** is(text, kind): whether the whole text (spaces around it aside) is one of these. */
export const TEXT_IS: ReadonlyMap<string, (t: string) => boolean> = new Map<string, (t: string) => boolean>([
  // An address is at most 254 characters, and the cap keeps the pattern fast on any text from the host.
  ["email", (t) => t.length <= 254 && EMAIL.test(t)],
  // http or https, a host with a dot in it, then an optional port and path.
  ["url", (t) => URL_FORM.test(t)],
  // 7 to 15 digits (the most any number has), with spaces, dashes, dots, brackets and a leading + allowed.
  ["phone", (t) => PHONE_FORM.test(t) && (t.match(/\p{Nd}/gu)?.length ?? 0) >= 7 && (t.match(/\p{Nd}/gu)?.length ?? 0) <= 15],
  // A US ZIP code: 12345 or 12345-6789. 'zip' is the same check, kept for specs written before us-zip.
  ["us-zip", (t) => ZIP_FORM.test(t)],
  ["zip", (t) => ZIP_FORM.test(t)],
  // A postal code in any of the countries in POSTCODES; is(v, 'postcode', 'GB') checks one.
  ["postcode", (t) => Object.values(POSTCODES).some((re) => re.test(t))],
  // The rule input kind=number writes a number by: 12.5, 1,234.5, 12,5 or 1.234,5.
  ["number", (t) => numberFromText(t) !== null],
  // A real calendar date written YYYY-MM-DD, the form date pickers write.
  ["date", (t) => parseDate(t) !== null],
]);
