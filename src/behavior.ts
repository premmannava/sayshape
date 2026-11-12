/**
 * EXPERIMENTAL, opt-in: rules, things that change by themselves.
 *
 *   every 1s if={running && left > 0} do=dec:left
 *
 * A rule runs ordinary action strings on an interval while its condition
 * holds. It may only change state: never emit, navigate or notify, so a spec
 * can't call the app or the model on a timer. It's off unless a host passes
 * `behavior: true`; without it, "every" is an unknown element as before.
 *
 * This file holds the limits and the timing (RuleRunner). Parsing is in
 * parser.ts (parseRuleLine); running actions, and what a tick may not write,
 * is the engine's (it owns the state and knows what the person is holding).
 * Plan: docs/plans/behavior.md.
 */
import type { Action } from "./actions";
import { evaluate, type Scope } from "./expr";
import { RULE_FUNCTIONS } from "./math";

/** The shortest interval: one frame at 60 a second. Shorter ones are raised to it, silently. */
export const MIN_RULE_INTERVAL = 16;
/** The longest interval. Longer ones are lowered to it, silently. */
export const MAX_RULE_INTERVAL = 60_000;
/** The most rules one spec may have; the rest are skipped. */
export const MAX_RULES = 8;
/** The most actions one rule's do= may chain. */
export const MAX_RULE_ACTIONS = 8;
/** The longest a list may grow through a rule's writes (what each shows). */
export const MAX_RULE_LIST = 500;
/** The slowest the slow-down guard takes the floor to. */
export const MAX_RULE_FLOOR = 1000;
/** The share of the floor a tick and its frame may take, on average, before the floor doubles. */
export const RULE_BUSY_SHARE = 0.25;
/** How many ticks the guard averages over. */
export const RULE_BUSY_WINDOW = 20;
/** The operations a rule may run: writes to state only. */
export const RULE_OPS: ReadonlySet<Action["op"]> = new Set(["inc", "dec", "toggle", "set", "add", "remove", "clear"]);
/** The state name the current screen lives in (the engine's SCREEN_KEY): rules can't write it. */
export const SCREEN_STATE = "screen";

/** A rule as parsed: its interval, optional condition, and actions. */
export interface RuleDef {
  line: number;
  /** Interval in ms, already within MIN_RULE_INTERVAL and MAX_RULE_INTERVAL. */
  every: number;
  /** The condition's expression, without braces; undefined means always. */
  if?: string;
  /** The do= action string, as written. */
  do: string;
  actions: Action[];
}

/** Where time comes from. The engine's default is the real one; sayshape/testing passes one a test advances. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Why rules are paused. Any one holds them all. */
export type RulePause = "host" | "hidden" | "offscreen" | "waiting" | "streaming";

export interface RuleRunnerHost {
  clock: Clock;
  /** State, for conditions. */
  scope: Scope;
  /** Run these rules' actions, in order, as one tick. */
  tick(rules: readonly RuleDef[]): void;
  /** Rules were slowed (the floor doubled); say so once. */
  slowed?(floor: number, tickMs: number): void;
  /** Whether any rule is running changed, or the pause did. */
  changed?(): void;
}

interface Armed {
  rule: RuleDef;
  /** When it's next due, while its condition holds; undefined while it doesn't. */
  due?: number;
}

/**
 * Runs rules on their intervals. A rule is armed when its condition turns
 * true (first tick one interval later) and disarmed when it turns false.
 * Rules due at the same moment run in written order, as one tick. Missed
 * ticks are dropped, never run in a burst.
 */
export class RuleRunner {
  private armed: Armed[] = [];
  private timer: unknown = null;
  private pauses = new Set<RulePause>();
  private floor = MIN_RULE_INTERVAL;
  private costs: number[] = [];
  private ticking = false;
  private recheck = false;
  /** The work since the last tick began: the tick itself and every frame drawn until the next one. */
  private pendingTick: number | null = null;

  constructor(private host: RuleRunnerHost) {}

  /** Start these rules (a complete spec). Rules the same as the running ones keep their timing. */
  set(rules: readonly RuleDef[]): void {
    const same = rules.length === this.armed.length && rules.every((r, i) => sameRule(r, this.armed[i]!.rule));
    if (same) { this.armed.forEach((a, i) => { a.rule = rules[i]!; }); this.check(); return; }
    this.armed = rules.map((rule) => ({ rule }));
    this.floor = MIN_RULE_INTERVAL;
    this.costs = [];
    this.check();
  }

  /** Stop and forget every rule. */
  clear(): void {
    this.armed = [];
    this.schedule();
    this.host.changed?.();
  }

  get count(): number { return this.armed.length; }
  /** How many rules are armed (their condition holds) right now. */
  get running(): number { return this.armed.filter((a) => a.due !== undefined).length; }
  get paused(): boolean { return this.pauses.size > 0; }
  isPausedFor(reason: RulePause): boolean { return this.pauses.has(reason); }
  /** The interval rules faster than it are slowed to (MIN_RULE_INTERVAL until the guard raises it). */
  get currentFloor(): number { return this.floor; }

  pause(reason: RulePause): void {
    if (this.pauses.has(reason)) return;
    this.pauses.add(reason);
    this.schedule();
    this.host.changed?.();
  }

  /** Lift a pause. When none is left, each running rule's next tick is one interval from now (no catch-up). */
  resume(reason: RulePause): void {
    if (!this.pauses.delete(reason)) return;
    if (!this.pauses.size) {
      const now = this.host.clock.now();
      for (const a of this.armed) if (a.due !== undefined) a.due = now + this.interval(a.rule);
    }
    this.schedule();
    this.host.changed?.();
  }

  /** State changed: arm rules whose condition turned true, disarm those that turned false. */
  check(): void {
    if (this.ticking) { this.recheck = true; return; }
    const now = this.host.clock.now();
    let changed = false;
    for (const a of this.armed) {
      const on = this.holds(a.rule);
      if (on && a.due === undefined) { a.due = now + this.interval(a.rule); changed = true; }
      else if (!on && a.due !== undefined) { a.due = undefined; changed = true; }
    }
    this.schedule();
    if (changed) this.host.changed?.();
  }

  /**
   * A frame took this long. Every frame between one tick and the next counts
   * toward that tick, for the guard: a change that animates (a progress bar
   * easing to its new value) costs several frames, not one.
   */
  frameCost(ms: number): void {
    if (this.pendingTick !== null) this.pendingTick += ms;
  }

  private holds(rule: RuleDef): boolean {
    if (rule.if === undefined) return true;
    const r = evaluate(rule.if, this.host.scope, RULE_FUNCTIONS);
    return r.ok && !!r.value;
  }

  /** A rule's interval now: as written, or the floor if it's faster than that. */
  private interval(rule: RuleDef): number {
    return Math.max(rule.every, this.floor);
  }

  private schedule(): void {
    const clock = this.host.clock;
    if (this.timer !== null) { clock.clearTimeout(this.timer); this.timer = null; }
    if (this.pauses.size) return;
    let next = Infinity;
    for (const a of this.armed) if (a.due !== undefined && a.due < next) next = a.due;
    if (next === Infinity) return;
    this.timer = clock.setTimeout(() => { this.timer = null; this.run(); }, Math.max(0, next - clock.now()));
  }

  private run(): void {
    if (this.pauses.size) return;
    const clock = this.host.clock;
    const now = clock.now();
    const due = this.armed.filter((a) => a.due !== undefined && a.due <= now + 0.5);
    if (due.length) {
      if (this.pendingTick !== null) this.note(this.pendingTick);
      const started = clock.now();
      this.ticking = true;
      try {
        // A condition can turn false between checks within one batch (an earlier rule's write).
        this.host.tick(due.filter((a) => this.holds(a.rule)).map((a) => a.rule));
      } finally {
        this.ticking = false;
      }
      this.pendingTick = clock.now() - started;
      for (const a of due) {
        if (a.due === undefined) continue;
        const next = a.due + this.interval(a.rule);
        // Late (a stall): one interval from now, never a burst of the ticks missed.
        a.due = next <= now ? now + this.interval(a.rule) : next;
      }
    }
    this.recheck = false;
    this.check();
  }

  private note(ms: number): void {
    this.costs.push(ms);
    if (this.costs.length > RULE_BUSY_WINDOW) this.costs.shift();
    if (this.costs.length < RULE_BUSY_WINDOW || !this.armed.length) return;
    const avg = this.costs.reduce((s, c) => s + c, 0) / this.costs.length;
    // Judged against the fastest interval actually running.
    const fastest = Math.max(this.floor, Math.min(...this.armed.map((a) => a.rule.every)));
    if (avg <= fastest * RULE_BUSY_SHARE || fastest >= MAX_RULE_FLOOR) return;
    // Raise the floor past it, in one step: doubled until a tick fits its share. Only rules
    // faster than the floor are slowed: a 1 s countdown stays 1 s.
    let floor = fastest * 2;
    while (floor * RULE_BUSY_SHARE < avg && floor < MAX_RULE_FLOOR) floor *= 2;
    this.floor = Math.min(MAX_RULE_FLOOR, floor);
    this.costs = [];
    this.host.slowed?.(this.floor, avg);
  }
}

function sameRule(a: RuleDef, b: RuleDef): boolean {
  return a.every === b.every && a.if === b.if && a.do === b.do;
}
