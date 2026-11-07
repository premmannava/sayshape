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
 *
 * A shape, group or use with on= is pressable (interact.ts): the scene
 * records where it drew it, registers a hit region for it, tests hits
 * exactly, runs its actions with the scope it was drawn with, and lists it
 * for screen readers. Hover, focus and selected= are drawn by the engine.
 */
import type { ComponentDef, PaintContext, PropDef } from "../../component";
import type { Scope } from "../../expr";
import type { Box, Rect } from "../../types";
import type { Theme } from "../../theme";
import { SCENE_FUNCTIONS, SCENE_NAMES } from "./functions";
import { paintScene, type Frame } from "./draw";
import { intersect, liveOf, outline, regionBounds, regionHit, regionName, setLive, type SceneRegion } from "./interact";

export { SCENE_FUNCTIONS, MAX_RANGE } from "./functions";
export { MAX_SCENE_SHAPES, MAX_SCENE_STEPS, MAX_USE_DEPTH, THEME_COLORS } from "./draw";
export { reviewScene, reviewScenes, MAX_DRAWING_PROBLEMS, PHONE_WIDTH, type MeasureText } from "./review";
export { liveOf as sceneRegions, type SceneRegion } from "./interact";

/** The tallest a scene is laid out, in pixels. */
const MAX_SCENE_HEIGHT = 2000;

/** What a scene and its groups and drawings hold. */
const SHAPES = ["rect", "circle", "ellipse", "line", "path", "polygon", "label", "group", "use", "define", "gradient"] as const;
const IN_SCENE = ["scene", "group", "define"] as const;

const num = (description: string, def?: number): PropDef => (def === undefined ? { type: "number", description } : { type: "number", description, default: def });
const color = (description: string): PropDef => ({ type: "string", description });

/** Props every shape takes. */
const PAINT: Record<string, PropDef> = {
  fill: color('Fill. Prefer a theme color, which matches the app and dark mode: accent, good, warn, bad, ink, muted, surface, raised, line, onAccent or series1-series6, faded like "bad 15%". Otherwise "#hex", rgb() or hsl(), or url(id) for a gradient. "none" for no fill.'),
  stroke: color("Outline color, like fill (stroke=line for a quiet border). No outline unless set."),
  width: num("Outline width in scene pixels.", 1),
  opacity: num("0 (invisible) to 1 (solid).", 1),
  rotate: num("Turn it by this many degrees around its center (a formula of t spins it)."),
  dash: { type: "string", description: 'A dashed outline: dash and gap lengths, like dash="6 4".' },
};

/** Props that make a shape, group or use pressable. */
const PRESS: Record<string, PropDef> = {
  on: { type: "action", description: "Actions when it's pressed (click, tap, Enter), like a button's on=; makes it pressable and a Tab stop. Inside the scene's each they see the item: on=set:sel:{m.id}." },
  selected: { type: "condition", description: "Draws a selection outline while true, e.g. selected={sel == m.id}." },
  tip: { type: "string", description: "Words shown in a small tag while it's hovered or focused; may hold {formulas}." },
  name: { type: "string", description: "What screen readers call it. Default: the words of its labels, else its tip." },
};

const leaf = { layout: (box: Box) => { box.h = 0; }, semantics: () => false as const, parents: IN_SCENE } satisfies Partial<ComponentDef>;

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
    "Draw back to front on a w×h canvas with rect, circle, ellipse, line, path, polygon and label, in theme colors (accent, bad, ink, surface, line…) where you can, and animate any prop as a formula of t, the seconds since it started.",
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
  # range(n) for each, and pick(list, i). Reuse a drawing with define and use.
  # Colors: theme names first (fill=accent, stroke=line, fill="bad 15%"), "#hex" for anything else.
  # Lay it out cleanly: keep labels inside the picture and clear of each other, say each fact once,
  # and draw connecting lines before the boxes they join, ending at their edges.
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
    const sx = box.w / w, sy = box.h / h;
    const f: Frame = {
      g, font: ctx.font, colors: ctx.theme.colors, defs: new Map(), gradients: new Map(), shapes: 0, steps: 0, useDepth: 0,
      m: [sx, 0, 0, sy, box.x, box.y], press: { regions: [], open: [], copy: [] },
    };
    g.save();
    g.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, ctx.theme.radius.md);
    g.clip();
    g.save();
    g.translate(box.x, box.y);
    g.scale(sx, sy);
    paintScene(f, box.node.children, base, w, h, p.raw("bg") === undefined ? undefined : p.str("bg"));
    g.restore();
    const shown = pressable(box, ctx, f.press!.regions);
    paintFeedback(box, ctx, shown);
    g.restore();
  },
  hitTest(region, x, y, detail) {
    const scene = liveOf(region.node);
    return scene && regionHit(scene, detail, x, y) ? { detail } : null;
  },
  press(ctx) {
    const r = liveOf(ctx.target.node)?.regions.get(String(ctx.target.detail));
    if (r) ctx.run(r.on, r.scope);
  },
  semantics: (box, ctx) => {
    const name = ctx.props(box.node).text() || "Picture";
    const scene = liveOf(box.node);
    const parts = ctx.regions.flatMap((h) => {
      const r = typeof h.detail === "string" ? scene?.regions.get(h.detail) : undefined;
      if (!r) return [];
      const label = regionName(r);
      return [{
        role: "button" as const, name: label, detail: h.detail,
        ...(r.tip && r.tip.trim() !== label ? { description: r.tip.trim() } : {}),
        ...(r.selected !== undefined ? { pressed: r.selected } : {}),
      }];
    });
    // A picture with things to press in it is a figure, so its parts can be reached; a plain one stays an image.
    return parts.length ? { role: "figure", name, parts } : { role: "img", name };
  },
};

// ---------- pressable shapes ----------

/**
 * Register a hit region for each pressable shape that shows inside the scene,
 * in the order they started (a group before the shapes inside it, so the
 * innermost is found first), and keep this frame's regions for hitTest,
 * press and semantics. Returns the ones that show, with their boxes.
 */
function pressable(box: Box, ctx: PaintContext, regions: readonly SceneRegion[]): Array<{ r: SceneRegion; at: Rect }> {
  const byKey = new Map<string, SceneRegion>();
  const shown: Array<{ r: SceneRegion; at: Rect }> = [];
  const area = { x: box.x, y: box.y, w: box.w, h: box.h };
  for (const r of regions) {
    if (byKey.has(r.key) || !r.geoms.length) continue;
    const b = regionBounds(r);
    const at = b && intersect(b, area);
    if (!at) continue;
    byKey.set(r.key, r);
    shown.push({ r, at });
    ctx.addHit({ node: box.node, children: [], ...at }, { detail: r.key });
  }
  setLive(box.node, { box: area, regions: byKey });
  return shown;
}

/** Outline a pressable shape that's selected, hovered or focused, and show the tip of the one in use. */
function paintFeedback(box: Box, ctx: PaintContext, shown: ReadonlyArray<{ r: SceneRegion; at: Rect }>): void {
  if (!shown.length) return;
  const g = ctx.g, c = ctx.theme.colors;
  let tipped: { r: SceneRegion; at: Rect } | null = null;
  for (const s of shown) {
    const hovered = ctx.isHovered(box.node, s.r.key), focused = ctx.isFocused(box.node, s.r.key);
    if (!s.r.selected && !hovered && !focused) continue;
    if ((focused || hovered) && s.r.tip && (!tipped || focused)) tipped = s;
    const strong = !!s.r.selected || focused;
    g.save();
    g.globalAlpha = strong ? 1 : 0.7;
    for (const geom of s.r.geoms) {
      const pts = outline(geom);
      if (pts.length < 2) continue;
      g.beginPath();
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      if (geom.kind !== "line") g.closePath();
      g.lineJoin = "round";
      g.lineCap = "round";
      // A light edge under the accent keeps the outline visible on any color the model chose.
      g.strokeStyle = c.surface;
      g.lineWidth = strong ? 6 : 5;
      g.stroke();
      g.strokeStyle = c.accent;
      g.lineWidth = strong ? 3 : 2;
      g.stroke();
    }
    g.restore();
  }
  if (tipped) paintTip(box, ctx, tipped.r.tip!, tipped.at);
}

/** A small tag with the tip above (or, with no room, below) a shape, kept inside the scene. */
function paintTip(box: Box, ctx: PaintContext, text: string, at: Rect): void {
  const g = ctx.g, theme: Theme = ctx.theme;
  const size = theme.text.caption, padX = theme.space.sm, padY = theme.space.xs + 1;
  g.font = ctx.font(600, size);
  let words = text.trim();
  const room = Math.max(40, box.w - 2 * theme.space.sm - 2 * padX);
  if (g.measureText(words).width > room) {
    while (words.length > 1 && g.measureText(words + "…").width > room) words = words.slice(0, -1);
    words += "…";
  }
  const w = g.measureText(words).width + 2 * padX, h = size + 2 * padY;
  const gap = theme.space.xs;
  let x = at.x + at.w / 2 - w / 2;
  let y = at.y - gap - h;
  if (y < box.y + gap) y = Math.min(at.y + at.h + gap, box.y + box.h - h - gap);
  x = Math.max(box.x + gap, Math.min(x, box.x + box.w - w - gap));
  g.save();
  g.beginPath();
  ctx.roundRect(x, y, w, h, theme.radius.sm);
  g.fillStyle = theme.colors.ink;
  g.fill();
  g.fillStyle = theme.colors.surface;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(words, x + padX, y + h / 2);
  g.restore();
}

const rect: ComponentDef = {
  ...leaf,
  type: "rect",
  category: "content",
  description: "A rectangle in a scene, from its top-left corner.",
  props: { x: num("Left edge."), y: num("Top edge."), w: num("Width."), h: num("Height."), rx: num("Corner rounding."), ...PAINT, ...PRESS },
  example: `rect x=40 y=40 w=160 h=90 rx=12 fill="#F4A261" rotate={t*20}`,
};

const circle: ComponentDef = {
  ...leaf,
  type: "circle",
  category: "content",
  description: "A circle in a scene, from its center.",
  props: { x: num("Center, across."), y: num("Center, down."), r: num("Radius."), ...PAINT, ...PRESS },
  example: `circle x={80 + 200*ease(t, 0, 2)} y=120 r=30 fill="#E63946"`,
};

const ellipse: ComponentDef = {
  ...leaf,
  type: "ellipse",
  category: "content",
  description: "An oval in a scene, from its center.",
  props: { x: num("Center, across."), y: num("Center, down."), rx: num("Half the width."), ry: num("Half the height."), ...PAINT, ...PRESS },
  example: `ellipse x=300 y=200 rx=120 ry=40 fill="#2A9D8F"`,
};

const line: ComponentDef = {
  ...leaf,
  type: "line",
  category: "content",
  description: "A straight line in a scene. Give it a stroke and width.",
  props: { x1: num("Start, across."), y1: num("Start, down."), x2: num("End, across."), y2: num("End, down."), ...PAINT, ...PRESS },
  example: `line x1=20 y1=200 x2=580 y2=200 stroke="#FFFFFF" width=4 dash="16 12"`,
};

const path: ComponentDef = {
  ...leaf,
  type: "path",
  category: "content",
  description: "Any outline, in SVG path commands (M move, L line, H, V, C and S curves, Q and T curves, A arc, Z close). For curved shapes: ears, hills, a car body, a wave.",
  props: { d: { type: "string", description: 'The path, like d="M20 200 Q150 60 280 200 Z". It may hold {formulas}.' }, ...PAINT, ...PRESS },
  example: `path d="M20 220 Q160 {120 + 40*sin(t*2)} 300 220 T580 220 L580 300 L20 300 Z" fill="#264653"`,
};

const polygon: ComponentDef = {
  ...leaf,
  type: "polygon",
  category: "content",
  description: "A closed shape through points, for triangles, stars, mountains and roofs.",
  props: { points: { type: "string", description: 'x,y pairs: points="300,40 360,160 240,160". They may hold {formulas}.' }, ...PAINT, ...PRESS },
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
    ...PRESS,
  },
  example: `label "GOAL!" x=300 y=120 size={60 + 20*wave(t, 1)} weight=bold align=center fill="#FFFFFF"`,
};

const group: ComponentDef = {
  type: "group",
  category: "content",
  description: "Shapes moved, turned, scaled or faded together: a car and its wheels, a waving arm. Its shapes are placed relative to its x and y.",
  props: { x: num("Moves everything across."), y: num("Moves everything down."), rotate: num("Turns everything, in degrees, around the group's x and y."), scale: num("Grows or shrinks everything.", 1), opacity: num("Fades everything, 0 to 1.", 1), ...PRESS },
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
    ...PRESS,
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
    from: color("The first color: a theme color or \"#hex\", like fill."),
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
