/**
 * Scalar motion for the SayShape canvas renderer.
 *
 * Components share this clock instead of owning timers. Weak ownership means
 * old parsed screens are released automatically. A first render is already
 * at its real value; only subsequent changes animate.
 */
import { easeOut } from "./ghost";

interface Track { from: number; to: number; start: number; duration: number }

function sample(s: Track, at: number): number {
  if (s.duration <= 0) return s.to;
  const t = Math.max(0, Math.min(1, (at - s.start) / s.duration));
  return s.from + (s.to - s.from) * easeOut(t);
}

export class MotionValues {
  private nodes = new WeakMap<object, Map<string, Track>>();

  value(node: object, key: string, target: number, at: number, duration: number, enabled: boolean, frame: () => void): number {
    if (!Number.isFinite(target)) return 0;
    let values = this.nodes.get(node);
    if (!values) { values = new Map(); this.nodes.set(node, values); }
    const previous = values.get(key);
    if (!enabled || !Number.isFinite(at) || !Number.isFinite(duration) || duration <= 0) {
      values.set(key, { from: target, to: target, start: at, duration: 0 });
      return target;
    }
    if (!previous) {
      values.set(key, { from: target, to: target, start: at, duration });
      return target;
    }
    if (previous.to !== target) {
      const current = sample(previous, at);
      values.set(key, { from: current, to: target, start: at, duration });
      if (current !== target) frame();
      return current;
    }
    const current = sample(previous, at);
    if (current !== target && at < previous.start + previous.duration) frame();
    return current;
  }
}
