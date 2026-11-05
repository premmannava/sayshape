/**
 * Pure geographic data helpers. No Canvas, external tiles or charting libraries.
 * The model provides field names; the runtime owns aggregation and scales.
 */
import { fieldOf, isList, isRecord, toNumber } from "../../data";
import type { Value } from "../../types";

export interface RegionValues {
  readonly values: ReadonlyMap<string, number>;
  readonly min: number;
  readonly max: number;
  readonly ignored: number;
  readonly unmatched: string[];
}

export interface BubbleDatum {
  label: string;
  lat: number;
  lon: number;
  value: number;
}
export interface BubbleValues {
  readonly points: BubbleDatum[];
  readonly min: number;
  readonly max: number;
  readonly ignored: number;
}

// Explicit common aliases only. Never guess a region from an unrelated name.
const ALIASES: Readonly<Record<string, string>> = {
  us: "unitedstatesofamerica",
  usa: "unitedstatesofamerica",
  unitedstates: "unitedstatesofamerica",
  america: "unitedstatesofamerica",
  uk: "unitedkingdom",
  greatbritain: "unitedkingdom",
  britain: "unitedkingdom",
  southkorea: "southkorea",
  republicofkorea: "southkorea",
  northkorea: "northkorea",
  dprk: "northkorea",
  russia: "russia",
  russianfederation: "russia",
  czechrepublic: "czechia",
  ivorycoast: "cotedivoire",
  turkey: "turkey",
  turkiye: "turkey",
  drcongo: "demrepcongo",
  drc: "demrepcongo",
  democraticrepublicofthecongo: "demrepcongo",
};
export function regionKey(name: string): string {
  const key = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[key] ?? key;
}

function numeric(value: Value | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return NaN;
  return toNumber(value);
}
function label(value: Value | undefined): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function domain(values: readonly number[]): { min: number; max: number } {
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 0 };
}

/** Sum duplicate country rows, skipping unknown geography and nonnumeric values. */
export function regionValues(items: Value | undefined, regionField: string, valueField: string, countryNames: readonly string[]): RegionValues {
  const index = new Map(countryNames.map((name) => [regionKey(name), name] as const));
  const values = new Map<string, number>();
  const unmatched = new Set<string>();
  let ignored = 0;
  if (isList(items)) for (const row of items) {
    if (!isRecord(row)) { ignored++; continue; }
    const region = label(fieldOf(row, regionField));
    const value = numeric(fieldOf(row, valueField));
    if (!region || !Number.isFinite(value)) { ignored++; continue; }
    const country = index.get(regionKey(region));
    if (!country) { unmatched.add(region); ignored++; continue; }
    values.set(country, (values.get(country) ?? 0) + value);
  }
  const { min, max } = domain([...values.values()]);
  return { values, min, max, ignored, unmatched: [...unmatched].slice(0, 5) };
}

/** Read location values directly from a dataset, without expanding a pin node per row. */
export function bubbleValues(items: Value | undefined, latField: string, lonField: string, valueField: string, labelField: string): BubbleValues {
  const points: BubbleDatum[] = [];
  let ignored = 0;
  if (isList(items)) for (const row of items) {
    if (!isRecord(row)) { ignored++; continue; }
    const lat = numeric(fieldOf(row, latField));
    const lon = numeric(fieldOf(row, lonField));
    const value = numeric(fieldOf(row, valueField));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 ||
      !Number.isFinite(value) || value < 0) { ignored++; continue; }
    const name = label(fieldOf(row, labelField));
    points.push({ label: name || lat.toFixed(2) + ", " + lon.toFixed(2), lat, lon, value });
  }
  const { min, max } = domain(points.map((p) => p.value));
  return { points, min, max, ignored };
}

export function fraction(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  // A single value is still visually significant.
  return max === min ? 0.7 : Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** Radius scales with sqrt(value), so visual circle area tracks the numeric measure. */
export function bubbleRadius(value: number, min: number, max: number): number {
  const t = max <= 0 ? 0 : Math.sqrt(Math.max(0, value) / max);
  return 5 + 17 * t;
}

type RGB = readonly [number, number, number];
function rgb(color: string): RGB | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Resolve color tokens once into concrete Canvas colors for data-driven fills. */
export function mixedColor(low: string, high: string, t: number): string {
  const a = rgb(low), b = rgb(high);
  if (!a || !b) return high;
  const k = Math.max(0, Math.min(1, t));
  return "rgb(" + a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(", ") + ")";
}

export function formatMapValue(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
