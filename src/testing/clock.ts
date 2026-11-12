/**
 * A clock a test advances by hand, so nothing in a test waits on real time:
 * rules' ticks, scene motion (t) and fade-ins all read it.
 */
import type { Clock } from "../behavior";

interface Timer { at: number; seq: number; fn: () => void }

export class ManualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, Timer>();

  /** Called after each timer that fires during advance(), so the screen draws between ticks as a browser would. */
  constructor(private afterTimer: () => void = () => {}) {}

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), seq: id, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Move time on by ms, running every timer that falls due on the way, in order. */
  advance(ms: number): void {
    const end = this.t + Math.max(0, ms);
    for (let guard = 0; guard < 1_000_000; guard++) {
      let next: Timer | undefined;
      let nextId = -1;
      for (const [id, tm] of this.timers) {
        if (tm.at <= end && (!next || tm.at < next.at || (tm.at === next.at && tm.seq < next.seq))) { next = tm; nextId = id; }
      }
      if (!next) break;
      this.timers.delete(nextId);
      this.t = Math.max(this.t, next.at);
      next.fn();
      this.afterTimer();
    }
    this.t = end;
    this.afterTimer();
  }

  /** How many timers are waiting (a test can check that nothing is left running). */
  get pending(): number {
    return this.timers.size;
  }
}
