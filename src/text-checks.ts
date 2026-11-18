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

/** is(text, kind): whether the whole text (spaces around it aside) is one of these. */
export const TEXT_IS: ReadonlyMap<string, (t: string) => boolean> = new Map<string, (t: string) => boolean>([
  ["email", (t) => EMAIL.test(t)],
  // http or https, a host with a dot in it, then an optional port and path.
  ["url", (t) => URL_FORM.test(t)],
  // 7 to 15 digits (the most any number has), with spaces, dashes, dots, brackets and a leading + allowed.
  ["phone", (t) => PHONE_FORM.test(t) && (t.match(/\p{Nd}/gu)?.length ?? 0) >= 7 && (t.match(/\p{Nd}/gu)?.length ?? 0) <= 15],
  // A US ZIP code: 12345 or 12345-6789.
  ["zip", (t) => ZIP_FORM.test(t)],
  // The rule input kind=number writes a number by.
  ["number", (t) => isFinite(Number(t))],
  // A real calendar date written YYYY-MM-DD, the form date pickers write.
  ["date", (t) => parseDate(t) !== null],
]);
