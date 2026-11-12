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
 * - pressable shapes on top of each other, or outside the picture.
 *
 * It doesn't check the animation's other moments: what moves is usually
 * meant to cross other things on its way.
 *
 * These are warnings for the model to tidy up, not errors: the scene still
 * shows. Headless, like layout: no canvas or DOM, so it runs on a server.
 */
import { MAX_DRAGGABLE } from "./drag";
import type { Diagnostic, SayShapeNode, Value } from "../../types";
import type { Scope } from "../../expr";
import type { ParseResult } from "../../parser";
import { Store } from "../../state";
import { darkTheme, lightTheme, type Theme } from "../../theme";
import { colorOf, paintScene, numOf, strOf, type Frame } from "./draw";
import { IDENTITY, regionBounds, type SceneRegion } from "./interact";
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
  const mark = (filled: boolean) => {
    const node = current();
    const b = boundsOf(path);
    if (!node || !b) return;
    const ends = node.type === "line" && segment.length >= 2 ? [segment[0]!, segment[segment.length - 1]!] as [[number, number], [number, number]] : undefined;
    const color = filled && typeof fillNow === "string" ? fillNow : undefined;
    marks.push({ node, order: marks.length, kind: node.type, bounds: b, filled, alpha: st.alpha, ...(ends ? { ends } : {}), ...(color ? { color } : {}) });
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
      const stretch = Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2]));
      marks.push({ node, order: marks.length, kind: "label", bounds: b, filled: true, alpha: st.alpha, text, size: size * stretch, ...(typeof fillNow === "string" ? { color: fillNow } : {}) });
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
export function reviewScene(scene: SayShapeNode, scope: Scope, opts: { theme?: Theme; measure?: MeasureText; behavior?: boolean } = {}): Diagnostic[] {
  try {
    const w = Math.max(1, numOf(scene, "w", scope, 600)), h = Math.max(1, numOf(scene, "h", scope, 340));
    const theme = opts.theme ?? lightTheme;
    const drawn = drawAtRest(scene, scope, theme, opts.measure, !!opts.behavior);
    const out: Diagnostic[] = [];
    // A scene whose formulas read t but that has no duration is a still picture: it never moves.
    if (!(numOf(scene, "duration", scope, 0) > 0) && readsClock(scene)) {
      out.push({ line: scene.line, severity: "warning", message: "Drawing: this scene's formulas use t, but its duration is 0, so it never moves. Set duration= to the seconds the motion takes (loop=true, the default, repeats it)" });
    }
    out.push(...findProblems(drawn.marks, drawn.regions, w, h));
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
    const phone = phoneText(drawn.marks, w);
    if (phone) return [...out.slice(0, MAX_DRAWING_PROBLEMS - 1), phone];
    return out.slice(0, MAX_DRAWING_PROBLEMS);
  } catch {
    return [];
  }
}

/** The scene drawn as it rests (its last moment), as marks and pressable regions in scene coordinates. */
function drawAtRest(scene: SayShapeNode, scope: Scope, theme: Theme, measure: MeasureText | undefined, behavior: boolean): { marks: Mark[]; regions: SceneRegion[]; under: string; dragOver?: number } {
  const w = Math.max(1, numOf(scene, "w", scope, 600)), h = Math.max(1, numOf(scene, "h", scope, 340));
  const duration = Math.max(0, numOf(scene, "duration", scope, 0));
  const at: Scope = (name) => (name === "t" ? duration : name === "PI" ? Math.PI : scope(name));
  const marks: Mark[] = [];
  let current: SayShapeNode | null = null;
  const g = measuringContext(marks, () => current, measure ?? estimate);
  const f: Frame = {
    g, font: (wt, size) => `${wt} ${size}px sans-serif`, colors: theme.colors,
    defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0,
    onNode: (n) => { current = n; },
    m: IDENTITY, press: { regions: [], open: [], copy: [], locate: stateLocate },
  };
  if (behavior) f.press!.drag = { scene: IDENTITY, w, h, count: 0 };
  paintScene(f, scene.children, at, w, h, undefined);
  // What a label with nothing under it sits on: the scene's background, or the card it's in.
  const bg = scene.props.bg === undefined ? undefined : strOf(scene, "bg", at);
  const under = (bg && colorOf(bg, { colors: theme.colors })) || theme.colors.raised;
  const over = f.press!.drag?.over;
  return { marks, regions: f.press!.regions, under, ...(over !== undefined ? { dragOver: over } : {}) };
}

function findProblems(marks: readonly Mark[], regions: readonly SceneRegion[], w: number, h: number): Diagnostic[] {
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
  // On a phone the whole picture shrinks to PHONE_WIDTH, and things to press shrink with it.
  const k = PHONE_WIDTH / w;
  const pressable = regions.map((r) => ({ r, b: regionBounds(r) })).filter((x): x is { r: SceneRegion; b: Rect } => !!x.b);
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
  return out;
}

/**
 * Labels too small to read on a phone, as one warning: they're usually most
 * of a scene's labels at once, and one warning each would crowd out every
 * other problem. It asks for bigger words, not a smaller w, because a small
 * w makes the whole scene huge on a wide screen.
 */
function phoneText(marks: readonly Mark[], w: number): Diagnostic | null {
  const k = PHONE_WIDTH / w;
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

