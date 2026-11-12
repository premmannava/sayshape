/**
 * Drawing a scene's lines onto a 2D context: reading their props (with scene
 * math), resolving colors and gradients, and painting each shape. The scene
 * element paints with it every frame; the drawing check (review.ts) runs it
 * against a context that measures instead of painting.
 */
import { literal } from "../../actions";
import { evaluate, interpolate, wholeExpression, type Scope } from "../../expr";
import { DEFAULT_AS } from "../../each";
import { isList, isRecord } from "../../data";
import type { Theme } from "../../theme";
import type { SayShapeNode, Value } from "../../types";
import { SCENE_FUNCTIONS } from "./functions";
import { points, tracePath, type Bounds } from "./path";
import { flattenPath, rotate, scale, translate, type Geom, type Matrix, type SceneRegion } from "./interact";
import { PATH, placeOf, type Locate } from "../../paths";
import { dragInfoOf, MAX_DRAGGABLE, type DragInfo } from "./drag";
import { isScalar } from "../../data";

/** The most shapes a scene draws in one frame; past it, the rest are left out. */
export const MAX_SCENE_SHAPES = 2000;
/** The most lines a scene works through in one frame (shapes, each copies, uses), so nothing can stall it. */
export const MAX_SCENE_STEPS = 20000;
/** How deep `use` may go inside other uses, so a drawing that uses itself stops. */
export const MAX_USE_DEPTH = 8;

// ---------- reading props inside a scene ----------

const BARE = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;

/** A prop as a value: {formula}, "text with {formula}", a bare name, or a literal. Scene math included. */
function read(node: SayShapeNode, key: string, scope: Scope): Value | undefined {
  const raw = node.props[key];
  if (raw === undefined) return undefined;
  const whole = wholeExpression(raw);
  if (whole !== null) {
    const r = evaluate(whole, scope, SCENE_FUNCTIONS);
    return r.ok ? r.value : undefined;
  }
  if (raw.includes("{")) return interpolate(raw, scope, SCENE_FUNCTIONS);
  if (node.quoted?.includes(key)) return raw;
  if (BARE.test(raw) && !["true", "false", "null"].includes(raw)) {
    const r = evaluate(raw, scope, SCENE_FUNCTIONS);
    if (r.ok && r.value !== undefined) return r.value;
  }
  return literal(raw);
}

export const numOf = (node: SayShapeNode, key: string, scope: Scope, fallback = 0): number => {
  const v = read(node, key, scope);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
export const strOf = (node: SayShapeNode, key: string, scope: Scope): string | undefined => {
  const v = read(node, key, scope);
  return v === undefined || v === null ? undefined : String(v);
};

/** Colors the canvas understands, nothing else: hex, rgb(a), hsl(a) and CSS color names. */
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%+-]*\))$/i;
/**
 * CSS color names. An unknown name would make the canvas keep the color it
 * had, painting a shape in the previous shape's color, so only these pass.
 */
const CSS_NAMES = new Set("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent".split(" "));
const isColor = (v: string) => COLOR.test(v) || CSS_NAMES.has(v.toLowerCase());

/**
 * Theme colors a scene can name instead of writing a color: fill=accent,
 * stroke=line, fill="bad 15%" (faded). They follow the app's theme, so a
 * scene stays on-brand and switches with dark mode. text is another name for ink.
 */
export const THEME_COLORS = ["accent", "onAccent", "good", "warn", "bad", "ink", "text", "muted", "surface", "raised", "line", "series1", "series2", "series3", "series4", "series5", "series6"] as const;
const THEME_NAME = new RegExp(`^(${THEME_COLORS.join("|")})(?:\\s+(\\d{1,3})%)?$`);

/** "#RRGGBB" (or #RGB) at an opacity, as rgba(); anything else as it is. */
function faded(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

/** A color as the canvas wants it: a theme color by name (maybe faded), or a checked literal color. Null when it's neither. */
export function colorOf(raw: string, f: Pick<Frame, "colors">): string | null {
  const v = raw.trim();
  const themed = THEME_NAME.exec(v);
  if (themed) {
    const key = themed[1] === "text" ? "ink" : themed[1] as keyof Theme["colors"];
    const base = f.colors[key];
    if (typeof base !== "string") return null;
    return themed[2] === undefined ? base : faded(base, Math.min(100, Number(themed[2])) / 100);
  }
  return isColor(v) ? v : null;
}
const GRADIENT_REF = /^url\(#?([A-Za-z_][\w-]*)\)$/;

// ---------- painting ----------

export interface Frame {
  g: CanvasRenderingContext2D;
  /** A canvas font for a weight and size, in the theme's family. */
  font: (weight: number, size: number) => string;
  /** The theme's colors, for fill=accent and the other theme color names. */
  colors: Theme["colors"];
  defs: Map<string, SayShapeNode>;
  gradients: Map<string, SayShapeNode>;
  shapes: number;
  steps: number;
  useDepth: number;
  /** Told about each element just before it's drawn (the drawing check uses this to know what drew what). */
  onNode?: (node: SayShapeNode) => void;
  /** Scene coordinates to canvas pixels, through every group, use and turn so far. */
  m: Matrix;
  /**
   * Set to record pressable shapes (on=) as they're drawn: the regions in the
   * order they start, the ones open around the line being drawn, and which
   * each copy and use the drawing is inside (for stable keys).
   */
  press?: {
    regions: SceneRegion[]; open: SceneRegion[]; copy: string[]; alpha?: number; locate: Locate;
    /** Behavior on: drag=true lines are recorded too, with the scene's own matrix and size to keep them inside it. */
    drag?: { scene: Matrix; w: number; h: number; count: number; over?: number };
  };
}

/** define and gradient lines anywhere in the scene (not inside a define's own drawing). */
export function collect(nodes: readonly SayShapeNode[], f: Frame): void {
  for (const n of nodes) {
    if (n.type === "define" && n.text) f.defs.set(n.text, n);
    else if (n.type === "gradient" && n.props.id) f.gradients.set(n.props.id, n);
    if (n.type !== "define") collect(n.children, f);
  }
}

/** A fill or stroke: a checked color, or a gradient over these bounds. */
function paintOf(raw: string | undefined, bounds: Bounds, f: Frame, scope: Scope): string | CanvasGradient | null {
  if (raw === undefined) return null;
  const v = raw.trim();
  if (v === "none" || v === "") return null;
  const ref = GRADIENT_REF.exec(v);
  if (ref) {
    const gn = f.gradients.get(ref[1]!);
    if (!gn) return null;
    const from = colorOf(strOf(gn, "from", scope) ?? "#ffffff", f), to = colorOf(strOf(gn, "to", scope) ?? "#000000", f);
    if (!from || !to) return null;
    const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
    let grad: CanvasGradient;
    if (strOf(gn, "kind", scope) === "radial") {
      grad = f.g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bounds.w, bounds.h, 1) / 2);
    } else {
      // angle=90 runs top to bottom, 0 left to right, like SVG's rotate around the middle.
      const a = (numOf(gn, "angle", scope, 90) * Math.PI) / 180;
      const len = Math.abs(bounds.w * Math.cos(a)) + Math.abs(bounds.h * Math.sin(a));
      const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
      grad = f.g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    }
    grad.addColorStop(0, from);
    grad.addColorStop(1, to);
    return grad;
  }
  return colorOf(v, f);
}

/** shadow=: how far down it falls and how soft it is, in scene pixels. */
const SHADOWS: Record<string, readonly [number, number]> = { sm: [2, 5], md: [5, 14], lg: [10, 28] };
/** A shadow is the same soft dark in every theme: darker on dark pages, where there's less to stand out from. */
const SHADOW_COLOR = "rgba(0, 0, 0, 0.3)";
/** How far a glow spreads, in scene pixels. */
const GLOW_BLUR = 18;

/** One plain color for a fill or stroke: a gradient gives its first color. */
function solidOf(raw: string | undefined, f: Frame, scope: Scope): string | null {
  if (raw === undefined) return null;
  const ref = GRADIENT_REF.exec(raw.trim());
  if (!ref) return colorOf(raw, f);
  const gn = f.gradients.get(ref[1]!);
  const from = gn && strOf(gn, "from", scope);
  return from ? colorOf(from, f) : null;
}

/**
 * Turn on the shape's glow= or shadow= for the next fill or stroke; false when it has neither.
 * The canvas measures shadows in its own pixels, whatever the scale, so sizes follow the drawing's scale here.
 */
function depthOn(node: SayShapeNode, scope: Scope, f: Frame, own: string | null): boolean {
  if (node.props.glow === undefined && node.props.shadow === undefined) return false;
  const g = f.g;
  const t = g.getTransform();
  const k = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  const glow = node.props.glow === undefined ? false : read(node, "glow", scope);
  if ((glow === true || glow === "true") && own) {
    g.shadowColor = own; g.shadowBlur = GLOW_BLUR * k; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
    return true;
  }
  const size = SHADOWS[strOf(node, "shadow", scope) ?? ""];
  if (!size) return false;
  g.shadowColor = SHADOW_COLOR; g.shadowBlur = size[1] * k; g.shadowOffsetX = 0; g.shadowOffsetY = size[0] * k;
  return true;
}
function depthOff(g: CanvasRenderingContext2D): void {
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
}

/** shine=true: light from the upper left and a darker far edge over the fill, so a circle reads as a ball. */
function shine(g: CanvasRenderingContext2D, b: Bounds): void {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.max(b.w, b.h, 1) / 2;
  const light = g.createRadialGradient(b.x + b.w * 0.34, b.y + b.h * 0.3, 0, cx, cy, r);
  light.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  light.addColorStop(0.55, "rgba(255, 255, 255, 0)");
  light.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  light.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  g.fillStyle = light;
  g.fill();
}

/** Fill and stroke the path just traced, with the shape's paint props. */
function finishShape(node: SayShapeNode, scope: Scope, bounds: Bounds, f: Frame, defaultFill: string | null): void {
  const g = f.g;
  const fillRaw = node.props.fill === undefined ? (defaultFill ?? undefined) : strOf(node, "fill", scope);
  const fill = paintOf(fillRaw, bounds, f, scope);
  const strokeRaw = node.props.stroke === undefined ? undefined : strOf(node, "stroke", scope);
  // The shadow or glow goes under whichever is painted first, once.
  let deep = depthOn(node, scope, f, solidOf(fill ? fillRaw : strokeRaw, f, scope));
  if (fill) {
    g.fillStyle = fill; g.fill();
    if (deep) { depthOff(g); deep = false; }
    const lit = node.props.shine === undefined ? false : read(node, "shine", scope);
    if (lit === true || lit === "true") shine(g, bounds);
  }
  const stroke = paintOf(strokeRaw, bounds, f, scope);
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(0, numOf(node, "width", scope, 1));
    g.lineCap = "round";
    g.lineJoin = "round";
    const dash = strOf(node, "dash", scope);
    g.setLineDash(dash ? (dash.match(/\d+(\.\d+)?/g) ?? []).map(Number).filter((x) => x >= 0).slice(0, 8) : []);
    g.stroke();
  }
  if (deep) depthOff(g);
}

/** Apply opacity and a rotation around (cx, cy), then draw, then undo them. */
function withLook(node: SayShapeNode, scope: Scope, f: Frame, cx: number, cy: number, draw: () => void): void {
  const g = f.g;
  g.save();
  if (node.props.opacity !== undefined) g.globalAlpha *= Math.min(1, Math.max(0, numOf(node, "opacity", scope, 1)));
  const deg = node.props.rotate === undefined ? 0 : numOf(node, "rotate", scope, 0);
  const was = f.m;
  if (deg) {
    g.translate(cx, cy); g.rotate((deg * Math.PI) / 180); g.translate(-cx, -cy);
    f.m = translate(rotate(translate(f.m, cx, cy), (deg * Math.PI) / 180), -cx, -cy);
  }
  draw();
  f.m = was;
  g.restore();
}

/** Lines that can be pressed: shapes, groups and uses with on=. */
const PRESSABLE = new Set(["rect", "circle", "ellipse", "line", "path", "polygon", "label", "group", "use"]);
/** Lines with one x and y, which drag=true can move (behavior on). */
const DRAGGABLE = new Set(["rect", "circle", "ellipse", "label", "group", "use"]);

/** Start recording a pressable or draggable line, or null when it isn't one (or nothing's recording). */
function openRegion(node: SayShapeNode, scope: Scope, f: Frame): SceneRegion | null {
  const rec = f.press;
  if (!rec || !PRESSABLE.has(node.type)) return null;
  const on = node.props.on?.trim() ?? "";
  let drag: DragInfo | undefined;
  const dr = rec.drag;
  if (dr && node.props.drag !== undefined && DRAGGABLE.has(node.type) && dr.count < MAX_DRAGGABLE) {
    const v = read(node, "drag", scope);
    if (v === true || v === "true") {
      drag = dragInfoOf(node.props, scope, numOf(node, "x", scope), numOf(node, "y", scope), f.m, dr.scene, dr.w, dr.h);
      if (drag) dr.count++;
    }
  } else if (dr && node.props.drag !== undefined && DRAGGABLE.has(node.type)) dr.over = node.line;
  if (!on && !drag) return null;
  const sel = node.props.selected === undefined ? undefined : read(node, "selected", scope);
  const r: SceneRegion = {
    key: rec.copy.length ? `${node.id}#${rec.copy.join(".")}` : node.id,
    node, scope, on, locate: rec.locate, geoms: [], words: [],
    ...(drag ? { drag } : {}),
  };
  const parent = rec.open[rec.open.length - 1];
  if (parent) r.parent = parent;
  const tip = node.props.tip === undefined ? undefined : strOf(node, "tip", scope);
  const name = node.props.name === undefined ? undefined : strOf(node, "name", scope);
  if (tip) r.tip = tip;
  if (name) r.name = name;
  if (sel !== undefined) r.selected = !!sel && sel !== "false";
  rec.regions.push(r);
  rec.open.push(r);
  return r;
}

function closeRegion(r: SceneRegion | null, f: Frame): void {
  if (r && f.press) f.press.open = f.press.open.filter((o) => o !== r);
}

/**
 * Give a drawn outline to every pressable line it's inside, unless the scene
 * faded it out (opacity near 0). Measured against the scene's own opacity, so
 * the engine fading a new scene in doesn't make it unpressable.
 */
function addGeom(f: Frame, geom: Geom): void {
  if (!f.press?.open.length || f.g.globalAlpha < 0.05 * (f.press.alpha ?? 1)) return;
  for (const r of f.press.open) r.geoms.push(geom);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + k, y);
  g.lineTo(x + w - k, y);
  if (k) g.quadraticCurveTo(x + w, y, x + w, y + k);
  g.lineTo(x + w, y + h - k);
  if (k) g.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  g.lineTo(x + k, y + h);
  if (k) g.quadraticCurveTo(x, y + h, x, y + h - k);
  g.lineTo(x, y + k);
  if (k) g.quadraticCurveTo(x, y, x + k, y);
  g.closePath();
}

/** Draw a scene's lines with this scope. Stops quietly at the shape and step limits. */
export function drawAll(nodes: readonly SayShapeNode[], scope: Scope, f: Frame): void {
  for (const node of nodes) {
    if (++f.steps > MAX_SCENE_STEPS || f.shapes >= MAX_SCENE_SHAPES) return;
    if (node.type === "define" || node.type === "gradient") continue;
    if (node.props.if !== undefined) {
      const r = evaluate(wholeExpression(node.props.if) ?? node.props.if, scope, SCENE_FUNCTIONS);
      if (!r.ok || !r.value) continue;
    }
    if (node.type === "if") { drawAll(node.children, scope, f); continue; }
    if (node.type === "each") { drawEach(node, scope, f); continue; }
    drawOne(node, scope, f);
  }
}

function drawEach(node: SayShapeNode, scope: Scope, f: Frame): void {
  const raw = node.props.items;
  if (raw === undefined) return;
  const expr = wholeExpression(raw) ?? raw;
  const r = evaluate(expr, scope, SCENE_FUNCTIONS);
  if (!r.ok || !isList(r.value)) return;
  const as = node.props.as ?? DEFAULT_AS, index = node.props.index;
  const items = r.value;
  const rec = f.press;
  // As each does: items of a list that's a path into state (machines, plant.lines) can be written through.
  const outer = rec?.locate;
  const listPlace = outer && PATH.test(expr.trim()) ? placeOf(expr.trim(), outer) : null;
  const keyExpr = node.props.key === undefined ? undefined : wholeExpression(node.props.key) ?? node.props.key;
  const seen = new Set<string>();
  for (let i = 0; i < items.length && f.steps <= MAX_SCENE_STEPS; i++) {
    const item = items[i]!;
    const own: Scope = (name) => (name === as ? item : name === index ? i : scope(name));
    if (rec && outer) {
      // Keys follow key= when it's given, so focus stays on the same item when the list is reordered.
      let key = String(i);
      if (keyExpr !== undefined) {
        const k = evaluate(keyExpr, own, SCENE_FUNCTIONS);
        if (k.ok && isScalar(k.value) && k.value !== null && k.value !== "") key = String(k.value);
      }
      if (seen.has(key)) key = `${key}@${i}`;
      seen.add(key);
      const place = listPlace && { key: listPlace.key, steps: [...listPlace.steps, i] };
      rec.copy.push(`${node.id}:${key}`);
      rec.locate = (name) => (name === as ? place : name === index ? null : outer(name));
      drawAll(node.children, own, f);
      rec.copy.pop();
      rec.locate = outer;
    } else {
      drawAll(node.children, own, f);
    }
  }
}

function drawOne(node: SayShapeNode, scope: Scope, f: Frame): void {
  const region = openRegion(node, scope, f);
  drawShape(node, scope, f);
  closeRegion(region, f);
}

function drawShape(node: SayShapeNode, scope: Scope, f: Frame): void {
  const g = f.g;
  f.onNode?.(node);
  const n = (k: string, d = 0) => numOf(node, k, scope, d);
  switch (node.type) {
    case "rect": {
      const x = n("x"), y = n("y"), w = Math.max(0, n("w")), h = Math.max(0, n("h"));
      const b = { x, y, w, h };
      f.shapes++;
      withLook(node, scope, f, x + w / 2, y + h / 2, () => {
        g.beginPath(); roundRect(g, x, y, w, h, n("rx")); finishShape(node, scope, b, f, "#000000");
        addGeom(f, { kind: "rect", m: f.m, x, y, w, h, r: Math.max(0, n("rx")) });
      });
      return;
    }
    case "circle": {
      const x = n("x"), y = n("y"), r = Math.max(0, n("r"));
      f.shapes++;
      withLook(node, scope, f, x, y, () => {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); finishShape(node, scope, { x: x - r, y: y - r, w: 2 * r, h: 2 * r }, f, "#000000");
        addGeom(f, { kind: "ellipse", m: f.m, x, y, rx: r, ry: r });
      });
      return;
    }
    case "ellipse": {
      const x = n("x"), y = n("y"), rx = Math.max(0, n("rx")), ry = Math.max(0, n("ry"));
      f.shapes++;
      withLook(node, scope, f, x, y, () => {
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); finishShape(node, scope, { x: x - rx, y: y - ry, w: 2 * rx, h: 2 * ry }, f, "#000000");
        addGeom(f, { kind: "ellipse", m: f.m, x, y, rx, ry });
      });
      return;
    }
    case "line": {
      const x1 = n("x1"), y1 = n("y1"), x2 = n("x2"), y2 = n("y2");
      const b = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      f.shapes++;
      // A line is all outline: it uses stroke, or black when none is given.
      const lined: SayShapeNode = node.props.stroke === undefined ? { ...node, props: { ...node.props, stroke: '"#000000"' } } : node;
      withLook(node, scope, f, b.x + b.w / 2, b.y + b.h / 2, () => {
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); finishShape({ ...lined, props: { ...lined.props, fill: "none" } }, scope, b, f, null);
        addGeom(f, { kind: "line", m: f.m, x1, y1, x2, y2, width: Math.max(0, n("width", 1)) });
      });
      return;
    }
    case "path": {
      const d = strOf(node, "d", scope) ?? "";
      f.shapes++;
      withLook(node, scope, f, 0, 0, () => {
        g.beginPath();
        const b = tracePath(d, g) ?? { x: 0, y: 0, w: 0, h: 0 };
        // A path with only an outline isn't filled, as in SVG paths drawn as lines.
        finishShape(node, scope, b, f, node.props.stroke === undefined ? "#000000" : null);
        if (f.press?.open.length) {
          const rings = flattenPath(d);
          const fill = node.props.fill === undefined ? (node.props.stroke === undefined ? "#000000" : undefined) : strOf(node, "fill", scope);
          if (fill !== undefined && fill.trim() !== "" && fill.trim() !== "none") addGeom(f, { kind: "poly", m: f.m, rings });
          else for (const pts of rings) addGeom(f, { kind: "polyline", m: f.m, pts, width: Math.max(0, n("width", 1)) });
        }
      });
      return;
    }
    case "polygon": {
      const pts = points(strOf(node, "points", scope) ?? "");
      if (pts.length < 2) return;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      f.shapes++;
      withLook(node, scope, f, b.x + b.w / 2, b.y + b.h / 2, () => {
        g.beginPath();
        g.moveTo(pts[0]![0], pts[0]![1]);
        for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
        g.closePath();
        finishShape(node, scope, b, f, "#000000");
        addGeom(f, { kind: "poly", m: f.m, rings: [pts] });
      });
      return;
    }
    case "label": {
      const x = n("x"), y = n("y"), size = Math.min(400, Math.max(1, n("size", 16)));
      const text = node.text === undefined ? "" : interpolate(node.text, scope, SCENE_FUNCTIONS);
      if (!text) return;
      f.shapes++;
      withLook(node, scope, f, x, y, () => {
        g.font = f.font(strOf(node, "weight", scope) === "bold" ? 800 : 500, size);
        const align = strOf(node, "align", scope);
        g.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
        g.textBaseline = "middle";
        const w = g.measureText(text).width;
        const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
        const b = { x: left, y: y - size / 2, w, h: size };
        const fill = paintOf(node.props.fill === undefined ? "#000000" : strOf(node, "fill", scope), b, f, scope);
        if (fill) {
          const deep = depthOn(node, scope, f, solidOf(node.props.fill === undefined ? "#000000" : strOf(node, "fill", scope), f, scope));
          g.fillStyle = fill; g.fillText(text, x, y);
          if (deep) depthOff(g);
        }
        const stroke = paintOf(node.props.stroke === undefined ? undefined : strOf(node, "stroke", scope), b, f, scope);
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = Math.max(0, n("width", 1)); g.strokeText(text, x, y); }
        addGeom(f, { kind: "rect", m: f.m, ...b, text: true });
        if (f.press) for (const r of f.press.open) r.words.push(text);
      });
      return;
    }
    case "group":
    case "use": {
      let kids = node.children, inner = scope;
      if (node.type === "use") {
        const d = node.text === undefined ? undefined : f.defs.get(node.text);
        if (!d || f.useDepth >= MAX_USE_DEPTH) return;
        kids = d.children;
        // args={{h: 60, tint: '#fff'}}: names the drawing reads, for this use only.
        const args = node.props.args === undefined ? undefined : read(node, "args", scope);
        if (args !== undefined && isRecord(args)) {
          const rec = args as Readonly<Record<string, Value>>;
          inner = (name) => (Object.hasOwn(rec, name) ? rec[name] : scope(name));
        }
      }
      const g2 = f.g;
      const was = f.m;
      g2.save();
      const gx = n("x"), gy = n("y");
      g2.translate(gx, gy);
      f.m = translate(f.m, gx, gy);
      const deg = n("rotate");
      if (deg) { g2.rotate((deg * Math.PI) / 180); f.m = rotate(f.m, (deg * Math.PI) / 180); }
      const s = n("scale", 1);
      if (s !== 1) { g2.scale(s, s); f.m = scale(f.m, s, s); }
      if (node.props.opacity !== undefined) g2.globalAlpha *= Math.min(1, Math.max(0, n("opacity", 1)));
      const rec = f.press, outer = rec?.locate;
      if (node.type === "use") {
        f.useDepth++;
        if (rec && outer) {
          rec.copy.push(node.id);
          // A drawing's args are its own names: reading them is fine, writing them goes nowhere.
          const args = inner === scope ? undefined : inner;
          if (args) rec.locate = (name) => (args(name) !== scope(name) ? null : outer(name));
        }
      }
      drawAll(kids, inner, f);
      if (node.type === "use") { f.useDepth--; if (rec && outer) { rec.copy.pop(); rec.locate = outer; } }
      g2.restore();
      f.m = was;
      return;
    }
  }
}


/** Draw a whole scene in its own coordinates: its background, then its lines. */
export function paintScene(f: Frame, nodes: readonly SayShapeNode[], scope: Scope, w: number, h: number, bg: string | undefined): void {
  collect(nodes, f);
  if (f.press) f.press.alpha = f.g.globalAlpha;
  const fill = paintOf(bg, { x: 0, y: 0, w, h }, f, scope);
  if (fill) { f.g.fillStyle = fill; f.g.fillRect(0, 0, w, h); }
  drawAll(nodes, scope, f);
}
