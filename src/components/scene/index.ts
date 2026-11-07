/**
 * EXPERIMENTAL, opt-in: `scene`, a free drawing the model paints itself.
 *
 * Every other element is designed by the engine and the model only picks
 * roles. A scene is the one place where the model is the painter: it draws
 * with shapes (rect, circle, ellipse, line, path, polygon, label), groups and
 * reusable drawings, in colors it chooses, and animates them by writing props
 * as formulas of t, the seconds since the scene started.
 *
 * It's off unless a host registers sceneComponents (this separate entry
 * point, like map), so turning it off is leaving it out: without it, "scene"
 * is an unknown element and the language is exactly what it was.
 *
 * It keeps the rules that matter: a scene is data and formulas, never code
 * (its math is SCENE_FUNCTIONS, pure functions only lines inside a scene can
 * call); it streams line by line; it draws on the canvas. It is the one,
 * deliberate exception to "components never hard-code design" (CLAUDE.md
 * rule 4): colors in a scene are the model's.
 *
 * Shapes have no boxes of their own: the scene lays out as one box, scaled to
 * its width, and draws its lines itself each frame (like compare-row).
 */
import { literal } from "../../actions";
import type { ComponentDef, PaintContext, PropDef } from "../../component";
import { evaluate, interpolate, wholeExpression, type Scope } from "../../expr";
import { DEFAULT_AS } from "../../each";
import { isList, isRecord } from "../../data";
import type { Box, SayShapeNode, Value } from "../../types";
import { SCENE_FUNCTIONS, SCENE_NAMES } from "./functions";
import { points, tracePath, type Bounds } from "./path";

export { SCENE_FUNCTIONS, MAX_RANGE } from "./functions";

/** The most shapes a scene draws in one frame; past it, the rest are left out. */
export const MAX_SCENE_SHAPES = 2000;
/** The most lines a scene works through in one frame (shapes, each copies, uses), so nothing can stall it. */
export const MAX_SCENE_STEPS = 20000;
/** How deep `use` may go inside other uses, so a drawing that uses itself stops. */
export const MAX_USE_DEPTH = 8;
/** The tallest a scene is laid out, in pixels. */
const MAX_SCENE_HEIGHT = 2000;

/** What a scene and its groups and drawings hold. */
const SHAPES = ["rect", "circle", "ellipse", "line", "path", "polygon", "label", "group", "use", "define", "gradient"] as const;
const IN_SCENE = ["scene", "group", "define"] as const;

const num = (description: string, def?: number): PropDef => (def === undefined ? { type: "number", description } : { type: "number", description, default: def });
const color = (description: string): PropDef => ({ type: "string", description });

/** Props every shape takes. */
const PAINT: Record<string, PropDef> = {
  fill: color('Fill color: "#hex", rgb(), hsl() or a color name, or url(id) for a gradient. "none" for no fill.'),
  stroke: color("Outline color, like fill. No outline unless set."),
  width: num("Outline width in scene pixels.", 1),
  opacity: num("0 (invisible) to 1 (solid).", 1),
  rotate: num("Turn it by this many degrees around its center (a formula of t spins it)."),
  dash: { type: "string", description: 'A dashed outline: dash and gap lengths, like dash="6 4".' },
};

const leaf = { layout: (box: Box) => { box.h = 0; }, semantics: () => false as const, parents: IN_SCENE } satisfies Partial<ComponentDef>;

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

const numOf = (node: SayShapeNode, key: string, scope: Scope, fallback = 0): number => {
  const v = read(node, key, scope);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const strOf = (node: SayShapeNode, key: string, scope: Scope): string | undefined => {
  const v = read(node, key, scope);
  return v === undefined || v === null ? undefined : String(v);
};

/** Colors the canvas understands, nothing else: hex, rgb(a), hsl(a), names, none and transparent. */
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%+-]*\)|[a-z]{3,20})$/i;
const GRADIENT_REF = /^url\(#?([A-Za-z_][\w-]*)\)$/;

// ---------- painting ----------

interface Frame {
  g: CanvasRenderingContext2D;
  ctx: PaintContext;
  defs: Map<string, SayShapeNode>;
  gradients: Map<string, SayShapeNode>;
  shapes: number;
  steps: number;
  useDepth: number;
}

/** define and gradient lines anywhere in the scene (not inside a define's own drawing). */
function collect(nodes: readonly SayShapeNode[], f: Frame): void {
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
    const from = strOf(gn, "from", scope) ?? "#ffffff", to = strOf(gn, "to", scope) ?? "#000000";
    if (!COLOR.test(from) || !COLOR.test(to)) return null;
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
  return COLOR.test(v) ? v : null;
}

/** Fill and stroke the path just traced, with the shape's paint props. */
function finishShape(node: SayShapeNode, scope: Scope, bounds: Bounds, f: Frame, defaultFill: string | null): void {
  const g = f.g;
  const fillRaw = node.props.fill === undefined ? (defaultFill ?? undefined) : strOf(node, "fill", scope);
  const fill = paintOf(fillRaw, bounds, f, scope);
  if (fill) { g.fillStyle = fill; g.fill(); }
  const stroke = paintOf(node.props.stroke === undefined ? undefined : strOf(node, "stroke", scope), bounds, f, scope);
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(0, numOf(node, "width", scope, 1));
    g.lineCap = "round";
    g.lineJoin = "round";
    const dash = strOf(node, "dash", scope);
    g.setLineDash(dash ? (dash.match(/\d+(\.\d+)?/g) ?? []).map(Number).filter((x) => x >= 0).slice(0, 8) : []);
    g.stroke();
  }
}

/** Apply opacity and a rotation around (cx, cy), then draw, then undo them. */
function withLook(node: SayShapeNode, scope: Scope, f: Frame, cx: number, cy: number, draw: () => void): void {
  const g = f.g;
  g.save();
  if (node.props.opacity !== undefined) g.globalAlpha *= Math.min(1, Math.max(0, numOf(node, "opacity", scope, 1)));
  const deg = node.props.rotate === undefined ? 0 : numOf(node, "rotate", scope, 0);
  if (deg) { g.translate(cx, cy); g.rotate((deg * Math.PI) / 180); g.translate(-cx, -cy); }
  draw();
  g.restore();
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
function drawAll(nodes: readonly SayShapeNode[], scope: Scope, f: Frame): void {
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
  const r = evaluate(wholeExpression(raw) ?? raw, scope, SCENE_FUNCTIONS);
  if (!r.ok || !isList(r.value)) return;
  const as = node.props.as ?? DEFAULT_AS, index = node.props.index;
  const items = r.value;
  for (let i = 0; i < items.length && f.steps <= MAX_SCENE_STEPS; i++) {
    const item = items[i]!;
    drawAll(node.children, (name) => (name === as ? item : name === index ? i : scope(name)), f);
  }
}

function drawOne(node: SayShapeNode, scope: Scope, f: Frame): void {
  const g = f.g;
  const n = (k: string, d = 0) => numOf(node, k, scope, d);
  switch (node.type) {
    case "rect": {
      const x = n("x"), y = n("y"), w = Math.max(0, n("w")), h = Math.max(0, n("h"));
      const b = { x, y, w, h };
      f.shapes++;
      withLook(node, scope, f, x + w / 2, y + h / 2, () => { g.beginPath(); roundRect(g, x, y, w, h, n("rx")); finishShape(node, scope, b, f, "#000000"); });
      return;
    }
    case "circle": {
      const x = n("x"), y = n("y"), r = Math.max(0, n("r"));
      f.shapes++;
      withLook(node, scope, f, x, y, () => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); finishShape(node, scope, { x: x - r, y: y - r, w: 2 * r, h: 2 * r }, f, "#000000"); });
      return;
    }
    case "ellipse": {
      const x = n("x"), y = n("y"), rx = Math.max(0, n("rx")), ry = Math.max(0, n("ry"));
      f.shapes++;
      withLook(node, scope, f, x, y, () => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); finishShape(node, scope, { x: x - rx, y: y - ry, w: 2 * rx, h: 2 * ry }, f, "#000000"); });
      return;
    }
    case "line": {
      const x1 = n("x1"), y1 = n("y1"), x2 = n("x2"), y2 = n("y2");
      const b = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      f.shapes++;
      // A line is all outline: it uses stroke, or black when none is given.
      const lined: SayShapeNode = node.props.stroke === undefined ? { ...node, props: { ...node.props, stroke: '"#000000"' } } : node;
      withLook(node, scope, f, b.x + b.w / 2, b.y + b.h / 2, () => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); finishShape({ ...lined, props: { ...lined.props, fill: "none" } }, scope, b, f, null); });
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
      });
      return;
    }
    case "label": {
      const x = n("x"), y = n("y"), size = Math.min(400, Math.max(1, n("size", 16)));
      const text = node.text === undefined ? "" : interpolate(node.text, scope, SCENE_FUNCTIONS);
      if (!text) return;
      f.shapes++;
      withLook(node, scope, f, x, y, () => {
        g.font = f.ctx.font(strOf(node, "weight", scope) === "bold" ? 800 : 500, size);
        const align = strOf(node, "align", scope);
        g.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
        g.textBaseline = "middle";
        const w = g.measureText(text).width;
        const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
        const b = { x: left, y: y - size / 2, w, h: size };
        const fill = paintOf(node.props.fill === undefined ? "#000000" : strOf(node, "fill", scope), b, f, scope);
        if (fill) { g.fillStyle = fill; g.fillText(text, x, y); }
        const stroke = paintOf(node.props.stroke === undefined ? undefined : strOf(node, "stroke", scope), b, f, scope);
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = Math.max(0, n("width", 1)); g.strokeText(text, x, y); }
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
      g2.save();
      g2.translate(n("x"), n("y"));
      const deg = n("rotate");
      if (deg) g2.rotate((deg * Math.PI) / 180);
      const s = n("scale", 1);
      if (s !== 1) g2.scale(s, s);
      if (node.props.opacity !== undefined) g2.globalAlpha *= Math.min(1, Math.max(0, n("opacity", 1)));
      if (node.type === "use") f.useDepth++;
      drawAll(kids, inner, f);
      if (node.type === "use") f.useDepth--;
      g2.restore();
      return;
    }
  }
}

/** The scene's time in seconds for this frame, asking for the next frame while it moves. */
export function sceneTime(box: Box, ctx: PaintContext, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  // Without motion (the animate option, or reduced motion), a still: the end of the animation.
  if (!ctx.motion) return duration;
  const view = ctx.view(box.node);
  if (view.start === undefined) view.start = ctx.now;
  const elapsed = Math.max(0, (ctx.now - view.start) / 1000);
  if (loop) { ctx.requestFrame(); return elapsed % duration; }
  if (elapsed < duration) ctx.requestFrame();
  return Math.min(elapsed, duration);
}

// ---------- the elements ----------

const scene: ComponentDef = {
  type: "scene",
  category: "content",
  description:
    "EXPERIMENTAL: a picture or animation you paint yourself from shapes, for what no other element shows (a goal celebration, a rabbit hopping, a car on a road). " +
    "Draw back to front on a w×h canvas with rect, circle, ellipse, line, path, polygon and label in colors you choose, and animate any prop as a formula of t, the seconds since it started.",
  text: { description: "What the picture shows, in a few words, for screen readers.", required: true },
  props: {
    w: num("Width of the drawing area, in scene pixels. Shapes use these coordinates; the scene is scaled to fit the screen.", 600),
    h: num("Height of the drawing area, in scene pixels.", 340),
    duration: num("Seconds the animation runs (t goes from 0 to this). 0 is a still picture.", 0),
    loop: { type: "boolean", description: "Start again when it ends.", default: true },
    bg: color("Background color behind everything."),
  },
  children: SHAPES,
  provides: { names: SCENE_NAMES, functions: SCENE_FUNCTIONS },
  picks: [{ for: "a picture or animation no other element can show", write: 'scene "A rabbit hopping across a meadow" w=600 h=340 duration=3' }],
  example: `scene "The sun rising over hills" w=600 h=300 duration=4 bg="#0B1D3A"
  # Inside a scene: t (seconds) and PI, and sin, cos, tan, atan2, sqrt, clamp(x, lo, hi), lerp(a, b, u),
  # ease(t, start, end) (0 to 1, eased), wave(t, seconds) (0 to 1 and back), random(seed) (the same 0 to 1 each time),
  # range(n) for each, and pick(list, i). Colors are "#hex" here only. Reuse a drawing with define and use.
  gradient id=sky from="#0B1D3A" to="#F28C38" angle=90
  rect x=0 y=0 w=600 h=300 fill="url(sky)" opacity={ease(t, 0, 3)}
  circle x=300 y={300 - 160*ease(t, 0, 3)} r=40 fill="#FFD166"
  each items={range(3)} as=i
    ellipse x={100 + i*200} y=300 rx=180 ry={70 + 20*i} fill={pick(['#2D6A4F', '#40916C', '#52B788'], i)}
  label "Good morning" x=300 y=60 size=28 weight=bold fill="#FFFFFF" align=center opacity={ease(t, 2, 3)}`,
  minWidth: () => 120,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const w = Math.max(1, p.num("w", 600)), h = Math.max(1, p.num("h", 340));
    box.h = Math.min(MAX_SCENE_HEIGHT, (box.w * h) / w);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const w = Math.max(1, p.num("w", 600)), h = Math.max(1, p.num("h", 340));
    const t = sceneTime(box, ctx, p.num("duration", 0), p.bool("loop", true));
    const base: Scope = (name) => (name === "t" ? t : name === "PI" ? Math.PI : ctx.scope(name));
    const g = ctx.g;
    const f: Frame = { g, ctx, defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0 };
    collect(box.node.children, f);
    g.save();
    g.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, ctx.theme.radius.md);
    g.clip();
    g.translate(box.x, box.y);
    g.scale(box.w / w, box.h / h);
    const bg = paintOf(p.raw("bg") === undefined ? undefined : p.str("bg"), { x: 0, y: 0, w, h }, f, base);
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    drawAll(box.node.children, base, f);
    g.restore();
  },
  semantics: (box, ctx) => ({ role: "img", name: ctx.props(box.node).text() || "Picture" }),
};

const rect: ComponentDef = {
  ...leaf,
  type: "rect",
  category: "content",
  description: "A rectangle in a scene, from its top-left corner.",
  props: { x: num("Left edge."), y: num("Top edge."), w: num("Width."), h: num("Height."), rx: num("Corner rounding."), ...PAINT },
  example: `rect x=40 y=40 w=160 h=90 rx=12 fill="#F4A261" rotate={t*20}`,
};

const circle: ComponentDef = {
  ...leaf,
  type: "circle",
  category: "content",
  description: "A circle in a scene, from its center.",
  props: { x: num("Center, across."), y: num("Center, down."), r: num("Radius."), ...PAINT },
  example: `circle x={80 + 200*ease(t, 0, 2)} y=120 r=30 fill="#E63946"`,
};

const ellipse: ComponentDef = {
  ...leaf,
  type: "ellipse",
  category: "content",
  description: "An oval in a scene, from its center.",
  props: { x: num("Center, across."), y: num("Center, down."), rx: num("Half the width."), ry: num("Half the height."), ...PAINT },
  example: `ellipse x=300 y=200 rx=120 ry=40 fill="#2A9D8F"`,
};

const line: ComponentDef = {
  ...leaf,
  type: "line",
  category: "content",
  description: "A straight line in a scene. Give it a stroke and width.",
  props: { x1: num("Start, across."), y1: num("Start, down."), x2: num("End, across."), y2: num("End, down."), ...PAINT },
  example: `line x1=20 y1=200 x2=580 y2=200 stroke="#FFFFFF" width=4 dash="16 12"`,
};

const path: ComponentDef = {
  ...leaf,
  type: "path",
  category: "content",
  description: "Any outline, in SVG path commands (M move, L line, H, V, C and S curves, Q and T curves, A arc, Z close). For curved shapes: ears, hills, a car body, a wave.",
  props: { d: { type: "string", description: 'The path, like d="M20 200 Q150 60 280 200 Z". It may hold {formulas}.' }, ...PAINT },
  example: `path d="M20 220 Q160 {120 + 40*sin(t*2)} 300 220 T580 220 L580 300 L20 300 Z" fill="#264653"`,
};

const polygon: ComponentDef = {
  ...leaf,
  type: "polygon",
  category: "content",
  description: "A closed shape through points, for triangles, stars, mountains and roofs.",
  props: { points: { type: "string", description: 'x,y pairs: points="300,40 360,160 240,160". They may hold {formulas}.' }, ...PAINT },
  example: `polygon points="300,40 380,180 220,180" fill="#E9C46A"`,
};

const label: ComponentDef = {
  ...leaf,
  type: "label",
  category: "content",
  description: "Words drawn in a scene, centered vertically on y: a big GOAL!, a score, a sign.",
  text: { description: "The words; may hold {formulas}.", required: true },
  props: {
    x: num("Where it's anchored, across."),
    y: num("Its middle, down."),
    size: num("Text size in scene pixels.", 16),
    weight: { type: "enum", values: ["regular", "bold"], description: "regular or bold.", default: "regular" },
    align: { type: "enum", values: ["left", "center", "right"], description: "Which end of the words sits at x.", default: "left" },
    ...PAINT,
  },
  example: `label "GOAL!" x=300 y=120 size={60 + 20*wave(t, 1)} weight=bold align=center fill="#FFFFFF"`,
};

const group: ComponentDef = {
  type: "group",
  category: "content",
  description: "Shapes moved, turned, scaled or faded together: a car and its wheels, a waving arm. Its shapes are placed relative to its x and y.",
  props: { x: num("Moves everything across."), y: num("Moves everything down."), rotate: num("Turns everything, in degrees, around the group's x and y."), scale: num("Grows or shrinks everything.", 1), opacity: num("Fades everything, 0 to 1.", 1) },
  children: SHAPES,
  parents: IN_SCENE,
  example: `group x={600*((t/3) % 1)} y=200
  rect x=-40 y=-20 w=80 h=24 rx=6 fill="#E63946"
  circle x=-22 y=6 r=9 fill="#222222"
  circle x=22 y=6 r=9 fill="#222222"`,
  layout: (box) => { box.h = 0; },
  semantics: () => false,
};

const define: ComponentDef = {
  type: "define",
  category: "content",
  description: "A reusable drawing: name it, draw it under this line around 0,0, and draw it anywhere with use. It reads names its use passes in args.",
  text: { description: "The drawing's name, used by use.", required: true },
  props: {},
  children: SHAPES,
  parents: ["scene"],
  provides: { anyNames: true },
  example: `define "cactus"
  rect x=-8 y={-h} w=16 h={h} rx=8 fill="#1B4332"
  rect x=8 y={-h*0.7} w=18 h=10 rx=5 fill="#1B4332"`,
  layout: (box) => { box.h = 0; },
  semantics: () => false,
};

const use: ComponentDef = {
  ...leaf,
  type: "use",
  category: "content",
  description: "Draws a defined drawing here, moved, turned and scaled like a group. Pass the names it reads in args.",
  text: { description: "The name of the drawing (its define line).", required: true },
  props: {
    x: num("Across."), y: num("Down."), rotate: num("Degrees."), scale: num("Size.", 1), opacity: num("0 to 1.", 1),
    args: { type: "expression", description: "A record of the names the drawing reads, like args={{h: 60, lean: -5}}." },
  },
  example: `use "cactus" x=120 y=300 scale=1.2 args={{h: 70}}`,
};

const gradient: ComponentDef = {
  ...leaf,
  type: "gradient",
  category: "content",
  description: "A color blend to fill shapes with fill=\"url(id)\": a sky, a glow, a shiny ball.",
  props: {
    id: { type: "name", description: "Its name, for url(id).", required: true },
    from: color("The first color."),
    to: color("The last color."),
    kind: { type: "enum", values: ["linear", "radial"], description: "linear (a straight blend) or radial (from the middle out).", default: "linear" },
    angle: num("Direction of a linear blend in degrees: 90 is top to bottom, 0 left to right.", 90),
  },
  example: `gradient id=glow kind=radial from="#FFF3B0" to="#FF8A3D"`,
};

/**
 * The scene elements. Register them to turn scenes on:
 *   new SayShape(canvas, { components: [...coreComponents, ...sceneComponents] })
 * Leave them out and scenes are off: "scene" is then an unknown element.
 */
export const sceneComponents: ComponentDef[] = [scene, rect, circle, ellipse, line, path, polygon, label, group, define, use, gradient];
