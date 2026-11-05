/**
 * World map. Kept in its own entry point (`loom-ui/map`) because the country
 * outlines add ~76 KB that most screens don't need.
 *
 * Country shapes: Natural Earth 1:110m (public domain) via world-atlas,
 * pre-projected with the Natural Earth I projection by scripts/build-world.mjs.
 */
import type { ComponentDef } from "../../component";
import type { Box, SayShapeNode } from "../../types";
import world from "./world.json";

interface WorldData { w: number; h: number; k: number; t: [number, number]; c: Array<[string, string]> }
const WORLD = world as unknown as WorldData;

let paths: Array<{ name: string; path: Path2D }> | null = null;
function countryPaths() {
  if (!paths) paths = WORLD.c.map(([name, d]) => ({ name, path: new Path2D(d) }));
  return paths;
}

/** All country names the map knows, for docs and validation. */
export const COUNTRY_NAMES: readonly string[] = WORLD.c.map((c) => c[0]);

/** Natural Earth I projection, matching the pre-projected outlines. */
export function project(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180, f = (lat * Math.PI) / 180, f2 = f * f, f4 = f2 * f2;
  const x = l * (0.8707 - 0.131979 * f2 + f4 * (-0.013791 + f4 * (0.003971 * f2 - 0.001529 * f4)));
  const y = f * (1.007226 + f2 * (0.015085 + f4 * (-0.044475 + 0.028874 * f2 - 0.005916 * f4)));
  return [WORLD.t[0] + WORLD.k * x, WORLD.t[1] - WORLD.k * y];
}

let probe: CanvasRenderingContext2D | null = null;
function countryAt(mx: number, my: number): string | null {
  // Outside a browser (tests, server rendering) there's no canvas to test points with.
  if (!probe && typeof document === "undefined") return null;
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  for (const c of countryPaths()) if (probe.isPointInPath(c.path, mx, my)) return c.name;
  return null;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const PIN_TONES = ["accent", "good", "warn", "bad", "muted"] as const;
type PinTone = (typeof PIN_TONES)[number];
interface MapPinPoint {
  node: SayShapeNode;
  label: string;
  x: number;
  y: number;
  tone: PinTone;
  size: number;
}


export const map: ComponentDef = {
  type: "map",
  category: "data",
  description: "A world map with clickable countries and selectable pins. Highlight countries by name; plot places with optional status colors and sizes.",
  props: {
    highlight: { type: "string", description: "Comma-separated country names to tint, e.g. \"Japan,Brazil\"." },
    bind: { type: "state", description: "State name that receives the clicked country or marker label." },
  },
  children: ["pin"],
  example: `state picked=none
map highlight="Japan,Kenya" bind=picked
  pin "Tokyo" lat=35.68 lon=139.69`,
  minWidth: () => 200,
  layout(box, ctx) {
    const s = box.w / WORLD.w;
    box.h = WORLD.h * s;
    // The map and its pins share one projection; each= expands dataset-backed pins here.
    // Calculate geometry during layout so painting and hit testing use identical positions.
    const pins: MapPinPoint[] = [];
    for (const node of ctx.visibleChildren(box.node)) {
      if (node.type !== "pin") continue;
      const p = ctx.props(node);
      const lat = p.num("lat", NaN), lon = p.num("lon", NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        ctx.warn?.(`pin on line ${node.line}: latitude must be -90..90 and longitude -180..180`);
        continue;
      }
      const [x, y] = project(lon, lat);
      pins.push({
        node, label: p.text(), x, y,
        tone: p.oneOf("tone", PIN_TONES, "accent"),
        size: Math.max(2, Math.min(18, p.num("size", 5))),
      });
    }
    box.data = { scale: s, pins };
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const s = (box.data as { scale: number }).scale;
    const highlighted = new Set(list(p.str("highlight")));
    const bind = p.raw("bind");
    const selected = bind ? p.bound() : null;
    const hovered = ctx.hover && ctx.hover.node.id === box.node.id ? (ctx.hover.detail as string | undefined) : undefined;
    g.save();
    g.translate(box.x, box.y);
    g.scale(s, s);
    g.lineWidth = 0.7 / s;
    g.lineJoin = "round";
    g.strokeStyle = c.surface;
    for (const { name, path } of countryPaths()) {
      g.fillStyle = name === selected ? c.accent : name === hovered ? c.landHover : highlighted.has(name) ? c.landHighlight : c.land;
      g.fill(path);
      g.stroke(path);
    }
    g.restore();
    ctx.addHit(box, { focusable: false });
  },
  paintOver(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const { scale: s, pins } = box.data as { scale: number; pins: MapPinPoint[] };
    const selected = ctx.props(box.node).raw("bind") ? ctx.props(box.node).bound() : null;
    for (const pin of pins) {
      g.globalAlpha = ctx.appear(pin.node);
      const x = box.x + pin.x * s, y = box.y + pin.y * s;
      if (selected === pin.label) {
        g.beginPath();
        g.arc(x, y, pin.size + 4, 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = c.focus;
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, pin.size, 0, Math.PI * 2);
      g.fillStyle = c[pin.tone];
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = c.surface;
      g.stroke();
      g.font = ctx.font(600, 12);
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.lineWidth = 3;
      g.strokeStyle = c.surface;
      g.strokeText(pin.label, x + pin.size + 4, y);
      g.fillStyle = c.ink;
      g.fillText(pin.label, x + pin.size + 4, y);
    }
    g.globalAlpha = 1;
    const hovered = ctx.hover && ctx.hover.node.id === box.node.id ? (ctx.hover.detail as string | undefined) : undefined;
    const pointer = ctx.pointer;
    if (hovered && pointer) tooltip(ctx.g, hovered, pointer.x, pointer.y, box, ctx.font(600, 12), c.ink, c.surface);
  },
  hitTest(box, x, y) {
    const { scale: s, pins } = box.data as { scale: number; pins: MapPinPoint[] };
    // Test pins first (latest drawn wins) so an overlapping country cannot steal clicks.
    for (let i = pins.length - 1; i >= 0; i--) {
      const pin = pins[i]!;
      const dx = x - (box.x + pin.x * s), dy = y - (box.y + pin.y * s);
      if (dx * dx + dy * dy <= (pin.size + 4) ** 2) return { detail: pin.label };
    }
    const name = countryAt((x - box.x) / s, (y - box.y) / s);
    return name ? { detail: name } : null;
  },
  press(ctx) {
    const bind = ctx.props(ctx.target.node).raw("bind");
    if (bind && typeof ctx.target.detail === "string") ctx.set(bind, ctx.target.detail);
  },
  cursor: (t) => (t.detail ? "pointer" : "default"),
};

export const pin: ComponentDef = {
  type: "pin",
  category: "data",
  description: "A labelled point on a map, placed by latitude and longitude.",
  text: { description: "The place name shown next to the pin.", required: true },
  props: {
    lat: { type: "number", required: true, description: "Latitude in degrees (-90 to 90)." },
    lon: { type: "number", required: true, description: "Longitude in degrees (-180 to 180)." },
    tone: { type: "enum", values: PIN_TONES, default: "accent", description: "Theme color for a marker: accent, good, warn, bad or muted. Supports state expressions for data-driven status colors." },
    size: { type: "number", default: 5, description: "Marker radius in screen pixels, clamped to 2..18. Supports expressions for bubble-like visualizations." },
  },
  parents: ["map"],
  example: `pin "Nairobi" lat=-1.29 lon=36.82 tone=good size=7`,
  layout(box) {
    box.h = 0;
  },
};

function tooltip(g: CanvasRenderingContext2D, text: string, px: number, py: number, box: Box, font: string, bg: string, fg: string): void {
  g.font = font;
  const w = g.measureText(text).width + 16;
  const x = Math.min(px + 14, box.x + box.w - w - 4);
  const y = Math.max(box.y + 4, py - 32);
  g.beginPath();
  g.roundRect?.(x, y, w, 24, 6);
  g.fillStyle = bg;
  g.fill();
  g.fillStyle = fg;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(text, x + 8, y + 12.5);
}

export const mapComponents = [map, pin];
