/**
 * emit: particles in a scene (confetti, snow, sparks, rain, fireworks).
 *
 * Stateless and analytic: nothing is kept between frames. Each particle gets
 * eight seeded random numbers per life (its cycle) and its place is a closed-form
 * function of the scene's time: ballistic motion with linear drag toward the
 * wind (y down),
 *
 *   E = e^(−kτ), A = (1 − E)/k, B = (τ − A)/k
 *   x = x0 + vx0·A + X_wind(τ),  y = y0 + vy0·A + g·B
 *   vx = vx0·E + V_wind(τ),      vy = vy0·E + g·A
 *
 * so the same moment always draws the same picture: seeking, rate= changes,
 * reduced motion's still and looping all come for free. A burst (from=) fires
 * once at that second; without from= each particle respawns on its own cycle,
 * staggered so the scene starts full, with the cycle fitted to a looping
 * scene's duration so the loop is seamless.
 *
 * Wind may be a formula (a let that gusts): it's worked out at 13 moments
 * over the last life span once per frame, and each particle reads the drift
 * that history gives it from a small table, so a frame costs the same however
 * many particles there are.
 *
 * A scene draws at most MAX_SCENE_PARTICLES particles, shared by its emit
 * lines in drawing order; each emit line counts once toward MAX_SCENE_SHAPES.
 * Particles are drawn in batches (one path per color and opacity step), so an
 * emit costs at most ~64 fills or strokes however many particles it has.
 */
import type { ComponentDef, PropDef } from "../../component";
import type { Scope } from "../../expr";
import type { SayShapeNode } from "../../types";
import { colorOf, numOf, strOf, type Frame } from "./draw";
import { shakeSeed } from "./shake";

/** The most particles a scene draws in one frame, over all its emit lines. */
export const MAX_SCENE_PARTICLES = 600;
/** The most colors one emit cycles through. */
const MAX_COLORS = 8;
/** Opacity steps particles are batched by. */
const ALPHA_STEPS = 8;
/** Seconds a new particle takes to fade in, and the share of its life it fades out over. */
const FADE_IN = 0.08, FADE_OUT = 0.25;
/** Seconds a fluttering particle takes to start swaying. */
const SWAY_IN = 0.3;
/** Wind samples per life span (plus one). */
const WIND_STEPS = 12;
/** Numbers kept per particle: x, y, vx, vy, alpha, size, color, angle, squash. */
export const STRIDE = 9;

export type EmitShape = "circle" | "rect" | "line";

/** An emit line's props, worked out for this frame. */
export interface EmitParams {
  count: number;
  /** The second of a single burst, or null for an endless flow. */
  from: number | null;
  x: number; y: number; w: number; h: number;
  /** Degrees: 0 right, 90 down, -90 up. */
  angle: number;
  spread: number;
  speed: number;
  gravity: number;
  /** Linear drag per second: how fast a particle takes the wind's speed. */
  drag: number;
  /** A steady wind in px/s (a formula's history comes in EmitClock.wind instead). */
  wind: number;
  life: number;
  size: number;
  seed: number;
  flutter: number;
  /** How many colors the particles pick from. */
  colors: number;
  shape: EmitShape;
}

/**
 * Drift from a wind that changes over time: the wind w[j] at j·step ago, and
 * the drift pos[j] and speed vel[j] it gives a particle of age j·step.
 */
export interface WindTable { step: number; k: number; w: Float64Array; decay: Float64Array; pos: Float64Array; vel: Float64Array }

/** The scene's clock: a looping scene fits endless flows to its duration. */
export interface EmitClock { duration: number; loop: boolean; wind?: WindTable }

/** A 32-bit integer mix of two integers (portable: Math.imul only). */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be59b) | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const unit = (n: number) => n / 4294967296;
const fract = (v: number) => v - Math.floor(v);

/** Drag's factors at age τ: E = e^(−kτ), A = ∫E, B = ∫A; a series near k = 0, where the closed form loses digits. */
export function dragIntegrals(k: number, tau: number): { E: number; A: number; B: number } {
  const x = k * tau;
  if (Math.abs(x) < 1e-3) {
    return { E: 1 - x + (x * x) / 2, A: tau * (1 - x / 2 + (x * x) / 6), B: tau * tau * (0.5 - x / 6 + (x * x) / 24) };
  }
  const E = Math.exp(-x), A = (1 - E) / k;
  return { E, A, B: (tau - A) / k };
}

/** The length of one particle's cycle in an endless flow: its life, fitted to a looping scene's duration. */
export function cycleOf(life: number, clock: Pick<EmitClock, "duration" | "loop">): number {
  const D = clock.duration;
  if (!clock.loop || !(D > 0)) return life;
  return D / Math.max(1, Math.round(D / life));
}

/**
 * Where every live particle is at scene time t. Writes STRIDE numbers per
 * particle into out (which must hold count × STRIDE) and returns how many.
 */
export function computeParticles(p: EmitParams, t: number, clock: EmitClock, out: Float64Array): number {
  const count = Math.min(p.count, Math.floor(out.length / STRIDE));
  if (!(count > 0) || !Number.isFinite(t)) return 0;
  const D = clock.duration, looping = clock.loop && D > 0;
  const burst = p.from !== null;
  // An endless flow in a looping scene takes its time in [0, D), so its end and its start are the same moment.
  // A burst reads t as it is: the still a scene rests on is t = duration, as every formula sees it.
  const now = looping && !burst ? ((t % D) + D) % D : t;
  const L = burst ? p.life : cycleOf(p.life, clock);
  const K = looping && !burst ? Math.max(1, Math.round(D / L)) : 0;
  const k = p.drag, g = p.gravity, W = p.wind, table = clock.wind;
  const spin = p.flutter > 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    let tau: number, cycle: number;
    if (burst) {
      tau = now - p.from!;
      cycle = 0;
    } else {
      // Staggered through the cycle (one slot each, jittered), so the flow starts full and stays even.
      const phase = (L * (i + unit(mix(p.seed ^ 0x51ed27, i)))) / count;
      const u = (now + phase) / L;
      const whole = Math.floor(u);
      tau = (u - whole) * L;
      cycle = K ? ((whole % K) + K) % K : whole | 0;
    }
    if (tau < 0) continue;
    const base = mix(mix(p.seed, i), cycle);
    const h = (j: number) => unit(mix(base, j));
    const life = L * (0.75 + 0.25 * h(4));
    if (tau >= life) continue;
    const alpha = Math.min(1, tau / FADE_IN) * Math.min(1, (life - tau) / (FADE_OUT * life));
    if (!(alpha > 0)) continue;
    const a = ((p.angle + (h(2) - 0.5) * p.spread) * Math.PI) / 180;
    const speed = p.speed * (0.5 + 0.5 * h(3));
    const vx0 = Math.cos(a) * speed, vy0 = Math.sin(a) * speed;
    const { E, A, B } = dragIntegrals(k, tau);
    let wx: number, wv: number;
    if (table) {
      windDrift(table, tau, DRIFT);
      wx = DRIFT[0]!; wv = DRIFT[1]!;
    } else {
      wx = W * k * B;
      wv = W * (1 - E);
    }
    let x = p.x + h(0) * p.w + vx0 * A + wx;
    const y = p.y + h(1) * p.h + vy0 * A + g * B;
    const size = p.size * (0.6 + 0.4 * h(5));
    const h7 = h(7);
    let angle = 0, squash = 1;
    if (spin && p.shape !== "line") {
      // Flutter: a sideways sway that builds up, a spin, and (for rects) a tumble that shows the edge.
      const ramp = Math.min(1, tau / SWAY_IN);
      x += p.flutter * 1.5 * size * ramp * Math.sin(2 * Math.PI * (0.5 + 0.8 * fract(h7 * 3.7)) * tau + 2 * Math.PI * h7);
      angle = 2 * Math.PI * h7 + p.flutter * (3 + 6 * fract(h7 * 7.31)) * (h(5) > 0.5 ? 1 : -1) * tau;
      if (p.shape === "rect") squash = Math.max(0.12, Math.abs(Math.cos(p.flutter * (4 + 6 * fract(h7 * 13.7)) * tau + 2 * Math.PI * fract(h7 * 5.3))));
    }
    const o = n * STRIDE;
    out[o] = x; out[o + 1] = y;
    out[o + 2] = vx0 * E + wv; out[o + 3] = vy0 * E + g * A;
    out[o + 4] = alpha; out[o + 5] = size;
    out[o + 6] = Math.min(p.colors - 1, Math.floor(h(6) * p.colors));
    out[o + 7] = angle; out[o + 8] = squash;
    n++;
  }
  return n;
}

const DRIFT = new Float64Array(2);

/**
 * ∫ from 0 to d of (w0 + (w1 − w0)·s/d)·e^(−ks) ds: a straight stretch of wind,
 * weighed by how much of it a particle still feels (series near k = 0).
 */
function decayed(k: number, d: number, w0: number, w1: number): number {
  if (!(d > 0)) return 0;
  const { E, A } = dragIntegrals(k, d);
  const x = k * d;
  const I1 = Math.abs(x) < 1e-3 ? d * d * (0.5 - x / 3 + (x * x) / 8) : (A - d * E) / k;
  return w0 * A + ((w1 - w0) / d) * I1;
}

/**
 * The drift a changing wind gives a particle of each age, from the wind at
 * WIND_STEPS + 1 moments back from now (samples[j] at j·step ago), taken as
 * straight between them (exact for that, and for a steady wind):
 *   pos(τ) = ∫ W(t−u)(1 − e^(−ku)) du,  vel(τ) = ∫ k W(t−u) e^(−ku) du,  u from 0 to τ.
 */
export function windTable(samples: ArrayLike<number>, step: number, k: number): WindTable {
  const n = WIND_STEPS + 1;
  const w = Float64Array.from({ length: n }, (_, j) => samples[j] ?? 0);
  const decay = Float64Array.from({ length: n }, (_, j) => Math.exp(-k * j * step));
  const pos = new Float64Array(n), vel = new Float64Array(n);
  for (let j = 1; j < n; j++) {
    const part = decay[j - 1]! * decayed(k, step, w[j - 1]!, w[j]!);
    pos[j] = pos[j - 1]! + (step * (w[j - 1]! + w[j]!)) / 2 - part;
    vel[j] = vel[j - 1]! + k * part;
  }
  return { step, k, w, decay, pos, vel };
}

/** A particle's drift and wind speed at age τ: the table up to the step before, then the rest of the way exactly. */
export function windDrift(table: WindTable, tau: number, out: Float64Array): void {
  const span = WIND_STEPS * table.step;
  const at = Math.max(0, Math.min(span, tau));
  const j = Math.min(WIND_STEPS - 1, Math.floor(at / table.step));
  const d = at - j * table.step;
  const w0 = table.w[j]!, w1 = w0 + (table.w[j + 1]! - w0) * (d / table.step);
  const part = table.decay[j]! * decayed(table.k, d, w0, w1);
  out[0] = table.pos[j]! + (d * (w0 + w1)) / 2 - part;
  out[1] = table.vel[j]! + table.k * part;
}

// ---------- drawing ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BUFFER = new Float64Array(MAX_SCENE_PARTICLES * STRIDE);
const KEYS = new Int16Array(MAX_SCENE_PARTICLES);
const ORDER = new Int16Array(MAX_SCENE_PARTICLES);
const BINS = MAX_COLORS * ALPHA_STEPS;
const STARTS = new Int32Array(BINS + 1);
const NEXT = new Int32Array(BINS);
/** How many times each emit line has drawn this frame, when no copy path tells copies apart. */
const seen = new WeakMap<Frame, Map<string, number>>();

/** "accent, warn, rgb(1, 2, 3)" as colors (commas inside parentheses stay). */
function colorsOf(raw: string, f: Frame): string[] {
  const out: string[] = [];
  for (const part of raw.split(/,(?![^(]*\))/)) {
    const c = colorOf(part, f);
    if (c && out.length < MAX_COLORS) out.push(c);
  }
  return out;
}

/** The wind's value at a scene time: the scene's time is set to it, read, and put back (lets follow f.time). */
function windAt(node: SayShapeNode, scope: Scope, f: Frame, s: number): number {
  const was = f.time;
  f.time = s;
  try { return numOf(node, "wind", scope, 0); } finally { f.time = was; }
}

/** This line's seed: seed= or its id, mixed with which each copy and use it's drawn in, so copies differ. */
function seedOf(node: SayShapeNode, scope: Scope, f: Frame): number {
  const own = node.props.seed === undefined ? shakeSeed(node.id) : Math.round(numOf(node, "seed", scope, 0)) >>> 0;
  // The each copies and uses it's drawn in: recorded while pressables are, or kept by a reflection drawing it again.
  const copy = f.press?.copy ?? f.seedCopy;
  if (copy?.length) return mix(own, shakeSeed(copy.join(".")));
  if (f.press || f.seedCopy) return own;
  let m = seen.get(f);
  if (!m) seen.set(f, (m = new Map()));
  const k = m.get(node.id) ?? 0;
  m.set(node.id, k + 1);
  return k ? mix(own, k) : own;
}

/** Draw one emit line's particles at the frame's time. */
export function drawEmit(node: SayShapeNode, scope: Scope, f: Frame): void {
  f.shapes++;
  const n = (key: string, d: number, lo: number, hi: number) => clamp(numOf(node, key, scope, d), lo, hi);
  const asked = Math.round(n("count", 40, 0, MAX_SCENE_PARTICLES));
  f.particlesAsked = (f.particlesAsked ?? 0) + asked;
  const used = f.particles ?? 0;
  const count = Math.min(asked, MAX_SCENE_PARTICLES - used);
  if (count < asked && f.particlesOver === undefined) f.particlesOver = node.line;
  f.particles = used + count;
  if (count <= 0) return;
  const colors = colorsOf(node.props.fill === undefined ? "accent" : strOf(node, "fill", scope) ?? "", f);
  if (!colors.length) return;
  const shapeRaw = strOf(node, "shape", scope);
  const shape: EmitShape = shapeRaw === "rect" || shapeRaw === "line" ? shapeRaw : "circle";
  const fromRaw = node.props.from === undefined ? undefined : numOf(node, "from", scope, NaN);
  const p: EmitParams = {
    count, from: fromRaw !== undefined && Number.isFinite(fromRaw) ? fromRaw : null,
    x: n("x", 0, -1e5, 1e5), y: n("y", 0, -1e5, 1e5), w: n("w", 0, 0, 1e5), h: n("h", 0, 0, 1e5),
    angle: n("angle", -90, -1e4, 1e4), spread: n("spread", 60, 0, 360), speed: n("speed", 300, 0, 1e4),
    gravity: n("gravity", 400, -2000, 2000), drag: n("drag", 1, 0, 20), wind: 0,
    life: n("life", 2, 0.1, 30), size: n("size", 6, 0, 200), seed: seedOf(node, scope, f),
    flutter: n("flutter", 0, 0, 1), colors: colors.length, shape,
  };
  const clock: EmitClock = { duration: f.clock?.duration ?? 0, loop: f.clock?.loop ?? false };
  const windRaw = node.props.wind?.trim();
  if (windRaw !== undefined && windRaw !== "") {
    const steady = Number(windRaw);
    if (Number.isFinite(steady)) p.wind = clamp(steady, -1e4, 1e4);
    else {
      // A formula: its history over one life span, in WIND_STEPS steps back from now.
      const span = p.from === null ? cycleOf(p.life, clock) : p.life;
      const step = span / WIND_STEPS, D = clock.duration;
      const samples = new Float64Array(WIND_STEPS + 1);
      let same = true;
      for (let j = 0; j <= WIND_STEPS; j++) {
        let s = f.time - j * step;
        s = clock.loop && D > 0 ? ((s % D) + D) % D : Math.max(0, s);
        samples[j] = clamp(windAt(node, scope, f, s), -1e4, 1e4);
        if (samples[j] !== samples[0]) same = false;
      }
      if (same) p.wind = samples[0]!;
      else clock.wind = windTable(samples, step, p.drag);
    }
  }
  const live = computeParticles(p, f.time, clock, BUFFER);
  if (!live) return;
  paintParticles(f, p, live, colors, clamp(numOf(node, "opacity", scope, 1), 0, 1));
}

/** Paint live particles from BUFFER, one path per color and opacity step. */
function paintParticles(f: Frame, p: EmitParams, live: number, colors: readonly string[], opacity: number): void {
  const g = f.g;
  // Bin by color and opacity step (a counting sort), so each bin is one path.
  STARTS.fill(0);
  for (let i = 0; i < live; i++) {
    const o = i * STRIDE;
    const step = Math.max(1, Math.ceil(BUFFER[o + 4]! * ALPHA_STEPS)) - 1;
    const key = BUFFER[o + 6]! * ALPHA_STEPS + step;
    KEYS[i] = key;
    STARTS[key + 1]!++;
  }
  for (let b = 0; b < BINS; b++) STARTS[b + 1]! += STARTS[b]!;
  NEXT.set(STARTS.subarray(0, BINS));
  for (let i = 0; i < live; i++) ORDER[NEXT[KEYS[i]!]!++] = i;
  // Device pixels per scene pixel: tiny circles are drawn as squares, which look the same and cost less.
  const tr = typeof g.getTransform === "function" ? g.getTransform() : null;
  const scale = tr ? Math.sqrt(Math.abs(tr.a * tr.d - tr.b * tr.c)) || 1 : 1;
  const base = g.globalAlpha * opacity;
  g.save();
  if (p.shape === "line") {
    g.lineWidth = Math.max(1 / scale, p.size / 3);
    g.lineCap = "round";
    g.setLineDash?.([]);
  }
  for (let b = 0; b < BINS; b++) {
    const from = STARTS[b]!, to = STARTS[b + 1]!;
    if (from === to) continue;
    const color = colors[Math.floor(b / ALPHA_STEPS)]!;
    g.globalAlpha = (base * ((b % ALPHA_STEPS) + 1)) / ALPHA_STEPS;
    g.beginPath();
    for (let q = from; q < to; q++) tracePart(g, ORDER[q]! * STRIDE, p.shape, scale);
    if (p.shape === "line") { g.strokeStyle = color; g.stroke(); } else { g.fillStyle = color; g.fill(); }
  }
  g.restore();
}

function tracePart(g: CanvasRenderingContext2D, o: number, shape: EmitShape, scale: number): void {
  const x = BUFFER[o]!, y = BUFFER[o + 1]!, size = BUFFER[o + 5]!;
  if (shape === "line") {
    // A streak from the particle back along its velocity, longer the faster it goes.
    const vx = BUFFER[o + 2]!, vy = BUFFER[o + 3]!, v = Math.hypot(vx, vy);
    const len = size * clamp(v / 150, 1, 6);
    g.moveTo(x, y);
    if (v > 1e-6) g.lineTo(x - (vx / v) * len, y - (vy / v) * len);
    else g.lineTo(x, y + 0.01);
    return;
  }
  if (shape === "rect") {
    const a = BUFFER[o + 7]!, hw = (size / 2) * BUFFER[o + 8]!, hh = size * 0.3;
    const c = Math.cos(a), s = Math.sin(a);
    const ux = c * hw, uy = s * hw, vx = -s * hh, vy = c * hh;
    g.moveTo(x - ux - vx, y - uy - vy);
    g.lineTo(x + ux - vx, y + uy - vy);
    g.lineTo(x + ux + vx, y + uy + vy);
    g.lineTo(x - ux + vx, y - uy + vy);
    g.closePath();
    return;
  }
  const r = size / 2;
  if (2 * r * scale < 1.5) {
    g.moveTo(x - r, y - r); g.lineTo(x + r, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.closePath();
    return;
  }
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, Math.PI * 2);
}

// ---------- the element ----------

const num = (description: string, def?: number): PropDef => (def === undefined ? { type: "number", description } : { type: "number", description, default: def });
const hidden = (description: string, def?: number): PropDef => ({ ...num(description, def), unlisted: true });

export const emitDef: ComponentDef = {
  type: "emit",
  category: "content",
  description: "Confetti, snow, sparks: count≤600 from=burst second (else endless) fill shape=rect|line x y w h angle spread speed gravity drag wind life size flutter.",
  props: {
    count: { ...num("How many, at most 600 in a scene.", 40), unlisted: true },
    from: { ...num("The second of a single burst; unset, they flow without end."), unlisted: true },
    fill: { type: "string", description: 'One color or a list: fill="accent, warn, #FFD166".', unlisted: true },
    shape: { type: "enum", values: ["circle", "rect", "line"], description: "rect for confetti, line for sparks and rain.", default: "circle", unlisted: true },
    x: hidden("Where they start, across (with w, the left of the area).", 0),
    y: hidden("Where they start, down (with h, the top of the area).", 0),
    w: hidden("Width of the area they start anywhere in.", 0),
    h: hidden("Height of that area.", 0),
    angle: hidden("Direction in degrees: 0 right, 90 down, -90 up.", -90),
    spread: hidden("Degrees around angle they scatter over (360 every way).", 60),
    speed: hidden("Starting speed, px per second.", 300),
    gravity: hidden("Pull down, px per second²; negative floats up.", 400),
    drag: hidden("Air drag per second: how fast they slow and take the wind.", 1),
    wind: hidden("Sideways wind, px per second; may be a formula of t.", 0),
    life: hidden("Seconds each particle lives.", 2),
    size: hidden("Size in px.", 6),
    flutter: hidden("0 to 1: confetti sway, spin and tumble.", 0),
    seed: hidden("Another number, another pattern."),
    opacity: hidden("0 (invisible) to 1.", 1),
  },
  parents: ["scene", "group", "define"],
  noBox: true,
  example: `emit count=60 from=1 spread=360 shape=line fill="accent, warn"`,
  check(props) {
    const c = Number(props.count);
    return props.count !== undefined && Number.isFinite(c) && c > MAX_SCENE_PARTICLES
      ? [`count=${props.count} is more particles than a scene draws (${MAX_SCENE_PARTICLES} in all), so it draws ${MAX_SCENE_PARTICLES}. Use count=${MAX_SCENE_PARTICLES} or fewer`]
      : [];
  },
  layout: (box) => { box.h = 0; },
  semantics: () => false,
};
