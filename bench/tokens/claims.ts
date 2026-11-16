/**
 * The fixed claims dataset for benchmark request 7: 40 claims, 12 monthly rows
 * and 6 by-line rows. Generated from a seed so every run, every variant and
 * every machine sees the same numbers; the monthly and by-line rows are
 * worked out from the claims, so they agree with them.
 */

export interface Claim { id: string; opened: string; line: string; site: string; status: string; incurred: number; days: number }
export interface MonthRow { month: string; opened: number; closed: number; incurred: number }
export interface LineRow { line: string; count: number; incurred: number }

export const LINES = ["Auto", "Property", "Liability", "Workers comp", "Marine", "Cyber"] as const;
export const SITES = ["Phoenix", "Denver", "Austin", "Seattle"] as const;
export const STATUSES = ["Open", "In review", "Closed", "Denied"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** mulberry32: a small seeded generator, so the data never changes. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(): { claims: Claim[]; monthly: MonthRow[]; byLine: LineRow[] } {
  const r = rng(20261116);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const claims: Claim[] = [];
  for (let i = 0; i < 40; i++) {
    const month = Math.floor(r() * 12);
    const day = 1 + Math.floor(r() * 28);
    claims.push({
      id: `CL-${1001 + i}`,
      opened: `2025-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      line: pick(LINES),
      site: pick(SITES),
      status: pick(STATUSES),
      incurred: Math.round(500 + r() * 49500),
      days: 1 + Math.floor(r() * 120),
    });
  }
  const monthly: MonthRow[] = MONTHS.map((m, i) => {
    const mm = `2025-${String(i + 1).padStart(2, "0")}`;
    const opened = claims.filter((c) => c.opened.startsWith(mm));
    // A claim counts as closed in the month it was opened plus its days, if it's closed.
    const closed = claims.filter((c) => c.status === "Closed" && closedMonth(c) === i);
    return { month: m, opened: opened.length, closed: closed.length, incurred: opened.reduce((n, c) => n + c.incurred, 0) };
  });
  const byLine: LineRow[] = LINES.map((line) => {
    const of = claims.filter((c) => c.line === line);
    return { line, count: of.length, incurred: of.reduce((n, c) => n + c.incurred, 0) };
  });
  return { claims, monthly, byLine };
}

function closedMonth(c: Claim): number {
  const m = Number(c.opened.slice(5, 7)) - 1;
  return Math.min(11, m + Math.floor(c.days / 30));
}

export const CLAIMS_DATA = build();

/** The data as SayShape state literals, one line each, the way a model would paste it. */
export function claimsAsJson(): string {
  return JSON.stringify(CLAIMS_DATA);
}
