/**
 * A small, safe expression language for `{...}` in specs.
 *
 * Supports numbers, strings ('single' or "double"), true/false/null, state
 * identifiers, + - * / %, comparisons, && || !, the ternary `a ? b : c`,
 * parentheses, a few whitelisted functions, list and record literals
 * (`[1, 2]`, `{name: "Ada"}`), and reading fields and items (`t.text`,
 * `cart[0]`, `todos.length`). Fields are read only through readField in
 * data.ts, which reaches a record's own fields and a list's items and
 * nothing else. There is no assignment and no way to reach JavaScript
 * objects or globals, so model-written expressions cannot run code.
 */
import { displayData, fieldOf, isData, isList, isRecord, isScalar, makeList, makeRecord, MAX_DATA_DEPTH, MAX_DATA_VALUES, readField, toNumber } from "./data";
import { TEXT_HAS, TEXT_IS } from "./text-checks";
import type { DataList, DataRecord, Value } from "./types";

type Node =
  | { k: "lit"; v: Value }
  | { k: "id"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[]; extra?: Fn }
  /**
   * extend(list, 'q', {field: expr}) and map(list, 'q', expr): the body is worked out once per item,
   * with the item named q. extend's body is always a record literal, whose fields are added to the item.
   */
  | { k: "per"; fn: "extend" | "map"; list: Node; as: string; body: Node }
  | { k: "list"; items: Node[] }
  | { k: "rec"; entries: Array<[string, Node]> }
  | { k: "get"; obj: Node; key: Node };

type Tok = { t: "num" | "str" | "id" | "op" | "end"; v: string; pos: number };

export class ExprError extends Error {}

export type Fn = (...a: Value[]) => Value;

/**
 * Functions an element makes available to the expressions on the lines inside
 * it, on top of the built-in ones (a scene's sin, cos and random). Pure
 * functions of their arguments, written in reviewed TypeScript like a component;
 * a spec can only call them, never add one. Make sets with expressionFunctions(),
 * which gives them no prototype, so names like constructor can't reach Object.
 * Built-in names always win: an extra set can't replace one, except those in REPLACEABLE.
 */
export type ExpressionFunctions = Readonly<Record<string, Fn>>;

/** A frozen, prototype-free set of extra functions (see ExpressionFunctions). */
export function expressionFunctions(fns: Record<string, Fn>): ExpressionFunctions {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, Fn>, fns));
}

const extraOf = (fns: ExpressionFunctions | undefined, name: string): Fn | undefined =>
  fns && (!Object.hasOwn(FUNCTIONS, name) || REPLACEABLE.includes(name)) && Object.hasOwn(fns, name) ? fns[name] : undefined;

/** min(3, 5) or min(list): a single list argument stands for its items. */
const spread = (a: Value[]): Value[] => (a.length === 1 && isList(a[0]) ? [...a[0]] : a);

/** Only numbers count in sums: text ("12"), true/false, null or a missing field is NaN. */
const amount = (v: Value | undefined): number => (typeof v === "number" ? v : NaN);

/**
 * sum/avg/min/max over a list: the items, one field of each, or two fields
 * multiplied (price × qty). A value that isn't a number makes the result NaN
 * (shown as —) rather than being read as one: "12" is never 12, and nothing
 * is joined as text. An empty list sums to 0.
 */
function amounts(v: Value, a?: Value, b?: Value): number[] | null {
  if (!isList(v)) return null;
  return v.map((item) => {
    if (a === undefined) return amount(item);
    const x = amount(fieldOf(item, a));
    return b === undefined ? x : x * amount(fieldOf(item, b));
  });
}

/** The items whose field equals a value, or (with no value) whose field is true or not empty. */
function matches(item: Value, field: Value | undefined, value: Value | undefined): boolean {
  if (field === undefined) return !!item;
  const v = fieldOf(item, field);
  if (value === undefined) return !!v;
  // A list of values, like a multi-select's: the field is any one of them (none for an empty list).
  if (isList(value)) return v !== undefined && value.some((x) => x === v);
  // A range, like a date picker's {from, to}: from the start to the end, both included; an empty end is open.
  if (isRecord(value) && (fieldOf(value, "from") !== undefined || fieldOf(value, "to") !== undefined)) return within(v, fieldOf(value, "from"), fieldOf(value, "to"));
  return v === value;
}

/** Whether a value is between two ends of the same kind (text, like YYYY-MM-DD dates, or numbers); a missing or "" end is open. */
function within(v: Value | undefined, from: Value | undefined, to: Value | undefined): boolean {
  const open = (x: Value | undefined) => x === undefined || x === null || x === "";
  if (open(from) && open(to)) return true;
  const comparable = (x: Value | undefined): x is string | number => (typeof x === "string" || (typeof x === "number" && !isNaN(x)));
  if (!comparable(v)) return false;
  const ok = (end: Value | undefined, after: boolean) =>
    open(end) || (comparable(end) && typeof end === typeof v && (after ? v >= end : v <= end));
  return ok(from, true) && ok(to, false);
}

/** Order for sort(): numbers by size, text alphabetically, missing values last. */
function order(a: Value | undefined, b: Value | undefined): number {
  const missing = (v: Value | undefined) => v === undefined || v === null || (typeof v === "number" && isNaN(v));
  if (missing(a) || missing(b)) return missing(a) ? (missing(b) ? 0 : 1) : -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return toNumber(a!) - toNumber(b!);
}

/** Formatting follows US English for now; a locale option can come with the theme. */
const LOCALE = "en-US";

/**
 * A number for the formatting functions. Data often holds amounts already
 * written for people ("$1,250.00", "1,250"), and money() on those should
 * still work rather than show a dash, so a currency sign and thousands
 * commas are allowed. Anything else goes through toNumber as usual.
 */
const FORMATTED_AMOUNT = /^(-?)[$€£¥]?(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;
function amountOf(v: Value | undefined): number {
  if (typeof v !== "string") return toNumber(v);
  const m = FORMATTED_AMOUNT.exec(v.trim());
  if (!m) return toNumber(v);
  const sign = m[1] || m[2] ? -1 : 1;
  return sign * Number(m[3]!.replace(/,/g, "") + (m[4] ?? ""));
}

/** Text for a value in lower/upper/trim: text as is, numbers as shown, nothing for null. */
const textOf = (v: Value | undefined): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : formatValue(v));

/**
 * The smallest or largest number, with a loop rather than Math.min(...xs):
 * spreading a list of host data with hundreds of thousands of items into
 * arguments overflows the call stack. Like Math.min, any NaN makes it NaN,
 * and no numbers at all give Infinity (min) or -Infinity (max).
 */
function pickOf(xs: readonly number[], largest: boolean): number {
  let best = largest ? -Infinity : Infinity;
  for (const x of xs) {
    if (isNaN(x)) return NaN;
    if (largest ? x > best : x < best) best = x;
  }
  return best;
}

/** min(3, 5), min(list) or min(list, 'field'). */
function extreme(largest: boolean, a: Value[]): number {
  if (isList(a[0]) && typeof a[1] === "string") return pickOf(amounts(a[0], a[1]) ?? [], largest);
  return pickOf(spread(a).map(toNumber), largest);
}

const GROUP_RESULTS = ["sum", "avg", "min", "max"] as const;
type GroupResult = (typeof GROUP_RESULTS)[number];

/** One number from a group's values: sum, avg, min or max, by the same rules as those functions. */
function combine(xs: readonly number[], how: GroupResult): number {
  if (how === "min" || how === "max") return pickOf(xs, how === "max");
  const total = xs.reduce((t, x) => t + x, 0);
  return how === "sum" ? total : xs.length ? total / xs.length : NaN;
}

/**
 * group(sales, 'region'): one record per region, in the order each first
 * appears, with how many items it has: [{region: "West", count: 12}, …].
 * group(sales, 'region', 'revenue') also totals that field per group, under
 * the field's own name, and a fourth argument works out 'avg', 'min' or 'max'
 * instead of the 'sum'. Totals follow sum()'s rules: only numbers count.
 *
 * Items group by the field's value as it is ("US" and "USA" are two groups);
 * items without the field, or with a list or record in it, share a null group.
 * The groups are new records worked out from the list, so they can be shown,
 * sorted and charted, but not written back to.
 */
function group(v: Value, by: Value | undefined, field: Value | undefined, how: Value | undefined): Value {
  if (!isList(v) || typeof by !== "string") return NaN;
  if (field !== undefined && typeof field !== "string") return NaN;
  if (field === by) throw new ExprError(`group() can't total the field it groups by ("${by}"); total another field, like group(list, '${by}', 'amount')`);
  if (field === "count") throw new ExprError(`group() already counts each group as count; total another field, or use group(list, '${by}') for the counts`);
  const result = how ?? "sum";
  if (!GROUP_RESULTS.includes(result as GroupResult)) {
    throw new ExprError(`group() works out 'sum', 'avg', 'min' or 'max' of a field, not ${typeof result === "string" ? `'${result}'` : String(result)}`);
  }
  const groups = new Map<Value, number[]>();
  for (const item of v) {
    const raw = fieldOf(item, by);
    const key = raw === undefined || !isScalar(raw) ? null : raw;
    let values = groups.get(key);
    if (!values) groups.set(key, (values = []));
    values.push(field === undefined ? 0 : amount(fieldOf(item, field)));
  }
  return makeList([...groups].map(([key, values]) => {
    const entries: Array<[string, Value]> = [[by, key], ["count", values.length]];
    if (field !== undefined) entries.push([field, combine(values, result as GroupResult)]);
    return makeRecord(entries);
  }));
}

/** What a value is, for messages: "a number", "text", "a list". */
function describeValue(v: Value | undefined): string {
  return v === null || v === undefined ? "null" : typeof v === "number" ? "a number" : typeof v === "string" ? "text" : typeof v === "boolean" ? "true/false" : isList(v) ? "a list" : "a record";
}

/** A copy of a record with fields added: ones it has already are replaced where they are, new ones come last. */
function withFields(item: DataRecord, fields: ReadonlyArray<readonly [string, Value]>): DataRecord {
  const merged = new Map<string, Value>(Object.entries(item));
  for (const [k, x] of fields) merged.set(k, x);
  return makeRecord([...merged]);
}

/**
 * rank(list, 'score', 'desc'): the list as it is, each record with a rank field: 1 for the best,
 * and items that tie share a rank (1, 1, 3). 'asc' (the default, as in sort()) makes the smallest 1.
 * Only numbers rank; an item whose field isn't one gets null. Sorting is still sort()'s job.
 */
function rank(v: Value, field: Value | undefined, dir: Value | undefined): Value {
  if (!isList(v) || typeof field !== "string") return NaN;
  if (dir !== undefined && dir !== "asc" && dir !== "desc") throw new ExprError(`rank() orders 'asc' or 'desc', not ${typeof dir === "string" ? `'${dir}'` : String(dir)}`);
  const x: Array<number | null> = v.map((item, i) => {
    if (!isRecord(item)) throw new ExprError(`rank(): item ${i} is ${describeValue(item)}, not a record`);
    const n = fieldOf(item, field);
    return typeof n === "number" && !isNaN(n) ? n : null;
  });
  const sign = dir === "desc" ? -1 : 1;
  const at = x.flatMap((n, i) => (n === null ? [] : [i])).sort((a, b) => sign * (x[a]! - x[b]!));
  const ranks = new Array<number | null>(v.length).fill(null);
  at.forEach((i, pos) => { ranks[i] = pos > 0 && x[i] === x[at[pos - 1]!] ? ranks[at[pos - 1]!]! : pos + 1; });
  return makeList(v.map((item, i) => withFields(item as DataRecord, [["rank", ranks[i]!]])));
}

/**
 * The most items range() makes, or map() works through, in one list: a formula can't ask for millions.
 * A whole expression makes at most MAX_DATA_VALUES items with them, so nesting can't multiply it.
 */
export const MAX_MADE_ITEMS = 2_000;

/** Items range() and map() have made in the expression being worked out (evaluate() starts it at 0). */
let made = 0;
function make(n: number, fn: string): void {
  made += n;
  if (made > MAX_DATA_VALUES) throw new ExprError(`${fn}() would make more than ${MAX_DATA_VALUES.toLocaleString("en-US")} items in one expression; work out fewer, or take() part of the list first`);
}

/** from, from + 1, … : count whole numbers, for range() here and in scenes. */
export function counting(from: number, count: number): DataList {
  return makeList(Array.from({ length: Math.max(0, count) }, (_, i) => from + i));
}

/**
 * range(5) is [0, 1, 2, 3, 4] and range(1, 4) is [1, 2, 3]: from the start up to, not including,
 * the end, like slice(). Whole numbers only; an end before the start gives an empty list.
 */
function range(a: Value | undefined, b: Value | undefined): Value {
  const whole = (v: Value | undefined): number => {
    if (typeof v !== "number" || !isFinite(v)) throw new ExprError(`range() counts with numbers, not ${describeValue(v)}: range(5) is 0 to 4, range(1, years + 1) is 1 to years`);
    return Math.floor(v);
  };
  if (a === undefined) throw new ExprError("range() needs a count, like range(5) for 0 to 4, or a start and end, like range(1, years + 1)");
  const [from, to] = b === undefined ? [0, whole(a)] : [whole(a), whole(b)];
  const count = Math.max(0, to - from);
  if (count > MAX_MADE_ITEMS) throw new ExprError(`range() makes at most ${MAX_MADE_ITEMS.toLocaleString("en-US")} items, not ${count.toLocaleString("en-US")}`);
  make(count, "range");
  return counting(from, count);
}

/** Text for the text checks: text as it is, a number as written, and null for anything else (null, true/false, lists, records). */
const checkedText = (v: Value | undefined): string | null => (typeof v === "string" ? v : typeof v === "number" && isFinite(v) ? String(v) : null);

/** The check a name picks for has() or is(); any other name is an error listing them, even for empty text. */
function namedCheck<T>(fn: string, checks: ReadonlyMap<string, T>, kind: Value | undefined): T {
  const found = typeof kind === "string" ? checks.get(kind) : undefined;
  if (found === undefined) throw new ExprError(`${fn}() checks ${[...checks.keys()].map((k) => `'${k}'`).join(", ")}, not ${typeof kind === "string" ? `'${kind}'` : describeValue(kind)}`);
  return found;
}

/**
 * contains, starts and ends: whether text has another text in it, at its start or at its end,
 * ignoring case unless the third argument is 'case'. Empty or null text is false, never an error.
 */
function textMatch(fn: "contains" | "starts" | "ends", text: Value | undefined, part: Value | undefined, mode: Value | undefined): boolean {
  if (mode !== undefined && mode !== "case") throw new ExprError(`${fn}() ignores case, or with 'case' as its third argument matches it; nothing else goes there`);
  if (isList(text) || isRecord(text)) throw new ExprError(`${fn}() checks text, not ${describeValue(text)}${fn === "contains" ? ": for a list use includes(list, value)" : ""}`);
  const t = checkedText(text), p = checkedText(part);
  if (!t || p === null) return false;
  const [a, b] = mode === "case" ? [t, p] : [t.toLowerCase(), p.toLowerCase()];
  return fn === "contains" ? a.includes(b) : fn === "starts" ? a.startsWith(b) : a.endsWith(b);
}

const BUILTINS: Record<string, Fn> = {
  min: (...a) => extreme(false, a),
  max: (...a) => extreme(true, a),
  /** Items in a list, or characters in text. */
  len: (v) => (isList(v) || typeof v === "string" ? v.length : NaN),
  /** Items that are true, whose field is true (or not empty), or whose field equals a value. */
  count: (v, field, value) => (isList(v) ? v.filter((item) => matches(item, field, value)).length : NaN),
  /** The items count() would count, as a list: filter(tx, 'cat', 'Gas'). */
  filter: (v, field, value) => (isList(v) ? makeList(v.filter((item) => matches(item, field, value))) : NaN),
  /** The first item whose field equals a value, or null: find(rooms, 'id', room). */
  find: (v, field, value) => (isList(v) ? v.find((item) => matches(item, field, value)) ?? null : NaN),
  /** Items whose field contains some text, ignoring case; empty text matches everything. */
  search: (v, field, text) => {
    if (!isList(v)) return NaN;
    const q = textOf(text).trim().toLowerCase();
    return makeList(q ? v.filter((item) => textOf(fieldOf(item, field)).toLowerCase().includes(q)) : [...v]);
  },
  /** sort(list), sort(list, 'price') or sort(list, 'price', 'desc'), and sort(list, 'desc') for plain values. */
  sort: (v, a, b) => {
    if (!isList(v)) return NaN;
    const plainDesc = a === "desc" || a === "asc";
    const field = plainDesc ? undefined : a;
    const desc = (plainDesc ? a : b) === "desc";
    const key = (item: Value) => (field === undefined ? item : fieldOf(item, field));
    return makeList([...v].sort((x, y) => (desc ? -1 : 1) * order(key(x), key(y))));
  },
  /** The list with a rank field on each item (1 is best, ties share a rank): rank(players, 'score', 'desc'). */
  rank: (v, field, dir) => rank(v, field, dir),
  /** The first item of a list, or null when it's empty: first(sort(sales, 'revenue', 'desc')).month. */
  first: (v) => (isList(v) ? v[0] ?? null : NaN),
  /** The last item of a list, or null when it's empty. */
  last: (v) => (isList(v) ? v[v.length - 1] ?? null : NaN),
  /** One field of every item, as a list (null where it's missing): pluck(sales, 'revenue') for a stat's spark=. */
  pluck: (v, field) => (isList(v) ? makeList(v.map((item) => fieldOf(item, field) ?? null)) : NaN),
  /** The first n items: take(sort(players, 'score', 'desc'), 3). */
  take: (v, n) => (isList(v) ? makeList(v.slice(0, Math.max(0, Math.floor(toNumber(n ?? 0)) || 0))) : NaN),
  /**
   * Items from start up to, not including, end, counting from 0: one page is
   * slice(rows, (page - 1) * 10, page * 10). Text too: slice(name, 0, 1).
   */
  slice: (v, start, end) => {
    if (!isList(v) && typeof v !== "string") return NaN;
    const at = (x: Value | undefined, d: number) => { const n = Math.floor(toNumber(x ?? d)); return isFinite(n) ? n : d; };
    const from = at(start, 0), to = end === undefined ? v.length : at(end, v.length);
    return typeof v === "string" ? v.slice(from, to) : makeList(v.slice(from, to));
  },
  sum: (v, a, b) => amounts(v, a, b)?.reduce((t, x) => t + x, 0) ?? NaN,
  avg: (v, a, b) => {
    const xs = amounts(v, a, b);
    return xs && xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN;
  },
  /** Totals per category: group(sales, 'region', 'revenue') is one {region, count, revenue} record per region. */
  group: (v, by, field, how) => group(v, by, field, how),
  /** join(tags) or join(tags, " / "), and for records join(cart, "name") or join(cart, "name", " / "). */
  join: (v, a, b) => {
    if (!isList(v)) return NaN;
    const ofRecords = v.some((item) => typeof item === "object" && item !== null && !isList(item));
    const parts = ofRecords ? v.map((item) => fieldOf(item, a)) : v;
    const sep = ofRecords ? b : a;
    return parts.map((x) => formatValue(x)).join(typeof sep === "string" ? sep : ", ");
  },
  /** range(5) is [0, 1, 2, 3, 4], range(1, 4) is [1, 2, 3]: the end is left out, like slice(). */
  range: (a, b) => range(a, b),
  /** has(pw, 'digit'): whether text has a digit, an upper or lower case letter, a symbol or a space, in any script. */
  has: (t, kind) => { const re = namedCheck("has", TEXT_HAS, kind); const s = checkedText(t); return !!s && re.test(s); },
  /** is(email, 'email'): whether the text is an email, url, phone, zip, number or date (YYYY-MM-DD). */
  is: (t, kind) => { const ok = namedCheck("is", TEXT_IS, kind); const s = checkedText(t)?.trim(); return !!s && ok(s); },
  /** contains(name, query): text in other text, ignoring case; contains(code, 'A', 'case') matches case. */
  contains: (t, part, mode) => textMatch("contains", t, part, mode),
  /** starts(name, 'Dr'): whether text starts with other text, ignoring case unless the third argument is 'case'. */
  starts: (t, part, mode) => textMatch("starts", t, part, mode),
  /** ends(file, '.pdf'): whether text ends with other text, ignoring case unless the third argument is 'case'. */
  ends: (t, part, mode) => textMatch("ends", t, part, mode),
  /** Whether a list holds a value, or text contains other text (matching case: contains() ignores it). */
  includes: (v, x) => (isList(v) ? v.some((item) => item === x) : typeof v === "string" && x !== undefined && x !== null ? v.includes(formatValue(x)) : false),
  round: (n, d = 0) => {
    const f = 10 ** toNumber(d);
    return Math.round(toNumber(n) * f) / f;
  },
  floor: (n) => Math.floor(toNumber(n)),
  ceil: (n) => Math.ceil(toNumber(n)),
  abs: (n) => Math.abs(toNumber(n)),
  /**
   * pow(2, 10) is 1024: a number raised to a power, for compound growth and
   * loan payments, like pow(1 + rate / 12, years * 12). A result too large to
   * show, or with no real answer (pow(-8, 0.5)), is nothing (—), not Infinity.
   */
  pow: (base, exp) => {
    const x = Math.pow(toNumber(base), toNumber(exp));
    return isFinite(x) ? x : NaN;
  },
  fixed: (n, d = 2) => toNumber(n).toFixed(toNumber(d)),
  /** money(2400) is $2,400.00, money(-84.1) is -$84.10; money(n, 'EUR') for another currency. */
  money: (n, currency = "USD") => {
    const x = amountOf(n);
    if (!isFinite(x)) return NaN;
    try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: textOf(currency) }).format(x); } catch { return NaN; }
  },
  /** number(37000) is 37,000; number(n, 2) always shows two decimals. */
  number: (n, d) => {
    const x = amountOf(n);
    if (!isFinite(x)) return NaN;
    const digits = d === undefined ? undefined : Math.min(10, Math.max(0, Math.floor(toNumber(d)) || 0));
    return new Intl.NumberFormat(LOCALE, digits === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
  },
  /**
   * compact(12345678) is 12.3M, compact(4500) is 4.5K, compact(1240000) is 1.24M; compact(n, 'USD') is $12.3M.
   * For big figures in small spaces. Keeps 3 significant digits or 1 decimal, whichever says more,
   * so a figure someone gave as $1.24M doesn't come back as $1.2M.
   */
  compact: (n, currency) => {
    const x = amountOf(n);
    if (!isFinite(x)) return NaN;
    // Both roundings, keeping the one that shows more digits. Intl's roundingPriority does the same,
    // but Node 18 and older browsers ignore it.
    const cur: Intl.NumberFormatOptions = currency === undefined ? {} : { style: "currency", currency: textOf(currency), minimumFractionDigits: 0 };
    try {
      const sig = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumSignificantDigits: 3, ...cur }).format(x);
      const dec = new Intl.NumberFormat(LOCALE, { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1, ...cur }).format(x);
      const digits = (t: string) => t.replace(/\D/g, "").length;
      return digits(dec) > digits(sig) ? dec : sig;
    } catch { return NaN; }
  },
  /** plural(1, 'item') is "1 item", plural(3, 'item') is "3 items"; plural(n, 'child', 'children') for irregular words. */
  plural: (n, one, many) => {
    const x = toNumber(n);
    const word = textOf(one);
    return `${isFinite(x) ? new Intl.NumberFormat(LOCALE).format(x) : "—"} ${x === 1 ? word : many === undefined ? word + "s" : textOf(many)}`;
  },
  lower: (t) => textOf(t).toLowerCase(),
  upper: (t) => textOf(t).toUpperCase(),
  trim: (t) => textOf(t).trim(),
};

// A frozen copy with no prototype, looked up by own property only, so names
// like `constructor` or `__defineGetter__` can't reach Object.prototype.
const FUNCTIONS: Readonly<Record<string, Fn>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Fn>, BUILTINS));
/** Functions with their own syntax, parsed in parseExpr instead of called: extend(list, 'q', {…}), map(list, 'q', …). */
const SPECIAL = ["extend", "map"];
/**
 * Built-in names an element's own functions may still replace (see ExpressionFunctions): a scene's
 * range() keeps its own rule (500 items at most, never an error), which its drawings rely on.
 */
const REPLACEABLE = ["range"];
const isFunctionName = (name: string) => Object.hasOwn(FUNCTIONS, name) || SPECIAL.includes(name);

/**
 * The most arguments each function takes. Extra ones used to be ignored, which hid the mistake:
 * filter(l, 'cat', ['Housing'], false) kept only Housing. min and max take any number; round,
 * fixed and money have a default for their last one, which Function.length doesn't count.
 */
const MAX_ARGS: Readonly<Record<string, number>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, number>,
  Object.fromEntries(Object.entries(BUILTINS).map(([k, f]) => [k, f.length])),
  { min: Infinity, max: Infinity, round: 2, fixed: 2, money: 2, extend: 3, map: 3 },
));

/** How to call the functions models most often give too many arguments. */
const SIGNATURES: Record<string, string> = {
  take: "take(list, n) keeps the first n; for a page or an offset use slice(list, start, end)",
  filter: "filter(list, 'field', value) keeps the items whose field is value (or any value in a list of them, or within {from, to}: numbers or YYYY-MM-DD dates, either end left open)",
  find: "find(list, 'field', value)", search: "search(list, 'field', text)", sort: "sort(list, 'field', 'desc')",
  count: "count(list, 'field', value)", sum: "sum(list, 'field', 'qty')", avg: "avg(list, 'field')",
  group: "group(list, 'field', 'amount', 'avg')", first: "first(list)", last: "last(list)", pluck: "pluck(list, 'field')",
  rank: "rank(list, 'field', 'desc') adds a rank field to each item (1 is best, ties share a rank)",
  extend: "extend(list, 'q', {field: q.a * 2}) adds computed fields to each item, which is q inside the braces",
  map: "map(list, 'q', q.a * 2) makes one value per item, which is q in the third argument",
  range: "range(n) for 0 to n - 1, or range(from, to) with to left out",
  has: "has(text, 'digit'), or 'upper', 'lower', 'symbol' or 'space'", is: "is(text, 'email'), or 'url', 'phone', 'zip', 'number' or 'date'",
  contains: "contains(text, part), or contains(text, part, 'case') to match case", starts: "starts(text, part[, 'case'])", ends: "ends(text, part[, 'case'])",
};

function tooManyArgs(name: string, got: number): string {
  const most = MAX_ARGS[name]!;
  return `${name}() takes at most ${most} argument${most === 1 ? "" : "s"}, not ${got}.${SIGNATURES[name] ? ` Write ${SIGNATURES[name]}` : ""}`;
}

/** A JavaScript-style method call, like rows.slice(0, 5): what to write instead. */
function noMethods(name: string): string {
  const key = name.toLowerCase();
  if (isFunctionName(name)) return `SayShape has no methods like .${name}(): pass the list or text first, as ${name}(list, …)`;
  const hint = Object.hasOwn(FUNCTION_HINTS, key) ? FUNCTION_HINTS[key] : undefined;
  return `SayShape has no methods like .${name}(): ${hint ? `use ${hint}` : `use its functions, such as ${["filter", "sort", "take", "slice", "pluck", "sum"].join(", ")}`}`;
}
export const EXPRESSION_FUNCTIONS = [...Object.keys(FUNCTIONS), ...SPECIAL];

/** Names models reach for from other languages, and what to write instead. */
const FUNCTION_HINTS: Record<string, string> = {
  length: "len(list)", size: "len(list)", length_of: "len(list)",
  head: "first(list)", tail: "last(list)", top: "take(list, n)", limit: "take(list, n)", skip: "slice(list, start)", offset: "slice(list, start, end)",
  argmax: "first(sort(list, 'field', 'desc'))", argmin: "first(sort(list, 'field'))",
  maxby: "first(sort(list, 'field', 'desc'))", minby: "first(sort(list, 'field'))",
  max_by: "first(sort(list, 'field', 'desc'))", min_by: "first(sort(list, 'field'))",
  mean: "avg(list, 'field')", average: "avg(list, 'field')", total: "sum(list, 'field')",
  where: "filter(list, 'field', value)", startswith: "starts(text, part)", starts_with: "starts(text, part)", endswith: "ends(text, part)", ends_with: "ends(text, part)",
  match: "has(text, 'digit') or is(text, 'email'): SayShape has named checks, not patterns", regex: "has(text, 'digit') or is(text, 'email'): SayShape has named checks, not patterns", test: "has(text, 'digit') or is(text, 'email'): SayShape has named checks, not patterns",
  groupby: "group(list, 'field', 'amount')", group_by: "group(list, 'field', 'amount')", aggregate: "group(list, 'field', 'amount')", pivot: "group(list, 'field', 'amount')",
  format: "number(n) or money(n)", currency: "money(n)", tofixed: "fixed(n, 2)", str: "text in quotes: \"{n} items\"", string: "text in quotes: \"{n} items\"",
  if: "a ? b : c", iif: "a ? b : c", concat: "join(list) or text in quotes",
  mutate: "extend(list, 'q', {field: q.price * 2})", assign: "extend(list, 'q', {field: q.price * 2})", withcolumn: "extend(list, 'q', {field: q.price * 2})", addfield: "extend(list, 'q', {field: q.price * 2})",
  ranking: "rank(list, 'field', 'desc')", row_number: "rank(list, 'field', 'desc')", dense_rank: "rank(list, 'field', 'desc')",
  values: "pluck(list, 'field')", column: "pluck(list, 'field')", get: "pluck(list, 'field')",
  // Scene math is only for lines inside a scene; models reach for it in derive lines too.
  clamp: "min(max(x, low), high) here (clamp works only on lines inside a scene)",
  lerp: "a + (b - a) * u here (lerp works only on lines inside a scene)",
  pick: "first(slice(list, i, i + 1)) here (pick works only on lines inside a scene)",
};

function unknownFunction(name: string, fns?: ExpressionFunctions): string {
  const key = name.toLowerCase();
  // hasOwn: names like "constructor" must not find Object's own properties.
  const hint = Object.hasOwn(FUNCTION_HINTS, key) ? FUNCTION_HINTS[key] : undefined;
  const near = EXPRESSION_FUNCTIONS.find((f) => f === key);
  const tip = hint ? ` Use ${hint}.` : near ? ` Did you mean ${near}?` : "";
  return `Unknown function "${name}".${tip} Functions: ${[...EXPRESSION_FUNCTIONS, ...(fns ? Object.keys(fns) : [])].join(", ")}`;
}

const OPS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", ",", "[", "]", "{", "}"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t") { i++; continue; }
    // A dot reads a field (t.text), unless a digit follows: then it starts a number (.5).
    if (c === "." && !/[0-9]/.test(src[i + 1] ?? "")) { out.push({ t: "op", v: ".", pos: i }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExprError(`Unexpected "${c}" at ${i}`);
      out.push({ t: "num", v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) j++; s += src[j]; j++; }
      if (j >= src.length) throw new ExprError("Unclosed string");
      out.push({ t: "str", v: s, pos: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], pos: i }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected "${c}" at ${i}`);
    out.push({ t: "op", v: op, pos: i }); i += op.length;
  }
  out.push({ t: "end", v: "", pos: src.length });
  return out;
}

const BIN_PREC: Record<string, number> = {
  "||": 2, "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

function parseExpr(src: string, fns?: ExpressionFunctions): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v) throw new ExprError(`Expected "${v}" but found "${t.v || "end"}"`);
  };

  /** Literals nest at most as deep as data may. */
  let depth = 0;

  /** Entries of a record literal, after its "{" (or at the start, for a bare record). */
  function recordBody(close: string): Node {
    const entries: Array<[string, Node]> = [];
    while (peek().v !== close && peek().t !== "end") {
      const k = next();
      if (k.t !== "id" && k.t !== "str") throw new ExprError(`Expected a field name but found "${k.v || "end"}"`);
      expect(":");
      entries.push([k.v, ternary()]);
      if (peek().v === ",") next();
      else break;
    }
    return { k: "rec", entries };
  }

  function nested<T>(f: () => T): T {
    if (++depth > MAX_DATA_DEPTH) throw new ExprError(`Lists and records nest more than ${MAX_DATA_DEPTH} levels deep`);
    try { return f(); } finally { depth--; }
  }

  /** A value, then any number of .field and [item] reads after it. */
  function primary(): Node {
    let n = atom();
    for (;;) {
      if (peek().v === ".") {
        next();
        const name = next();
        if (name.t !== "id") throw new ExprError(`Expected a field name after "." but found "${name.v || "end"}"`);
        if (peek().v === "(") throw new ExprError(noMethods(name.v));
        n = { k: "get", obj: n, key: { k: "lit", v: name.v } };
      } else if (peek().v === "[") {
        next();
        const key = ternary();
        expect("]");
        n = { k: "get", obj: n, key };
      } else return n;
    }
  }

  /**
   * extend(list, 'q', {field: expression, …}) and map(list, 'q', expression), after the name: their own
   * syntax, since the third argument is worked out once per item, with the item named.
   */
  function perCall(fn: "extend" | "map"): Node {
    const usage = () => new ExprError(fn === "extend"
      ? "extend() takes a list, a name for each item in quotes, and a record of new fields: extend(rows, 'r', {total: r.price * r.qty})"
      : "map() takes a list, a name for each item in quotes, and what to make of each: map(range(1, years + 1), 'y', {year: y, balance: loan * pow(1 + r, y)})");
    next();
    const list = ternary();
    if (peek().v !== ",") throw usage();
    next();
    const as = next();
    if (as.t !== "str" || !/^[A-Za-z_]\w*$/.test(as.v) || ["true", "false", "null"].includes(as.v)) {
      throw new ExprError(`${fn}()'s second argument names each item, like 'q' in quotes (a plain word), not ${as.t === "str" ? `'${as.v}'` : `"${as.v || "end"}"`}`);
    }
    // map(cart, 'price'), as in lodash: one field of every item is pluck()'s job.
    if (fn === "map" && peek().v === ")") throw new ExprError(`map() needs what to make of each item as its third argument, like map(list, 'q', q.price * 2); for one field of every item, use pluck(list, 'field')`);
    if (peek().v !== ",") throw usage();
    next();
    let body: Node;
    if (fn === "extend") {
      if (peek().v !== "{") throw new ExprError("extend()'s third argument must be the new fields written out in braces, like {total: q.price * q.qty}");
      next();
      body = nested(() => { const r = recordBody("}"); expect("}"); return r; });
    } else body = ternary();
    if (peek().v === ",") throw new ExprError(tooManyArgs(fn, 4));
    expect(")");
    return { k: "per", fn, list, as: as.v, body };
  }

  function atom(): Node {
    const t = next();
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if ((t.v === "extend" || t.v === "map") && peek().v === "(") return perCall(t.v);
      if (peek().v === "(") {
        const extra = extraOf(fns, t.v);
        if (!isFunctionName(t.v) && !extra) throw new ExprError(unknownFunction(t.v, fns));
        next();
        const args: Node[] = [];
        if (peek().v !== ")") {
          args.push(ternary());
          while (peek().v === ",") { next(); args.push(ternary()); }
        }
        expect(")");
        if (extra) {
          if (args.length > extra.length) throw new ExprError(`${t.v}() takes at most ${extra.length} argument${extra.length === 1 ? "" : "s"}, not ${args.length}`);
          return { k: "call", fn: t.v, args, extra };
        }
        if (args.length > MAX_ARGS[t.v]!) throw new ExprError(tooManyArgs(t.v, args.length));
        // A check named in quotes is known now, so a misspelt one is reported on its line, not when it runs.
        const kind = args[1];
        if (t.v === "has" && kind?.k === "lit") namedCheck("has", TEXT_HAS, kind.v);
        if (t.v === "is" && kind?.k === "lit") namedCheck("is", TEXT_IS, kind.v);
        return { k: "call", fn: t.v, args };
      }
      return { k: "id", name: t.v };
    }
    if (t.v === "(") { const e = ternary(); expect(")"); return e; }
    if (t.v === "[") {
      return nested(() => {
        const items: Node[] = [];
        while (peek().v !== "]" && peek().t !== "end") {
          items.push(ternary());
          if (peek().v === ",") next();
          else break;
        }
        expect("]");
        return { k: "list", items } as Node;
      });
    }
    if (t.v === "{") return nested(() => { const r = recordBody("}"); expect("}"); return r; });
    if (t.v === "!" || t.v === "-") return { k: "un", op: t.v, a: primary() };
    throw new ExprError(t.t === "end" ? "Expression ended early" : `Unexpected "${t.v}"`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const t = peek();
      const prec = t.t === "op" ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      next();
      left = { k: "bin", op: t.v, a: left, b: binary(prec + 1) };
    }
  }

  function ternary(): Node {
    const c = binary(1);
    if (peek().v !== "?") return c;
    next();
    const a = ternary();
    expect(":");
    return { k: "cond", c, a, b: ternary() };
  }

  // Braces whose content starts with "name:" hold a record: {text:'Snacks', done:false}.
  // A ternary always has "?" before its ":", so the two can't be confused.
  const startsRecord = (toks[0]!.t === "id" || toks[0]!.t === "str") && toks[1]?.v === ":";
  const root = startsRecord ? nested(() => recordBody("")) : ternary();
  if (peek().t !== "end") throw new ExprError(`Unexpected "${peek().v}"`);
  return root;
}

export type Scope = (name: string) => Value | undefined;


function run(n: Node, scope: Scope): Value {
  switch (n.k) {
    case "lit": return n.v;
    case "id": {
      const v = scope(n.name);
      // Only SayShape data counts: a scope backed by an object could otherwise
      // hand back things like Object.prototype for `__proto__`.
      if (!isData(v)) throw new ExprError(`Unknown state "${n.name}"`);
      return v;
    }
    case "un": {
      const a = run(n.a, scope);
      return n.op === "!" ? !a : -toNumber(a);
    }
    case "cond": return run(n.c, scope) ? run(n.a, scope) : run(n.b, scope);
    case "list": return makeList(n.items.map((x) => run(x, scope)));
    case "rec": return makeRecord(n.entries.map(([k, x]) => [k, run(x, scope)]));
    case "get": {
      const r = readField(run(n.obj, scope), run(n.key, scope));
      if ("error" in r) throw new ExprError(r.error);
      return r.value;
    }
    case "per": {
      const list = run(n.list, scope);
      if (!isList(list)) return NaN;
      if (n.fn === "map") {
        if (list.length > MAX_MADE_ITEMS) throw new ExprError(`map() works through at most ${MAX_MADE_ITEMS.toLocaleString("en-US")} items, and this list has ${list.length.toLocaleString("en-US")}; filter() or take() it first`);
        make(list.length, "map");
      }
      // One name for the item in the whole expression: it can't also mean state, a derived value or an outer item.
      if (scope(n.as) !== undefined) throw new ExprError(`${n.fn}() names its item "${n.as}", but "${n.as}" is already a name here. Pick another, like '${n.as}_'`);
      let current: Value = null;
      const inner: Scope = (name) => (name === n.as ? current : scope(name));
      const { body } = n;
      return makeList(list.map((item, i) => {
        if (n.fn === "extend" && !isRecord(item)) throw new ExprError(`extend(): item ${i} is ${describeValue(item)}, not a record`);
        current = item;
        try {
          return n.fn === "map" || body.k !== "rec" ? run(body, inner) : withFields(item as DataRecord, body.entries.map(([k, x]) => [k, run(x, inner)] as const));
        } catch (e) {
          throw e instanceof ExprError ? new ExprError(`${n.fn}(): item ${i}: ${e.message}`) : e;
        }
      }));
    }
    case "call": {
      // Called detached, so `this` is never the function table.
      const fn = n.extra ?? FUNCTIONS[n.fn]!;
      return fn(...n.args.map((a) => run(a, scope)));
    }
    case "bin": {
      if (n.op === "&&") return run(n.a, scope) && run(n.b, scope);
      if (n.op === "||") return run(n.a, scope) || run(n.b, scope);
      const a = run(n.a, scope), b = run(n.b, scope);
      switch (n.op) {
        case "+": return typeof a === "string" || typeof b === "string" ? `${joinText(a)}${joinText(b)}` : toNumber(a) + toNumber(b);
        case "-": return toNumber(a) - toNumber(b);
        case "*": return toNumber(a) * toNumber(b);
        case "/": return toNumber(a) / toNumber(b);
        case "%": return toNumber(a) % toNumber(b);
        case "==": case "===": return a === b;
        case "!=": case "!==": return a !== b;
        case "<": case "<=": case ">": case ">=": return compare(n.op, a, b);
      }
    }
  }
  throw new ExprError("Bad expression");
}

const cache = new Map<string, Node | ExprError>();
/** Compiled expressions per set of extra functions: the same text can mean different calls in each. */
const extraCaches = new WeakMap<ExpressionFunctions, Map<string, Node | ExprError>>();

/**
 * An arrow function (x => x.done), outside quoted text: models write them from JavaScript, and the
 * plain parse error ("Unexpected =") didn't say what to write instead.
 */
const hasArrow = (src: string) => /=>/.test(src.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, ""));
const NO_ARROWS = "SayShape has no arrow functions (x => …): list functions take a field name and a value instead, like filter(list, 'priority', 'High'), count(list, 'done') or sort(list, 'price', 'desc'). To work something out for each item, use extend(list, 'x', {total: x.price * x.qty})";

/** A JavaScript template string (`Total: ${n}`): models write them, and the parse error didn't say what to write. */
const NO_TEMPLATES = "SayShape has no template strings (`…`): put the text in quotes outside the braces, and it fills in each {…}: value=\"${total}K\" or text \"Total: {money(total)}\"";

/**
 * Text in quotes that holds {…} (or ${…}), as a whole expression: {"${total}K"}. It's valid, but
 * it's just text, so the braces show as they are. Returns that text, or null.
 */
export function quotedTemplate(src: string): string | null {
  const m = /^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*$/.exec(src);
  return m && /\{[^{}]*\}/.test(m[2]!) ? m[2]! : null;
}

function compile(src: string, fns?: ExpressionFunctions): Node {
  let store = cache;
  if (fns) {
    let own = extraCaches.get(fns);
    if (!own) extraCaches.set(fns, (own = new Map()));
    store = own;
  }
  let c = store.get(src);
  if (!c) {
    try { c = parseExpr(src, fns); } catch (e) { c = e instanceof ExprError ? e : new ExprError(String(e)); }
    if (c instanceof ExprError && hasArrow(src)) c = new ExprError(NO_ARROWS);
    else if (c instanceof ExprError && src.includes("`")) c = new ExprError(NO_TEMPLATES);
    if (store.size > 2000) store.clear();
    store.set(src, c);
  }
  if (c instanceof ExprError) throw c;
  return c;
}

export type EvalResult = { ok: true; value: Value } | { ok: false; error: string };

/** Evaluate an expression against a scope, with an element's extra functions if any. Never throws. */
export function evaluate(src: string, scope: Scope, fns?: ExpressionFunctions): EvalResult {
  try {
    const node = compile(src, fns);
    made = 0;
    return { ok: true, value: run(node, scope) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Check syntax only (used by the parser to report problems early). */
export function checkSyntax(src: string, fns?: ExpressionFunctions): string | null {
  try { compile(src, fns); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/**
 * Collect the state names an expression reads (with an element's extra functions, if it calls them).
 * The name extend() or map() gives its items is not one: it only exists inside that call's last argument.
 */
export function identifiers(src: string, fns?: ExpressionFunctions): string[] {
  try {
    const out = new Set<string>();
    const walk = (n: Node, bound: ReadonlySet<string>): void => {
      if (n.k === "id") { if (!bound.has(n.name)) out.add(n.name); }
      else if (n.k === "un") walk(n.a, bound);
      else if (n.k === "bin") { walk(n.a, bound); walk(n.b, bound); }
      else if (n.k === "cond") { walk(n.c, bound); walk(n.a, bound); walk(n.b, bound); }
      else if (n.k === "call") n.args.forEach((a) => walk(a, bound));
      else if (n.k === "list") n.items.forEach((a) => walk(a, bound));
      else if (n.k === "rec") n.entries.forEach(([, x]) => walk(x, bound));
      else if (n.k === "get") { walk(n.obj, bound); walk(n.key, bound); }
      else if (n.k === "per") {
        walk(n.list, bound);
        walk(n.body, new Set(bound).add(n.as));
      }
    };
    walk(compile(src, fns), new Set());
    return [...out];
  } catch { return []; }
}

/** The names extend() and map() calls in an expression give their items, and which call, for the parser to check against state and derived names. */
export function namedItems(src: string, fns?: ExpressionFunctions): Array<{ name: string; fn: string }> {
  try {
    const out = new Map<string, string>();
    const walk = (n: Node): void => {
      if (n.k === "un") walk(n.a);
      else if (n.k === "bin") { walk(n.a); walk(n.b); }
      else if (n.k === "cond") { walk(n.c); walk(n.a); walk(n.b); }
      else if (n.k === "call") n.args.forEach(walk);
      else if (n.k === "list") n.items.forEach(walk);
      else if (n.k === "rec") n.entries.forEach(([, x]) => walk(x));
      else if (n.k === "get") { walk(n.obj); walk(n.key); }
      else if (n.k === "per") { if (!out.has(n.as)) out.set(n.as, n.fn); walk(n.list); walk(n.body); }
    };
    walk(compile(src, fns));
    return [...out].map(([name, fn]) => ({ name, fn }));
  } catch { return []; }
}

/** The names extend() and map() calls in an expression give their items. */
export function itemNames(src: string, fns?: ExpressionFunctions): string[] {
  return namedItems(src, fns).map((n) => n.name);
}

/** Format a value for display in text. */
export function formatValue(v: Value | undefined): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") {
    if (!isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === "object") return displayData(v, formatValue);
  return String(v);
}

/** A value joined into text with +: as it would display, except null stays empty. */
function joinText(v: Value): string {
  return v === null ? "" : typeof v === "object" ? formatValue(v) : String(v);
}

/** <, <=, > and >=: text compares as text, plain values as numbers, and lists or records are never ordered. */
function compare(op: string, a: Value, b: Value): boolean {
  if (!isScalar(a) || !isScalar(b)) return false;
  const [x, y] = typeof a === "string" && typeof b === "string" ? [a, b] : [toNumber(a), toNumber(b)];
  return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
}

/** Find `{...}` segments in a string, respecting nested braces and quotes. */
export function splitTemplate(s: string): Array<{ text: string } | { expr: string }> {
  const parts: Array<{ text: string } | { expr: string }> = [];
  let buf = "", i = 0;
  while (i < s.length) {
    if (s[i] === "{") {
      let depth = 1, j = i + 1, quote = "";
      while (j < s.length && depth > 0) {
        const c = s[j]!;
        if (quote) { if (c === quote) quote = ""; }
        else if (c === "'" || c === '"') quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      if (depth === 0) {
        if (buf) parts.push({ text: buf });
        buf = "";
        parts.push({ expr: s.slice(i + 1, j - 1) });
        i = j;
        continue;
      }
    }
    buf += s[i]; i++;
  }
  if (buf) parts.push({ text: buf });
  return parts;
}

/** Currency signs a value can start with, after an optional minus. */
const CURRENCY_START = /^-?([$€£¥])/;

/**
 * Replace every `{expr}` in a string with its formatted value.
 * "${money(x)}" would show $$1,250.00, since money() adds the sign itself;
 * a sign written just before a value that already starts with the same sign
 * is dropped, so it shows once.
 */
export function interpolate(s: string, scope: Scope, fns?: ExpressionFunctions): string {
  if (!s.includes("{")) return s;
  let out = "";
  for (const p of splitTemplate(s)) {
    if ("text" in p) { out += p.text; continue; }
    const r = evaluate(p.expr, scope, fns);
    const v = r.ok ? formatValue(r.value) : "—";
    const sign = CURRENCY_START.exec(v)?.[1];
    if (sign && out.endsWith(sign)) out = out.slice(0, -1);
    out += v;
  }
  return out;
}

/**
 * The expression inside a prop value that is one whole {…}, or null.
 * "{a} of {b}" starts with { and ends with } but is text with two
 * expressions in it, so it isn't one expression.
 */
export function wholeExpression(raw: string): string | null {
  if (raw[0] !== "{" || raw[raw.length - 1] !== "}") return null;
  let depth = 0, quote = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0 && i < raw.length - 1) return null;
  }
  return depth === 0 ? raw.slice(1, -1) : null;
}

/** A condition or expression prop's source: the inside of a whole {…}, or the value as written (if=done). */
export function bareExpression(raw: string): string {
  return wholeExpression(raw) ?? raw;
}
