/**
 * reflect= on group and use: a mirrored copy of the contents below a line,
 * like a skyline in a river, with ripple= (moving waves) and fade= (falling
 * off with depth). Behind the scene's reflect feature (sceneComponentsWith).
 *
 * reflect=<y> is in the group's parent coordinates, the same space as its x
 * and y. Only rows a viewer can see are captured: the scene's rectangle,
 * mapped into the parent's coordinates, bounds what's above and below the
 * line, and the reflection is as deep as the shorter of the two.
 *
 * The contents are drawn once more, into an offscreen buffer at the device's
 * scale (DPR included, capped at 2), with nothing recorded for pressing or the
 * drawing check: a reflection is only a picture. The fade is baked into the
 * buffer; the buffer is drawn flipped about the line, clipped below it, in
 * one piece or, with ripple, as horizontal strips shifted sideways by a wave
 * of depth and t. No per-pixel work.
 *
 * The buffer is kept between frames (a few per line, least recently used
 * first) while nothing the contents read changes: the values of every name
 * they read, their own place and look, the theme. Contents that read t (or
 * shake, or anything else that moves on its own) are drawn every frame.
 * Ripple happens when the buffer is drawn, so a moving ripple keeps the cache.
 *
 * Without an offscreen canvas (Node, the drawing check), nothing is drawn.
 * With reduced motion, the ripple stops: one still, unshifted copy.
 *
 * It takes drawAll and numOf from draw.ts as arguments, so the two modules
 * don't import each other (as depth.ts does).
 */
import { identifiers, splitTemplate, wholeExpression, type Scope } from "../../expr";
import type { SayShapeNode, Value } from "../../types";
import { SCENE_FUNCTIONS } from "./functions";
import { invert, mul, type Matrix } from "./interact";
import type { Frame } from "./draw";

/** The props this feature adds to group and use. */
export const REFLECT_PROPS = ["reflect", "ripple", "fade"] as const;

/** The largest buffer side, in device pixels; past it the buffer is drawn at a lower scale. */
export const MAX_REFLECT_BUFFER = 2048;
/** Buffers kept per reflecting line (different sizes, places or states seen recently). */
const MAX_ENTRIES = 4;
/** Misses in a row before a line stops caching for a while (its contents keep changing). */
const MISSES_TO_PAUSE = 3;
/** Frames a line goes without caching after that, before trying again. */
const PAUSE_FRAMES = 120;
/** How far the ripple shifts a row at most, in parent pixels, at ripple=1. */
const RIPPLE_PX = 6;
/** Extra width captured on each side, so a shifted row never shows a gap at the scene's edge. */
const PAD = RIPPLE_PX + 2;
/** The ripple's speed: half a wave per second, rounded so a looping scene holds whole waves. */
const RIPPLE_HZ = 0.5;

export type ReflectBuffer = HTMLCanvasElement | OffscreenCanvas;
type Draw = (nodes: readonly SayShapeNode[], scope: Scope, f: Frame) => void;
type Num = (node: SayShapeNode, key: string, scope: Scope, fallback?: number) => number;

/**
 * Device pixels per unit of the current drawing: the scale of the canvas
 * transform (DPR times every scale so far), capped at 2 so buffers stay small.
 */
export function bufferScale(t: { a: number; b: number; c: number; d: number }): number {
  const k = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
  return Number.isFinite(k) ? Math.min(k, 2) : 0;
}

/**
 * Buffer pixels per unit of the parent's coordinates: the drawing's own scale on
 * the page (scene, groups) times the screen's pixel ratio capped at 2. Capping
 * only the pixel ratio keeps a scene drawn larger than its w sharp.
 */
export function deviceScale(t: { a: number; b: number; c: number; d: number }, m: Matrix): number {
  const k = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
  const css = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  if (!Number.isFinite(k) || !(css > 0)) return bufferScale(t);
  return css * Math.min(k / css, 2);
}

/** The ripple's angular speed (radians per second): RIPPLE_HZ, or the nearest whole number of waves per loop. */
export function rippleSpeed(period = 0): number {
  if (!(period > 0)) return 2 * Math.PI * RIPPLE_HZ;
  return (2 * Math.PI * Math.max(1, Math.round(RIPPLE_HZ * period))) / period;
}

/**
 * How far the row at depth d (0 at the line, D at the bottom) shifts sideways
 * at time t: a wave that's longer and stronger further from the line, as on
 * water seen at a slant. 0 at ripple 0; never more than ripple × 6.
 */
export function rippleOffset(d: number, D: number, ripple: number, time: number, period = 0): number {
  if (!(ripple > 0) || !(D > 0)) return 0;
  const u = Math.max(0, Math.min(1, d / D));
  const wavelength = 10 + 0.15 * d;
  return ripple * RIPPLE_PX * (0.25 + 0.75 * u) * Math.sin((2 * Math.PI * d) / wavelength - rippleSpeed(period) * time);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------- what the contents read ----------

/** Lines whose drawing is fixed by their props and the names they read. Anything else (emit) moves on its own. */
const STILL_TYPES = new Set(["rect", "circle", "ellipse", "line", "path", "polygon", "label", "group", "use", "let", "if", "each", "define", "gradient"]);
/** Props that move a line by themselves, without reading a name. */
const MOVING_PROPS = new Set(["shake", "trail"]);

interface Reads { names: string[]; moves: boolean }
const readsOf = new WeakMap<SayShapeNode, Reads>();

/** The names a prop's text reads: a formula, a text with formulas, or a bare name. */
function namesIn(raw: string, out: Set<string>): void {
  const whole = wholeExpression(raw);
  const exprs = whole !== null ? [whole] : raw.includes("{") ? splitTemplate(raw).flatMap((p) => ("expr" in p ? [p.expr] : [])) : [raw];
  for (const e of exprs) for (const n of identifiers(e, SCENE_FUNCTIONS)) out.add(n);
}

/**
 * Every name the contents read (through their uses' drawings and the scene's
 * gradients), and whether anything in them moves with t. Worked out once per line.
 */
function reads(node: SayShapeNode, f: Frame): Reads {
  const known = readsOf.get(node);
  if (known) return known;
  const out = new Set<string>();
  let moves = false;
  const seen = new Set<SayShapeNode>();
  const walk = (n: SayShapeNode): void => {
    if (seen.has(n)) return;
    seen.add(n);
    if (!STILL_TYPES.has(n.type)) moves = true;
    for (const [k, raw] of Object.entries(n.props)) {
      if (MOVING_PROPS.has(k)) moves = true;
      namesIn(raw, out);
    }
    if (n.text !== undefined && n.type !== "use" && n.type !== "define") namesIn(n.text, out);
    if (n.type === "use" && n.text !== undefined) {
      const d = f.defs.get(n.text);
      if (d) walk(d);
    }
    n.children.forEach(walk);
  };
  walk(node);
  for (const gn of f.gradients.values()) walk(gn);
  if (out.has("t")) moves = true;
  const r = { names: [...out], moves };
  readsOf.set(node, r);
  return r;
}

// ---------- the buffers ----------

interface Entry {
  key: string;
  colors: object;
  sig: unknown[];
  buf: ReflectBuffer;
  shapes: number;
  steps: number;
}
interface Memo { entries: Entry[]; misses: number; frame: number; pausedUntil: number; scratch?: ReflectBuffer }
const memos = new WeakMap<SayShapeNode, Memo>();

const sameSig = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** A buffer at least this big, reused when it can be (its contents are cleared either way). */
function sized(buf: ReflectBuffer | undefined, w: number, h: number, f: Frame): ReflectBuffer | null {
  if (!buf) return f.offscreen?.(w, h) ?? null;
  if (buf.width !== w || buf.height !== h) { buf.width = w; buf.height = h; }
  return buf;
}

/**
 * Draw node's reflection below its reflect= line, before node itself is drawn.
 * Called from draw.ts's group and use case, in the parent's coordinates.
 */
export function drawReflection(node: SayShapeNode, scope: Scope, f: Frame, draw: Draw, num: Num): void {
  // One level: a reflection's contents don't reflect again.
  if (f.reflecting || !f.offscreen || !f.view) return;
  const baseline = num(node, "reflect", scope, NaN);
  if (!Number.isFinite(baseline)) return;
  const ripple = node.props.ripple === undefined ? 0 : clamp01(num(node, "ripple", scope, 0));
  const fade = node.props.fade === undefined ? 0.5 : clamp01(num(node, "fade", scope, 0.5));
  const g = f.g;

  // The scene's rectangle in the parent's coordinates: what a viewer can see.
  const inv = invert(f.m);
  if (!inv) return;
  const p = mul(inv, f.view.m);
  const { w, h } = f.view;
  const xs: number[] = [], ys: number[] = [];
  for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    xs.push(p[0] * cx + p[2] * cy + p[4]);
    ys.push(p[1] * cx + p[3] * cy + p[5]);
  }
  const by0 = Math.min(...ys), by1 = Math.max(...ys);
  const depth = Math.min(baseline - by0, by1 - baseline);
  if (!(depth > 0)) return;
  const x0 = Math.min(...xs) - PAD, width = Math.max(...xs) + PAD - x0, top = baseline - depth;

  let s = deviceScale(g.getTransform(), f.m);
  s = Math.min(s, MAX_REFLECT_BUFFER / width, MAX_REFLECT_BUFFER / depth);
  const bw = Math.ceil(width * s), bh = Math.ceil(depth * s);
  if (!(s > 0) || bw < 1 || bh < 1) return;

  const memo = memos.get(node) ?? { entries: [], misses: 0, frame: 0, pausedUntil: 0 };
  memos.set(node, memo);
  memo.frame++;
  const r = reads(node, f);
  const caching = !r.moves && memo.frame >= memo.pausedUntil;
  const key = `${s}|${bw}|${bh}|${x0}|${top}|${baseline}|${depth}|${fade}`;
  let sig: unknown[] = [];
  let hit: Entry | undefined;
  if (caching) {
    const n = (k: string, d: number) => (node.props[k] === undefined ? d : num(node, k, scope, d));
    sig = [n("x", 0), n("y", 0), n("rotate", 0), n("scale", 1), n("opacity", 1), ...r.names.map((name) => scope(name) as Value | undefined)];
    // shine= is lit from the scene's light=, which depends on where the drawing sits on the canvas.
    if (f.light) sig.push(...f.light, ...f.m);
    hit = memo.entries.find((e) => e.key === key && e.colors === f.colors && sameSig(e.sig, sig));
  }

  let buf: ReflectBuffer;
  if (hit) {
    memo.misses = 0;
    memo.entries = [hit, ...memo.entries.filter((e) => e !== hit)];
    f.shapes += hit.shapes;
    f.steps += hit.steps;
    buf = hit.buf;
  } else {
    let entry: Entry | undefined;
    if (caching) {
      if (++memo.misses >= MISSES_TO_PAUSE) {
        // Its contents change every frame (a let of t, state that keeps moving): stop keeping copies for a while.
        memo.misses = 0;
        memo.pausedUntil = memo.frame + PAUSE_FRAMES;
        memo.scratch ??= memo.entries[0]?.buf;
        memo.entries = [];
      } else {
        const old = memo.entries.length >= MAX_ENTRIES ? memo.entries.pop() : undefined;
        const b = sized(old?.buf, bw, bh, f);
        if (!b) return;
        entry = { key, colors: f.colors, sig, buf: b, shapes: 0, steps: 0 };
        memo.entries.unshift(entry);
      }
    }
    const b = entry ? entry.buf : (memo.scratch = sized(memo.scratch, bw, bh, f) ?? undefined);
    if (!b) return;
    buf = b;
    const counts = capture(node, scope, f, draw, buf, { s, x0, top, width, depth, baseline, fade });
    if (entry) { entry.shapes = counts.shapes; entry.steps = counts.steps; }
  }

  // Flip it about the line, below the line only.
  g.save();
  g.beginPath();
  g.rect(x0, baseline, width, depth);
  g.clip();
  g.translate(0, 2 * baseline);
  g.scale(1, -1);
  const image = buf as CanvasImageSource;
  if (ripple <= 0 || !f.motion) {
    g.drawImage(image, 0, 0, bw, bh, x0, top, bw / s, bh / s);
  } else {
    // Strips of rows, each shifted by the wave at its depth: at most ~300 draws however tall.
    const rows = Math.max(2, Math.ceil(bh / 300));
    const period = f.view.period ?? 0;
    for (let sy = 0; sy < bh; sy += rows) {
      const rh = Math.min(rows, bh - sy);
      const d = depth - (sy + rh / 2) / s;
      const dx = rippleOffset(d, depth, ripple, f.time, period);
      g.drawImage(image, 0, sy, bw, rh, x0 + dx, top + sy / s, bw / s, rh / s + 0.5 / s);
    }
  }
  g.restore();
}

interface Area { s: number; x0: number; top: number; width: number; depth: number; baseline: number; fade: number }

/** Draw node's contents into buf (rows from top to the line), fade baked in. Returns the shapes and steps it took. */
function capture(node: SayShapeNode, scope: Scope, f: Frame, draw: Draw, buf: ReflectBuffer, a: Area): { shapes: number; steps: number } {
  const og = buf.getContext("2d") as CanvasRenderingContext2D | null;
  if (!og) return { shapes: 0, steps: 0 };
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.globalCompositeOperation = "source-over";
  og.globalAlpha = 1;
  og.clearRect(0, 0, buf.width, buf.height);
  og.setTransform(a.s, 0, 0, a.s, -a.x0 * a.s, -a.top * a.s);
  const was = { g: f.g, press: f.press, onNode: f.onNode, reflecting: f.reflecting, seedCopy: f.seedCopy };
  const shapes = f.shapes, steps = f.steps;
  // The reflection shows the same particles as the line: it spends none of the scene's particle budget
  // and seeds them from the same each copies and uses.
  const particles = f.particles, asked = f.particlesAsked, over = f.particlesOver;
  f.seedCopy = f.press ? [...f.press.copy] : f.seedCopy ?? [];
  f.g = og;
  f.press = undefined;
  f.onNode = undefined;
  f.reflecting = node;
  try {
    og.save();
    draw([node], scope, f);
    og.restore();
  } finally {
    f.g = was.g;
    f.press = was.press;
    f.onNode = was.onNode;
    f.reflecting = was.reflecting;
    f.seedCopy = was.seedCopy;
    f.particles = particles; f.particlesAsked = asked; f.particlesOver = over;
  }
  if (a.fade > 0) {
    // Solid at the line, 1 - fade at the far edge.
    const grad = og.createLinearGradient(0, a.baseline, 0, a.top);
    grad.addColorStop(0, "rgba(0, 0, 0, 1)");
    grad.addColorStop(1, `rgba(0, 0, 0, ${Math.round((1 - a.fade) * 1000) / 1000})`);
    og.globalCompositeOperation = "destination-in";
    og.fillStyle = grad;
    og.fillRect(a.x0, a.top, a.width, a.depth + 1);
    og.globalCompositeOperation = "source-over";
  }
  return { shapes: f.shapes - shapes, steps: f.steps - steps };
}
