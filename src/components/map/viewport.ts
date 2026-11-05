/** Pure, dependency-free map viewport calculations in Canvas CSS pixels. */
export interface Viewport {
  zoom: number;
  dx: number;
  dy: number;
}

export interface Point { x: number; y: number }

export const MAX_ZOOM = 48;
export const worldView = (): Viewport => ({ zoom: 1, dx: 0, dy: 0 });
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function constrain(view: Viewport, width: number, height: number): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, finite(view.zoom, 1)));
  // The projected world fills the view at zoom=1, and may be panned only at higher zoom.
  const minX = width * (1 - zoom);
  const minY = height * (1 - zoom);
  return {
    zoom,
    dx: Math.min(0, Math.max(minX, finite(view.dx, 0))),
    dy: Math.min(0, Math.max(minY, finite(view.dy, 0))),
  };
}

export function zoomAt(view: Viewport, factor: number, x: number, y: number, width: number, height: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return view;
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * factor));
  const ratio = zoom / view.zoom;
  // Keep the projected point underneath the pointer stationary.
  return constrain({
    zoom,
    dx: x - (x - view.dx) * ratio,
    dy: y - (y - view.dy) * ratio,
  }, width, height);
}

export function panBy(view: Viewport, dx: number, dy: number, width: number, height: number): Viewport {
  return constrain({ zoom: view.zoom, dx: view.dx + dx, dy: view.dy + dy }, width, height);
}

/** Fit projected coordinates (world units, not pixels) with room for markers and labels. */
export function fitPins(points: readonly Point[], width: number, height: number, worldWidth: number): Viewport {
  if (!points.length || width <= 0 || height <= 0 || worldWidth <= 0) return worldView();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const base = width / worldWidth;
  // A single point should zoom to regional context, not a giant empty pixel.
  const zoom = points.length === 1 ? 8 : Math.min(
    MAX_ZOOM,
    Math.max(1, (width - 64) / (Math.max(1, maxX - minX) * base)),
    Math.max(1, (height - 64) / (Math.max(1, maxY - minY) * base)),
  );
  // The smaller fitted dimension limits zoom.
  const fittedZoom = points.length === 1 ? zoom : Math.min(
    MAX_ZOOM,
    Math.max(1, Math.min(
      (width - 64) / (Math.max(1, maxX - minX) * base),
      (height - 64) / (Math.max(1, maxY - minY) * base),
    )),
  );
  return constrain({
    zoom: fittedZoom,
    dx: width / 2 - ((minX + maxX) / 2) * base * fittedZoom,
    dy: height / 2 - ((minY + maxY) / 2) * base * fittedZoom,
  }, width, height);
}
