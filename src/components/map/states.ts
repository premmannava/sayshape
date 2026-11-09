/**
 * Optional US state borders, drawn only when zoomed in.
 * Geometry: US Census state boundaries, public domain, via us-atlas.
 * Each state keeps only the borders it shares with another state, so
 * coastlines and the national border come from the country layer alone.
 *
 * Paths are pre-projected with the same Web Mercator projection as the
 * world basemap. No runtime GIS library, tile server or API is required.
 */
import data from "./states.json";

let paths: Path2D[] | null = null;
export function stateBoundaryPaths(): readonly Path2D[] {
  if (!paths) paths = data.states.filter(([, svg]) => svg).map(([, svg]) => new Path2D(svg));
  return paths;
}
