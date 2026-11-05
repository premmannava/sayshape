/**
 * Optional state boundary outlines, drawn only when zoomed in.
 * Geometry: Natural Earth Admin1 US states, public domain (PDDL),
 * https://github.com/datasets/geo-admin1-us
 *
 * Paths are pre-projected using the same Natural Earth I projection as the
 * world basemap. No runtime GIS library, tile server or API is required.
 */
import data from "./states.json";

let paths: Path2D[] | null = null;
export function stateBoundaryPaths(): readonly Path2D[] {
  if (!paths) paths = data.states.map(([, svg]) => new Path2D(svg));
  return paths;
}
