/**
 * shake= on a group or a scene: its contents jolt by up to that many scene
 * pixels, for an impact (shake={14*(1 - ease(t, 1.2, 1.6))} settles after a
 * hit). The jolts come from a seeded hash of the line and the scene's time, so
 * the same moment always shakes the same way; with motion off, nothing moves.
 */

/** Jolts per second: quick enough to read as a shake, slow enough not to flicker. */
const JOLTS = 24;
/** The most a shake moves anything, in scene pixels. */
export const MAX_SHAKE = 200;

/** A repeatable number in [0, 1) for two integers. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A seed from a line's id ("12:group"), so each shaking line moves its own way. */
export function shakeSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How far to move the contents at this time: up to amount pixels each way, eased between jolts. */
export function shakeOffset(amount: number, seed: number, time: number): [number, number] {
  const a = Math.min(MAX_SHAKE, Math.max(0, amount));
  if (!(a > 0) || !Number.isFinite(time)) return [0, 0];
  const u = time * JOLTS, k = Math.floor(u), f = u - k, s = f * f * (3 - 2 * f);
  const at = (i: number, axis: number) => hash(seed + axis, i) * 2 - 1;
  const dx = at(k, 0) + (at(k + 1, 0) - at(k, 0)) * s;
  const dy = at(k, 1) + (at(k + 1, 1) - at(k, 1)) * s;
  return [dx * a, dy * a];
}
