/**
 * The drawing check: problems a person would see in a scene, found by drawing
 * it onto a context that measures instead of painting.
 *
 * The parser checks what a spec says; this checks what it shows. It draws the
 * scene as it rests (its last moment, the still that reduced motion and saved
 * pictures show) and reports, with line numbers and how to fix them:
 *
 * - a label cut off by the edge of the picture,
 * - labels drawn on top of each other,
 * - a label straddling the edge of a box, half in and half out,
 * - a line that runs under a box drawn after it, so what it connects is hidden,
 * - labels too small to read (one warning for them all), or a pressable shape too small to tap, on a phone,
 * - a scene whose formulas use t but whose duration is 0, so it never moves,
 * - a label too close in color to what's under it, in light or dark mode,
 * - pressable shapes on top of each other, or outside the picture,
 * - a label partly cut off by a clip=true group (what a clip hides entirely isn't judged).
 * - a station or small circle a few pixels off the line it seems meant to sit
 *   on, where other markers sit right on that line (so the line looks like it misses it).
 *
 * It doesn't check the animation's other moments: what moves is usually
 * meant to cross other things on its way.
 *
 * These are warnings for the model to tidy up, not errors: the scene still
 * shows. Headless, like layout: no canvas or DOM, so it runs on a server.
 */
import { shownWidth } from "./size";
import { MAX_DRAGGABLE } from "./drag";
import { MAX_SCENE_PARTICLES } from "./emit";
import type { Diagnostic, SayShapeNode, Value } from "../../types";
import type { Scope } from "../../expr";
import type { ParseResult } from "../../parser";
import { Store } from "../../state";
import { darkTheme, lightTheme, type Theme } from "../../theme";
import { colorOf, paintScene, numOf, strOf, type Frame } from "./draw";
import { boundsOf as boundsOfPts, IDENTITY, outline, regionBounds, regionName, type SceneRegion } from "./interact";
import { stateLocate } from "../../paths";

/** The most drawing problems reported for one spec; the first few are what a model needs. */
export const MAX_DRAWING_PROBLEMS = 8;

/** The width a scene gets on a 360 px phone, inside the screen's padding: the size the phone checks use. */
export const PHONE_WIDTH = 328;
/** The smallest label, in pixels on that phone, that's still readable. */
const MIN_PHONE_TEXT = 8;
/** The smallest pressable shape, in pixels on that phone, both ways (WCAG 2.5.8 target size). */
const MIN_PHONE_TARGET = 24;
/** The least contrast between a label and what's under it (WCAG's minimum for large text and graphics). */
const MIN_CONTRAST = 3;

type Matrix = [number, number, number, number, number, number];
interface Rect { x: number; y: number; w: number; h: number }

/** What one fill, stroke or text left on the picture, in scene coordinates. */
interface Mark {
  node: SayShapeNode;
  order: number;
  kind: string;
  bounds: Rect;
  filled: boolean;
  alpha: number;
  /** For a line element: its two ends. */
  ends?: [[number, number], [number, number]];
  text?: string;
  /** The color it was painted in, when it was a plain color (not a gradient). */
  color?: string;
  /** A label's text size in scene pixels, after groups' scaling. */
  size?: number;
  /** The line of the clip=true group that cuts part of it off. */
  cutBy?: number;
  /** For a line or a path drawn as an outline only: its centre lines, curves flattened. */
  lines?: Subpath[];
  /** That outline's width in scene pixels, after groups' scaling. */
  width?: number;
  /** The pressable lines it was drawn inside, when there are any. */
  inside?: readonly SceneRegion[];
}

/** One subpath of a stroked outline, in scene coordinates. Closed ones end where they began. */
interface Subpath { pts: Array<[number, number]>; closed: boolean }
/** The most points kept for one stroked outline in the marker-off-its-path check. */
const MAX_LINE_POINTS = 4000;
/** Short lines each curve is flattened into for that check. */
const CURVE_STEPS = 10;

/** How wide text is, given its size and weight. The default is a close estimate for sans-serif. */
export type MeasureText = (text: string, size: number, bold: boolean) => number;
const estimate: MeasureText = (text, size, bold) => text.length * size * (bold ? 0.6 : 0.54);

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const boundsOf = (pts: ReadonlyArray<[number, number]>): Rect | null => {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** A stand-in 2D context that records where things land instead of painting them. */
function measuringContext(marks: Mark[], current: () => SayShapeNode | null, measure: MeasureText, openNow: () => readonly SceneRegion[] = () => []): CanvasRenderingContext2D {
  /** clip: what a clip=true group lets show, and that group's line. */
  type State = { m: Matrix; alpha: number; font: string; align: string; clip?: { r: Rect; line: number } };
  let fillNow: unknown = "";
  let st: State = { m: [1, 0, 0, 1, 0, 0], alpha: 1, font: "16px sans-serif", align: "left" };
  const stack: State[] = [];
  let path: Array<[number, number]> = [];
  let segment: [number, number][] = [];
  const add = (x: number, y: number) => { path.push(apply(st.m, x, y)); segment.push(apply(st.m, x, y)); };
  const round = (cx: number, cy: number, rx: number, ry: number, rot = 0) => {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      path.push(apply(st.m, cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)));
    }
  };
  /** What of these bounds shows inside the clip=true groups around it: null when none of it does. */
  const shown = (b: Rect): { b: Rect; cut: boolean } | null => {
    if (!st.clip) return { b, cut: false };
    const c = cut(b, st.clip.r);
    return c ? { b: c, cut: area(c) < area(b) - 1 } : null;
  };
  // The same path again, as the canvas would draw its outline (curves and arcs over their real sweep), kept apart from the rough bounds above.
  let subs: Subpath[] = [];
  let sub: Subpath | null = null;
  let count = 0, filledNow = false;
  const put = (p: [number, number]) => { if (count < MAX_LINE_POINTS && Number.isFinite(p[0]) && Number.isFinite(p[1])) { count++; sub!.pts.push(p); } };
  const begin = (p: [number, number]) => { sub = { pts: [], closed: false }; subs.push(sub); put(p); };
  const to = (p: [number, number]) => { if (sub) put(p); else begin(p); };
  const curve = (ctrl: Array<[number, number]>) => {
    // With no point yet, the canvas starts the curve at its first control point.
    if (!sub?.pts.length) begin(ctrl[0]!);
    const p0 = sub?.pts[sub.pts.length - 1];
    if (!p0) return;
    const pts = [p0, ...ctrl];
    for (let k = 1; k <= CURVE_STEPS; k++) {
      // de Casteljau: works for quadratic and cubic alike, and transforms commute with it.
      let q = pts.slice();
      const u = k / CURVE_STEPS;
      while (q.length > 1) q = q.slice(1).map((b, i) => [q[i]![0] + (b[0] - q[i]![0]) * u, q[i]![1] + (b[1] - q[i]![1]) * u] as [number, number]);
      put(q[0]!);
    }
  };
  const sweep = (cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number, ccw: boolean) => {
    let span = end - start;
    if (ccw && span > 0) span -= 2 * Math.PI;
    if (!ccw && span < 0) span += 2 * Math.PI;
    span = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, span));
    const steps = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) {
      const a = start + (span * k) / steps;
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      to(apply(st.m, cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)));
    }
  };
  const mark = (filled: boolean): Mark | undefined => {
    const node = current();
    const whole = boundsOf(path);
    // Particles (emit) move and scatter by design: no rule judges them.
    if (!node || !whole || node.type === "emit") return;
    const seen = shown(whole);
    if (!seen) return;
    const b = seen.b;
    const ends = node.type === "line" && segment.length >= 2 ? [segment[0]!, segment[segment.length - 1]!] as [[number, number], [number, number]] : undefined;
    const color = filled && typeof fillNow === "string" ? fillNow : undefined;
    const open = openNow();
    const m: Mark = { node, order: marks.length, kind: node.type, bounds: b, filled, alpha: st.alpha, ...(ends ? { ends } : {}), ...(color ? { color } : {}), ...(open.length ? { inside: open.slice() } : {}) };
    marks.push(m);
    return m;
  };
  const ctx = {
    get globalAlpha() { return st.alpha; },
    set globalAlpha(v: number) { st.alpha = v; },
    get font() { return st.font; },
    set font(v: string) { st.font = v; },
    get textAlign() { return st.align; },
    set textAlign(v: string) { st.align = v; },
    get fillStyle() { return fillNow; },
    set fillStyle(v: unknown) { fillNow = v; },
    textBaseline: "middle", strokeStyle: "", lineWidth: 1, lineCap: "round", lineJoin: "round",
    save() { stack.push({ ...st, m: [...st.m] as Matrix }); },
    clip() {
      const b = boundsOf(path);
      const r = b && st.clip ? cut(b, st.clip.r) : b;
      st.clip = { r: r ?? { x: 0, y: 0, w: 0, h: 0 }, line: current()?.line ?? 0 };
    },
    restore() { st = stack.pop() ?? st; },
    translate(x: number, y: number) { st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    rotate(a: number) { st.m = mul(st.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x: number, y: number) { st.m = mul(st.m, [x, 0, 0, y, 0, 0]); },
    // glow= and shadow= read it to size their blur.
    getTransform() { const [a, b, c, d, e, f] = st.m; return { a, b, c, d, e, f }; },
    beginPath() { path = []; segment = []; subs = []; sub = null; count = 0; filledNow = false; },
    moveTo(x: number, y: number) { add(x, y); begin(apply(st.m, x, y)); },
    lineTo(x: number, y: number) { add(x, y); to(apply(st.m, x, y)); },
    quadraticCurveTo(a: number, b: number, x: number, y: number) { add(a, b); add(x, y); curve([apply(st.m, a, b), apply(st.m, x, y)]); },
    bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { add(a, b); add(c, d); add(x, y); curve([apply(st.m, a, b), apply(st.m, c, d), apply(st.m, x, y)]); },
    arc(x: number, y: number, r: number, start = 0, end = 2 * Math.PI, ccw = false) { round(x, y, r, r); sweep(x, y, r, r, 0, start, end, ccw); },
    arcTo(a: number, b: number, x: number, y: number) { add(a, b); add(x, y); to(apply(st.m, a, b)); to(apply(st.m, x, y)); },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number, start = 0, end = 2 * Math.PI, ccw = false) { round(x, y, rx, ry, rot); sweep(x, y, rx, ry, rot, start, end, ccw); },
    closePath() {
      const first = sub?.pts[0];
      if (!sub || !first) return;
      put(first);
      sub.closed = true;
      begin(first);
    },
    setLineDash() {},
    fill() { mark(true); filledNow = true; },
    stroke() {
      const m = mark(false);
      // Only an outline with nothing filled is a line something can sit on; a filled shape's border isn't.
      if (!m || filledNow || (m.kind !== "line" && m.kind !== "path")) return;
      const lines = subs.filter((s) => s.pts.length >= 2);
      if (!lines.length) return;
      m.lines = lines;
      m.width = ctx.lineWidth * Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
    },
    fillRect(x: number, y: number, w: number, h: number) { path = []; subs = []; sub = null; add(x, y); add(x + w, y + h); },
    measureText(text: string) { return { width: measure(text, sizeOf(st.font), boldOf(st.font)) }; },
    fillText(text: string, x: number, y: number) {
      const node = current();
      if (!node) return;
      const size = sizeOf(st.font), w = measure(text, size, boldOf(st.font));
      const left = st.align === "center" ? x - w / 2 : st.align === "right" ? x - w : x;
      const corners: Array<[number, number]> = [[left, y - size / 2], [left + w, y - size / 2], [left, y + size / 2], [left + w, y + size / 2]];
      const seen = shown(boundsOf(corners.map(([cx, cy]) => apply(st.m, cx, cy)))!);
      if (!seen) return;
      const b = seen.b;
      const stretch = Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
      marks.push({ node, order: marks.length, kind: "label", bounds: b, filled: true, alpha: st.alpha, text, size: size * stretch, ...(seen.cut && st.clip ? { cutBy: st.clip.line } : {}), ...(typeof fillNow === "string" ? { color: fillNow } : {}) });
    },
    strokeText() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
const boldOf = (font: string) => /\b(700|800|900|bold)\b/.test(font);
const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
/** The part of a that's inside b, or null when they don't meet. */
const cut = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
const overlap = (a: Rect, b: Rect) => area({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) });
const inside = (p: [number, number], r: Rect, pad: number) => p[0] > r.x - pad && p[0] < r.x + r.w + pad && p[1] > r.y - pad && p[1] < r.y + r.h + pad;
const quote = (s: string) => (s.length > 32 ? `"${s.slice(0, 30)}…"` : `"${s}"`);

/** Drawing problems in one scene, drawn as it rests. Never throws. */
export function reviewScene(scene: SayShapeNode, scope: Scope, opts: { theme?: Theme; measure?: MeasureText; behavior?: boolean } = {}): Diagnostic[] {
  try {
    const w = Math.max(1, numOf(scene, "w", scope, 600)), h = Math.max(1, numOf(scene, "h", scope, 340));
    // How wide it shows on a phone: maxw= and scale= can make it narrower than the phone.
    const phoneW = shownWidth(PHONE_WIDTH, w, scene.props.maxw === undefined ? undefined : numOf(scene, "maxw", scope, 0), scene.props.scale === undefined ? undefined : numOf(scene, "scale", scope, 1));
    const theme = opts.theme ?? lightTheme;
    const drawn = drawAtRest(scene, scope, theme, opts.measure, !!opts.behavior);
    const out: Diagnostic[] = [];
    // A scene whose formulas read t but that has no duration is a still picture: it never moves.
    if (!(numOf(scene, "duration", scope, 0) > 0) && readsClock(scene)) {
      out.push({ line: scene.line, severity: "warning", message: "Drawing: this scene's formulas use t, but its duration is 0, so it never moves. Set duration= to the seconds the motion takes (loop=true, the default, repeats it)" });
    }
    // Lines that drew nothing for a reason only drawing finds (an icon name a formula works out to), once each.
    const noted = new Set<string>();
    for (const n of drawn.notes) {
      if (noted.has(`${n.line}:${n.message}`)) continue;
      noted.add(`${n.line}:${n.message}`);
      out.push({ line: n.line, severity: "warning", message: `Drawing: ${n.message}` });
    }
        out.push(...findProblems(drawn.marks, drawn.regions, w, h, phoneW));
    if (drawn.particlesOver !== undefined) out.push({ line: drawn.particlesOver, severity: "warning", message: `Drawing: a scene draws at most ${MAX_SCENE_PARTICLES} particles in all and its emit lines ask for ${drawn.particlesAsked}, so this one and those after it draw fewer. Lower their count=` });
    if (drawn.dragOver !== undefined) out.push({ line: drawn.dragOver, severity: "warning", message: `Drawing: a scene can have at most ${MAX_DRAGGABLE} draggable shapes, so this one and those after it can't be dragged. Drag fewer, or use a slider` });
    out.push(...swipeTraps(drawn.regions, w, h));
    // Contrast in both modes when no theme was asked for: theme colors change between them.
    const light = lowContrast(drawn.marks, drawn.under, theme);
    const dark = opts.theme ? [] : (() => {
      const d = drawAtRest(scene, scope, darkTheme, opts.measure, false);
      return lowContrast(d.marks, d.under, darkTheme);
    })();
    const said = new Set<string>();
    const contrast: Array<{ c: (typeof light)[number]; mode: string; count: number }> = [];
    for (const c of [...light, ...dark]) {
      if (said.has(c.key)) continue;
      said.add(c.key);
      const both = !opts.theme && light.some((l) => l.key === c.key) && dark.some((d) => d.key === c.key);
      const mode = opts.theme || both ? "" : c.dark ? " in dark mode" : " in light mode";
      // Labels failing for the same reason (one fill on one background, one mode) are one problem with one fix.
      const same = contrast.find((x) => x.mode === mode && x.c.color === c.color && x.c.under === c.under);
      if (same) same.count++;
      else contrast.push({ c, mode, count: 1 });
    }
    for (const { c, mode, count } of contrast) {
      const who = count === 1 ? `the label ${quote(c.text)} is` : `${count} labels, like ${quote(c.text)}, are`;
      out.push({ line: c.line, severity: "warning", message: `Drawing: ${who} hard to read${mode}: the color is too close to what's under ${count === 1 ? "it" : "them"} (contrast ${c.ratio.toFixed(1)}:1, needs ${MIN_CONTRAST}:1). Pick a lighter or darker fill, or a theme color like ink or onAccent` });
    }
    // Last, and always kept: it's about the whole picture, and it never crowds out a problem that's only in one place.
    const phone = phoneText(drawn.marks, w, phoneW);
    if (phone) return [...out.slice(0, MAX_DRAWING_PROBLEMS - 1), phone];
    return out.slice(0, MAX_DRAWING_PROBLEMS);
  } catch {
    return [];
  }
}

/** The scene drawn as it rests (its last moment), as marks and pressable regions in scene coordinates. */
function drawAtRest(scene: SayShapeNode, scope: Scope, theme: Theme, measure: MeasureText | undefined, behavior: boolean): { marks: Mark[]; regions: SceneRegion[]; under: string; notes: Array<{ line: number; message: string }>; dragOver?: number; particlesOver?: number; particlesAsked?: number } {
  const w = Math.max(1, numOf(scene, "w", scope, 600)), h = Math.max(1, numOf(scene, "h", scope, 340));
  const duration = Math.max(0, numOf(scene, "duration", scope, 0));
  const marks: Mark[] = [];
  let current: SayShapeNode | null = null;
  const g = measuringContext(marks, () => current, measure ?? estimate, () => f.press?.open ?? []);
  const f: Frame = {
    g, font: (wt, size) => `${wt} ${size}px sans-serif`, colors: theme.colors, theme,
    defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0, ends: new Map(), time: duration,
    onNode: (n) => { current = n; }, notes: [],
    m: IDENTITY, press: { regions: [], open: [], copy: [], locate: stateLocate },
    clock: { duration, loop: strOf(scene, "loop", scope) !== "false" },
  };
  const at: Scope = (name) => (name === "t" ? f.time : name === "PI" ? Math.PI : scope(name));
  if (behavior) f.press!.drag = { scene: IDENTITY, w, h, count: 0 };
  paintScene(f, scene.children, at, w, h, undefined);
  // What a label with nothing under it sits on: the scene's background, or the card it's in.
  const bg = scene.props.bg === undefined ? undefined : strOf(scene, "bg", at);
  const under = (bg && colorOf(bg, { colors: theme.colors })) || theme.colors.raised;
  const over = f.press!.drag?.over;
  return { marks, regions: f.press!.regions, under, notes: f.notes ?? [], ...(over !== undefined ? { dragOver: over } : {}), ...(f.particlesOver !== undefined ? { particlesOver: f.particlesOver, particlesAsked: f.particlesAsked ?? 0 } : {}) };
}

function findProblems(marks: readonly Mark[], regions: readonly SceneRegion[], w: number, h: number, phoneW = PHONE_WIDTH): Diagnostic[] {
  const out: Diagnostic[] = [];
  const said = new Set<string>();
  const warn = (line: number, message: string) => {
    if (said.has(`${line}:${message}`) || out.length >= MAX_DRAWING_PROBLEMS) return;
    said.add(`${line}:${message}`);
    out.push({ line, severity: "warning", message: `Drawing: ${message}` });
  };
  const visible = (m: Mark) => m.alpha >= 0.15;
  const labels = marks.filter((m) => m.kind === "label" && visible(m) && m.text?.trim());
  // Solid boxes a label or line can collide with; a background that fills most of the picture doesn't count.
  const boxes = marks.filter((m) => m.filled && m.alpha >= 0.6 && (m.kind === "rect" || m.kind === "polygon") && area(m.bounds) < 0.6 * w * h);

  for (const l of labels) {
    if (l.cutBy !== undefined) warn(l.node.line, `the label ${quote(l.text!)} is cut off by the clipped group on line ${l.cutBy}. Move it inside or make the group bigger`);
    const b = l.bounds;
    const shown = overlap(b, { x: 0, y: 0, w, h });
    if (shown > 0 && shown < area(b) - 1) {
      const edge = b.x < 0 ? "left" : b.x + b.w > w ? "right" : b.y < 0 ? "top" : "bottom";
      warn(l.node.line, `the label ${quote(l.text!)} is cut off by the ${edge} edge of the picture. Move it in or make it smaller`);
    }
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!, b = labels[j]!;
      // The same words drawn twice, a little apart, is a deliberate shadow or outline.
      if (a.node === b.node || a.text!.trim() === b.text!.trim()) continue;
      if (overlap(a.bounds, b.bounds) > 0.25 * Math.min(area(a.bounds), area(b.bounds))) {
        warn(b.node.line, `the label ${quote(b.text!)} is drawn on top of ${quote(a.text!)} (line ${a.node.line}). Move one of them`);
      }
    }
  }
  for (const l of labels) {
    for (const box of boxes) {
      const share = overlap(l.bounds, box.bounds) / Math.max(1, area(l.bounds));
      if (share > 0.15 && share < 0.85) {
        warn(l.node.line, `the label ${quote(l.text!)} straddles the edge of the ${box.kind} on line ${box.node.line}. Put it fully inside or fully outside`);
      }
    }
  }
  for (const line of marks.filter((m) => m.ends && visible(m))) {
    const [[x1, y1], [x2, y2]] = line.ends!;
    for (const box of boxes) {
      if (box.order < line.order || box.node === line.node) continue;
      if (inside([x1, y1], box.bounds, 3) || inside([x2, y2], box.bounds, 3)) continue;
      let under = 0;
      for (let k = 1; k <= 9; k++) if (inside([x1 + ((x2 - x1) * k) / 10, y1 + ((y2 - y1) * k) / 10], box.bounds, -2)) under++;
      if (under >= 3) {
        warn(line.node.line, `this line runs under the ${box.kind} on line ${box.node.line}, so it looks connected to it. Route it around that shape, or end it at the shape's edge`);
      }
    }
  }
  // On a phone the whole picture shrinks to PHONE_WIDTH, and things to press shrink with it.
  const k = phoneW / w;
  // Shapes only hovered (on-hover=, no on=) aren't tapped, so they're not held to tap sizes.
  const pressable = regions.filter((r) => r.on || r.drag).map((r) => ({ r, b: regionBounds(r) })).filter((x): x is { r: SceneRegion; b: Rect } => !!x.b);
  for (const { r, b } of pressable) {
    if (overlap(b, { x: 0, y: 0, w, h }) <= 0) {
      warn(r.node.line, `this ${r.drag ? "draggable" : "pressable"} ${r.node.type} is outside the picture, so it can't be ${r.drag ? "dragged" : "pressed"}. Move it inside 0..${w} across and 0..${h} down`);
      continue;
    }
    if (Math.min(b.w, b.h) * k < MIN_PHONE_TARGET) {
      warn(r.node.line, `this ${r.drag ? "draggable" : "pressable"} ${r.node.type} is only ${Math.round(Math.min(b.w, b.h) * k)} px across on a phone, too small to tap. Make it at least ${Math.ceil(MIN_PHONE_TARGET / k)} scene pixels both ways`);
    }
  }
  for (let i = 0; i < pressable.length; i++) {
    for (let j = i + 1; j < pressable.length; j++) {
      const a = pressable[i]!, b = pressable[j]!;
      // A pressable shape inside a pressable group is meant to be there: its outlines are the group's too.
      if (a.r.node === b.r.node || contains(a.r, b.r) || contains(b.r, a.r)) continue;
      if (overlap(a.b, b.b) > 0.5 * Math.min(area(a.b), area(b.b))) {
        warn(b.r.node.line, `this pressable ${b.r.node.type} is mostly on top of the one on line ${a.r.node.line}, so a press can't tell them apart. Move them apart`);
      }
    }
  }
  for (const p of offPath(marks, regions)) warn(p.line, p.message);
  return out;
}

// ---------- markers just off their path ----------

/** The most marker-off-its-path warnings for one scene: one or two show the pattern. */
const MAX_OFF_PATH = 3;
/** Segments per chunk when looking for the nearest point on a long path. */
const CHUNK = 16;

interface Marker { line: number; order: number; x: number; y: number; r: number; name?: string; what: string; region?: SceneRegion }
interface Track { mark: Mark; hw: number; length: number; bounds: Rect; subs: Subpath[]; chunks: Array<{ b: Rect; sub: number; from: number; to: number }> }
interface Nearest { d: number; dx: number; dy: number; atEnd: boolean }

/** A prop that moves with the clock: t inside a {formula}, or t on its own. */
const movesWithClock = (raw: string | undefined) => raw !== undefined && (raw.trim() === "t" || [...raw.matchAll(/\{([^}]*)\}/g)].some((m) => /(^|[^\w.'"])t\b(?!\s*:)/.test(m[1]!)));

/**
 * Stations, pins and dots that sit a few pixels off the line they're meant to
 * be on: it looks like the line misses them. Only judged where the picture
 * shows the habit (at least two markers sit right on that path, and at least
 * as many as miss it), so scatter dots near a trend line, nodes whose links
 * end at their edge, and legends stay quiet.
 */
function offPath(marks: readonly Mark[], regions: readonly SceneRegion[]): Array<{ line: number; message: string }> {
  const tracks: Track[] = [];
  for (const m of marks) {
    if (!m.lines || m.alpha < 0.15 || !(m.width! > 0) || m.width! > 30) continue;
    let length = 0;
    const all: Array<[number, number]> = [];
    const chunks: Track["chunks"] = [];
    m.lines.forEach((s, si) => {
      for (let i = 1; i < s.pts.length; i++) length += Math.hypot(s.pts[i]![0] - s.pts[i - 1]![0], s.pts[i]![1] - s.pts[i - 1]![1]);
      for (let from = 0; from < s.pts.length - 1; from += CHUNK) {
        const to = Math.min(s.pts.length - 1, from + CHUNK);
        chunks.push({ b: boundsOf(s.pts.slice(from, to + 1))!, sub: si, from, to });
      }
      all.push(...s.pts);
    });
    const bounds = boundsOf(all);
    if (bounds && chunks.length) tracks.push({ mark: m, hw: m.width! / 2, length, bounds, subs: m.lines, chunks });
  }
  if (!tracks.length) return [];

  const markers: Marker[] = [];
  const seen = new Set<string>();
  // Pressable shapes judged as one marker; one too big to be one (a 44 px tap area around a
  // station) leaves the circle inside it to be judged instead.
  const judged = new Set<SceneRegion>();
  const add = (k: Marker, node: SayShapeNode) => {
    if (movesWithClock(node.props.x) || movesWithClock(node.props.y) || node.props.drag !== undefined) return;
    const key = `${Math.round(k.x)},${Math.round(k.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push(k);
  };
  for (const r of regions) {
    if (r.drag || r.node.type === "label" || r.geoms.some((g) => g.kind === "line" || g.kind === "polyline")) continue;
    const shapes = r.geoms.filter((g) => !(g.kind === "rect" && g.text));
    const b = shapes.length ? boundsOfPts(shapes.flatMap((g) => outline(g))) : null;
    if (!b || Math.max(b.w, b.h) > 36 || Math.min(b.w, b.h) < 3) continue;
    const named = regionName(r);
    const name = named !== "Shape" ? named : undefined;
    judged.add(r);
    add({ line: r.node.line, order: regions.indexOf(r), x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2, what: r.node.type, region: r, ...(name ? { name } : {}) }, r.node);
  }
  const labels = marks.filter((m) => m.kind === "label" && m.alpha >= 0.15 && m.text?.trim());
  for (const c of marks) {
    // Circles inside a pressable line are judged with it (or not at all, when it's dragged); inside
    // one too big to judge (a station's 44 px tap area), the circle is the station.
    if (c.kind !== "circle" || c.alpha < 0.15) continue;
    if (c.inside?.some((r) => judged.has(r) || r.drag)) continue;
    const r = Math.max(c.bounds.w, c.bounds.h) / 2;
    if (r > 12 || r < 1.5) continue;
    const x = c.bounds.x + c.bounds.w / 2, y = c.bounds.y + c.bounds.h / 2;
    let name: string | undefined, best = r + 24;
    for (const l of labels) {
      const d = Math.hypot(Math.max(l.bounds.x - x, 0, x - l.bounds.x - l.bounds.w), Math.max(l.bounds.y - y, 0, y - l.bounds.y - l.bounds.h));
      if (d <= best) { best = d; name = l.text!.trim(); }
    }
    add({ line: c.node.line, order: regions.length + c.order, x, y, r, what: "circle", ...(name ? { name } : {}) }, c.node);
  }

  const onCount = new Map<Track, number>(), missCount = new Map<Track, number>();
  const misses: Array<{ k: Marker; t: Track; d: number }> = [];
  for (const k of markers) {
    const near: Array<{ t: Track; n: Nearest }> = [];
    // A line of any length ending at its edge (a link, a pin's stem) means it's attached on purpose.
    let attached = false;
    for (const t of tracks) {
      if (k.region && t.mark.inside?.includes(k.region)) continue;
      // As far as a miss can be reported (limit, below), so a station a little further off is still found.
      const reach = Math.min(28, Math.max(20, k.r + t.hw + 12));
      const b = t.bounds;
      if (k.x < b.x - reach || k.x > b.x + b.w + reach || k.y < b.y - reach || k.y > b.y + b.h + reach) continue;
      const n = nearestOn(t, k.x, k.y, reach);
      if (!n) continue;
      if (n.atEnd && n.d <= k.r + t.hw + 2) attached = true;
      if (t.length >= Math.max(40, 6 * k.r)) near.push({ t, n });
    }
    const on = new Set(near.filter(({ t, n }) => n.d <= Math.max(2, t.hw + 1)).map((x) => x.t));
    // A pill or ring spanning two lines (an interchange) is on both: its centre sits between them.
    const spanning = near.filter(({ t, n }) => n.d <= k.r + t.hw);
    for (let i = 0; i < spanning.length; i++) {
      for (let j = i + 1; j < spanning.length; j++) {
        const a = spanning[i]!.n, c = spanning[j]!.n;
        if (a.dx * c.dx + a.dy * c.dy < 0) { on.add(spanning[i]!.t); on.add(spanning[j]!.t); }
      }
    }
    for (const t of on) onCount.set(t, (onCount.get(t) ?? 0) + 1);
    if (on.size || attached) continue;
    const closest = near.sort((a, b) => a.n.d - b.n.d)[0];
    if (!closest) continue;
    const { t, n } = closest;
    // A miss up to a station's own size past the line's edge still looks like a miss (a corner
    // rounded with round= moves the line a little further away), so the reach grows with both.
    const limit = Math.min(28, Math.max(12, k.r + t.hw + 12));
    if (n.d > limit || n.atEnd) continue;
    missCount.set(t, (missCount.get(t) ?? 0) + 1);
    misses.push({ k, t, d: n.d });
  }
  return misses
    .filter(({ t }) => (onCount.get(t) ?? 0) >= 2 && (onCount.get(t) ?? 0) >= (missCount.get(t) ?? 0))
    .sort((a, b) => a.k.line - b.k.line || a.k.order - b.k.order)
    .slice(0, MAX_OFF_PATH)
    .map(({ k, t, d }) => {
      const kind = t.mark.node.type;
      const who = k.name ? `the marker ${quote(k.name)} is` : `this ${k.what === "use" ? "shape" : k.what} is`;
      return { line: k.line, message: `${who} ${Math.round(d)} px off the ${kind} on line ${t.mark.node.line}, so it looks like it misses it. Move its centre onto the ${kind}, or well clear of it if it isn't meant to be on it` };
    });
}

/** The nearest point of a track to (x, y), if any is within reach; atEnd when it's an open end of the line. */
function nearestOn(t: Track, x: number, y: number, reach: number): Nearest | null {
  let best: Nearest | null = null;
  let bestD = reach;
  for (const c of t.chunks) {
    if (x < c.b.x - bestD || x > c.b.x + c.b.w + bestD || y < c.b.y - bestD || y > c.b.y + c.b.h + bestD) continue;
    const s = t.subs[c.sub]!;
    for (let i = c.from + 1; i <= c.to; i++) {
      const [x1, y1] = s.pts[i - 1]!, [x2, y2] = s.pts[i]!;
      const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
      const u = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
      const px = x1 + u * dx, py = y1 + u * dy;
      const d = Math.hypot(x - px, y - py);
      if (d > bestD) continue;
      const first = s.pts[0]!, last = s.pts[s.pts.length - 1]!;
      const atEnd = !s.closed && (Math.hypot(px - first[0], py - first[1]) <= 2 || Math.hypot(px - last[0], py - last[1]) <= 2);
      bestD = d;
      best = { d, dx: px - x, dy: py - y, atEnd };
    }
  }
  return best;
}

/**
 * Labels too small to read on a phone, as one warning: they're usually most
 * of a scene's labels at once, and one warning each would crowd out every
 * other problem. It asks for bigger words, not a smaller w, because a small
 * w makes the whole scene huge on a wide screen.
 */
function phoneText(marks: readonly Mark[], w: number, phoneW = PHONE_WIDTH): Diagnostic | null {
  const k = phoneW / w;
  const small = marks
    .filter((m) => m.kind === "label" && m.alpha >= 0.15 && m.text?.trim())
    .map((l) => ({ l, px: (l.size ?? l.bounds.h) * k }))
    .filter((x) => x.px < MIN_PHONE_TEXT)
    .sort((a, b) => a.px - b.px);
  const first = small[0];
  if (!first) return null;
  const need = Math.ceil(MIN_PHONE_TEXT / k);
  const which = small.length === 1
    ? `the label ${quote(first.l.text!)} is only ${first.px.toFixed(1)} px tall on a phone`
    : `${new Set(small.map((x) => x.l.node)).size === 1 ? `${small.length} copies of this label are` : `${small.length} labels are`} too small to read on a phone, the smallest ${quote(first.l.text!)} only ${first.px.toFixed(1)} px tall`;
  return { line: first.l.node.line, severity: "warning", message: `Drawing: ${which}. Make every label's size at least ${need} at w=${w}` };
}

/** A name that reads the scene's clock: t inside a {formula}, unless an each or a drawing names something else t. */
function readsClock(scene: SayShapeNode): boolean {
  let clock = false, shadowed = false;
  const walk = (n: SayShapeNode) => {
    if (n.props.as === "t" || n.props.index === "t") shadowed = true;
    // Particles move with the clock without saying t.
    if (n.type === "emit") clock = true;
    for (const v of [...Object.values(n.props), n.text ?? ""]) {
      for (const m of v.matchAll(/\{([^}]*)\}/g)) if (/(^|[^\w.'"])t\b(?!\s*:)/.test(m[1]!)) clock = true;
    }
    n.children.forEach(walk);
  };
  scene.children.forEach(walk);
  return clock && !shadowed;
}

/** Whether inner is drawn inside outer (a pressable shape in a pressable group). */
const contains = (outer: SceneRegion, inner: SceneRegion) => {
  for (let p = inner.parent; p; p = p.parent) if (p === outer) return true;
  return false;
};

// ---------- contrast ----------

interface Rgba { r: number; g: number; b: number; a: number }

/** A color the drawing used, as numbers: #hex, rgb(a) or hsl(a). Null for names and anything else. */
export function parseColor(raw: string): Rgba | null {
  const v = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    let d = hex[1]!;
    if (d.length <= 4) d = d.split("").map((c) => c + c).join("");
    const n = (i: number) => parseInt(d.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: d.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (s: string, max: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * max : parseFloat(s));
  const a = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (fn[1]!.startsWith("rgb")) {
    const [r, g, b] = parts.map((p) => num(p, 255));
    return [r, g, b, a].every(Number.isFinite) ? { r: r!, g: g!, b: b!, a } : null;
  }
  const hue = parseFloat(parts[0]!), sat = num(parts[1]!, 1), light = num(parts[2]!, 1);
  if (![hue, sat, light, a].every(Number.isFinite)) return null;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((hue % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = light - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255, a };
}

const luminance = (c: Rgba) => {
  const ch = (v: number) => { const s = Math.min(255, Math.max(0, v)) / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
};
export const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top: Rgba, alpha: number, under: Rgba): Rgba => {
  const a = Math.min(1, Math.max(0, top.a * alpha));
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
};

/**
 * Labels too close in color to what's under their middle: the last solid
 * shape drawn before them there, else the background. Only plain colors are
 * compared; a label over a gradient, a see-through shape or a color name
 * isn't judged, so art isn't flagged for what this can't know.
 */
interface LowContrast { key: string; line: number; text: string; ratio: number; dark: boolean; color: string; under: string }

function lowContrast(marks: readonly Mark[], background: string, theme: Theme): LowContrast[] {
  const out: LowContrast[] = [];
  const bg = parseColor(background);
  for (const l of marks) {
    if (l.kind !== "label" || !l.text?.trim() || !l.color || l.alpha < 0.6) continue;
    // The same words drawn again over these are a shadow or an outline: the words on top are the ones read.
    if (marks.some((o) => o.order > l.order && o.kind === "label" && o.text === l.text && overlap(o.bounds, l.bounds) > 0)) continue;
    const ink = parseColor(l.color);
    if (!ink || ink.a < 0.6) continue;
    const cx = l.bounds.x + l.bounds.w / 2, cy = l.bounds.y + l.bounds.h / 2;
    let under: Rgba | null | undefined;
    for (let i = l.order - 1; i >= 0; i--) {
      const m = marks[i]!;
      if (!m.filled || m.kind === "label" || m.alpha < 0.95) continue;
      const b = m.bounds;
      if (cx < b.x || cx > b.x + b.w || cy < b.y || cy > b.y + b.h) continue;
      // A gradient, a name or a see-through fill: unknown, so no verdict.
      const c = m.color ? parseColor(m.color) : null;
      under = c && c.a >= 0.95 ? c : null;
      break;
    }
    if (under === null) continue;
    const base = under ?? bg;
    if (!base || base.a < 0.95) continue;
    const ratio = contrast(over(ink, l.alpha, base), base);
    if (ratio < MIN_CONTRAST) out.push({ key: `${l.node.line}:${l.text}`, line: l.node.line, text: l.text, ratio, dark: theme === darkTheme, color: l.color, under: base === bg ? "background" : `${base.r},${base.g},${base.b}` });
  }
  return out;
}

/**
 * Draggable shapes that move up or down take vertical swipes that start on
 * them away from the page (behavior on). Covering more than a third of the
 * picture on a phone, they make the page hard to scroll past.
 */
function swipeTraps(regions: readonly SceneRegion[], w: number, h: number): Diagnostic[] {
  let covered = 0;
  let first: SceneRegion | undefined;
  for (const r of regions) {
    if (!r.drag?.y) continue;
    const b = regionBounds(r);
    if (!b) continue;
    covered += overlap(b, { x: 0, y: 0, w, h });
    first ??= r;
  }
  if (!first || covered <= (w * h) / 3) return [];
  return [{ line: first.node.line, severity: "warning", message: `Drawing: shapes people drag up and down cover over a third of the picture, so on a phone a finger on them moves them instead of scrolling the page. Make them smaller, or let them move only across (x=)` }];
}

/** Drawing problems in every scene of a parsed spec, with its state and derived values filled in. */
export function reviewScenes(parsed: Pick<ParseResult, "root" | "state" | "derived">, opts: { theme?: Theme; measure?: MeasureText; behavior?: boolean } = {}): Diagnostic[] {
  const store = new Store();
  for (const s of parsed.state) store.declare(s.key, s.value);
  store.derive(parsed.derived);
  const scope: Scope = (name) => store.get(name) as Value | undefined;
  const out: Diagnostic[] = [];
  const walk = (n: SayShapeNode) => {
    if (n.type === "scene") out.push(...reviewScene(n, scope, opts));
    else n.children.forEach(walk);
  };
  walk(parsed.root);
  return out.slice(0, MAX_DRAWING_PROBLEMS);
}

