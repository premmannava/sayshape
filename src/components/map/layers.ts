/**
 * Regional context drawn under pins: lakes, rivers, city names and a scale
 * bar. Natural Earth 1:50m (public domain), pre-projected with the same Web
 * Mercator as the country outlines by `npm run build:world`.
 *
 * Each layer is ranked by Natural Earth's scalerank (0 = most important), so
 * a world view stays quiet and smaller features appear as people zoom in.
 */
import water from "./water.json";
import places from "./places.json";

type Ranked = Array<[number, string]>;
const WATER = water as unknown as { lakes: Ranked; rivers: Ranked };
/** [name, x, y, scalerank], most important first. */
export const PLACES = places as unknown as ReadonlyArray<readonly [string, number, number, number]>;

let lakePaths: Array<[number, Path2D]> | null = null;
let riverPaths: Array<[number, Path2D]> | null = null;
const toPaths = (ranked: Ranked) => ranked.map(([rank, d]) => [rank, new Path2D(d)] as [number, Path2D]);

/** The smallest zoom at which a lake of this rank is drawn. */
export const lakeZoom = (rank: number) => rank <= 1 ? 1 : 2 ** (rank - 1);
/** Rivers wait until a region is in view, then fill in by rank. */
export const riverZoom = (rank: number) => [2.5, 2.5, 4, 6, 10, 16, 24][Math.min(6, rank)]!;
/** Cities are named only from regional zoom, more of them the closer you get. */
export const placeZoom = (rank: number) => rank <= 1 ? 3 : rank === 2 ? 4 : rank === 3 ? 8 : rank === 4 ? 16 : 40;

export function lakes(zoom: number): Path2D[] {
  lakePaths ??= toPaths(WATER.lakes);
  return lakePaths.filter(([rank]) => zoom >= lakeZoom(rank)).map(([, path]) => path);
}

export function rivers(zoom: number): Path2D[] {
  riverPaths ??= toPaths(WATER.rivers);
  return riverPaths.filter(([rank]) => zoom >= riverZoom(rank)).map(([, path]) => path);
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PlacedName { name: string; x: number; y: number; dotX: number; dotY: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * City names in view, most important first, skipping any that would overlap
 * a name already placed or anything in `avoid` (pins, their labels, controls).
 * Coordinates are relative to the map box.
 */
export function placeNames(
  zoom: number, toScreen: (x: number, y: number) => [number, number],
  width: number, height: number, measure: (text: string) => number,
  avoid: readonly Rect[], max = 24,
): PlacedName[] {
  const placed: PlacedName[] = [];
  const taken: Rect[] = [...avoid];
  for (const [name, wx, wy, rank] of PLACES) {
    if (placed.length >= max) break;
    if (zoom < placeZoom(rank)) continue;
    const [x, y] = toScreen(wx, wy);
    if (x < 4 || y < 8 || x > width - 4 || y > height - 8) continue;
    const w = measure(name);
    const rect = { x: x - 3, y: y - 8, w: w + 10, h: 16 };
    if (rect.x + rect.w > width - 2 || taken.some((r) => overlaps(r, rect))) continue;
    taken.push(rect);
    placed.push({ name, x: x + 5, y, dotX: x, dotY: y });
  }
  return placed;
}

/** A round distance in miles that fits within `maxPx`, with its length in pixels. */
export function scaleBar(metersPerPx: number, maxPx: number): { px: number; miles: number; km: number } | null {
  if (!(metersPerPx > 0) || !Number.isFinite(metersPerPx)) return null;
  const maxMiles = (maxPx * metersPerPx) / 1609.344;
  const step = 10 ** Math.floor(Math.log10(maxMiles));
  const miles = [5, 2, 1].map((m) => m * step).find((m) => m <= maxMiles) ?? step;
  const px = (miles * 1609.344) / metersPerPx;
  return { px, miles, km: Math.round(miles * 1.609344) || Math.round(miles * 1.609344 * 10) / 10 };
}
