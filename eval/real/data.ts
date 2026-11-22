/**
 * Datasets for the real-world benchmark, from a seeded generator, so every run
 * and every model sees identical data and the expected figures are exact.
 * Each dataset keeps its own seed, so changing one never shifts another.
 *
 * Extreme datasets are messy on purpose (blank cells, mixed date and money
 * formats, untidy casing). They are built from clean values ("truth") and
 * then written out messily, so the expected figures come from the truth,
 * never from re-parsing the mess.
 */

export type Row = Record<string, string | number | null>;

// ---------------------------------------------------------------------------
// Generator

/** mulberry32: small, fast and the same on every platform. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Gen {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = rng(seed);
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** A whole number in [lo, hi] that is a multiple of `step`. */
  step(lo: number, hi: number, step: number): number {
    return this.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    const x = xs[Math.floor(this.next() * xs.length)];
    if (x === undefined) throw new Error("pick from an empty list");
    return x;
  }
  /** Pick by weight: `weights[i]` is how likely `xs[i]` is. */
  weighted<T>(xs: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < xs.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return xs[i] as T;
    }
    return xs[xs.length - 1] as T;
  }
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
  sample<T>(xs: readonly T[], n: number): T[] {
    return this.shuffle(xs).slice(0, n);
  }
}

// ---------------------------------------------------------------------------
// Numbers, dates and text

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const comma = (n: number): string => Math.trunc(n).toLocaleString("en-US");
/** `$1,234` for whole dollars, `$1,234.50` otherwise. */
export const usd = (n: number): string =>
  Number.isInteger(n) ? `$${comma(n)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Day { y: number; m: number; d: number }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (t: Day): string => `${t.y}-${pad(t.m)}-${pad(t.d)}`;
export const quarterOf = (t: Day): number => Math.ceil(t.m / 3);
const dayKey = (t: Day) => t.y * 10000 + t.m * 100 + t.d;
/** A day in 2026 between two months, inclusive. Days stop at 28 so every month is valid. */
export const dayIn = (g: Gen, mFrom: number, mTo: number): Day => ({ y: 2026, m: g.int(mFrom, mTo), d: g.int(1, 28) });
export const byDay = <T extends { day: Day }>(rows: T[]): T[] => [...rows].sort((a, b) => dayKey(a.day) - dayKey(b.day));

/** Dates written five ways. Slashes are always month/day, and the requests say so. */
export function messyDate(t: Day, k: number): string {
  switch (k % 5) {
    case 0: return iso(t);
    case 1: return `${pad(t.m)}/${pad(t.d)}/${t.y}`;
    case 2: return `${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
    case 3: return `${MONTHS[t.m - 1]} ${t.d}, ${t.y}`;
    default: return `${t.y}/${t.m}/${t.d}`;
  }
}
/** A month written four ways. */
export function messyMonth(m: number, k: number): string {
  switch (k % 4) {
    case 0: return `2026-${pad(m)}`;
    case 1: return `${MONTHS[m - 1]} 2026`;
    case 2: return `${pad(m)}/2026`;
    default: return `${MONTHS[m - 1]}-26`;
  }
}
/** Whole-dollar amounts written five ways. */
export function messyMoney(v: number, k: number): string {
  switch (k % 5) {
    case 0: return `$${comma(v)}`;
    case 1: return String(v);
    case 2: return `${comma(v)}.00`;
    case 3: return `USD ${v}`;
    default: return `$${v}.00`;
  }
}
/** Minutes written four ways. */
export function messyMinutes(v: number, k: number): string {
  switch (k % 4) {
    case 0: return String(v);
    case 1: return `${v} min`;
    case 2: return `${Math.floor(v / 60)}:${pad(v % 60)}`;
    default: return `${v}m`;
  }
}
/** A blank cell, written three ways. */
const blank = (k: number): string | null => (k % 3 === 0 ? null : k % 3 === 1 ? "" : " ");
/** Untidy casing and spacing on a category name. */
function messyName(s: string, k: number): string {
  switch (k % 5) {
    case 1: return s.toLowerCase();
    case 2: return `${s} `;
    case 3: return s.toUpperCase();
    default: return s;
  }
}

// ---------------------------------------------------------------------------
// Pattern helpers for checks: tolerant of formatting (`1,200` or `1200`,
// `$` or none, `12.3K`), but strict about the digits.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const grouped = (intDigits: string) => intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",?");

function fixedAlts(x: number, dps: readonly number[]): string[] {
  const out = new Set<string>();
  for (const dp of dps) {
    const [i = "0", d] = Math.abs(x).toFixed(dp).split(".");
    out.add(d ? `${grouped(i)}\\.${d}` : `${grouped(i)}(?:\\.0{1,2})?`);
  }
  return [...out];
}
function shortAlts(x: number): string[] {
  const a = Math.abs(x);
  const out: string[] = [];
  const short = (v: number, unit: string, dps: number[]) => {
    const alts = new Set(dps.map((dp) => esc(v.toFixed(dp))));
    out.push(`(?:${[...alts].join("|")})\\s?${unit}(?![A-Za-z])`);
  };
  if (a >= 10_000) short(a / 1000, "[kK]", a >= 100_000 ? [0, 1, 2] : [1, 2]);
  if (a >= 1_000_000) short(a / 1_000_000, "M", [1, 2]);
  return out;
}
const bounded = (alts: string[]) => `(?<![\\d.,])(?:${alts.join("|")})(?!\\d|\\.\\d|,\\d{3})`;

/** A number with these decimal places accepted (default: as given, 1 place, whole). */
export function num(x: number, dps: readonly number[] = Number.isInteger(x) ? [0] : [2, 1, 0]): RegExp {
  return new RegExp(bounded([...fixedAlts(x, dps), ...shortAlts(x)]));
}
/** A money figure: whole dollars, or cents and the rounded dollar. Sign is ignored. */
export function money(x: number): RegExp {
  const r = round2(x);
  return num(r, Number.isInteger(r) ? [0] : [2, 0]);
}
/** A percentage, to one place or whole. */
export function pct(x: number, dps: readonly number[] = [1, 0]): RegExp {
  return new RegExp(`${bounded(fixedAlts(x, dps))}\\s?%`);
}
/** Matches if any of these do. */
export function anyOf(...res: RegExp[]): RegExp {
  return new RegExp(res.map((r) => `(?:${r.source})`).join("|"));
}

// ---------------------------------------------------------------------------
// Name pools

const COMPANIES = (() => {
  const a = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Tyrell", "Soylent", "Hooli", "Vandelay", "Wonka", "Cyberdyne", "Oscorp", "Nakatomi", "Virtucon", "Monarch", "Gringotts", "Dunder", "Pied Piper", "Blue Sun"];
  const b = ["Corp", "Labs", "Foods", "Logistics", "Health", "Retail", "Energy", "Media", "Freight", "Bank"];
  return a.flatMap((x) => b.map((y) => `${x} ${y}`));
})();
const FIRST = ["Ana", "Ben", "Chen", "Dee", "Eli", "Fay", "Gus", "Hana", "Ivan", "Jade", "Kofi", "Lena", "Milo", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sven", "Tara", "Umar", "Vera", "Wes", "Xena", "Yuri", "Zoe"];
const LAST = ["Abbott", "Barnes", "Castro", "Dalton", "Ellis", "Foster", "Garcia", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Moreau", "Novak", "Okafor", "Patel", "Quist", "Reyes", "Sato", "Tran"];
const PEOPLE = FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`));
const TICKET_SUBJECTS = (() => {
  const what = ["Login", "Export", "Invoice", "Password reset", "Dashboard", "Sync", "Report", "Checkout", "Search", "Upload", "Webhook", "Mobile app", "SSO", "Billing page", "Email alerts"];
  const how = ["fails", "is slow", "shows wrong totals", "times out", "loses data", "won't load", "duplicates rows", "crashes"];
  return what.flatMap((w) => how.map((h) => `${w} ${h}`));
})();

// ---------------------------------------------------------------------------
// Low: one thing, data in the sentence

export const lowBudget = (() => {
  const g = new Gen(1101);
  const ranges: Array<[string, number, number]> = [["Rent", 1600, 2300], ["Groceries", 380, 720], ["Dining", 120, 380], ["Transport", 90, 260], ["Utilities", 110, 240], ["Fun", 60, 220]];
  const rows = ranges.map(([category, lo, hi]) => ({ category, amount: g.int(lo, hi) }));
  return { rows, total: sum(rows.map((r) => r.amount)) };
})();

const SUBS_MENU: Array<[string, number]> = [["Netflix", 1549], ["Spotify", 1199], ["iCloud", 299], ["Gym", 3999], ["NYT", 425], ["Disney+", 1399], ["Xbox Game Pass", 1699], ["Audible", 1495], ["YouTube Premium", 1399], ["Duolingo", 699], ["Hulu", 999], ["Headspace", 1299], ["Dropbox", 1199], ["Peloton", 4400]];

export const lowSubs = (() => {
  const g = new Gen(1102);
  const rows = g.sample(SUBS_MENU, 6).map(([name, cents]) => ({ name, cents }));
  const monthCents = sum(rows.map((r) => r.cents));
  return { rows, monthly: monthCents / 100, yearly: (monthCents * 12) / 100 };
})();

export const lowWorkouts = (() => {
  const g = new Gen(1103);
  const rows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({ day, activity: g.pick(["Run", "Bike", "Swim", "Yoga", "Strength"]), minutes: g.int(20, 75) }));
  return { rows, total: sum(rows.map((r) => r.minutes)) };
})();

export const lowTrip = (() => {
  const g = new Gen(1104);
  const rows = [{ what: "cabin", amount: g.int(600, 1200) }, { what: "gas", amount: g.int(80, 180) }, { what: "groceries", amount: g.int(200, 400) }, { what: "ski passes", amount: g.int(400, 800) }];
  const total = sum(rows.map((r) => r.amount));
  return { rows, people: 4, total, each: total / 4 };
})();

export const lowPipeline = (() => {
  const g = new Gen(1105);
  const deals = g.int(18, 40);
  const value = g.step(400_000, 1_600_000, 100);
  return { deals, value, winRate: g.int(18, 41), average: round2(value / deals) };
})();

export const lowTickets = (() => {
  const g = new Gen(1106);
  // Separate ranges keep every count different, so a check can't match the wrong one.
  return { rows: [{ priority: "Urgent", count: g.int(5, 12) }, { priority: "High", count: g.int(20, 60) }, { priority: "Normal", count: g.int(61, 140) }, { priority: "Low", count: g.int(13, 19) }] };
})();

export const lowHeadcount = (() => {
  const g = new Gen(1107);
  const rows = ["Engineering", "Sales", "Support", "Marketing", "Finance", "People"].map((dept, i) => ({ dept, headcount: i === 0 ? g.int(80, 160) : g.int(8, 70), open: g.int(0, 12) }));
  return { rows, headcount: sum(rows.map((r) => r.headcount)), open: sum(rows.map((r) => r.open)) };
})();

export const lowRenewals = (() => {
  const g = new Gen(1108);
  const counts = g.sample(Array.from({ length: 23 }, (_, i) => i + 3), 5);
  const rows = ["Travelers", "Chubb", "Hartford", "Liberty Mutual", "Zurich"].map((carrier, i) => ({ carrier, count: counts[i] ?? 0 }));
  return { rows, largestFirst: [...rows].sort((a, b) => b.count - a.count).map((r) => r.carrier) };
})();

// ---------------------------------------------------------------------------
// Medium: up to 15 rows, in the request

/** Standard amortized monthly payment. */
export const payment = (principal: number, apr: number, months: number): number => {
  const r = apr / 100 / 12;
  return round2((principal * r) / (1 - (1 + r) ** -months));
};

export const medLoans = (() => {
  const g = new Gen(1201);
  const terms = g.sample([36, 48, 60, 72], 3);
  const rows = ["Harbor Credit Union", "Northline Bank", "Quickfund"].map((lender, i) => ({ lender, apr: g.int(549, 999) / 100, months: terms[i] ?? 60 }));
  return { rows, amount: 25_000, typed: 40_000 };
})();

export const medSubs = (() => {
  const g = new Gen(1202);
  const rows = g.sample(SUBS_MENU, 8).map(([name, cents]) => ({ name, cents }));
  const monthCents = sum(rows.map((r) => r.cents));
  return { rows, monthly: monthCents / 100, yearly: (monthCents * 12) / 100 };
})();

export const medWorkouts = (() => {
  const g = new Gen(1203);
  const km = { Run: [3, 15], Bike: [10, 50], Swim: [0.5, 3] } as const;
  const rows = byDay(Array.from({ length: 12 }, (_, i) => {
    const type = (["Run", "Bike", "Swim"] as const)[i % 3] ?? "Run";
    const [lo, hi] = km[type];
    return { day: dayIn(g, 3, 3), type, minutes: g.int(20, 95), km: g.int(lo * 10, hi * 10) / 10 };
  }));
  const of = (t?: string) => rows.filter((r) => !t || r.type === t);
  return { rows, minutes: sum(of().map((r) => r.minutes)), km: round1(sum(of().map((r) => r.km))), runMinutes: sum(of("Run").map((r) => r.minutes)), runKm: round1(sum(of("Run").map((r) => r.km))) };
})();

export const medStudy = (() => {
  const g = new Gen(1204);
  const names = ["Limits", "Derivatives", "Integrals", "Series", "Vectors", "Matrices", "Probability", "Statistics", "Proofs", "Graph theory"];
  const done = new Set(g.sample(names, 3));
  const rows = names.map((topic) => ({ topic, hours: g.int(1, 6), done: done.has(topic) }));
  const left = sum(rows.filter((r) => !r.done).map((r) => r.hours));
  const target = rows.find((r) => !r.done) ?? rows[0]!;
  return { rows, left, target: target.topic, leftAfter: left - target.hours };
})();

export const medDeals = (() => {
  const g = new Gen(1205);
  const stages = ["Prospect", "Proposal", "Negotiation", "Won"];
  const accounts = g.sample(COMPANIES, 12);
  const rows = accounts.map((account, i) => ({ account, owner: g.pick(["Priya", "Marco", "Jen"]), stage: i < 3 ? "Negotiation" : (stages[i % 4] ?? "Prospect"), value: g.step(5_000, 120_000, 500) }));
  const shuffled = g.shuffle(rows);
  const neg = shuffled.filter((r) => r.stage === "Negotiation");
  return { rows: shuffled, total: sum(rows.map((r) => r.value)), negotiation: sum(neg.map((r) => r.value)), notNegotiation: shuffled.find((r) => r.stage !== "Negotiation")!.account };
})();

export const medTickets = (() => {
  const g = new Gen(1206);
  const subjects = g.sample(TICKET_SUBJECTS, 14);
  const rows = subjects.map((subject, i) => ({ id: `#${4101 + i}`, subject, status: i < 3 ? "Pending" : i < 6 ? "Solved" : g.pick(["Open", "Pending", "Solved"]), priority: g.pick(["High", "Normal", "Low"]) }));
  const mixed = g.shuffle(rows).map((r, i) => ({ ...r, id: `#${4101 + i}` }));
  return { rows: mixed, open: mixed.filter((r) => r.status === "Open").length, pending: mixed.filter((r) => r.status === "Pending").map((r) => r.subject), solved: mixed.filter((r) => r.status === "Solved").map((r) => r.subject) };
})();

export const medClaims = (() => {
  const g = new Gen(1207);
  const rows = g.sample(PEOPLE, 8).map((claimant, i) => ({ id: `CLM-${1001 + i}`, policy: `POL-${g.int(100000, 999999)}`, claimant, amount: g.step(800, 30_000, 50) }));
  const total = sum(rows.map((r) => r.amount));
  return { rows, total, add: { policy: "POL-482913", claimant: "Dana Whitfield", amount: 4250 }, after: total + 4250 };
})();

export const medBva = (() => {
  const g = new Gen(1208);
  const rows = ["Engineering", "Sales", "Marketing", "Support", "Finance", "Legal", "Facilities", "People"].map((dept, i) => {
    const budget = g.step(40_000, 400_000, 1000);
    const swing = i < 2 ? g.int(3, 20) : i < 4 ? -g.int(3, 20) : g.int(-18, 18) || 5;
    return { dept, budget, actual: Math.round((budget * (100 + swing)) / 100) };
  });
  const over = rows.filter((r) => r.actual > r.budget);
  const under = rows.filter((r) => r.actual <= r.budget);
  return { rows, budget: sum(rows.map((r) => r.budget)), actual: sum(rows.map((r) => r.actual)), over: over.map((r) => r.dept), under: under.map((r) => r.dept) };
})();

// ---------------------------------------------------------------------------
// Hard: about 50 rows, in the request

const MERCHANTS: Record<string, string[]> = {
  Groceries: ["Trader Joe's", "Safeway", "Whole Foods", "Costco", "Aldi"],
  Dining: ["Chipotle", "Blue Bottle", "Sushi Den", "Pizza Barn", "Thai Orchid"],
  Transport: ["Shell", "Uber", "Metro Card", "Chevron", "Lyft"],
  Bills: ["PG&E", "Comcast", "Verizon", "Geico", "Water Dept"],
  Fun: ["AMC", "Steam", "Bowl-a-rama", "REI", "Ticketmaster"],
};
const SPEND: Record<string, [number, number]> = { Groceries: [25, 220], Dining: [12, 95], Transport: [9, 70], Bills: [40, 210], Fun: [10, 140] };

export const hardBudget = (() => {
  const g = new Gen(1301);
  const cats = Object.keys(MERCHANTS);
  const rows = byDay(Array.from({ length: 50 }, () => {
    const category = g.weighted(cats, [5, 4, 3, 2, 2]);
    const [lo, hi] = SPEND[category] ?? [10, 100];
    return { day: dayIn(g, 1, 3), merchant: g.pick(MERCHANTS[category] ?? ["Store"]), category, amount: g.int(lo, hi) };
  }));
  const total = sum(rows.map((r) => r.amount));
  return { rows, total, dining: sum(rows.filter((r) => r.category === "Dining").map((r) => r.amount)), groceryMerchant: "Costco", add: 37, march: sum(rows.filter((r) => r.day.m === 3).map((r) => r.amount)) };
})();

export const hardTrip = (() => {
  const g = new Gen(1302);
  const people = ["Maya", "Leo", "Sam", "Priya"];
  const what: Record<string, string[]> = { Lodging: ["Airbnb night", "Hostel", "Hotel night"], Food: ["Dinner", "Lunch", "Breakfast", "Market run", "Coffee", "Snacks"], Gas: ["Gas fill-up", "Tolls", "Parking"], Activities: ["Kayak rental", "Museum", "Boat tour", "Hike guide", "Concert"] };
  const range: Record<string, [number, number]> = { Lodging: [90, 260], Food: [8, 120], Gas: [12, 85], Activities: [20, 160] };
  const cats = Object.keys(what);
  const rows = Array.from({ length: 48 }, () => {
    const category = g.weighted(cats, [2, 6, 2, 3]);
    const [lo, hi] = range[category] ?? [10, 100];
    return { who: g.pick(people), what: g.pick(what[category] ?? ["Item"]), category, amount: g.int(lo, hi) };
  });
  // Make the total split evenly four ways, so every share is whole dollars.
  const last = rows[rows.length - 1]!;
  last.amount += (4 - (sum(rows.map((r) => r.amount)) % 4)) % 4;
  const total = sum(rows.map((r) => r.amount));
  const share = total / 4;
  const paid = people.map((name) => ({ name, paid: sum(rows.filter((r) => r.who === name).map((r) => r.amount)) }));
  return { rows, people, total, share, paid: paid.map((p) => ({ ...p, balance: p.paid - share })), food: sum(rows.filter((r) => r.category === "Food").map((r) => r.amount)) };
})();

export const hardWorkouts = (() => {
  const g = new Gen(1303);
  const km: Record<string, [number, number] | null> = { Run: [3, 21], Bike: [12, 70], Swim: [1, 4], Strength: null };
  const types = Object.keys(km);
  const rows = byDay(Array.from({ length: 50 }, () => {
    const type = g.weighted(types, [4, 3, 2, 2]);
    const range = km[type];
    return { day: dayIn(g, 2, 4), type, minutes: g.int(20, 120), km: range ? g.int(range[0] * 10, range[1] * 10) / 10 : null };
  }));
  const run = rows.filter((r) => r.type === "Run");
  return { rows, minutes: sum(rows.map((r) => r.minutes)), km: round1(sum(rows.map((r) => r.km ?? 0))), runMinutes: sum(run.map((r) => r.minutes)), runKm: round1(sum(run.map((r) => r.km ?? 0))), add: { minutes: 45, km: 8 } };
})();

export const hardStudy = (() => {
  const g = new Gen(1304);
  const topics: Record<string, string[]> = { Biology: ["Cells", "Genetics", "Ecology", "Evolution"], Chemistry: ["Bonding", "Moles", "Acids", "Kinetics"], History: ["WWI", "Cold War", "Renaissance", "Revolutions"], Spanish: ["Verbs", "Listening", "Vocab", "Reading"], Calculus: ["Limits", "Derivatives", "Integrals", "Series"] };
  const subjects = Object.keys(topics);
  const rows = byDay(Array.from({ length: 50 }, () => {
    const subject = g.pick(subjects);
    return { day: dayIn(g, 9, 11), subject, topic: g.pick(topics[subject] ?? ["Review"]), hours: g.int(1, 7) / 2 };
  }));
  return { rows, hours: sum(rows.map((r) => r.hours)), chemistry: sum(rows.filter((r) => r.subject === "Chemistry").map((r) => r.hours)), add: 2 };
})();

export const hardRenewals = (() => {
  const g = new Gen(1305);
  const carriers = ["Travelers", "Chubb", "Hartford", "Zurich", "AIG"];
  const rows = byDay(g.sample(COMPANIES, 50).map((client, i) => ({ policy: `PL-${1001 + i}`, client, carrier: g.pick(carriers), line: g.pick(["Property", "Auto", "Liability", "Workers Comp"]), premium: g.step(2_000, 90_000, 50), day: dayIn(g, 1, 12), status: g.weighted(["Quoted", "Bound", "Pending", "Lost"], [3, 4, 3, 1]) }))).map((r, i) => ({ ...r, policy: `PL-${1001 + i}` }));
  const of = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f);
  const q3 = of((r) => quarterOf(r.day) === 3);
  return { rows, premium: sum(rows.map((r) => r.premium)), chubb: sum(of((r) => r.carrier === "Chubb").map((r) => r.premium)), bound: of((r) => r.status === "Bound").length, add: { client: "Lakeside Dental", premium: 12_500 }, q3: sum(q3.map((r) => r.premium)), q3Count: q3.length };
})();

export const hardDeals = (() => {
  const g = new Gen(1306);
  const owners = ["Priya", "Marco", "Jen", "Tomas", "Aisha"];
  const rows = g.sample(COMPANIES, 50).map((account, i) => {
    const value = g.step(4_000, 180_000, 500);
    return { id: `D-${201 + i}`, account, owner: g.pick(owners), stage: g.weighted(["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"], [3, 3, 3, 2, 2, 1]), value, cost: Math.round((value * g.int(35, 80)) / 100), close: g.pick(["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) };
  });
  const open = (r: (typeof rows)[number]) => r.stage !== "Won" && r.stage !== "Lost";
  const marco = rows.filter((r) => r.owner === "Marco");
  return { rows, total: sum(rows.map((r) => r.value)), open: sum(rows.filter(open).map((r) => r.value)), marcoTotal: sum(marco.map((r) => r.value)), marcoOpen: sum(marco.filter(open).map((r) => r.value)), margins: rows.map((r) => ({ dollars: r.value - r.cost, percent: ((r.value - r.cost) / r.value) * 100 })) };
})();

export const hardTickets = (() => {
  const g = new Gen(1307);
  const agents = ["Ana", "Ben", "Chen", "Dee"];
  const rows = g.sample(TICKET_SUBJECTS, 50).map((subject, i) => ({ id: `#${3101 + i}`, subject, customer: g.pick(COMPANIES), priority: g.weighted(["Urgent", "High", "Normal", "Low"], [1, 3, 5, 2]), agent: g.pick(agents), status: g.weighted(["Open", "Pending", "Solved"], [4, 2, 4]), replyHours: g.int(1, 96) / 4 }));
  const open = rows.filter((r) => r.status === "Open");
  const ana = rows.filter((r) => r.agent === "Ana");
  return {
    rows,
    open: open.length,
    avgReply: sum(rows.map((r) => r.replyHours)) / rows.length,
    urgentIds: rows.filter((r) => r.priority === "Urgent").map((r) => r.id),
    lowSubject: rows.find((r) => r.priority === "Low")!.subject,
    anaOpen: ana.filter((r) => r.status === "Open").length,
    notAna: rows.filter((r) => r.agent !== "Ana").slice(0, 2).map((r) => r.subject),
  };
})();

export const hardStaff = (() => {
  const g = new Gen(1308);
  const rows = g.sample(PEOPLE, 50).map((name) => ({ name, dept: g.weighted(["Engineering", "Sales", "Support", "Marketing", "Finance"], [5, 3, 3, 2, 1]), location: g.pick(["Austin", "Dublin", "Remote"]), salary: g.step(52_000, 210_000, 500), start: g.int(2014, 2026) }));
  const sales = rows.filter((r) => r.dept === "Sales");
  return { rows, headcount: rows.length, payroll: sum(rows.map((r) => r.salary)), sales: sales.length, salesPayroll: sum(sales.map((r) => r.salary)), add: { name: "Robin Vale", salary: 98_000 } };
})();

// ---------------------------------------------------------------------------
// Extreme: about 200 messy rows, passed by name

export interface Supplied {
  /** The list's name, as the app supplies it. */
  name: string;
  columns: string[];
  rows: Row[];
}

/** Writes `count` rows from clean values; the first five rows use each messy format once, so the samples show the mess. */
function supply<T>(name: string, columns: string[], truth: T[], write: (t: T, k: number, g: Gen) => Row, seed: number): Supplied {
  const g = new Gen(seed);
  return { name, columns, rows: truth.map((t, i) => write(t, i < 5 ? i : g.int(0, 59), g)) };
}

/** Five sample rows as JSON lines, for the request text. */
export const samples = (s: Supplied): string => s.rows.slice(0, 5).map((r) => JSON.stringify(r)).join("\n");

const groupSum = <T>(rows: T[], key: (r: T) => string, value: (r: T) => number | null) => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = value(r);
    if (v !== null) out[key(r)] = (out[key(r)] ?? 0) + v;
  }
  return out;
};

export const extremeBudget = (() => {
  const g = new Gen(1401);
  const cats = [...Object.keys(MERCHANTS), "Shopping", "Health"];
  const merchants: Record<string, string[]> = { ...MERCHANTS, Shopping: ["Target", "Amazon", "IKEA", "Uniqlo"], Health: ["CVS", "Walgreens", "Dr. Patel", "Dental Care"] };
  const spend: Record<string, [number, number]> = { ...SPEND, Shopping: [15, 400], Health: [10, 300] };
  const truth = Array.from({ length: 200 }, (_, i) => {
    const category = g.weighted(cats, [5, 4, 3, 2, 2, 3, 1]);
    const [lo, hi] = spend[category] ?? [10, 100];
    return { id: `TX-${String(i + 1).padStart(4, "0")}`, day: dayIn(g, 1, 12), merchant: g.pick(merchants[category] ?? ["Store"]), category, blankCategory: g.chance(0.05) || i === 3, account: g.pick(["Checking", "Credit card", "Savings"]), amount: g.int(lo, hi), blankAmount: g.chance(0.04) || i === 4 };
  });
  const data = supply("transactions", ["id", "date", "merchant", "category", "amount", "account"], truth, (t, k) => ({ id: t.id, date: messyDate(t.day, k), merchant: t.merchant, category: t.blankCategory ? blank(k) : t.category, amount: t.blankAmount ? blank(k) : messyMoney(t.amount, k), account: t.account }), 2401);
  const amt = (t: (typeof truth)[number]) => (t.blankAmount ? null : t.amount);
  const valued = truth.filter((t) => !t.blankAmount);
  return {
    data,
    total: sum(valued.map((t) => t.amount)),
    groceries: groupSum(truth.filter((t) => !t.blankCategory && t.category === "Groceries"), () => "g", amt).g ?? 0,
    groceryIds: truth.filter((t) => !t.blankCategory && t.category === "Groceries").map((t) => t.id),
    q3: sum(valued.filter((t) => quarterOf(t.day) === 3).map((t) => t.amount)),
  };
})();

export const extremeTrip = (() => {
  const g = new Gen(1402);
  const people = ["Maya", "Leo", "Sam", "Priya", "Jonah", "Elif"];
  const cities = ["Lisbon", "Porto", "Seville"];
  const cats = ["Lodging", "Food", "Transport", "Activities", "Drinks"];
  const range: Record<string, [number, number]> = { Lodging: [60, 340], Food: [6, 140], Transport: [4, 120], Activities: [12, 180], Drinks: [5, 90] };
  const truth = Array.from({ length: 200 }, (_, i) => {
    const category = g.weighted(cats, [2, 6, 3, 3, 3]);
    const [lo, hi] = range[category] ?? [10, 100];
    return { id: `E-${String(i + 1).padStart(3, "0")}`, day: dayIn(g, 6, 6), who: g.pick(people), city: g.pick(cities), category, note: g.chance(0.6) ? g.pick(["", "split w/ everyone", "cash", "card", "receipt lost", "tip incl."]) : "", amount: g.int(lo, hi), blankAmount: g.chance(0.04) || i === 4 };
  });
  const data = supply("expenses", ["id", "date", "paid_by", "city", "category", "amount", "note"], truth, (t, k) => ({ id: t.id, date: messyDate(t.day, k), paid_by: messyName(t.who, k), city: t.city, category: t.category, amount: t.blankAmount ? blank(k) : messyMoney(t.amount, k), note: t.note || null }), 2402);
  const valued = truth.filter((t) => !t.blankAmount);
  const paid = groupSum(valued, (t) => t.who, (t) => t.amount);
  return { data, people, total: sum(valued.map((t) => t.amount)), paid, lisbon: groupSum(valued, (t) => t.city, (t) => t.amount).Lisbon ?? 0, lisbonIds: truth.filter((t) => t.city === "Lisbon").map((t) => t.id) };
})();

export const extremeWorkouts = (() => {
  const g = new Gen(1403);
  const km: Record<string, [number, number] | null> = { Run: [3, 25], Bike: [10, 90], Swim: [1, 5], Strength: null, Yoga: null };
  const types = Object.keys(km);
  const truth = Array.from({ length: 200 }, (_, i) => {
    const type = g.weighted(types, [5, 3, 2, 3, 1]);
    const range = km[type];
    return { id: `S-${String(i + 1).padStart(3, "0")}`, day: dayIn(g, 1, 12), type, minutes: g.int(15, 150), blankMinutes: g.chance(0.04) || i === 3, km: range ? g.int(range[0] * 10, range[1] * 10) / 10 : null, hr: g.chance(0.15) ? null : g.int(105, 172) };
  });
  const data = supply("sessions", ["id", "date", "type", "minutes", "distance_km", "avg_hr"], truth, (t, k) => ({ id: t.id, date: messyDate(t.day, k), type: t.type, minutes: t.blankMinutes ? blank(k) : messyMinutes(t.minutes, k), distance_km: t.km === null ? blank(k) : k % 2 ? `${t.km} km` : String(t.km), avg_hr: t.hr }), 2403);
  const timed = truth.filter((t) => !t.blankMinutes);
  const runs = truth.filter((t) => t.type === "Run" && t.km !== null && !t.blankMinutes);
  return { data, minutes: sum(timed.map((t) => t.minutes)), runMinutes: sum(timed.filter((t) => t.type === "Run").map((t) => t.minutes)), runIds: truth.filter((t) => t.type === "Run").map((t) => t.id), paces: runs.map((t) => t.minutes / (t.km ?? 1)) };
})();

export const extremeStudy = (() => {
  const g = new Gen(1404);
  const topics: Record<string, string[]> = { Math: ["Algebra", "Geometry", "Calculus", "Stats"], Chemistry: ["Bonding", "Moles", "Acids", "Kinetics", "Organic"], History: ["WWI", "Cold War", "Renaissance"], Spanish: ["Verbs", "Listening", "Vocab"], Physics: ["Motion", "Waves", "Circuits", "Optics"] };
  const subjects = Object.keys(topics);
  const truth = Array.from({ length: 200 }, (_, i) => {
    const subject = g.pick(subjects);
    return { id: `L-${String(i + 1).padStart(3, "0")}`, day: dayIn(g, 1, 6), subject, topic: g.pick(topics[subject] ?? ["Review"]), minutes: g.step(15, 180, 5), blankMinutes: g.chance(0.04) || i === 4, focus: g.chance(0.2) ? null : g.int(1, 5) };
  });
  const data = supply("study_log", ["id", "date", "subject", "topic", "minutes", "focus"], truth, (t, k) => ({ id: t.id, date: messyDate(t.day, k), subject: messyName(t.subject, k), topic: t.topic, minutes: t.blankMinutes ? blank(k) : messyMinutes(t.minutes, k), focus: t.focus }), 2404);
  const timed = truth.filter((t) => !t.blankMinutes);
  return { data, hours: sum(timed.map((t) => t.minutes)) / 60, chemistry: sum(timed.filter((t) => t.subject === "Chemistry").map((t) => t.minutes)) / 60, chemistryIds: truth.filter((t) => t.subject === "Chemistry").map((t) => t.id) };
})();

export const extremeClaims = (() => {
  const g = new Gen(1405);
  const truth = Array.from({ length: 200 }, (_, i) => {
    const status = g.weighted(["Open", "In review", "Approved", "Denied"], [3, 3, 4, 1]);
    const claimed = g.int(300, 48_000);
    return { id: `CLM-${20001 + i}`, day: dayIn(g, 1, 10), policy: `POL-${g.int(100000, 999999)}`, claimant: g.pick(PEOPLE), type: g.weighted(["Auto", "Property", "Liability", "Health"], [4, 3, 2, 2]), claimed, paid: status === "Approved" ? Math.round((claimed * g.int(40, 100)) / 100) : null, status, adjuster: g.pick(["R. Osei", "K. Lindqvist", "M. Haddad", "J. Ortiz", "S. Mehta"]) };
  });
  const data = supply("claims", ["claim_id", "filed", "policy", "claimant", "type", "amount_claimed", "amount_paid", "status", "adjuster"], truth, (t, k) => ({ claim_id: t.id, filed: messyDate(t.day, k), policy: t.policy, claimant: t.claimant, type: t.type, amount_claimed: messyMoney(t.claimed, k), amount_paid: t.paid === null ? blank(k) : messyMoney(t.paid, k + 2), status: messyName(t.status, k), adjuster: t.adjuster }), 2405);
  const big = truth.filter((t) => t.claimed > 10_000);
  return { data, claimed: sum(truth.map((t) => t.claimed)), auto: sum(truth.filter((t) => t.type === "Auto").map((t) => t.claimed)), autoIds: truth.filter((t) => t.type === "Auto").map((t) => t.id), bigCount: big.length, bigClaimed: sum(big.map((t) => t.claimed)) };
})();

export const extremeRenewals = (() => {
  const g = new Gen(1406);
  const carriers = ["Travelers", "Chubb", "Hartford", "Zurich", "AIG", "Liberty Mutual"];
  const truth = g.sample(COMPANIES, 200).map((client, i) => ({ id: `RN-${5001 + i}`, client, carrier: g.pick(carriers), line: g.pick(["Property", "Auto", "Liability", "Workers Comp", "Cyber"]), premium: g.int(1_500, 140_000), blankPremium: g.chance(0.03) || i === 4, day: dayIn(g, 1, 12), status: g.weighted(["Not started", "Quoted", "Bound", "Lost"], [3, 4, 4, 1]), broker: g.pick(["Hale", "Ng", "Brooks", "Okoye"]) }));
  const data = supply("renewals", ["policy", "client", "carrier", "line", "premium", "expires", "status", "broker"], truth, (t, k) => ({ policy: t.id, client: t.client, carrier: messyName(t.carrier, k), line: t.line, premium: t.blankPremium ? blank(k) : messyMoney(t.premium, k), expires: messyDate(t.day, k), status: t.status, broker: t.broker }), 2406);
  const valued = truth.filter((t) => !t.blankPremium);
  return { data, premium: sum(valued.map((t) => t.premium)), chubb: sum(valued.filter((t) => t.carrier === "Chubb").map((t) => t.premium)), chubbIds: truth.filter((t) => t.carrier === "Chubb").map((t) => t.id), q3: sum(valued.filter((t) => quarterOf(t.day) === 3).map((t) => t.premium)) };
})();

export const extremeBva = (() => {
  const g = new Gen(1407);
  const depts = ["Engineering", "Sales", "Marketing", "Support", "Finance", "Operations"];
  const accounts = ["Salaries", "Contractors", "Software", "Travel", "Events", "Equipment", "Training", "Rent"];
  const truth = Array.from({ length: 200 }, (_, i) => {
    const dept = depts[i % depts.length] ?? "Sales";
    const budget = g.step(1_000, 90_000, 100);
    return { cc: `CC-${100 + (i % 24)}`, dept, account: g.pick(accounts), month: g.int(1, 6), budget, actual: Math.round((budget * g.int(70, 135)) / 100), blankActual: g.chance(0.05) || i === 4 };
  });
  const rows = g.shuffle(truth).map((t, i) => ({ ...t, line: `GL-${String(i + 1).padStart(4, "0")}` }));
  const data = supply("ledger", ["line", "cost_center", "dept", "account", "month", "budget", "actual"], rows, (t, k) => ({ line: t.line, cost_center: t.cc, dept: t.dept, account: t.account, month: messyMonth(t.month, k), budget: messyMoney(t.budget, k), actual: t.blankActual ? blank(k) : messyMoney(t.actual, k + 1) }), 2407);
  const mkt = rows.filter((t) => t.dept === "Marketing");
  return { data, budget: sum(rows.map((t) => t.budget)), actual: sum(rows.filter((t) => !t.blankActual).map((t) => t.actual)), mktBudget: sum(mkt.map((t) => t.budget)), mktActual: sum(mkt.filter((t) => !t.blankActual).map((t) => t.actual)), mktIds: mkt.map((t) => t.line) };
})();

export const extremeTickets = (() => {
  const g = new Gen(1408);
  const truth = Array.from({ length: 200 }, (_, i) => ({ id: `T-${7001 + i}`, day: dayIn(g, 7, 11), customer: g.pick(COMPANIES), subject: g.pick(TICKET_SUBJECTS), priority: g.weighted(["Urgent", "High", "Normal", "Low"], [1, 3, 5, 2]), agent: g.pick(["Ana", "Ben", "Chen", "Dee", "Eli"]), status: g.weighted(["Open", "Pending", "Solved", "Closed"], [3, 2, 4, 2]), reply: g.chance(0.06) ? null : g.int(1, 120) / 4, csat: g.chance(0.6) ? null : g.int(1, 5) }));
  const data = supply("tickets", ["id", "opened", "customer", "subject", "priority", "agent", "status", "first_reply_hours", "csat"], truth, (t, k) => ({ id: t.id, opened: messyDate(t.day, k), customer: t.customer, subject: t.subject, priority: messyName(t.priority, k), agent: t.agent, status: t.status, first_reply_hours: t.reply, csat: t.csat }), 2408);
  const open = truth.filter((t) => t.status === "Open");
  return { data, open: open.length, urgentIds: truth.filter((t) => t.priority === "Urgent").map((t) => t.id) };
})();
