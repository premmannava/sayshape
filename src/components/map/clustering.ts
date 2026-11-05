/** Dependency-free grouping of screen-space locations into stable visible clusters. */
export interface Positioned<T> { item: T; x: number; y: number }
export interface Cluster<T> { x: number; y: number; items: T[] }

/**
 * Uses a uniform spatial grid to look for nearby clusters, rather than
 * comparing every point against every other point. Order is deterministic.
 */
export function clusterPoints<T>(points: readonly Positioned<T>[], radius = 42): Cluster<T>[] {
  if (!Number.isFinite(radius) || radius <= 0) return points.map((p) => ({ x: p.x, y: p.y, items: [p.item] }));
  const grid = new Map<string, Cluster<T>[]>();
  const out: Cluster<T>[] = [];
  const cell = (n: number) => Math.floor(n / radius);
  const key = (x: number, y: number) => x + ":" + y;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const cx = cell(point.x), cy = cell(point.y);
    let nearest: Cluster<T> | undefined;
    let best = radius * radius;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const candidate of grid.get(key(x, y)) ?? []) {
          const d = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
          if (d < best) { nearest = candidate; best = d; }
        }
      }
    }
    if (nearest) {
      const count = nearest.items.length;
      nearest.x = (nearest.x * count + point.x) / (count + 1);
      nearest.y = (nearest.y * count + point.y) / (count + 1);
      nearest.items.push(point.item);
      // Put the updated centroid in its new spatial cell too.
      const bucket = grid.get(key(cell(nearest.x), cell(nearest.y))) ?? [];
      if (!bucket.includes(nearest)) {
        bucket.push(nearest);
        grid.set(key(cell(nearest.x), cell(nearest.y)), bucket);
      }
    } else {
      const group = { x: point.x, y: point.y, items: [point.item] };
      out.push(group);
      const id = key(cx, cy);
      const bucket = grid.get(id) ?? [];
      bucket.push(group);
      grid.set(id, bucket);
    }
  }
  return out;
}
