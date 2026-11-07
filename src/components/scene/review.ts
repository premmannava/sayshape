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
 * - a line that runs under a box drawn after it, so what it connects is hidden.
 *
 * These are warnings for the model to tidy up, not errors: the scene still
 * shows. Headless, like layout: no canvas or DOM, so it runs on a server.
 */
import type { Diagnostic, SayShapeNode, Value } from "../../types";
import type { Scope } from "../../expr";
import type { ParseResult } from "../../parser";
import { Store } from "../../state";
import { lightTheme, type Theme } from "../../theme";
import { paintScene, numOf, type Frame } from "./draw";

/** The most drawing problems reported for one spec; the first few are what a model needs. */
export const MAX_DRAWING_PROBLEMS = 8;

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
}

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
function measuringContext(marks: Mark[], current: () => SayShapeNode | null, measure: MeasureText): CanvasRenderingContext2D {
  type State = { m: Matrix; alpha: number; font: string; align: string };
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
  const mark = (filled: boolean) => {
    const node = current();
    const b = boundsOf(path);
    if (!node || !b) return;
    const ends = node.type === "line" && segment.length >= 2 ? [segment[0]!, segment[segment.length - 1]!] as [[number, number], [number, number]] : undefined;
    marks.push({ node, order: marks.length, kind: node.type, bounds: b, filled, alpha: st.alpha, ...(ends ? { ends } : {}) });
  };
  const ctx = {
    get globalAlpha() { return st.alpha; },
    set globalAlpha(v: number) { st.alpha = v; },
    get font() { return st.font; },
    set font(v: string) { st.font = v; },
    get textAlign() { return st.align; },
    set textAlign(v: string) { st.align = v; },
    textBaseline: "middle", fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "round", lineJoin: "round",
    save() { stack.push({ ...st, m: [...st.m] as Matrix }); },
    restore() { st = stack.pop() ?? st; },
    translate(x: number, y: number) { st.m = mul(st.m, [1, 0, 0, 1, x, y]); },
    rotate(a: number) { st.m = mul(st.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x: number, y: number) { st.m = mul(st.m, [x, 0, 0, y, 0, 0]); },
    beginPath() { path = []; segment = []; },
    moveTo: add, lineTo: add,
    quadraticCurveTo(a: number, b: number, x: number, y: number) { add(a, b); add(x, y); },
    bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { add(a, b); add(c, d); add(x, y); },
    arc(x: number, y: number, r: number) { round(x, y, r, r); },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number) { round(x, y, rx, ry, rot); },
    closePath() {},
    clip() {},
    setLineDash() {},
    fill() { mark(true); },
    stroke() { mark(false); },
    fillRect(x: number, y: number, w: number, h: number) { path = []; add(x, y); add(x + w, y + h); },
    measureText(text: string) { return { width: measure(text, sizeOf(st.font), boldOf(st.font)) }; },
    fillText(text: string, x: number, y: number) {
      const node = current();
      if (!node) return;
      const size = sizeOf(st.font), w = measure(text, size, boldOf(st.font));
      const left = st.align === "center" ? x - w / 2 : st.align === "right" ? x - w : x;
      const corners: Array<[number, number]> = [[left, y - size / 2], [left + w, y - size / 2], [left, y + size / 2], [left + w, y + size / 2]];
      const b = boundsOf(corners.map(([cx, cy]) => apply(st.m, cx, cy)))!;
      marks.push({ node, order: marks.length, kind: "label", bounds: b, filled: true, alpha: st.alpha, text });
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
const overlap = (a: Rect, b: Rect) => area({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) });
const inside = (p: [number, number], r: Rect, pad: number) => p[0] > r.x - pad && p[0] < r.x + r.w + pad && p[1] > r.y - pad && p[1] < r.y + r.h + pad;
const quote = (s: string) => (s.length > 32 ? `"${s.slice(0, 30)}…"` : `"${s}"`);

/** Drawing problems in one scene, drawn as it rests. Never throws. */
export function reviewScene(scene: SayShapeNode, scope: Scope, opts: { theme?: Theme; measure?: MeasureText } = {}): Diagnostic[] {
  try {
    const w = Math.max(1, numOf(scene, "w", scope, 600)), h = Math.max(1, numOf(scene, "h", scope, 340));
    const duration = Math.max(0, numOf(scene, "duration", scope, 0));
    const at: Scope = (name) => (name === "t" ? duration : name === "PI" ? Math.PI : scope(name));
    const marks: Mark[] = [];
    let current: SayShapeNode | null = null;
    const g = measuringContext(marks, () => current, opts.measure ?? estimate);
    const f: Frame = {
      g, font: (wt, size) => `${wt} ${size}px sans-serif`, colors: (opts.theme ?? lightTheme).colors,
      defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0,
      onNode: (n) => { current = n; },
    };
    paintScene(f, scene.children, at, w, h, undefined);
    return findProblems(marks, w, h);
  } catch {
    return [];
  }
}

function findProblems(marks: readonly Mark[], w: number, h: number): Diagnostic[] {
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
  return out;
}

/** Drawing problems in every scene of a parsed spec, with its state and derived values filled in. */
export function reviewScenes(parsed: Pick<ParseResult, "root" | "state" | "derived">, opts: { theme?: Theme; measure?: MeasureText } = {}): Diagnostic[] {
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

