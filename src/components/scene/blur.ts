/**
 * blur= on shapes, group and use: soft fog banks, smoke, near-camera snow.
 * blur is in scene pixels (at most MAX_BLUR) and is drawn with the canvas's
 * filter, its radius scaled to device pixels from the canvas transform (DPR,
 * the scene's scale and every group's scale), as glow and shadow are.
 *
 * A shape: its own draw gets filter blur(…) (blurOn, from withLook).
 *
 * A group or use: its contents are drawn into one offscreen buffer covering
 * the scene's rectangle on the canvas (plus three radii of margin, so edges
 * fade instead of being cut), at the device's scale capped at 2 (half that for
 * big radii), then drawn back once through the filter, so overlapping shapes
 * blur together and the group's opacity applies once. At most MAX_LAYERS
 * buffers a frame; past them, and wherever there's no offscreen canvas (Node),
 * the filter is set on the group so each shape blurs on its own.
 *
 * Contents that can't change between frames (no formulas, no each/if/emit,
 * nothing pressable, moving or reflecting, gradients without formulas) are
 * blurred once into a bitmap in the group's own coordinates and reused while
 * the scale, radius, theme and the names they read stay the same; the group's
 * own x, y, rotate and opacity may move (a drifting fog bank stays cached).
 *
 * Without the filter (Safari before 18, the drawing check's measuring
 * context) everything is drawn sharp. Takes drawAll and numOf from draw.ts as
 * arguments, so the two modules don't import each other (as reflect.ts does).
 */
import type { Scope } from "../../expr";
import type { SayShapeNode, Value } from "../../types";
import { invert, mul, type Matrix } from "./interact";
import type { Frame } from "./draw";
import type { ReflectBuffer } from "./reflect";

/** The largest blur=, in scene pixels. */
export const MAX_BLUR = 60;
/** The largest blur radius drawn, in device pixels. */
export const MAX_BLUR_DEVICE = 200;
/** Offscreen buffers blurred groups may use in one frame; past it, each shape blurs on its own. */
export const MAX_BLUR_LAYERS = 6;
/** Buffer pixels of blur a buffer keeps when it's drawn at a lower density for a big radius. */
const BLUR_PIXELS = 2.5;
/** The lowest buffer density, in buffer pixels per device pixel. */
const MIN_DENSITY = 0.25;
/** The largest buffer side, in buffer pixels. */
const MAX_SIDE = 4096;
/** A cached bitmap is only made for contents at most this big, in device pixels. */
const MAX_CACHED_SIDE = 4096;
/** Bitmaps kept per line. */
const MAX_ENTRIES = 2;
/** Rebuilds in a row before a line stops caching (its contents keep changing). */
const MISSES_TO_STOP = 2;

type Draw = (nodes: readonly SayShapeNode[], scope: Scope, f: Frame) => void;
type Num = (node: SayShapeNode, key: string, scope: Scope, fallback?: number) => number;
type Transform = { a: number; b: number; c: number; d: number; e?: number; f?: number };

/** Device pixels per unit of the current drawing (DPR times every scale so far). */
const scaleOf = (t: Transform) => Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;

/** blur= in scene pixels as a radius in device pixels: clamped to 0..MAX_BLUR, scaled, capped at MAX_BLUR_DEVICE. */
export function blurRadius(blur: number, t: Transform): number {
  if (!(blur > 0)) return 0;
  const r = Math.min(blur, MAX_BLUR) * scaleOf(t);
  return Number.isFinite(r) ? Math.min(r, MAX_BLUR_DEVICE) : 0;
}

/**
 * The buffer density, in buffer pixels per device pixel: DPR capped at 2,
 * and lower for a bigger radius, keeping about 2.5 buffer pixels of blur (at
 * least a quarter density): the blur hides the coarser pixels, and a smaller
 * buffer blurs much faster on a phone.
 */
export function bufferDensity(dpr: number, radius: number): number {
  const q = dpr > 2 ? 2 / dpr : 1;
  return radius > BLUR_PIXELS ? Math.min(q, Math.max(MIN_DENSITY, BLUR_PIXELS / radius)) : q;
}

/** A filter with blur added to whatever filter is already on. */
export function withBlur(filter: unknown, radius: number): string {
  const add = `blur(${Math.round(radius * 100) / 100}px)`;
  return typeof filter === "string" && filter !== "" && filter !== "none" ? `${filter} ${add}` : add;
}

const support = new WeakMap<object, boolean>();
/** Whether this context draws filter blur: it has a string filter that takes "blur(1px)". Checked once per context. */
export function canFilter(g: CanvasRenderingContext2D): boolean {
  const known = support.get(g);
  if (known !== undefined) return known;
  let ok = false;
  try {
    if (typeof g.filter === "string") {
      const was = g.filter;
      g.filter = "blur(1px)";
      ok = g.filter === "blur(1px)";
      g.filter = was;
    }
  } catch { ok = false; }
  support.set(g, ok);
  return ok;
}

type DrawShape = (node: SayShapeNode, scope: Scope, f: Frame) => void;

/**
 * blur= on a shape, called before its look is applied: draw it blurred and
 * return true, or false to draw it as usual (no blur, or no filter). The shape
 * is drawn again by drawShape with f.blurring set, so it's drawn plainly:
 * into a small buffer around it, blurred there, then put on the canvas; or,
 * with no buffer, straight onto the canvas through the filter.
 */
export function blurShape(node: SayShapeNode, scope: Scope, f: Frame, num: Num, drawShape: DrawShape): boolean {
  const g = f.g;
  if (f.blurring === node || !canFilter(g)) return false;
  const T = g.getTransform();
  const r = blurRadius(num(node, "blur", scope, 0), T);
  if (r < 0.05) return false;
  const was = { blurring: f.blurring, shapes: f.shapes };
  f.blurring = node;
  try {
    // The canvas filter is slow on a big canvas (each filtered draw is a layer the size of the canvas): blur in a buffer the size of the shape.
    if (!f.offscreen || measuring.has(g) || g.globalAlpha <= 0.001 || !buffered(node, scope, f, drawShape, toM(T), r)) {
      g.save();
      g.filter = withBlur(g.filter, r);
      drawShape(node, scope, f);
      g.restore();
    }
  } finally {
    f.blurring = was.blurring;
    // drawShape counted it before calling here.
    f.shapes = was.shapes;
  }
  return true;
}

/** One shape into a small buffer around it (device pixels, plus three radii), blurred there, then onto the canvas. */
function buffered(node: SayShapeNode, scope: Scope, f: Frame, drawShape: DrawShape, m: Matrix, r: number): boolean {
  const g = f.g;
  const box = measure(g, m, f, () => drawShape(node, scope, f));
  if (!box) return true;
  const area = padded(g, box, 3 * r);
  if (!area) return true;
  return blurInto(g, f, area, m, r, shapePools, (og) => {
    const was = f.g;
    f.g = og;
    try { og.save(); drawShape(node, scope, f); og.restore(); } finally { f.g = was; }
  });
}

/** Where a drawing lands, in the device pixels of m: drawn once onto a context that only keeps bounds, with nothing recorded for pressing. */
function measure(g: CanvasRenderingContext2D, m: Matrix, f: Frame, draw: () => void): Rect | null {
  const bounds = boundsContext(g, m);
  const was = { g: f.g, press: f.press, shapes: f.shapes, steps: f.steps };
  f.g = bounds.context;
  f.press = undefined;
  try { draw(); } finally { f.g = was.g; f.press = was.press; f.shapes = was.shapes; f.steps = was.steps; }
  return bounds.box();
}

interface Rect { x: number; y: number; w: number; h: number }

/** A device-pixel rectangle grown by pad, and kept to the canvas (with pad around it) when its size is known. */
function padded(g: CanvasRenderingContext2D, b: Rect, pad: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Math.floor(b.x - pad), y0 = Math.floor(b.y - pad);
  let x1 = Math.ceil(b.x + b.w + pad), y1 = Math.ceil(b.y + b.h + pad);
  const cw = g.canvas?.width, ch = g.canvas?.height, p = Math.ceil(pad);
  if (typeof cw === "number" && typeof ch === "number" && cw > 0 && ch > 0) {
    x0 = Math.max(x0, -p); y0 = Math.max(y0, -p);
    x1 = Math.min(x1, cw + p); y1 = Math.min(y1, ch + p);
  }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * Draw into a buffer over area (device pixels of the canvas) with m as the
 * drawing's transform, blur it into a second buffer at the buffer's own
 * density, and put that on the canvas, unfiltered and unscaled by the
 * transform. A group's opacity applies once, as the buffer goes on the
 * canvas (overlapping shapes don't show seams); a shape goes in at the
 * canvas's opacity and back at full, so presses see it as drawn.
 */
function blurInto(g: CanvasRenderingContext2D, f: Frame, area: { x0: number; y0: number; x1: number; y1: number }, m: Matrix, r: number, pool: Pool, draw: (og: CanvasRenderingContext2D) => void, group = false): boolean {
  const { x0, y0, x1, y1 } = area;
  let q = bufferDensity(dprOf(m, f), r);
  q = Math.min(q, MAX_SIDE / (x1 - x0), MAX_SIDE / (y1 - y0));
  const bw = Math.ceil((x1 - x0) * q), bh = Math.ceil((y1 - y0) * q);
  if (!(q > 0) || bw < 1 || bh < 1) return false;
  const sharp = pooled(pool.sharp, g, bw, bh, f), soft = sharp && pooled(pool.soft, g, bw, bh, f);
  const og = sharp && fresh(sharp, bw, bh), og2 = soft && fresh(soft, bw, bh);
  if (!sharp || !soft || !og || !og2) return false;
  if (!group) og.globalAlpha = g.globalAlpha;
  og.setTransform(q * m[0], q * m[1], q * m[2], q * m[3], q * (m[4] - x0), q * (m[5] - y0));
  draw(og);
  og2.filter = withBlur("none", r * q);
  og2.drawImage(sharp as CanvasImageSource, 0, 0, bw, bh, 0, 0, bw, bh);
  og2.filter = "none";
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (!group) g.globalAlpha = 1;
  g.drawImage(soft as CanvasImageSource, 0, 0, bw, bh, x0, y0, bw / q, bh / q);
  g.restore();
  return true;
}

// ---------- groups ----------

/** Scratch buffers, one per context drawn into (so a blurred group inside another gets its own): the sharp drawing and its blur. */
interface Pool { sharp: WeakMap<object, ReflectBuffer>; soft: WeakMap<object, ReflectBuffer> }
const groupPools: Pool = { sharp: new WeakMap(), soft: new WeakMap() };
const shapePools: Pool = { sharp: new WeakMap(), soft: new WeakMap() };
/** Contexts that only measure (boundsContext): blur there is a filter, which they read as margin. */
const measuring = new WeakSet<object>();

/** A buffer at least w × h (grown in steps, never shrunk). */
function pooled(pool: WeakMap<object, ReflectBuffer>, g: CanvasRenderingContext2D, w: number, h: number, f: Frame): ReflectBuffer | null {
  let buf = pool.get(g);
  const step = (n: number) => Math.ceil(n / 64) * 64;
  if (!buf) {
    buf = f.offscreen?.(step(w), step(h));
    if (!buf) return null;
    pool.set(g, buf);
  } else if (buf.width < w || buf.height < h) {
    buf.width = Math.max(buf.width, step(w));
    buf.height = Math.max(buf.height, step(h));
  }
  return buf;
}

/** A buffer's context, reset: no transform, opacity, filter or blending left from last time, cleared over w × h. */
function fresh(buf: ReflectBuffer, w: number, h: number): CanvasRenderingContext2D | null {
  const og = buf.getContext("2d") as CanvasRenderingContext2D | null;
  if (!og) return null;
  og.setTransform(1, 0, 0, 1, 0, 0);
  og.globalAlpha = 1;
  og.globalCompositeOperation = "source-over";
  if (typeof og.filter === "string") og.filter = "none";
  og.clearRect(0, 0, w, h);
  return og;
}

/** Draw nodes onto og with f (pressing, the scene's matrix and counts carry on), then put f.g back. */
function drawInto(og: CanvasRenderingContext2D, kids: readonly SayShapeNode[], scope: Scope, f: Frame, draw: Draw): void {
  const was = f.g;
  f.g = og;
  try { og.save(); draw(kids, scope, f); og.restore(); } finally { f.g = was; }
}

/**
 * blur= on a group or use, called with its transform and opacity in force:
 * draw kids blurred and return true, or false when it has no blur (or the
 * canvas can't blur), for the caller to draw them as usual.
 */
export function drawBlurred(node: SayShapeNode, scope: Scope, kids: readonly SayShapeNode[], inner: Scope, f: Frame, draw: Draw, num: Num): boolean {
  if (node.props.blur === undefined) return false;
  const g = f.g;
  if (!canFilter(g)) return false;
  const T = g.getTransform();
  const r = blurRadius(num(node, "blur", scope, 0), T);
  // Not worth a buffer, or nothing shows (an invisible group draws as usual, for the same regions).
  if (r < 0.05 || g.globalAlpha <= 0.001) return false;
  const m = toM(T);
  if (!measuring.has(g)) {
    if (cached(node, kids, inner, f, draw, m, r)) return true;
    if (layered(kids, inner, f, draw, m, r)) return true;
  }
  // No buffer (Node, or MAX_BLUR_LAYERS used): each shape blurs on its own.
  g.save();
  g.filter = withBlur(g.filter, r);
  draw(kids, inner, f);
  g.restore();
  return true;
}

/** The canvas's pixels per CSS pixel here: the canvas transform against the scene's own matrix. */
function dprOf(m: Matrix, f: Frame): number {
  const inv = invert(f.m);
  return inv ? scaleOf(toT(mul(m, inv))) : 1;
}
const toT = (m: Matrix): Transform => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });

const toM = (t: Transform): Matrix => [t.a, t.b, t.c, t.d, t.e ?? 0, t.f ?? 0];

/** Contents into one buffer over the scene's rectangle on the canvas (what can blur into view), blurred once, then onto the canvas. */
function layered(kids: readonly SayShapeNode[], scope: Scope, f: Frame, draw: Draw, m: Matrix, r: number): boolean {
  if (!f.offscreen || !f.view || (f.layers ?? 0) >= MAX_BLUR_LAYERS) return false;
  const inv = invert(f.m);
  if (!inv) return false;
  const g = f.g;
  const p = mul(m, mul(inv, f.view.m));
  const { w, h } = f.view;
  const xs: number[] = [], ys: number[] = [];
  for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    xs.push(p[0] * cx + p[2] * cy + p[4]);
    ys.push(p[1] * cx + p[3] * cy + p[5]);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  const area = padded(g, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, 3 * r);
  if (!area) return true;
  f.layers = (f.layers ?? 0) + 1;
  return blurInto(g, f, area, m, r, groupPools, (og) => drawInto(og, kids, scope, f, draw), true);
}

// ---------- still contents, blurred once ----------

/** Lines that draw the same every frame given their props. */
const STILL_TYPES = new Set(["rect", "circle", "ellipse", "line", "path", "polygon", "label", "group", "use"]);
/** Props that make a line move, press or draw differently by themselves. */
const LIVE_PROPS = new Set(["if", "on", "on-hover", "on-leave", "drag", "shake", "trail", "reflect", "args"]);
const BARE = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
const URL = /^url\(#?([A-Za-z_][\w-]*)\)$/;

/** What a line's contents need to be cached: null when they can change by themselves; else the names they read and whether they shine. */
interface Still { names: string[]; shines: boolean }
const stills = new WeakMap<SayShapeNode, Still | null>();

function stillOf(node: SayShapeNode, kids: readonly SayShapeNode[], f: Frame): Still | null {
  if (stills.has(node)) return stills.get(node)!;
  const names = new Set<string>();
  let shines = false, ok = true;
  const seen = new Set<SayShapeNode>();
  const props = (n: SayShapeNode): void => {
    for (const [k, raw] of Object.entries(n.props)) {
      if (LIVE_PROPS.has(k) || raw.includes("{")) { ok = false; return; }
      if (k === "shine") shines = true;
      const ref = URL.exec(raw.trim());
      if (ref) { const gn = f.gradients.get(ref[1]!); if (gn) props(gn); }
      else if (BARE.test(raw) && !["true", "false", "null"].includes(raw)) names.add(raw.split(".")[0]!);
    }
  };
  const walk = (n: SayShapeNode): void => {
    if (!ok || seen.has(n)) return;
    seen.add(n);
    if (!STILL_TYPES.has(n.type) || n.text?.includes("{")) { ok = false; return; }
    props(n);
    if (n.type === "use") {
      const d = n.text === undefined ? undefined : f.defs.get(n.text);
      if (!d) { ok = false; return; }
      d.children.forEach(walk);
    }
    n.children.forEach(walk);
  };
  kids.forEach(walk);
  // The line's own args change what its drawing reads.
  if (node.props.args !== undefined) ok = false;
  const r = ok ? { names: [...names], shines } : null;
  stills.set(node, r);
  return r;
}

interface Entry { key: string; colors: object; sig: unknown[]; buf: ReflectBuffer; x: number; y: number; w: number; h: number; s: number; shapes: number; steps: number }
interface Memo { entries: Entry[]; misses: number; off: boolean }
const memos = new WeakMap<SayShapeNode, Memo>();
const sameSig = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Draw still contents from their blurred bitmap, building it when needed; false when they can't be cached. */
function cached(node: SayShapeNode, kids: readonly SayShapeNode[], scope: Scope, f: Frame, draw: Draw, m: Matrix, r: number): boolean {
  if (!f.offscreen || f.press?.open.length || f.onNode) return false;
  const memo = memos.get(node) ?? { entries: [], misses: 0, off: false };
  if (memo.off) return false;
  const still = stillOf(node, kids, f);
  if (!still) return false;
  memos.set(node, memo);
  const g = f.g;
  const k = scaleOf(toT(m));
  // Scales within ~9% of each other share a bitmap; the radius is in device pixels.
  const bucket = Math.round(Math.log2(k) * 8);
  const key = `${bucket}|${Math.round(r * 4)}`;
  const sig: unknown[] = still.names.map((n) => scope(n) as Value | undefined);
  // shine= is lit from the scene's light=, which depends on where the drawing sits.
  if (still.shines && f.light) sig.push(...f.light, ...f.m);
  let hit = memo.entries.find((e) => e.key === key && e.colors === f.colors && sameSig(e.sig, sig));
  if (!hit) {
    if (memo.entries.length && ++memo.misses >= MISSES_TO_STOP) { memo.off = true; memo.entries = []; return false; }
    if ((f.layers ?? 0) >= MAX_BLUR_LAYERS) return false;
    hit = build(kids, scope, f, draw, k, r, dprOf(m, f)) ?? undefined;
    if (!hit) { memo.off = true; return false; }
    hit.key = key; hit.colors = f.colors; hit.sig = sig;
    memo.entries = [hit, ...memo.entries].slice(0, MAX_ENTRIES);
  } else {
    memo.misses = 0;
    f.shapes += hit.shapes;
    f.steps += hit.steps;
  }
  if (hit.w > 0 && hit.h > 0) g.drawImage(hit.buf as CanvasImageSource, 0, 0, Math.ceil(hit.w * hit.s), Math.ceil(hit.h * hit.s), hit.x, hit.y, Math.ceil(hit.w * hit.s) / hit.s, Math.ceil(hit.h * hit.s) / hit.s);
  return true;
}

/** Blur the contents once into a bitmap in the line's own coordinates. Null when they're too big to keep (nothing drawn, nothing counted). */
function build(kids: readonly SayShapeNode[], scope: Scope, f: Frame, draw: Draw, k: number, r: number, dpr: number): Entry | null {
  const g = f.g;
  const shapes = f.shapes, steps = f.steps;
  // Measured at k device pixels per unit, then back in the line's own units.
  const dev = measure(g, [k, 0, 0, k, 0, 0], f, () => draw(kids, scope, f));
  if (!dev) return null;
  const pad = (3 * r) / k;
  const x = dev.x / k - pad, y = dev.y / k - pad, w = dev.w / k + 2 * pad, h = dev.h / k + 2 * pad;
  if (w * k > MAX_CACHED_SIDE || h * k > MAX_CACHED_SIDE) return null;
  // Buffer pixels per unit of the line's own coordinates.
  const s = k * bufferDensity(dpr, r);
  const bw = Math.max(1, Math.ceil(w * s)), bh = Math.max(1, Math.ceil(h * s));
  const sharp = pooled(groupPools.sharp, g, bw, bh, f);
  const og = sharp && fresh(sharp, bw, bh);
  const out = og ? f.offscreen?.(bw, bh) : undefined;
  const og2 = out && fresh(out, bw, bh);
  if (!sharp || !og || !out || !og2) return null;
  f.layers = (f.layers ?? 0) + 1;
  og.setTransform(s, 0, 0, s, -x * s, -y * s);
  drawInto(og, kids, scope, f, draw);
  // The radius in buffer pixels: device pixels times buffer pixels per device pixel.
  og2.filter = withBlur("none", (r * s) / k);
  og2.drawImage(sharp as CanvasImageSource, 0, 0, bw, bh, 0, 0, bw, bh);
  og2.filter = "none";
  return { key: "", colors: f.colors, sig: [], buf: out, x, y, w, h, s, shapes: f.shapes - shapes, steps: f.steps - steps };
}
/**
 * A context that draws nothing and keeps the bounds of what would be drawn,
 * in device pixels (start is its transform), with strokes, shadows and
 * filters around them. Text is measured with g.
 */
function boundsContext(g: CanvasRenderingContext2D, start: Matrix): { context: CanvasRenderingContext2D; box(): Rect | null } {
  type State = { m: Matrix; lineWidth: number; shadowBlur: number; shadowColor: string; shadowOffsetX: number; shadowOffsetY: number; filter: string; font: string; textAlign: string; [k: string]: unknown };
  let st: State = { m: start, lineWidth: 1, shadowBlur: 0, shadowColor: "transparent", shadowOffsetX: 0, shadowOffsetY: 0, filter: "none", font: "10px sans-serif", textAlign: "left" };
  const stack: State[] = [];
  let path: Array<[number, number]> = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const at = (x: number, y: number) => { const m = st.m; path.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]); };
  const box = (x: number, y: number, w: number, h: number) => { at(x, y); at(x + w, y); at(x, y + h); at(x + w, y + h); };
  /** Commit the path, grown by pad device pixels (outline, shadow, filter). */
  const commit = (pad: number) => {
    const shadow = st.shadowColor !== "transparent" && st.shadowBlur > 0 ? st.shadowBlur + Math.max(Math.abs(st.shadowOffsetX), Math.abs(st.shadowOffsetY)) : 0;
    const blur = [...st.filter.matchAll(/blur\(([\d.]+)px\)/g)].reduce((s, b) => s + 3 * Number(b[1]), 0);
    const grow = pad + shadow + blur;
    for (const [px, py] of path) {
      x0 = Math.min(x0, px - grow); y0 = Math.min(y0, py - grow);
      x1 = Math.max(x1, px + grow); y1 = Math.max(y1, py + grow);
    }
  };
  const lineScale = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
  const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const textWidth = (text: string) => {
    g.save();
    g.font = st.font;
    const w = g.measureText(text).width;
    g.restore();
    return w;
  };
  const text = (t: unknown, x: number, y: number, pad: number) => {
    const s = String(t), w = textWidth(s), size = sizeOf(st.font);
    const left = st.textAlign === "center" ? x - w / 2 : st.textAlign === "right" || st.textAlign === "end" ? x - w : x;
    path = [];
    box(left, y - size, w, 2 * size);
    commit(pad);
    path = [];
  };
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => { stack.push({ ...st }); },
    restore: () => { st = stack.pop() ?? st; },
    translate: (x, y) => { st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    rotate: (a) => { st.m = mul(st.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale: (x, y) => { st.m = mul(st.m, [x, 0, 0, y, 0, 0]); },
    transform: (a, b, c, d, e, f) => { st.m = mul(st.m, [a, b, c, d, e, f]); },
    setTransform: (a, b, c, d, e, f) => { st.m = [a, b, c, d, e, f]; },
    getTransform: () => toT(st.m),
    beginPath: () => { path = []; },
    closePath: () => {},
    moveTo: (x, y) => at(x, y),
    lineTo: (x, y) => at(x, y),
    quadraticCurveTo: (a, b, x, y) => { at(a, b); at(x, y); },
    bezierCurveTo: (a, b, c, d, x, y) => { at(a, b); at(c, d); at(x, y); },
    arcTo: (a, b, x, y) => { at(a, b); at(x, y); },
    arc: (x, y, r) => box(x - r, y - r, 2 * r, 2 * r),
    ellipse: (x, y, rx, ry) => { const e = Math.max(rx, ry); box(x - e, y - e, 2 * e, 2 * e); },
    rect: (x, y, w, h) => box(x, y, w, h),
    roundRect: (x, y, w, h) => box(x, y, w, h),
    fill: () => commit(0),
    stroke: () => commit(st.lineWidth * lineScale()),
    fillRect: (x, y, w, h) => { path = []; box(x, y, w, h); commit(0); path = []; },
    strokeRect: (x, y, w, h) => { path = []; box(x, y, w, h); commit(st.lineWidth * lineScale()); path = []; },
    fillText: (t, x, y) => text(t, x, y, 0),
    strokeText: (t, x, y) => text(t, x, y, st.lineWidth * lineScale()),
    // A nested blurred group's bitmap (image, then x y w h, or the 9-number form).
    drawImage: (...a) => {
      const [dx, dy, dw, dh] = (a.length >= 9 ? a.slice(5, 9) : a.slice(1, 5)).map(Number);
      path = []; box(dx ?? 0, dy ?? 0, dw ?? 0, dh ?? 0); commit(0); path = [];
    },
    measureText: (t) => ({ width: textWidth(String(t)) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const context = new Proxy({}, {
    get: (_t, prop) => (typeof prop !== "string" ? undefined : prop in methods ? methods[prop] : prop in st ? st[prop] : prop === "canvas" ? undefined : () => undefined),
    set: (_t, prop, value) => { if (typeof prop === "string") st[prop] = value; return true; },
    has: (_t, prop) => typeof prop === "string" && prop in st,
  }) as unknown as CanvasRenderingContext2D;
  measuring.add(context);
  return { context, box: () => (x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null) };
}
