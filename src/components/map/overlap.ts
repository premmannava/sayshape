/** Screen-space collision detection and spiderfied marker geometry. Pure math, no DOM. */
export interface Circle { x: number; y: number; radius: number }
export interface SpiderPoint { index: number; x: number; y: number; sourceX: number; sourceY: number }

/** Connected collision groups; covers partial overlap and truly identical coordinates. */
export function overlappingGroups(circles: readonly Circle[], padding = 4): number[][] {
  const parent = circles.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < circles.length; i++) {
    const a = circles[i]!;
    if (![a.x, a.y, a.radius].every(Number.isFinite)) continue;
    for (let j = i + 1; j < circles.length; j++) {
      const b = circles[j]!;
      if (![b.x, b.y, b.radius].every(Number.isFinite)) continue;
      const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      const threshold = Math.max(0, a.radius) + Math.max(0, b.radius) + padding;
      if (distance <= threshold * threshold) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < circles.length; i++) {
    const groupRoot = root(i);
    const group = groups.get(groupRoot) ?? [];
    group.push(i);
    groups.set(groupRoot, group);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Spread an overlap group around its real projected locations, retaining each
 * member's true anchor for connector lines and geographic correctness.
 * Positions are in box-local CSS pixels. Rings use circle radii for spacing.
 */
export function spiderfy(group: readonly number[], circles: readonly Circle[], width: number, height: number): SpiderPoint[] {
  if (group.length < 2 || width <= 0 || height <= 0) return [];
  const actual = group.filter((i) => !!circles[i]);
  if (actual.length < 2) return [];
  const cx = actual.reduce((v, i) => v + circles[i]!.x, 0) / actual.length;
  const cy = actual.reduce((v, i) => v + circles[i]!.y, 0) / actual.length;
  const radius = Math.max(...actual.map((i) => circles[i]!.radius));
  // Use multiple rings when many items occupy the same coordinate.
  let offset = 0;
  let ring = 0;
  const points: SpiderPoint[] = [];
  while (offset < actual.length) {
    const distance = 56 + ring * (radius * 2 + 24);
    const capacity = Math.max(3, Math.floor((2 * Math.PI * distance) / (2 * radius + 20)));
    const count = Math.min(capacity, actual.length - offset);
    for (let j = 0; j < count; j++) {
      const index = actual[offset + j]!;
      const anchor = circles[index]!;
      const angle = -Math.PI / 2 + (2 * Math.PI * j) / count + ring * 0.15;
      const inset = Math.min(14 + anchor.radius, Math.max(2, Math.min(width, height) / 2));
      points.push({
        index,
        x: Math.min(width - inset, Math.max(inset, cx + Math.cos(angle) * distance)),
        y: Math.min(height - inset, Math.max(inset, cy + Math.sin(angle) * distance)),
        sourceX: anchor.x, sourceY: anchor.y,
      });
    }
    offset += count;
    ring++;
  }
  return points;
}
